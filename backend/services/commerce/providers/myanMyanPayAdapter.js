"use strict";

const QRCode = require("qrcode");
const { createProviderAdapter, ProviderAdapterError, ERROR_CODES, CAPABILITIES } = require("../providerAdapter");
const { PROVIDER, METHOD } = require("../../myanmyanpay/myanMyanPayPaymentPolicy");

const text = value => String(value || "").trim();
const fail = (message, stage = "callback") => new ProviderAdapterError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, message, { stage });
const STATUS = Object.freeze({ PENDING: "PENDING", SUCCESS: "PAID", FAILED: "FAILED", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED", REFUNDED: "REFUNDED" });

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
            providerTransactionId: orderId,
            status: "PENDING",
            amount,
            currency: "MMK",
            qr: { type: "MYANMYANPAY_MMQR", mode: "provider_generated", payload: qrPayload, image: await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 2, width: 360 }) },
            paymentInstructions: { type: "MYANMYANPAY_MMQR", title: "MyanMyanPay / MMQR", reference: orderId, steps: ["Scan the MMQR", "Pay the exact amount", "Wait for payment confirmation"], requiresReceiptUpload: false, receiptUploadEnabled: false, slipRequired: false, confirmationMode: "provider_webhook" },
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
        const response = await client.cancel({ orderId: text(attempt.providerReference || attempt.attemptId) });
        if (!response || text(response.orderId) !== text(attempt.providerReference || attempt.attemptId) || text(response.status).toUpperCase() !== "CANCELLED" || Number(response.amount) !== Number(attempt.amount)) {
            throw fail("MyanMyanPay cancellation response does not match the payment attempt.", "cancel");
        }
        return { provider: PROVIDER, providerReference: text(attempt.providerReference), providerTransactionId: text(attempt.providerTransactionId || attempt.providerReference), status: "CANCELLED", amount: Number(attempt.amount), currency: "MMK", rawProviderStatus: "CANCELLED" };
    }

    return createProviderAdapter({ providerId: PROVIDER, displayName: "MyanMyanPay MMQR", version: "1", supportedCurrencies: ["MMK"], supportedPaymentMethods: [METHOD], supportedCapabilities: [CAPABILITIES.CREATE_PAYMENT, CAPABILITIES.CANCEL_PAYMENT, CAPABILITIES.WEBHOOK, CAPABILITIES.QR_CODE], environment: "sandbox", handlers: { createPayment, cancelPayment, handleProviderEvent } });
}

module.exports = Object.freeze({ createMyanMyanPayAdapter, MYANMYANPAY_PROVIDER_ID: PROVIDER, MYANMYANPAY_METHOD_ID: METHOD });
