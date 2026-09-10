"use strict";

const crypto = require("crypto");
const ProviderWebhookEvent = require("../../models/ProviderWebhookEvent");
const orderRepository = require("./orderRepository");
const paymentAttemptRepository = require("./paymentAttemptRepository");
const { createTmwPaymentApplicationService } = require("./tmwPaymentApplicationService");
const { configurationFromEnvironment } = require("../tmwEasyApiClient");

class TmwWebhookError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "TmwWebhookError";
        this.code = code;
        this.statusCode = statusCode;
    }
}
const text = value => String(value == null ? "" : value).trim();
function canonicalEventFields(payload) {
    return JSON.stringify([text(payload.id_pay), text(payload.ref1), text(payload.amount_check), text(payload.amount), text(payload.date_pay)]);
}
function eventIdFor(payload) {
    return `tmw:payment:${crypto.createHash("sha256").update(canonicalEventFields(payload)).digest("hex")}`;
}
function verifySignature(data, signature, apiKey) {
    if (typeof data !== "string" || !data || !text(apiKey)) return false;
    const supplied = text(signature).toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(supplied)) return false;
    const expected = crypto.createHash("md5").update(`${data}:${apiKey}`, "utf8").digest("hex");
    const left = Buffer.from(supplied, "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function parseAmountStringToSatang(value) {
    const raw = text(value);
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(raw);
    if (!match) throw new TmwWebhookError("TMW_WEBHOOK_AMOUNT_INVALID", "TMW webhook amount is invalid.");
    const whole = Number(match[1]);
    const fraction = Number((match[2] || "").padEnd(2, "0") || 0);
    const result = whole * 100 + fraction;
    if (!Number.isSafeInteger(result) || result <= 0) throw new TmwWebhookError("TMW_WEBHOOK_AMOUNT_INVALID", "TMW webhook amount is invalid.");
    return result;
}
function parseAmountCheck(value) {
    const raw = text(value);
    if (!/^[1-9]\d*$/.test(raw)) throw new TmwWebhookError("TMW_WEBHOOK_AMOUNT_CHECK_INVALID", "TMW webhook amount_check is invalid.");
    const result = Number(raw);
    if (!Number.isSafeInteger(result)) throw new TmwWebhookError("TMW_WEBHOOK_AMOUNT_CHECK_INVALID", "TMW webhook amount_check is invalid.");
    return result;
}
function parsePayload(data) {
    let payload;
    try { payload = JSON.parse(data); } catch { throw new TmwWebhookError("TMW_WEBHOOK_DATA_INVALID", "TMW webhook data is invalid."); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TmwWebhookError("TMW_WEBHOOK_DATA_INVALID", "TMW webhook data is invalid.");
    for (const field of ["id_pay", "ref1", "amount_check", "date_pay"]) {
        if (!text(payload[field])) throw new TmwWebhookError("TMW_WEBHOOK_FIELD_MISSING", `TMW webhook ${field} is required.`);
    }
    return payload;
}

function createTmwPaymentWebhookService(dependencies = {}) {
    const env = dependencies.env || process.env;
    const configuration = dependencies.configuration || configurationFromEnvironment(env);
    const attempts = dependencies.paymentAttemptRepository || paymentAttemptRepository;
    const orders = dependencies.orderRepository || orderRepository;
    const webhookModel = dependencies.webhookEventModel || ProviderWebhookEvent;
    const application = dependencies.application || createTmwPaymentApplicationService(dependencies.applicationOptions || {});

    async function processWebhook(input = {}) {
        const data = input.data;
        if (typeof data !== "string" || typeof input.signature !== "string") throw new TmwWebhookError("TMW_WEBHOOK_ENVELOPE_INVALID", "TMW webhook envelope is invalid.");
        if (!configuration.apiKey) throw new TmwWebhookError("TMW_WEBHOOK_NOT_CONFIGURED", "TMW webhook is not configured.", 503);
        if (!verifySignature(data, input.signature, configuration.apiKey)) throw new TmwWebhookError("TMW_WEBHOOK_SIGNATURE_INVALID", "TMW webhook signature is invalid.", 401);
        const payload = parsePayload(data);
        const idPay = text(payload.id_pay);
        if (idPay.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(idPay)) throw new TmwWebhookError("TMW_WEBHOOK_ID_PAY_INVALID", "TMW webhook id_pay is invalid.");
        const amountCheck = parseAmountCheck(payload.amount_check);
        if (payload.amount != null && text(payload.amount) && parseAmountStringToSatang(payload.amount) !== amountCheck) throw new TmwWebhookError("TMW_WEBHOOK_AMOUNTS_DISAGREE", "TMW webhook amounts do not agree.");

        const attempt = await attempts.findAttemptByProviderReference({ providerReference: idPay });
        if (!attempt) throw new TmwWebhookError("TMW_PAYMENT_NOT_FOUND", "TMW payment was not found.", 404);
        if (text(attempt.provider) !== "TMW") throw new TmwWebhookError("TMW_PROVIDER_MISMATCH", "TMW payment provider does not match.", 409);
        if (text(payload.ref1) !== text(attempt.attemptId)) throw new TmwWebhookError("TMW_REFERENCE_MISMATCH", "TMW payment reference does not match.", 409);
        if (text(attempt.currency).toUpperCase() !== "THB") throw new TmwWebhookError("TMW_CURRENCY_MISMATCH", "TMW payment currency does not match.", 409);
        const expectedSatang = Number(attempt.amount) * 100;
        if (!Number.isSafeInteger(expectedSatang) || expectedSatang !== amountCheck) throw new TmwWebhookError("TMW_AMOUNT_MISMATCH", "TMW payment amount does not match.", 409);
        const order = await orders.findOrderById(attempt.orderId);
        if (!order || text(order.orderId) !== text(attempt.orderId) || text(order.payment?.provider) !== "TMW" || Number(order.commercial?.totalAmount) * 100 !== amountCheck || text(order.commercial?.currency).toUpperCase() !== "THB") {
            throw new TmwWebhookError("TMW_ORDER_BINDING_MISMATCH", "TMW payment order binding does not match.", 409);
        }

        const eventId = eventIdFor(payload);
        let receipt = await webhookModel.findOne({ provider: "TMW", eventId });
        if (receipt?.processingStatus === "PROCESSED") return { accepted: true, duplicate: true, eventId };
        if (!receipt) {
            try {
                receipt = await webhookModel.create({ provider: "TMW", eventId, eventType: "TMW_PAYMENT_CONFIRMED", providerOrderId: idPay, safeMetadata: { attemptId: attempt.attemptId, orderId: attempt.orderId, amountSatang: amountCheck } });
            } catch (error) {
                if (error?.code !== 11000) throw error;
                receipt = await webhookModel.findOne({ provider: "TMW", eventId });
                if (receipt?.processingStatus === "PROCESSED") return { accepted: true, duplicate: true, eventId };
            }
        }
        try {
            const result = await application.orchestrator.handleProviderEvent({
                trusted: true,
                providerEvent: { provider: "TMW", providerReference: idPay, providerTransactionId: idPay, providerEventId: eventId, eventType: "TMW_PAYMENT_CONFIRMED", status: "PAID", amount: amountCheck / 100, currency: "THB", orderId: attempt.orderId, ref1: text(payload.ref1), amountCheck }
            });
            if (receipt) { receipt.processingStatus = "PROCESSED"; receipt.processedAt = new Date(); await receipt.save(); }
            return { accepted: true, duplicate: result.metadata?.duplicate === true, eventId, payment: result };
        } catch (error) {
            if (["PAYMENT_EVENT_DUPLICATE", "PAYMENT_DUPLICATE_EVENT"].includes(error?.code)) {
                if (receipt) { receipt.processingStatus = "PROCESSED"; receipt.processedAt = new Date(); await receipt.save().catch(() => null); }
                return { accepted: true, duplicate: true, eventId };
            }
            if (receipt) { receipt.processingStatus = "FAILED"; receipt.processedAt = new Date(); await receipt.save().catch(() => null); }
            throw error;
        }
    }
    return Object.freeze({ processWebhook });
}

module.exports = Object.freeze({ createTmwPaymentWebhookService, TmwWebhookError, verifyTmwWebhookSignature: verifySignature, parseTmwWebhookPayload: parsePayload, tmwWebhookEventId: eventIdFor, parseTmwAmountToSatang: parseAmountStringToSatang });
