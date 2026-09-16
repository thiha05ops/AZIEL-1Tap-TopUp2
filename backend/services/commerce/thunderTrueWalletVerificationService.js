"use strict";

const crypto = require("crypto");
const { createThunderApiClient } = require("../thunderApiClient");
const { toThbSatang } = require("./thbMinorUnits");
const { THUNDER_TRUEWALLET_PROVIDER_ID, THUNDER_TRUEWALLET_VERIFIED_EVENT } = require("./providers/thunderTrueWalletAdapter");
const { diagnosticTag, logThunderDiagnostic } = require("../../utils/thunderDiagnostics");

const TRUEWALLET_PROVIDER_IDENTIFIERS = Object.freeze(new Set([
    "TRUEMONEYWALLET",
    "TRUEWALLET"
]));

class ThunderTrueWalletVerificationError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "ThunderTrueWalletVerificationError";
        this.code = code;
        this.httpStatus = options.httpStatus || 422;
        this.retryable = options.retryable === true;
        this.evidenceBound = options.evidenceBound === true;
    }
}

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).replace(/[\s-]+/g, "_").toUpperCase(); }
function fail(code, message, options = {}) { throw new ThunderTrueWalletVerificationError(code, message, options); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function normalizeThaiWalletAccount(value) {
    const compact = text(value).replace(/[\s()-]/g, "");
    let digits;
    if (/^\+66\d{9}$/.test(compact)) digits = `0${compact.slice(3)}`;
    else if (/^66\d{9}$/.test(compact)) digits = `0${compact.slice(2)}`;
    else digits = compact;
    if (!/^0\d{9}$/.test(digits)) return "";
    return digits;
}

function normalizeTransactionId(value) {
    const id = text(value);
    if (!id || id.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(id)) return "";
    return id.toUpperCase();
}

function trueWalletIdentifier(matchedAccount = {}) {
    const bank = isObject(matchedAccount.bank) ? matchedAccount.bank : {};
    return [bank.code, bank.shortCode].map(upper).find(value => TRUEWALLET_PROVIDER_IDENTIFIERS.has(value)) || "";
}

function createThunderTrueWalletVerificationService(dependencies = {}) {
    const attempts = dependencies.paymentAttemptRepository;
    const orders = dependencies.orderRepository;
    const orchestrator = dependencies.paymentOrchestrator;
    const logger = dependencies.logger || console;
    const client = dependencies.thunderClient || createThunderApiClient({ ...(dependencies.thunderClientOptions || {}), logger });
    const clock = dependencies.clock || (() => new Date());
    const expectedReceiver = normalizeThaiWalletAccount(dependencies.receiverAccount || process.env.AZIEL_TRUEMONEY_RECEIVER_ACCOUNT);
    if (!attempts || !orders || !orchestrator) throw new TypeError("TrueMoney verification dependencies are required.");
    if (!expectedReceiver) throw new ThunderTrueWalletVerificationError("TRUEWALLET_NOT_CONFIGURED", "TrueMoney Wallet verification is unavailable.", { httpStatus: 503, retryable: true });

    async function verify(input = {}) {
        const owner = input.owner || {};
        const diagnostic = { correlationId: input.correlationId || "", orderTag: diagnosticTag(input.subjectId || input.orderId), attemptTag: diagnosticTag(input.attemptId) };
        const diag = (event, fields = {}, level = "info") => logThunderDiagnostic(logger, event, { ...diagnostic, ...fields }, level);
        const attempt = await attempts.findAttemptByIdForOwner({ attemptId: text(input.attemptId), owner });
        let order;
        if (attempt && typeof orchestrator.loadOwnedPaymentSubject === "function") {
            order = (await orchestrator.loadOwnedPaymentSubject({ attempt, owner })).subject;
        } else {
            order = await orders.findOwnedOrderById({ orderId: text(input.orderId), owner });
        }
        const subjectId = text(attempt?.subjectId || attempt?.orderId);
        const loadedSubjectId = text(order?.topupId || order?.orderId);
        if (!attempt || !order || subjectId !== loadedSubjectId) fail("TRUEWALLET_PAYMENT_NOT_FOUND", "Payment attempt was not found.", { httpStatus: 404 });
        if (upper(attempt.provider) !== THUNDER_TRUEWALLET_PROVIDER_ID || text(attempt.confirmationMode) !== "thunder_truewallet_slip") fail("TRUEWALLET_FLOW_REQUIRED", "This payment does not support TrueMoney verification.");
        const walletSubject = upper(attempt.subjectType) === "WALLET_TOPUP";
        if (upper(attempt.status) !== "PENDING" || (!walletSubject && (text(order.status).toLowerCase() !== "pending_payment" || text(order.paymentStatus || order.payment?.status).toLowerCase() !== "pending")) || (walletSubject && text(order.paymentStatus).toLowerCase() !== "pending")) {
            fail("TRUEWALLET_PAYMENT_INACTIVE", "This payment attempt is no longer eligible for verification.", { httpStatus: 409, evidenceBound: true });
        }
        if (attempt.expiresAt && new Date(attempt.expiresAt).getTime() <= clock().getTime()) {
            fail("TRUEWALLET_PAYMENT_EXPIRED", "This TrueMoney Wallet payment attempt has expired.", { httpStatus: 409, evidenceBound: true });
        }
        if (upper(attempt.currency) !== "THB") fail("TRUEWALLET_CURRENCY_UNSUPPORTED", "TrueMoney verification supports THB only.", { evidenceBound: true });

        let expectedSatang;
        try { expectedSatang = toThbSatang(attempt.amount); }
        catch (_) { fail("TRUEWALLET_AMOUNT_INVALID", "The expected payment amount is invalid.", { evidenceBound: true }); }
        if (!Buffer.isBuffer(input.fileBuffer) || input.fileBuffer.length === 0 || input.fileBuffer.length > 4 * 1024 * 1024) fail("TRUEWALLET_INVALID_IMAGE", "Please upload a valid TrueMoney transfer slip.", { evidenceBound: true });

        let response;
        try {
            response = await client.verifyTrueWallet({
                base64: input.fileBuffer.toString("base64"),
                remark: `AZIEL ${subjectId} ${text(attempt.attemptId)}`.slice(0, 100),
                matchAmount: attempt.amount,
                ...diagnostic
            });
        } catch (error) {
            const status = error.code === "THUNDER_QUOTA_EXCEEDED" ? 503 : (error.retryable ? 503 : 422);
            fail(error.code || "THUNDER_UNAVAILABLE", error.message || "Payment verification is temporarily unavailable.", { httpStatus: status, retryable: error.retryable === true, evidenceBound: true });
        }

        if (!isObject(response) || response.success !== true || !isObject(response.data)) {
            fail("TRUEWALLET_RESPONSE_INVALID", "Payment verification returned an invalid response. Please retry.", { httpStatus: 503, retryable: true, evidenceBound: true });
        }
        const data = response.data;
        if (data.isDuplicate !== false) {
            if (data.isDuplicate === true) fail("TRUEWALLET_PROVIDER_DUPLICATE", "This payment slip has already been used.", { httpStatus: 409, evidenceBound: true });
            fail("TRUEWALLET_RESPONSE_INVALID", "Payment verification returned an invalid response. Please retry.", { httpStatus: 503, retryable: true, evidenceBound: true });
        }
        if (!isObject(data.matchedAccount)) fail("TRUEWALLET_RECEIVER_MISMATCH", "This slip was paid to a different receiving account.", { evidenceBound: true });
        const providerIdentifier = trueWalletIdentifier(data.matchedAccount);
        if (!providerIdentifier) fail("TRUEWALLET_PROVIDER_MISMATCH", "The uploaded slip is not a supported TrueMoney Wallet transfer.", { evidenceBound: true });
        const matchedReceiver = normalizeThaiWalletAccount(data.matchedAccount.bankNumber);
        if (!matchedReceiver || matchedReceiver !== expectedReceiver) fail("TRUEWALLET_RECEIVER_MISMATCH", "This slip was paid to a different receiving account.", { evidenceBound: true });
        if (data.isAmountMatched !== true) fail("TRUEWALLET_AMOUNT_MISMATCH", "The slip amount does not match this order.", { evidenceBound: true });
        if (!isObject(data.rawSlip)) fail("TRUEWALLET_RESPONSE_INVALID", "Payment verification returned an invalid response. Please retry.", { httpStatus: 503, retryable: true, evidenceBound: true });

        let amountInOrder;
        let amountInSlip;
        let rawAmount;
        try {
            amountInOrder = toThbSatang(data.amountInOrder);
            amountInSlip = toThbSatang(data.amountInSlip);
            rawAmount = toThbSatang(data.rawSlip.amount);
        } catch (_) {
            fail("TRUEWALLET_AMOUNT_INVALID", "The verifier returned an invalid payment amount.", { evidenceBound: true });
        }
        if ([amountInOrder, amountInSlip, rawAmount].some(value => value !== expectedSatang)) {
            fail("TRUEWALLET_AMOUNT_MISMATCH", "The slip amount does not match this order.", { evidenceBound: true });
        }

        const transactionId = normalizeTransactionId(data.rawSlip.transactionId);
        if (!transactionId) fail("TRUEWALLET_TRANSACTION_ID_MISSING", "The verifier response was incomplete. Please retry.", { httpStatus: 503, retryable: true, evidenceBound: true });
        const verifiedTransactionRef = `THUNDER_TRUEWALLET:${transactionId}`;
        const occurredAtCandidate = data.rawSlip.date ? new Date(data.rawSlip.date) : clock();
        const occurredAt = Number.isFinite(occurredAtCandidate.getTime()) ? occurredAtCandidate : clock();
        const providerEventId = `truewallet:${crypto.createHash("sha256").update(transactionId).digest("hex").slice(0, 32)}`;

        try {
            const payment = await orchestrator.handleProviderEvent({
                trustedOperational: true,
                verifiedTransactionRef,
                providerEvent: {
                    provider: THUNDER_TRUEWALLET_PROVIDER_ID,
                    providerReference: attempt.providerReference,
                    providerEventId,
                    eventType: THUNDER_TRUEWALLET_VERIFIED_EVENT,
                    amount: attempt.amount,
                    currency: "THB",
                    occurredAt: occurredAt.toISOString(),
                    metadata: { receiptId: text(input.receiptEvidence?.receiptId), verificationMethod: "THUNDER_TRUEWALLET_V2" }
                }
            });
            diag("THUNDER_TRUEWALLET_PAYMENT_COMMITTED", { afterPaymentState: "PAID" });
            return { ...payment, verificationStatus: "verified" };
        } catch (error) {
            const current = await attempts.findAttemptByIdForOwner({ attemptId: attempt.attemptId, owner });
            if (upper(current?.status) === "PAID" && current?.verifiedTransactionRef === verifiedTransactionRef) {
                return { ...(await orchestrator.getPaymentResult({ attemptId: attempt.attemptId, owner })), verificationStatus: "verified", idempotent: true };
            }
            const duplicate = error?.code === "PAYMENT_VERIFIED_TRANSACTION_EXISTS" || error?.causeCode === "PAYMENT_VERIFIED_TRANSACTION_EXISTS";
            fail(duplicate ? "TRUEWALLET_TRANSACTION_REUSED" : "TRUEWALLET_PAYMENT_COMMIT_FAILED", duplicate ? "This payment transaction has already been used." : "Payment verification could not be committed. Please retry.", { httpStatus: duplicate ? 409 : 503, retryable: !duplicate, evidenceBound: true });
        }
    }

    return Object.freeze({ verify });
}

module.exports = Object.freeze({ TRUEWALLET_PROVIDER_IDENTIFIERS, ThunderTrueWalletVerificationError, createThunderTrueWalletVerificationService, normalizeThaiWalletAccount, normalizeTransactionId, trueWalletIdentifier });
