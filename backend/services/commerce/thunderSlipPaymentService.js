"use strict";

const crypto = require("crypto");
const { decodePaymentSlipQr } = require("../paymentSlipQrDecoder");
const { createThunderApiClient } = require("../thunderApiClient");
const { buildReceiverDiagnostic, diagnosticTag, logThunderDiagnostic } = require("../../utils/thunderDiagnostics");

const PROVIDER = "THUNDER_PROMPTPAY";

class ThunderSlipPaymentError extends Error {
    constructor(code, message, options = {}) { super(message); this.name = "ThunderSlipPaymentError"; this.code = code; this.httpStatus = options.httpStatus || 422; this.retryable = options.retryable === true; this.evidenceBound = options.evidenceBound === true; }
}
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).replace(/-/g, "_").toUpperCase(); }
function fail(code, message, options) { throw new ThunderSlipPaymentError(code, message, options); }
function cents(value) { const n = Number(value); return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) : null; }
function rawSlipOf(response = {}) { return response.rawSlip || response.data?.rawSlip || response.data?.data?.rawSlip || response.result?.rawSlip || {}; }
function field(source, names) { for (const name of names) if (source?.[name] !== undefined && source?.[name] !== null) return source[name]; return undefined; }
function normalizeAccount(value) { return text(value).replace(/[^0-9A-Za-z]/g, "").toUpperCase(); }

