"use strict";

const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const PaymentAttempt = require("../models/PaymentAttempt");
const { loadMyanMyanPayConfiguration } = require("../services/myanmyanpay/myanMyanPayConfiguration");
const { createMyanMyanPayClient } = require("../services/myanmyanpay/myanMyanPayClient");
const { isMyanMyanPayProviderOrderId } = require("../services/myanmyanpay/myanMyanPayProviderOrderId");
const { createManualPaymentApplicationService } = require("../services/commerce/manualPaymentApplicationService");

const MAX_BODY_BYTES = 16 * 1024;
const text = value => String(value || "").trim();
const ALLOWED = new Set(["orderId", "amount", "currency", "vendor", "method", "status", "condition", "transactionRefId", "vendorQrRefId", "callbackUrl", "customMessage", "appId", "createdAt"]);
const STATUSES = new Set(["PENDING", "SUCCESS", "FAILED", "REFUNDED", "CANCELLED", "EXPIRED"]);
const CONDITIONS = new Set(["PRISTINE", "TOUCHED", "EXPIRED", "DIRTY"]);

function validateCallback(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !ALLOWED.has(key))) throw Object.assign(new Error("Invalid callback body."), { code: "MYANMYANPAY_CALLBACK_INVALID", httpStatus: 400 });
    const result = { ...body, orderId: text(body.orderId), currency: text(body.currency).toUpperCase(), vendor: text(body.vendor), method: text(body.method).toUpperCase(), status: text(body.status).toUpperCase(), condition: text(body.condition).toUpperCase(), transactionRefId: text(body.transactionRefId), vendorQrRefId: text(body.vendorQrRefId), appId: text(body.appId) };
    if (!isMyanMyanPayProviderOrderId(result.orderId) || !Number.isSafeInteger(Number(result.amount)) || Number(result.amount) <= 0 || result.currency !== "MMK" || !result.vendor || result.method !== "QR" || !STATUSES.has(result.status) || !CONDITIONS.has(result.condition) || !result.transactionRefId) throw Object.assign(new Error("Invalid callback fields."), { code: "MYANMYANPAY_CALLBACK_INVALID", httpStatus: 400 });
    return result;
}

function eventId(result, environment = "SANDBOX") {
    return `myanmyanpay:${text(environment).toLowerCase()}:${crypto.createHash("sha256").update([result.orderId, result.transactionRefId, result.vendorQrRefId, result.status].join("\0"), "utf8").digest("hex")}`;
}

async function resolveAttemptEnvironment(orderId, options = {}) {
    const findAttempt = options.findAttempt || (providerReference => PaymentAttempt.findOne({ provider: "MYANMYANPAY", providerReference }).select("provider safeMetadata.environment").lean());
    const attempt = await findAttempt(orderId);
    const environment = text(attempt?.safeMetadata?.environment).toUpperCase();
    if (!attempt || !["SANDBOX", "PRODUCTION"].includes(environment)) throw Object.assign(new Error("Payment attempt not found."), { code: "MYANMYANPAY_CALLBACK_ATTEMPT_NOT_FOUND", httpStatus: 404 });
    return environment;
}

async function handleMyanMyanPaySettlementCallback(req, res, options = {}) {
    try {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw Object.assign(new Error("Raw callback body is unavailable."), { code: "MYANMYANPAY_CALLBACK_RAW_BODY_MISSING", httpStatus: 400 });
        const payload = req.body.toString("utf8");
        let body;
        try {
            body = JSON.parse(payload);
        } catch (_) {
            throw Object.assign(new Error("Invalid callback JSON."), { code: "MYANMYANPAY_CALLBACK_JSON_INVALID", httpStatus: 400 });
        }
        const untrustedOrderId = text(body?.orderId);
        if (!isMyanMyanPayProviderOrderId(untrustedOrderId)) throw Object.assign(new Error("Invalid callback order."), { code: "MYANMYANPAY_CALLBACK_INVALID", httpStatus: 400 });
        const environment = options.configuration?.environment || await resolveAttemptEnvironment(untrustedOrderId, options);
        const configuration = options.configuration || loadMyanMyanPayConfiguration(options.env, { environment });
        const nonce = text(req.get("X-Mmpay-Nonce"));
        const signature = text(req.get("X-Mmpay-Signature"));
        if (!nonce || !signature) return res.status(401).json({ received: false, code: "MYANMYANPAY_CALLBACK_AUTH_MISSING" });
        const client = options.client || createMyanMyanPayClient(configuration);
        await client.verifyAndListen(payload, nonce, signature);
        const result = validateCallback(body);
        if (result.appId && result.appId !== configuration.appId) throw Object.assign(new Error("Application mismatch."), { code: "MYANMYANPAY_APPLICATION_MISMATCH", httpStatus: 409 });
        const service = options.paymentService || createManualPaymentApplicationService(options.paymentServiceOptions || {});
        const settlement = await service.applyMyanMyanPayCallback({ result, environment, appId: configuration.appId, providerEventId: eventId(result, environment) });
        return res.status(200).json({ received: true, duplicate: settlement?.metadata?.duplicate === true });
    } catch (error) {
        const status = Number(error.httpStatus || error.statusCode || 0);
        const clientError = status >= 400 && status < 500;
        return res.status(clientError ? status : 503).json({ received: false, code: text(error.code || (clientError ? "MYANMYANPAY_CALLBACK_REJECTED" : "MYANMYANPAY_CALLBACK_PROCESSING_UNCERTAIN")) });
    }
}

function createMyanMyanPaySettlementCallbackRouter(options = {}) {
    const router = express.Router();
    const limiter = options.limiter || rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
    const parser = express.raw({ limit: MAX_BODY_BYTES, type: "application/json" });
    router.post("/payment", limiter, (req, res, next) => req.is("application/json") ? parser(req, res, next) : res.status(415).json({ received: false, code: "MYANMYANPAY_CONTENT_TYPE_UNSUPPORTED" }), (req, res) => handleMyanMyanPaySettlementCallback(req, res, options));
    router.use((error, req, res, next) => error ? res.status(error.type === "entity.too.large" ? 413 : 400).json({ received: false, code: error.type === "entity.too.large" ? "MYANMYANPAY_CALLBACK_BODY_TOO_LARGE" : "MYANMYANPAY_CALLBACK_JSON_INVALID" }) : next());
    return router;
}
module.exports = Object.freeze({ MAX_BODY_BYTES, validateCallback, eventId, resolveAttemptEnvironment, handleMyanMyanPaySettlementCallback, createMyanMyanPaySettlementCallbackRouter });
