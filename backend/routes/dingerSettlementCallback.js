"use strict";

const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { decryptAesEcbPkcs7, verifyCallbackChecksum } = require("../services/dinger/dingerCryptoService");
const { parseDingerCallbackResult } = require("../services/dinger/dingerCallbackContract");
const { createManualPaymentApplicationService } = require("../services/commerce/manualPaymentApplicationService");

const MAX_BODY_BYTES = 16 * 1024;
const CALLBACK_CONTRACT = Object.freeze({ confirmed: true, input: "DECRYPTED_JSON_TEXT", encoding: "HEX_LOWER" });

function text(value) { return String(value || "").trim(); }
function enabled(value) { return text(value).toLowerCase() === "true"; }
function safeCode(error, fallback = "DINGER_CALLBACK_REJECTED") { return text(error?.code || fallback).replace(/[^A-Z0-9_.-]/gi, "").slice(0, 80) || fallback; }
function tag(value) { return crypto.createHash("sha256").update(text(value), "utf8").digest("hex").slice(0, 12); }

function settlementConfiguration(env = process.env) {
    const key = text(env.DINGER_LIVE_CALLBACK_KEY);
    const configuredOffset = Number(env.DINGER_TOKEN_TIMESTAMP_UTC_OFFSET_MINUTES);
    return Object.freeze({
        enabled: enabled(env.DINGER_LIVE_CALLBACK_SETTLEMENT_ENABLED),
        live: text(env.DINGER_ENVIRONMENT).toUpperCase() === "LIVE",
        contractConfirmed: enabled(env.DINGER_LIVE_CALLBACK_VERIFICATION_CONTRACT_CONFIRMED),
        key,
        validKeyLength: Buffer.byteLength(key, "utf8") === 32,
        utcOffsetMinutes: Number.isSafeInteger(configuredOffset) && configuredOffset >= -840 && configuredOffset <= 840
            ? configuredOffset
            : 390
    });
}

function assertSettlementConfiguration(config) {
    if (!config.enabled || !config.live || !config.contractConfirmed || !config.validKeyLength) {
        const error = new Error("Dinger settlement callback is not configured.");
        error.code = "DINGER_SETTLEMENT_CALLBACK_DISABLED";
        error.httpStatus = 503;
        throw error;
    }
}

function validateEnvelope(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("invalid envelope"), { code: "DINGER_CALLBACK_ENVELOPE_INVALID", httpStatus: 400 });
    const fields = Object.keys(body).sort();
    if (fields.length !== 2 || fields[0] !== "checksum" || fields[1] !== "paymentResult") throw Object.assign(new Error("invalid envelope"), { code: "DINGER_CALLBACK_ENVELOPE_INVALID", httpStatus: 400 });
    const paymentResult = text(body.paymentResult);
    const checksum = text(body.checksum).toLowerCase();
    if (!paymentResult || paymentResult.length > MAX_BODY_BYTES || !/^[a-f0-9]{64}$/.test(checksum)) throw Object.assign(new Error("invalid envelope"), { code: "DINGER_CALLBACK_ENVELOPE_INVALID", httpStatus: 400 });
    return { paymentResult, checksum };
}

function callbackOccurredAt(result, utcOffsetMinutes = 390) {
    const match = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})$/.exec(result.createdAt);
    if (!match) throw Object.assign(new Error("invalid timestamp"), { code: "DINGER_CALLBACK_RESULT_INVALID", httpStatus: 400 });
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - utcOffsetMinutes * 60000).toISOString();
}

function callbackEventId(result) {
    return `dinger:${crypto.createHash("sha256").update(`${result.transactionId}\0${result.transactionStatus}`, "utf8").digest("hex")}`;
}

async function processDingerSettlementCallback(body, options = {}) {
    const config = options.configuration || settlementConfiguration(options.env);
    assertSettlementConfiguration(config);
    const envelope = validateEnvelope(body);
    const exactJsonText = decryptAesEcbPkcs7({ encryptedBase64: envelope.paymentResult, keyBytes: config.key });
    if (!verifyCallbackChecksum({ exactJsonText, checksum: envelope.checksum, contract: CALLBACK_CONTRACT })) {
        throw Object.assign(new Error("checksum mismatch"), { code: "DINGER_CALLBACK_CHECKSUM_INVALID", httpStatus: 401 });
    }
    const result = parseDingerCallbackResult(exactJsonText);
    const service = options.paymentService || createManualPaymentApplicationService(options.paymentServiceOptions || {});
    const settlement = await service.applyDingerCallback({
        result,
        providerEventId: callbackEventId(result),
        occurredAt: callbackOccurredAt(result, Number(options.utcOffsetMinutes ?? config.utcOffsetMinutes ?? 390))
    });
    return Object.freeze({ result, settlement });
}

function createDingerSettlementCallbackRouter(options = {}) {
    const router = express.Router();
    const logger = options.logger || console;
    const limiter = options.limiter || rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
    const parser = express.json({ limit: MAX_BODY_BYTES, strict: true, type: "application/json" });
    router.post("/payment", limiter, (req, res, next) => {
        try { assertSettlementConfiguration(settlementConfiguration(options.env)); }
        catch (error) { return res.status(error.httpStatus || 503).json({ received: false, code: safeCode(error) }); }
        if (!req.is("application/json")) return res.status(415).json({ received: false, code: "DINGER_CALLBACK_CONTENT_TYPE_UNSUPPORTED" });
        return parser(req, res, next);
    }, async (req, res) => {
        try {
            const processed = await processDingerSettlementCallback(req.body, options);
            logger.info?.("Dinger settlement callback applied.", {
                event: "DINGER_CALLBACK_SETTLED",
                status: processed.result.transactionStatus,
                merchantReferenceTag: tag(processed.result.merchantOrderId),
                transactionReferenceTag: tag(processed.result.transactionId),
                duplicate: processed.settlement?.metadata?.duplicate === true
            });
            return res.status(200).json({ data: {
                transactionStatus: processed.result.transactionStatus,
                merchantOrderId: processed.result.merchantOrderId,
                totalAmount: processed.result.totalAmount,
                methodName: processed.result.methodName,
                providerName: processed.result.providerName,
                transactionId: processed.result.transactionId
            } });
        } catch (error) {
            const status = Number(error?.httpStatus || error?.statusCode || 0);
            const clientError = status >= 400 && status < 500;
            const code = safeCode(error, clientError ? "DINGER_CALLBACK_REJECTED" : "DINGER_CALLBACK_PROCESSING_UNCERTAIN");
            logger.warn?.("Dinger settlement callback rejected.", { event: "DINGER_CALLBACK_REJECTED", code, retryable: !clientError });
            return res.status(clientError ? status : 503).json({ received: false, code });
        }
    });
    router.use((error, req, res, next) => {
        if (!error) return next();
        return res.status(error.type === "entity.too.large" ? 413 : 400).json({ received: false, code: error.type === "entity.too.large" ? "DINGER_CALLBACK_BODY_TOO_LARGE" : "DINGER_CALLBACK_JSON_INVALID" });
    });
    return router;
}

module.exports = Object.freeze({
    MAX_BODY_BYTES,
    CALLBACK_CONTRACT,
    settlementConfiguration,
    assertSettlementConfiguration,
    validateEnvelope,
    callbackOccurredAt,
    callbackEventId,
    processDingerSettlementCallback,
    createDingerSettlementCallbackRouter
});
