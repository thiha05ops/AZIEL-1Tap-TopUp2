"use strict";

const QRCode = require("qrcode");
const { createProviderAdapter, ProviderAdapterError, ERROR_CODES, CAPABILITIES } = require("../providerAdapter");
const { PROVIDER, METHOD } = require("../../myanmyanpay/myanMyanPayPaymentPolicy");

const text = value => String(value || "").trim();
const fail = (message, stage = "callback") => new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, message, { stage });
const STATUS = Object.freeze({ PENDING: "PENDING", SUCCESS: "PAID", FAILED: "FAILED", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED", REFUNDED: "REFUNDED" });
const RECONCILIATION_STATUSES = Object.freeze(new Set(["PENDING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]));

function errorShaped(value) {
    if (value instanceof Error || !value || typeof value !== "object" || Array.isArray(value)) return true;
    if (["error", "errorCode", "code", "statusCode", "httpStatus"].some(key => Object.prototype.hasOwnProperty.call(value, key))) return true;
    return Object.prototype.hasOwnProperty.call(value, "message") && (!text(value.orderId) || !text(value.status));
}

function createMyanMyanPayAdapter(options = {}) {
    const configuration = options.configuration || {};
    const client = options.client || {};

    async function createPayment({ intent = {}, attempt = {} } = {}) {
        const amount = Number(intent.amount);
        if (configuration.enabled !== true || configuration.environment !== "SANDBOX") throw fail("MyanMyanPay sandbox is unavailable.", "configuration");
        if (text(intent.currency).toUpperCase() !== "MMK" || !Number.isSafeInteger(amount) || amount <= 0) throw fail("MyanMyanPay requires a positive integer MMK amount.", "amount");
        const orderId = text(attempt.attemptId);
        const response = await client.pay({
            orderId,
            amount,
            currency: "MMK",
            callbackUrl: configuration.callbackUrl,
            customMessage: `AZIEL ${text(intent.orderId)}`.slice(0, 150),
            items: Array.isArray(intent.items) ? intent.items : []
        });
        if (text(response.orderId) !== orderId || Number(response.amount) !== amount || text(response.currency).toUpperCase() !== "MMK" || text(response.status).toUpperCase() !== "PENDING") {
            throw fail("MyanMyanPay payment response does not match the payment attempt.", "contract");
        }
        const qrPayload = text(response.qr);
        return {
            provider: PROVIDER,
            providerReference: orderId,
            providerTransactionId: text(response.transactionRefId) || orderId,
            status: "PENDING",
            amount,
            currency: "MMK",
            qr: { type: "MYANMYANPAY_MMQR", mode: "provider_generated", payload: qrPayload, image: await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 2, width: 360 }) },
            paymentInstructions: { type: "MYANMYANPAY_MMQR", title: "MyanMyanPay / MMQR", reference: orderId, steps: ["Scan the MMQR", "Pay the exact amount", "Wait for payment confirmation"], requiresReceiptUpload: false, receiptUploadEnabled: false, slipRequired: false, confirmationMode: "provider_webhook" },
            safeMetadata: { environment: "SANDBOX", appId: configuration.appId, vendorQrRefId: text(response.vendorQrRefId), paymentMethodId: METHOD }
        };
    }

    async function queryPayment({ intent = {}, attempt = {} } = {}) {
        const attemptId = text(attempt.attemptId);
        const amount = Number(attempt.amount ?? intent.amount);
        if (configuration.enabled !== true || configuration.environment !== "SANDBOX") throw fail("MyanMyanPay sandbox is unavailable.", "configuration");
        if (text(attempt.provider) !== PROVIDER || text(attempt.paymentMethodId || attempt.paymentMethod) !== METHOD || text(attempt.paymentChannel) !== "MYANMYANPAY_MMQR") throw fail("MyanMyanPay reconciliation identity mismatch.", "identity");
        if (!attemptId || text(attempt.orderId) !== text(intent.orderId) || text(attempt.currency || intent.currency).toUpperCase() !== "MMK" || !Number.isSafeInteger(amount) || amount <= 0) throw fail("MyanMyanPay reconciliation binding is invalid.", "identity");
        let response;
        try {
            response = await client.get({ orderId: attemptId, expectedAmount: amount, expectedCurrency: "MMK" });
        } catch (error) {
            const safeCode = text(error?.providerCode || error?.code);
            const notFound = Number(error?.httpStatus) === 404 || /NOT[_ -]?FOUND/i.test(safeCode);
            return { usable: false, observedStatus: "", reconciliationOutcome: notFound ? "NOT_FOUND_INCONCLUSIVE" : "PROVIDER_ERROR_INCONCLUSIVE" };
        }
        if (errorShaped(response)) {
            const safeCode = [response?.code, response?.errorCode, response?.statusCode, response?.httpStatus].find(value => ["string", "number", "boolean"].includes(typeof value));
            const notFound = Number(safeCode) === 404 || /NOT[_ -]?FOUND/i.test(String(safeCode || ""));
            return { usable: false, observedStatus: "", reconciliationOutcome: notFound ? "NOT_FOUND_INCONCLUSIVE" : "PROVIDER_ERROR_INCONCLUSIVE" };
        }
        const observedStatus = text(response.status).toUpperCase();
        const safeObservedStatus = RECONCILIATION_STATUSES.has(observedStatus) ? observedStatus : "UNKNOWN";
        if (text(response.orderId) !== attemptId || Number(response.amount) !== amount || (text(response.currency) && text(response.currency).toUpperCase() !== "MMK") || (text(response.appId) && text(response.appId) !== text(configuration.appId)) || (text(response.method) && text(response.method).toUpperCase() !== "QR")) {
            return { usable: false, observedStatus: safeObservedStatus, reconciliationOutcome: "BINDING_MISMATCH" };
        }
        if (!RECONCILIATION_STATUSES.has(observedStatus)) return { usable: false, observedStatus: "UNKNOWN", reconciliationOutcome: "UNKNOWN_STATUS_INCONCLUSIVE" };
        const qrPayload = text(response.qr);
        const qr = qrPayload ? { type: "MYANMYANPAY_MMQR", mode: "provider_generated", payload: qrPayload, image: await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 2, width: 360 }) } : null;
        return {
            usable: true,
            observedStatus,
            reconciliationOutcome: observedStatus === "SUCCESS" ? "SUCCESS_AWAITING_AUTHENTICATED_CALLBACK" : `PROVIDER_${observedStatus}_OBSERVED`,
            providerReference: attemptId,
            providerTransactionId: text(response.transactionRefId) || attemptId,
            rawProviderStatus: observedStatus,
            amount,
            currency: "MMK",
            qr,
            paymentInstructions: qr ? { type: "MYANMYANPAY_MMQR", title: "MyanMyanPay / MMQR", reference: attemptId, steps: ["Scan the MMQR", "Pay the exact amount", "Wait for payment confirmation"], requiresReceiptUpload: false, receiptUploadEnabled: false, slipRequired: false, confirmationMode: "provider_webhook" } : null,
            safeMetadata: { environment: "SANDBOX", appId: configuration.appId, vendorQrRefId: text(response.vendorQrRefId), paymentMethodId: METHOD }
        };
    }

    async function handleProviderEvent({ providerEvent = {}, attempt = {}, intent = {}, trustedOperational } = {}) {
        const rawStatus = text(providerEvent.rawProviderStatus || providerEvent.status).toUpperCase();
        const mapped = STATUS[rawStatus];
        if (!mapped) throw fail("Unknown MyanMyanPay callback status.");
        if (trustedOperational !== true || text(providerEvent.provider) !== PROVIDER || text(attempt.provider) !== PROVIDER) throw fail("MyanMyanPay provider binding mismatch.");
        if (text(providerEvent.environment) !== "SANDBOX" || text(attempt.safeMetadata?.environment) !== "SANDBOX") throw fail("MyanMyanPay environment binding mismatch.");
        if (text(providerEvent.appId) !== text(attempt.safeMetadata?.appId)) throw fail("MyanMyanPay application binding mismatch.");
        if (text(providerEvent.callbackUrl) && text(providerEvent.callbackUrl) !== text(configuration.callbackUrl)) throw fail("MyanMyanPay callback URL binding mismatch.");
        if (text(providerEvent.providerReference) !== text(attempt.providerReference) || text(providerEvent.providerReference) !== text(attempt.attemptId)) throw fail("MyanMyanPay order reference mismatch.");
        if (!Number.isSafeInteger(Number(providerEvent.amount)) || Number(providerEvent.amount) !== Number(attempt.amount ?? intent.amount)) throw fail("MyanMyanPay amount mismatch.");
        if (text(providerEvent.currency).toUpperCase() !== "MMK" || text(attempt.currency || intent.currency).toUpperCase() !== "MMK") throw fail("MyanMyanPay currency mismatch.");
        if (text(providerEvent.method).toUpperCase() !== "QR" || text(attempt.paymentMethodId || attempt.paymentMethod).toLowerCase() !== METHOD) throw fail("MyanMyanPay method mismatch.");
        const vendorQrRefId = text(providerEvent.vendorQrRefId);
        if (text(attempt.safeMetadata?.vendorQrRefId) && vendorQrRefId && vendorQrRefId !== text(attempt.safeMetadata.vendorQrRefId)) throw fail("MyanMyanPay QR reference mismatch.");
        const transactionRefId = text(providerEvent.providerTransactionId);
        if (rawStatus === "SUCCESS" && !transactionRefId) throw fail("MyanMyanPay success is missing transaction reference.");
        return {
            provider: PROVIDER,
            providerReference: text(attempt.providerReference),
            providerTransactionId: transactionRefId || text(attempt.providerReference),
            providerEventId: text(providerEvent.providerEventId),
            eventType: `MYANMYANPAY_${rawStatus}`,
            status: mapped,
            rawProviderStatus: rawStatus,
            amount: Number(providerEvent.amount),
            currency: "MMK",
            occurredAt: providerEvent.occurredAt,
            safeMetadata: { verificationMethod: "MMPAY_SDK_SIGNATURE_NONCE", environment: "SANDBOX", vendor: text(providerEvent.vendor), method: "QR", condition: text(providerEvent.condition), vendorQrRefId }
        };
    }

    async function cancelPayment({ attempt = {} } = {}) {
        if (typeof client.cancel !== "function") throw fail("MyanMyanPay cancellation is unavailable.", "configuration");
        const response = await client.cancel({ orderId: text(attempt.providerReference || attempt.attemptId), expectedAmount: Number(attempt.amount) });
        if (!response || text(response.orderId) !== text(attempt.providerReference || attempt.attemptId) || text(response.status).toUpperCase() !== "CANCELLED" || Number(response.amount) !== Number(attempt.amount)) {
            throw fail("MyanMyanPay cancellation response does not match the payment attempt.", "cancel");
        }
        return { provider: PROVIDER, providerReference: text(attempt.providerReference), providerTransactionId: text(attempt.providerTransactionId || attempt.providerReference), status: "CANCELLED", amount: Number(attempt.amount), currency: "MMK", rawProviderStatus: "CANCELLED" };
    }

    return createProviderAdapter({ providerId: PROVIDER, displayName: "MyanMyanPay MMQR", version: "1", supportedCurrencies: ["MMK"], supportedPaymentMethods: [METHOD], supportedCapabilities: [CAPABILITIES.CREATE_PAYMENT, CAPABILITIES.QUERY_PAYMENT, CAPABILITIES.REFRESH_PAYMENT, CAPABILITIES.CANCEL_PAYMENT, CAPABILITIES.WEBHOOK, CAPABILITIES.QR_CODE], environment: "sandbox", handlers: { createPayment, queryPayment, refreshPayment: queryPayment, cancelPayment, handleProviderEvent } });
}

module.exports = Object.freeze({ createMyanMyanPayAdapter, MYANMYANPAY_PROVIDER_ID: PROVIDER, MYANMYANPAY_METHOD_ID: METHOD });
