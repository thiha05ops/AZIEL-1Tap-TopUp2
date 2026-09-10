"use strict";

const {
    createProviderAdapter,
    ProviderAdapterError,
    ERROR_CODES,
    CAPABILITIES
} = require("../providerAdapter");
const { createTmwEasyApiClient, TmwEasyApiError } = require("../../tmwEasyApiClient");

const PROVIDER_ID = "TMW";
const PAYMENT_METHOD = "tmw_promptpay";
const MAX_QR_BASE64_LENGTH = 2 * 1024 * 1024;

function text(value) { return String(value == null ? "" : value).trim(); }
function upper(value) { return text(value).replace(/-/g, "_").toUpperCase(); }
function providerError(code, message, stage, options = {}) {
    return new ProviderAdapterError(code, message, { stage, retryable: options.retryable === true, submissionUncertain: options.submissionUncertain === true, metadata: options.metadata || {} });
}
function optionalFiniteNumber(value) {
    if (value === undefined || value === null || text(value) === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function assertSuccessful(payload, operation) {
    const status = text(payload?.status).toLowerCase();
    if (!["1", "success", "successful", "ok"].includes(status)) {
        throw providerError(`TMW_${upper(operation)}_REJECTED`, `TMW ${operation} was not successful.`, operation, {
            metadata: { providerStatus: text(payload?.status).slice(0, 40), diagnostic: "PROVIDER_STATUS_REJECTED" }
        });
    }
}
function integerThb(amount) {
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw providerError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "TMW PromptPay requires a positive integer THB amount.", "amount", { metadata: { eligibility: "INTEGER_THB_REQUIRED" } });
    }
    return value;
}
function satang(value) {
    const raw = text(value);
    if (!/^(0|[1-9]\d*)$/.test(raw)) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW amount_check is invalid.", "detail_pay");
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW amount_check is invalid.", "detail_pay");
    return parsed;
}
function timeoutSeconds(value) {
    const raw = text(value);
    if (!/^-?\d+$/.test(raw)) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW time_out is invalid.", "detail_pay");
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW time_out is invalid.", "detail_pay");
    return parsed;
}
function qrImage(value) {
    const raw = text(value);
    if (!raw || raw.length > MAX_QR_BASE64_LENGTH) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW QR image is invalid.", "detail_pay");
    if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(raw)) return raw.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW QR image is invalid.", "detail_pay");
    return `data:image/png;base64,${raw.replace(/\s+/g, "")}`;
}
function referenceFor(attempt = {}) {
    const reference = text(attempt.attemptId);
    if (!reference) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW payment attempt reference is missing.", "create_pay");
    return reference;
}

