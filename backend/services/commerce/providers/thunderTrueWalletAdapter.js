"use strict";

const { createProviderAdapter, ProviderAdapterError, ERROR_CODES, CAPABILITIES } = require("../providerAdapter");
const { createTrueMoneyQrFromTemplate, parseEmvPayload } = require("../../promptPayQrService");
const { toThbSatang } = require("../thbMinorUnits");

const PROVIDER_ID = "THUNDER_TRUEWALLET";
const EVENT_TYPE = "THUNDER_TRUEWALLET_SLIP_VERIFIED";

function text(value) { return String(value ?? "").trim(); }
function canonicalThbAmount(value) {
    const satang = toThbSatang(value);
    if (satang <= 0) throw new Error("TrueMoney Wallet amount must be positive.");
    return { satang, amount: satang / 100, text: `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, "0")}` };
}
function normalizedThaiPhone(value) {
    const digits = text(value).replace(/\D/g, "");
    if (/^66[689]\d{8}$/.test(digits)) return `0${digits.slice(2)}`;
    if (/^0[689]\d{8}$/.test(digits)) return digits;
    return "";
}
function adapterError(message) {
    return new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, message, { stage: "verification" });
}

function createThunderTrueWalletAdapter(options = {}) {
    const configuration = options.configuration || {};
    if (configuration.enabled !== true) {
        throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "Thunder TrueMoney Wallet is disabled.", { stage: "configuration" });
    }
    const clock = options.clock || (() => new Date());
    const qrService = options.qrService || createTrueMoneyQrFromTemplate;
    const expiryMinutes = Math.max(1, Math.min(Number(configuration.defaultExpiryMinutes) || 30, 120));

    function base(intent = {}, attempt = {}, status = "PENDING") {
        return {
            provider: PROVIDER_ID,
            providerReference: text(attempt.providerReference),
            providerTransactionId: text(attempt.providerReference),
            status,
            amount: Number(intent.amount ?? attempt.amount),
            currency: text(intent.currency || attempt.currency).toUpperCase(),
            expiresAt: attempt.expiresAt || null,
            paymentInstructions: attempt.paymentInstructions || null,
            safeMetadata: { providerId: PROVIDER_ID, paymentRail: "TRUE_MONEY_WALLET", verificationMechanism: "THUNDER_TRUEWALLET_V2", confirmationMode: "thunder_truewallet_slip", receiptRequired: true },
            rawProviderStatus: status.toLowerCase()
        };
    }

    async function createPayment({ intent = {}, attempt = {} } = {}) {
        if (text(intent.currency).toUpperCase() !== "THB" || text(attempt.currency).toUpperCase() !== "THB") {
            throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "TrueMoney Wallet requires a positive THB amount.", { stage: "amount" });
        }
        let authoritative;
        try {
            authoritative = canonicalThbAmount(attempt.amount);
            if (canonicalThbAmount(intent.amount).satang !== authoritative.satang) throw new Error("Payment intent amount does not match PaymentAttempt amount.");
        } catch (error) {
            throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "TrueMoney Wallet payment amount is invalid.", { stage: "amount", metadata: { causeCode: error.code || "INVALID_THB_AMOUNT" } });
        }
        const verificationReceiver = normalizedThaiPhone(configuration.receivingAccount);
        const customerReceiver = normalizedThaiPhone(configuration.customerAccountNumber);
        const trueMoneyQrTemplate = text(configuration.trueMoneyQrTemplate);

        if (!verificationReceiver || !customerReceiver || verificationReceiver !== customerReceiver) {
            throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "TrueMoney Wallet customer account does not match verification receiver.", { stage: "configuration" });
        }
        if (!trueMoneyQrTemplate) {
            throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "TrueMoney Wallet QR template is not configured.", { stage: "configuration" });
        }
        const providerReference = `AZL-TMW-${text(intent.subjectId || intent.orderId)}-${text(attempt.attemptId)}`.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 95);
        let qrResult;
        try {
            qrResult = await qrService({
                templatePayload: trueMoneyQrTemplate,
                amount: authoritative.text,
                currency: "THB",
                expiryMinutes
            });

            const templateFields = parseEmvPayload(trueMoneyQrTemplate);
            const generatedFields = parseEmvPayload(qrResult.qrPayload);
            const templateMerchantFields = templateFields.filter(field => field.id === "29");
            const generatedMerchantFields = generatedFields.filter(field => field.id === "29");

            if (
                templateMerchantFields.length !== 1 ||
                generatedMerchantFields.length !== 1 ||
                generatedMerchantFields[0].value !== templateMerchantFields[0].value ||
                qrResult.encodedAmount !== authoritative.text ||
                qrResult.pointOfInitiationMethod !== "12" ||
                qrResult.currencyCode !== "764" ||
                qrResult.country !== "TH" ||
                qrResult.crcValid !== true ||
                qrResult.qrImagePayloadMatches !== true
            ) {
                throw new Error("Generated TrueMoney QR failed authority validation.");
            }
        } catch (error) {
            throw new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TrueMoney Wallet QR generation failed.", { stage: "qr", retryable: false, metadata: { causeCode: error.code || "TRUEWALLET_QR_INVALID" } });
        }
        const expiresAt = qrResult.expiresAt || new Date(clock().getTime() + expiryMinutes * 60000).toISOString();
        return {
            ...base(intent, { ...attempt, providerReference, expiresAt }, "PENDING"),
            providerReference,
            providerTransactionId: providerReference,
            expiresAt,
            providerPayableAmountSatang: authoritative.satang,
            providerPayableAmount: authoritative.amount,
            qr: {
                type: "TRUE_MONEY_WALLET_QR",
                mode: "truemoney_template_dynamic",
                sourceType: "dynamic_response",
                image: qrResult.qrImage,
                encodedAmount: qrResult.encodedAmount,
                payloadVerified: true
            },
            paymentInstructions: {
                type: "TRUE_MONEY_WALLET",
                title: "TrueMoney Wallet",
                accountName: text(configuration.customerAccountName),
                accountNumber: text(configuration.customerAccountNumber),
                steps: ["Scan this QR with TrueMoney", "Pay the exact amount", "Upload the TrueMoney transfer slip"],
                qrMode: "truemoney_template_dynamic",
                enableSaveQr: true,
                requiresReceiptUpload: true,
                receiptUploadEnabled: true,
                slipRequired: true,
                confirmationMode: "thunder_truewallet_slip"
            }
        };
    }

    async function refreshPayment({ intent = {}, attempt = {} } = {}) { return base(intent, attempt, text(attempt.status || "PENDING").toUpperCase()); }
    async function expirePayment({ intent = {}, attempt = {} } = {}) { return base(intent, attempt, "EXPIRED"); }
    async function cancelPayment({ intent = {}, attempt = {} } = {}) { return base(intent, attempt, "CANCELLED"); }
    async function handleProviderEvent({ providerEvent = {}, attempt = {}, intent = {}, trustedOperational } = {}) {
        if (trustedOperational !== true || text(providerEvent.provider) !== PROVIDER_ID || text(providerEvent.providerReference) !== text(attempt.providerReference) || text(providerEvent.eventType) !== EVENT_TYPE) {
            throw adapterError("TrueMoney Wallet verification event is invalid.");
        }
        return {
            ...base(intent, attempt, "PAID"),
            providerEventId: text(providerEvent.providerEventId),
            eventType: EVENT_TYPE,
            occurredAt: providerEvent.occurredAt || clock().toISOString(),
            safeMetadata: { verificationMethod: "THUNDER_TRUEWALLET_V2", receiptId: text(providerEvent.metadata?.receiptId) }
        };
    }

    return createProviderAdapter({
        providerId: PROVIDER_ID,
        displayName: "Thunder Verified TrueMoney Wallet",
        version: "1",
        supportedCurrencies: ["THB"],
        supportedPaymentMethods: ["truewallet", "TRUE_MONEY_WALLET"],
        supportedCapabilities: [CAPABILITIES.CREATE_PAYMENT, CAPABILITIES.QUERY_PAYMENT, CAPABILITIES.REFRESH_PAYMENT, CAPABILITIES.EXPIRE_PAYMENT, CAPABILITIES.MANUAL_APPROVAL],
        environment: text(configuration.environment || "production").toLowerCase(),
        handlers: { createPayment, queryPayment: refreshPayment, refreshPayment, expirePayment, cancelPayment, handleProviderEvent }
    });
}

module.exports = Object.freeze({ createThunderTrueWalletAdapter, THUNDER_TRUEWALLET_PROVIDER_ID: PROVIDER_ID, THUNDER_TRUEWALLET_VERIFIED_EVENT: EVENT_TYPE });