function createThunderSlipPaymentService(dependencies = {}) {
    const attempts = dependencies.paymentAttemptRepository;
    const orders = dependencies.orderRepository;
    const orchestrator = dependencies.paymentOrchestrator;
    const decoder = dependencies.decodeSlipQr || decodePaymentSlipQr;
    const logger = dependencies.logger || console;
    const client = dependencies.thunderClient || createThunderApiClient({ ...(dependencies.thunderClientOptions || {}), logger });
    const clock = dependencies.clock || (() => new Date());
    const receiverDiagnosticBuilder = dependencies.receiverDiagnosticBuilder || buildReceiverDiagnostic;
    if (!attempts || !orders || !orchestrator) throw new TypeError("Thunder slip verification dependencies are required.");

    async function verify(input = {}) {
        const owner = input.owner || {};
        const diagnostic = { correlationId: input.correlationId || "", orderTag: diagnosticTag(input.orderId), attemptTag: diagnosticTag(input.attemptId) };
        const diag = (event, fields = {}, level = "info") => logThunderDiagnostic(logger, event, { ...diagnostic, ...fields }, level);
        const attempt = await attempts.findAttemptByIdForOwner({ attemptId: text(input.attemptId), owner });
        const order = await orders.findOwnedOrderById({ orderId: text(input.orderId), owner });
        if (!attempt || !order || attempt.orderId !== order.orderId) fail("THUNDER_PAYMENT_NOT_FOUND", "Payment attempt was not found.", { httpStatus: 404 });
        if (upper(attempt.provider) !== PROVIDER || text(attempt.confirmationMode) !== "thunder_slip") fail("THUNDER_FLOW_REQUIRED", "This payment does not support automatic slip verification.");
        if (upper(attempt.status) === "PAID") return { ...(await orchestrator.getPaymentResult({ attemptId: attempt.attemptId, owner })), verificationStatus: "verified", idempotent: true };
        if (!["PENDING", "INITIATING"].includes(upper(attempt.status))) fail("THUNDER_PAYMENT_INACTIVE", "This payment attempt is no longer active.", { httpStatus: 409 });
        if (upper(attempt.currency) !== "THB" || cents(attempt.amount) === null) fail("THUNDER_CURRENCY_UNSUPPORTED", "Automatic slip verification supports THB only.");
        const now = clock();
        if (attempt.expiresAt && new Date(attempt.expiresAt).getTime() + 120000 < now.getTime()) fail("THUNDER_SLIP_STALE", "This payment session has expired. Please start a new payment.", { httpStatus: 409 });

        let payload;
        diag("THUNDER_QR_DECODE_STARTED");
        try {
            payload = await decoder(input.fileBuffer);
            diag("THUNDER_QR_DECODE_COMPLETED", { passed: true });
        } catch (error) {
            diag("THUNDER_QR_DECODE_COMPLETED", { passed: false, azielErrorCode: error.code || "THUNDER_QR_DECODE_FAILED" }, "warn");
            fail(error.code || "THUNDER_QR_DECODE_FAILED", error.message || "The slip QR code could not be read.", { evidenceBound: true });
        }
        let response;
        try { response = await client.verifyBank({ payload, remark: text(order.orderId).slice(0, 60), matchAmount: Number(attempt.amount), ...diagnostic }); }
        catch (error) {
            diag("THUNDER_VERIFICATION_CLASSIFIED", { azielErrorCode: error.code || "THUNDER_UNAVAILABLE", providerErrorCode: error.providerCode, retryable: error.retryable === true }, "warn");
            fail(error.code || "THUNDER_UNAVAILABLE", error.message || "Payment verification is temporarily unavailable.", { retryable: error.retryable === true, evidenceBound: true, httpStatus: error.retryable ? 503 : 422 });
        }
        const data = response?.data || {};
        const providerStatus = upper(field(response, ["status", "code"]) || field(data, ["status", "code"]));
        if (providerStatus === "SLIP_PENDING") {
            diag("THUNDER_VERIFICATION_CLASSIFIED", { azielErrorCode: "SLIP_PENDING", providerErrorCode: response?.providerCode, retryable: true });
            return { ...(await orchestrator.getPaymentResult({ attemptId: attempt.attemptId, owner })), verificationStatus: "pending", code: "SLIP_PENDING", message: "Payment is still being verified. Please retry shortly." };
        }
        const rawSlip = rawSlipOf(response);
        const success = field(response, ["success", "verified", "isSuccess"]) ?? field(response?.data, ["success", "verified", "isSuccess"]);
        if (success !== true && !["SUCCESS", "VERIFIED", "OK"].includes(providerStatus)) {
            diag("THUNDER_VERIFICATION_CLASSIFIED", { azielErrorCode: "THUNDER_SLIP_NOT_VERIFIED", retryable: false }, "warn");
            fail("THUNDER_SLIP_NOT_VERIFIED", "The payment slip could not be verified.", { evidenceBound: true });
        }
        diag("THUNDER_VERIFICATION_CLASSIFIED", { azielErrorCode: "THUNDER_PROVIDER_VERIFIED", retryable: false });
        const matchedAccount = field(response, ["matchedAccount"]) ?? field(data, ["matchedAccount"]);
        const amountMatched = field(response, ["isAmountMatched", "matchedAmount"]) ?? field(data, ["isAmountMatched", "matchedAmount"]);
        const expectedReceiver = normalizeAccount(dependencies.receiverBankAccount || "");
        const receiverDiagnostic = fields => {
            try { logThunderDiagnostic(logger, "THUNDER_RECEIVER_VALIDATION", receiverDiagnosticBuilder({ expectedNormalized: expectedReceiver, ...fields })); } catch (_) { /* Diagnostics must not affect receiver authority. */ }
        };
        if (!matchedAccount) {
            receiverDiagnostic({ matchedAccountPresent: false, providerBankNumberPresent: false, identifierType: "UNKNOWN", receiverFailureReason: "MATCHED_ACCOUNT_MISSING" });
            diag("THUNDER_VALIDATION", { validation: "receiver", passed: false, azielErrorCode: "THUNDER_RECEIVER_MISMATCH" }, "warn");
            fail("THUNDER_RECEIVER_MISMATCH", "This slip was paid to a different receiving account.", { evidenceBound: true });
        }
        if (typeof matchedAccount !== "object" || Array.isArray(matchedAccount)) {
            receiverDiagnostic({ matchedAccountPresent: true, providerBankNumberPresent: false, identifierType: "UNKNOWN", receiverFailureReason: "MATCHED_ACCOUNT_INVALID" });
            diag("THUNDER_VALIDATION", { validation: "receiver", passed: false, azielErrorCode: "THUNDER_RECEIVER_MISMATCH" }, "warn");
            fail("THUNDER_RECEIVER_MISMATCH", "This slip was paid to a different receiving account.", { evidenceBound: true });
        }
        const originalProviderReceiver = matchedAccount.bankNumber;
        const providerBankNumberPresent = text(originalProviderReceiver) !== "";
        const matchedReceiver = normalizeAccount(matchedAccount.bankNumber);
        const providerReceiverMasked = (() => { try { return /[xX*]/.test(String(originalProviderReceiver)); } catch (_) { return false; } })();
        let bankCode;
        try { bankCode = field(matchedAccount.bank, ["code", "shortCode"]); } catch (_) { bankCode = undefined; }
        let receiverFailureReason = "RECEIVER_MATCHED";
        if (!providerBankNumberPresent || !matchedReceiver) receiverFailureReason = "PROVIDER_BANK_NUMBER_MISSING";
        else if (providerReceiverMasked && matchedReceiver !== expectedReceiver) receiverFailureReason = "PROVIDER_BANK_NUMBER_MASKED";
        else if (!expectedReceiver || matchedReceiver !== expectedReceiver) receiverFailureReason = "NORMALIZED_RECEIVER_MISMATCH";
        receiverDiagnostic({ matchedAccountPresent: true, providerBankNumberPresent, originalProviderValue: originalProviderReceiver, providerNormalized: matchedReceiver, bankCode, identifierType: "BANK_ACCOUNT", receiverFailureReason });
        if (!expectedReceiver || !matchedReceiver || matchedReceiver !== expectedReceiver) { diag("THUNDER_VALIDATION", { validation: "receiver", passed: false, azielErrorCode: "THUNDER_RECEIVER_MISMATCH" }, "warn"); fail("THUNDER_RECEIVER_MISMATCH", "This slip was paid to a different receiving account.", { evidenceBound: true }); }
        diag("THUNDER_VALIDATION", { validation: "receiver", passed: true });
        if (amountMatched !== true) { diag("THUNDER_VALIDATION", { validation: "amount", passed: false, azielErrorCode: "THUNDER_AMOUNT_MISMATCH" }, "warn"); fail("THUNDER_AMOUNT_MISMATCH", "The slip amount does not match this order.", { evidenceBound: true }); }
        const slipAmount = field(data, ["amountInSlip"]) ?? rawSlip?.amount?.amount ?? field(rawSlip, ["amountInSlip", "transferAmount"]);
        if (cents(slipAmount) !== cents(attempt.amount)) { diag("THUNDER_VALIDATION", { validation: "amount", passed: false, azielErrorCode: "THUNDER_AMOUNT_MISMATCH" }, "warn"); fail("THUNDER_AMOUNT_MISMATCH", "The slip amount does not match this order.", { evidenceBound: true }); }
        diag("THUNDER_VALIDATION", { validation: "amount", passed: true });
        const transRef = text(field(rawSlip, ["transRef", "transactionRef", "reference"]) || field(response?.data, ["transRef"]));
        if (!transRef) fail("THUNDER_RESPONSE_INVALID", "The verifier response was incomplete. Please retry.", { retryable: true, evidenceBound: true, httpStatus: 503 });
        const transferredAtRaw = field(rawSlip, ["date", "transDateTime", "transactionDateTime", "transDate", "dateTime", "timestamp"]);
        const transferredAt = transferredAtRaw ? new Date(transferredAtRaw) : null;
        if (!transferredAt || !Number.isFinite(transferredAt.getTime())) fail("THUNDER_RESPONSE_INVALID", "The verifier response was incomplete. Please retry.", { retryable: true, evidenceBound: true, httpStatus: 503 });
        const earliest = new Date(attempt.createdAt || order.createdAt).getTime() - 120000;
        const latest = (attempt.expiresAt ? new Date(attempt.expiresAt).getTime() : now.getTime()) + 120000;
        if (transferredAt.getTime() < earliest || transferredAt.getTime() > latest) { diag("THUNDER_VALIDATION", { validation: "freshness", passed: false, azielErrorCode: "THUNDER_SLIP_STALE" }, "warn"); fail("THUNDER_SLIP_STALE", "This slip is outside the valid payment time window.", { evidenceBound: true }); }
        diag("THUNDER_VALIDATION", { validation: "freshness", passed: true });
        const receiverAccount = rawSlip?.receiver?.account || {};
        const maskedReceiver = text(receiverAccount?.bank?.account || field(rawSlip, ["receiverAccount", "receiverAccountNo"]));
        if (maskedReceiver && !/^[0-9xX*\-\s]+$/.test(maskedReceiver)) fail("THUNDER_RECEIVER_MISMATCH", "The receiving account details were inconsistent.", { evidenceBound: true });
        const eventId = `thunder:${crypto.createHash("sha256").update(transRef).digest("hex").slice(0, 32)}`;
        const transactionRefTag = diagnosticTag(transRef);
        let payment;
        let reusedExisting = false;
        diag("THUNDER_TRANSACTION_REF_BINDING_STARTED", { transactionRefTag });
        diag("THUNDER_PAYMENT_COMMIT_STARTED", { beforePaymentState: upper(attempt.status) });
        try {
            payment = await orchestrator.handleProviderEvent({ trustedOperational: true, verifiedTransactionRef: transRef, providerEvent: { provider: PROVIDER, providerReference: attempt.providerReference, providerEventId: eventId, eventType: "THUNDER_SLIP_VERIFIED", amount: attempt.amount, currency: "THB", occurredAt: transferredAt.toISOString(), metadata: { receiptId: text(input.receiptEvidence?.receiptId), verificationMethod: "thunder_slip" } } });
        } catch (error) {
            const current = await attempts.findAttemptByIdForOwner({ attemptId: attempt.attemptId, owner });
            if (upper(current?.status) === "PAID" && current?.verifiedTransactionRef === transRef) {
                payment = await orchestrator.getPaymentResult({ attemptId: attempt.attemptId, owner });
                reusedExisting = true;
            } else {
                if (error?.code === "PAYMENT_VERIFIED_TRANSACTION_EXISTS") {
                    diag("THUNDER_TRANSACTION_REF_BINDING", { transactionRefTag, passed: false, azielErrorCode: "THUNDER_TRANSACTION_REUSED" }, "warn");
                }
                diag("THUNDER_PAYMENT_COMMIT_FAILED", { beforePaymentState: upper(attempt.status), azielErrorCode: error?.code === "PAYMENT_VERIFIED_TRANSACTION_EXISTS" ? "THUNDER_TRANSACTION_REUSED" : "THUNDER_PAYMENT_COMMIT_FAILED", retryable: error?.retryable === true }, "warn");
                fail(error?.code === "PAYMENT_VERIFIED_TRANSACTION_EXISTS" ? "THUNDER_TRANSACTION_REUSED" : "THUNDER_PAYMENT_COMMIT_FAILED", "Payment verification could not be committed. Please retry.", { evidenceBound: true, retryable: error?.retryable === true, httpStatus: error?.code === "PAYMENT_VERIFIED_TRANSACTION_EXISTS" ? 409 : 503 });
            }
        }
        diag("THUNDER_TRANSACTION_REF_BINDING", { transactionRefTag, passed: true, reusedExisting });
        diag("THUNDER_PAYMENT_COMMIT_COMPLETED", { afterPaymentState: "PAID", reusedExisting });
        return { ...payment, verificationStatus: "verified" };
    }
    return Object.freeze({ verify });
}

module.exports = Object.freeze({ PROVIDER, ThunderSlipPaymentError, createThunderSlipPaymentService });