function createTmwPromptPayAdapter(options = {}) {
    const client = options.client || createTmwEasyApiClient(options.clientOptions || options);
    const clock = options.clock || (() => new Date());
    const logger = options.logger || console;

    function observe(event, fields = {}) {
        logger.info?.("[tmw-provider-contract]", {
            event,
            provider: PROVIDER_ID,
            stage: fields.stage || "",
            attemptId: text(fields.attemptId),
            orderId: text(fields.orderId),
            requestedThb: Number.isFinite(fields.requestedThb) ? fields.requestedThb : null,
            expectedAmountCheckSatang: Number.isSafeInteger(fields.expectedAmountCheckSatang) ? fields.expectedAmountCheckSatang : null,
            returnedAmountCheck: Number.isSafeInteger(fields.returnedAmountCheck) ? fields.returnedAmountCheck : null,
            returnedAmount: Number.isFinite(fields.returnedAmount) ? fields.returnedAmount : null,
            tmwStatus: text(fields.tmwStatus).slice(0, 40),
            idPayPresent: fields.idPayPresent === true,
            refMatch: typeof fields.refMatch === "boolean" ? fields.refMatch : null,
            timeoutSeconds: Number.isSafeInteger(fields.timeoutSeconds) ? fields.timeoutSeconds : null,
            qrPresent: fields.qrPresent === true,
            diagnostic: text(fields.diagnostic).slice(0, 80)
        });
    }

    function normalizeDetail(payload, context) {
        assertSuccessful(payload, "detail_pay");
        const { intent = {}, attempt = {} } = context;
        const idPay = text(attempt.providerReference || attempt.providerTransactionId || context.idPay);
        const expectedRef = referenceFor(attempt);
        if (!idPay) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW id_pay is missing.", "detail_pay");
        const refMatch = text(payload.ref1) === expectedRef;
        const expectedSatang = integerThb(intent.amount ?? attempt.amount) * 100;
        let actualSatang = null;
        try { actualSatang = satang(payload.amount_check); } catch (error) {
            observe("detail_pay_validation", { stage: "detail_pay", attemptId: attempt.attemptId, orderId: attempt.orderId || intent.orderId, requestedThb: expectedSatang / 100, expectedAmountCheckSatang: expectedSatang, tmwStatus: payload.status, idPayPresent: true, refMatch, returnedAmount: optionalFiniteNumber(payload.amount), timeoutSeconds: /^-?\d+$/.test(text(payload.time_out)) ? Number(payload.time_out) : null, qrPresent: Boolean(text(payload.qr_image_base64)), diagnostic: "MALFORMED_AMOUNT_CHECK" });
            throw error;
        }
        observe("detail_pay_validation", { stage: "detail_pay", attemptId: attempt.attemptId, orderId: attempt.orderId || intent.orderId, requestedThb: expectedSatang / 100, expectedAmountCheckSatang: expectedSatang, returnedAmountCheck: actualSatang, returnedAmount: optionalFiniteNumber(payload.amount), tmwStatus: payload.status, idPayPresent: true, refMatch, timeoutSeconds: /^-?\d+$/.test(text(payload.time_out)) ? Number(payload.time_out) : null, qrPresent: Boolean(text(payload.qr_image_base64)), diagnostic: !refMatch ? "REF_MISMATCH" : actualSatang !== expectedSatang ? "PROVIDER_PAYABLE_CAPTURED" : "MATCH" });
        if (!refMatch) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW payment reference does not match the payment attempt.", "detail_pay", {
            metadata: { diagnostic: "REF_MISMATCH" }
        });
        const remaining = timeoutSeconds(payload.time_out);
        const expired = remaining < 0;
        const providerPayableAmount = actualSatang / 100;
        return {
            provider: PROVIDER_ID,
            providerReference: idPay,
            providerTransactionId: idPay,
            status: expired ? "EXPIRED" : "PENDING",
            amount: expectedSatang / 100,
            providerPayableAmountSatang: actualSatang,
            providerPayableAmount,
            currency: "THB",
            expiresAt: expired ? clock().toISOString() : new Date(clock().getTime() + remaining * 1000).toISOString(),
            qr: expired ? (attempt.qr || null) : {
                type: "PROMPTPAY_QR_IMAGE",
                mode: "provider_generated",
                sourceType: "provider_response",
                image: qrImage(payload.qr_image_base64),
                encodedAmount: providerPayableAmount
            },
            paymentInstructions: {
                type: "TMW_PROMPTPAY",
                title: "PromptPay QR",
                steps: ["Scan the QR with a supported banking app", "Pay the exact displayed amount", "Wait for automatic confirmation"],
                requiresReceiptUpload: false,
                confirmationMode: "provider_webhook"
            },
            safeMetadata: { providerId: PROVIDER_ID, attemptId: attempt.attemptId, orderId: attempt.orderId || intent.orderId, remainingSeconds: Math.max(0, remaining), commerceAmount: expectedSatang / 100, providerPayableAmountSatang: actualSatang, providerPayableAmount },
            rawProviderStatus: text(payload.status)
        };
    }

    async function createPayment(context = {}) {
        const { intent = {}, attempt = {} } = context;
        if (upper(intent.currency) !== "THB") throw providerError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "TMW PromptPay supports THB only.", "currency");
        const amount = integerThb(intent.amount);
        const ref1 = referenceFor(attempt);
        if (!text(intent.clientIp)) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID, "Customer IP is required for TMW payment creation.", "create_pay");
        if (attempt.providerReference) return refreshPayment(context);
        const created = await client.createPay({ amount, ref1, ip: text(intent.clientIp) });
        assertSuccessful(created, "create_pay");
        const idPay = text(created.id_pay);
        if (!idPay || idPay.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(idPay)) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW returned an invalid id_pay.", "create_pay");
        observe("create_pay_accepted", { stage: "create_pay", attemptId: attempt.attemptId, orderId: attempt.orderId || intent.orderId, requestedThb: amount, tmwStatus: created.status, idPayPresent: true, diagnostic: "ID_PAY_RECEIVED" });
        if (typeof context.persistProviderReference === "function") {
            try {
                await context.persistProviderReference({ providerReference: idPay, providerTransactionId: idPay, rawProviderStatus: text(created.status), safeMetadata: { providerId: PROVIDER_ID, attemptId: attempt.attemptId, orderId: attempt.orderId || intent.orderId, detailPending: true, referenceCheckpointed: true } });
            } catch {
                throw providerError("TMW_PROVIDER_REFERENCE_PERSIST_FAILED", "TMW payment submission requires operational reconciliation.", "create_pay", { submissionUncertain: true, metadata: { diagnostic: "ID_PAY_PERSISTENCE_FAILED" } });
            }
        }
        try {
            const detail = await client.detailPay({ idPay });
            return normalizeDetail(detail, { ...context, idPay, attempt: { ...attempt, providerReference: idPay, providerTransactionId: idPay } });
        } catch (error) {
            if (!(error instanceof TmwEasyApiError) || error.retryable !== true) throw error;
            // create_pay may already have committed remotely. Preserve id_pay so a
            // retryable detail transport/upstream failure can use detail_pay instead
            // of creating a second charge. Integrity failures are never downgraded.
            return {
                provider: PROVIDER_ID,
                providerReference: idPay,
                providerTransactionId: idPay,
                status: "PENDING",
                amount,
                currency: "THB",
                paymentInstructions: {
                    type: "TMW_PROMPTPAY",
                    title: "PromptPay QR",
                    steps: ["Refresh to retrieve the provider QR", "Pay only after the QR is displayed", "Wait for automatic confirmation"],
                    requiresReceiptUpload: false,
                    confirmationMode: "provider_webhook"
                },
                safeMetadata: { providerId: PROVIDER_ID, attemptId: attempt.attemptId, orderId: attempt.orderId || intent.orderId, detailPending: true },
                rawProviderStatus: text(created.status)
            };
        }
    }

    async function refreshPayment(context = {}) {
        const idPay = text(context.attempt?.providerReference || context.attempt?.providerTransactionId);
        if (!idPay) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_RESPONSE_INVALID, "TMW payment reference is missing; automatic recreation is unsafe.", "refresh_payment");
        return normalizeDetail(await client.detailPay({ idPay }), context);
    }

    async function expirePayment(context = {}) {
        const result = await refreshPayment(context);
        if (result.status !== "EXPIRED") throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW payment is still active and cannot be expired.", "expire_payment");
        return result;
    }

    async function cancelPayment(context = {}) {
        const detail = await refreshPayment(context);
        if (detail.status !== "EXPIRED") throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW payment can only be cancelled after its timeout.", "cancel_payment");
        const result = await client.cancelPay({ idPay: detail.providerReference });
        assertSuccessful(result, "cancel");
        return { ...detail, status: "CANCELLED", rawProviderStatus: text(result.status) };
    }

    async function handleProviderEvent(context = {}) {
        if (context.trusted !== true && context.trustedOperational !== true) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW webhook event is not trusted.", "webhook");
        const event = context.providerEvent || context.event || {};
        const attempt = context.attempt || {};
        if (text(event.provider) !== PROVIDER_ID) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW webhook provider is invalid.", "webhook");
        const idPay = text(event.providerReference || event.providerTransactionId);
        if (!idPay || idPay !== text(attempt.providerReference)) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW webhook id_pay does not match the payment attempt.", "webhook");
        if (text(event.ref1) !== referenceFor(attempt)) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW webhook ref1 does not match the payment attempt.", "webhook");
        const expectedSatang = Number(attempt.providerPayableAmountSatang);
        if (!Number.isSafeInteger(expectedSatang) || expectedSatang <= 0) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW provider payable amount is missing.", "webhook");
        if (satang(event.amountCheck) !== expectedSatang) throw providerError(ERROR_CODES.PAYMENT_PROVIDER_EVENT_INVALID, "TMW webhook amount does not match the provider payable amount.", "webhook");
        return {
            provider: PROVIDER_ID,
            providerReference: idPay,
            providerTransactionId: idPay,
            providerEventId: text(event.providerEventId),
            eventType: "TMW_PAYMENT_CONFIRMED",
            status: "PAID",
            amount: integerThb(attempt.amount),
            providerPayableAmountSatang: expectedSatang,
            providerPayableAmount: expectedSatang / 100,
            currency: "THB",
            orderId: attempt.orderId,
            safeMetadata: { providerId: PROVIDER_ID, verificationMethod: "tmw_md5_signature", providerPayableAmountSatang: expectedSatang },
            rawProviderStatus: "paid"
        };
    }

    return createProviderAdapter({
        providerId: PROVIDER_ID,
        displayName: "TMW Easy API",
        version: "1",
        supportedCurrencies: ["THB"],
        supportedPaymentMethods: [PAYMENT_METHOD],
        supportedCapabilities: [CAPABILITIES.CREATE_PAYMENT, CAPABILITIES.REFRESH_PAYMENT, CAPABILITIES.EXPIRE_PAYMENT, CAPABILITIES.CANCEL_PAYMENT, CAPABILITIES.WEBHOOK, CAPABILITIES.QR_CODE],
        environment: text(options.environment || process.env.NODE_ENV || "runtime"),
        handlers: { createPayment, refreshPayment, expirePayment, cancelPayment, handleProviderEvent }
    });
}

module.exports = Object.freeze({
    createTmwPromptPayAdapter,
    TMW_PROVIDER_ID: PROVIDER_ID,
    TMW_PAYMENT_METHOD: PAYMENT_METHOD,
    parseTmwSatang: satang
});
