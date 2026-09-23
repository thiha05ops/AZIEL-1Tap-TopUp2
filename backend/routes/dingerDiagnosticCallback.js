"use strict";

const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { decryptAesEcbPkcs7, verifyCallbackChecksum } = require("../services/dinger/dingerCryptoService");
const { parseDingerCallbackResult } = require("../services/dinger/dingerCallbackContract");

const MODE = "DIAGNOSTIC_ONLY";
const KEY_ENCODING = "UTF8";
const CHECKSUM_INPUT = "EXACT_DECRYPTED_UTF8_JSON";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPLAY_ENTRIES = 1000;
const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

function text(value) { return String(value || "").trim(); }
function enabled(value) { return text(value).toLowerCase() === "true"; }
function safeCode(error, fallback = "DINGER_CALLBACK_REJECTED") {
    return text(error?.code || fallback).replace(/[^A-Z0-9_.-]/gi, "").slice(0, 80) || fallback;
}
function tag(value) { return crypto.createHash("sha256").update(text(value), "utf8").digest("hex").slice(0, 12); }

function callbackConfiguration(env = process.env) {
    const key = text(env.DINGER_PRODUCTION_TEST_CALLBACK_KEY);
    return Object.freeze({
        enabled: enabled(env.DINGER_PRODUCTION_TEST_CALLBACK_ENABLED),
        mode: text(env.DINGER_PRODUCTION_TEST_CALLBACK_MODE),
        key,
        keyEncoding: text(env.DINGER_PRODUCTION_TEST_CALLBACK_KEY_ENCODING).toUpperCase(),
        checksumInput: text(env.DINGER_PRODUCTION_TEST_CALLBACK_CHECKSUM_INPUT).toUpperCase()
    });
}

function configurationFailure(config) {
    if (!config.enabled) return Object.freeze({ status: 503, code: "DINGER_DIAGNOSTIC_CALLBACK_DISABLED" });
    if (config.mode !== MODE) return Object.freeze({ status: 503, code: "DINGER_DIAGNOSTIC_MODE_REQUIRED" });
    if (!config.key) return Object.freeze({ status: 503, code: "DINGER_DIAGNOSTIC_CALLBACK_KEY_MISSING" });
    if (config.keyEncoding !== KEY_ENCODING || config.checksumInput !== CHECKSUM_INPUT) {
        return Object.freeze({ status: 503, code: "DINGER_CALLBACK_VERIFICATION_CONTRACT_UNCONFIRMED" });
    }
    return null;
}

function validateEnvelope(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("invalid callback envelope"), { code: "DINGER_CALLBACK_ENVELOPE_INVALID" });
    const fields = Object.keys(body).sort();
    if (fields.length !== 2 || fields[0] !== "checksum" || fields[1] !== "paymentResult") {
        throw Object.assign(new Error("invalid callback envelope"), { code: "DINGER_CALLBACK_ENVELOPE_INVALID" });
    }
    const paymentResult = text(body.paymentResult);
    const checksum = text(body.checksum).toLowerCase();
    if (!paymentResult || paymentResult.length > MAX_BODY_BYTES || !/^[a-f0-9]{64}$/.test(checksum)) {
        throw Object.assign(new Error("invalid callback fields"), { code: "DINGER_CALLBACK_ENVELOPE_INVALID" });
    }
    return Object.freeze({ paymentResult, checksum });
}

function createReplayStore(clock = () => Date.now()) {
    const entries = new Map();
    function prune() {
        const cutoff = clock() - REPLAY_TTL_MS;
        for (const [key, createdAt] of entries) if (createdAt < cutoff) entries.delete(key);
        while (entries.size > MAX_REPLAY_ENTRIES) entries.delete(entries.keys().next().value);
    }
    return Object.freeze({
        claim(key) {
            prune();
            if (entries.has(key)) return false;
            entries.set(key, clock());
            return true;
        }
    });
}

function createDingerDiagnosticCallbackRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const logger = options.logger || console;
    const replayStore = options.replayStore || createReplayStore(options.clock);
    const limiter = options.limiter || rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
    const jsonParser = express.json({ limit: MAX_BODY_BYTES, strict: true, type: "application/json" });

    router.post("/payment", limiter, (req, res, next) => {
        const failure = configurationFailure(callbackConfiguration(env));
        if (failure) return res.status(failure.status).json({ received: false, code: failure.code });
        if (!req.is("application/json")) return res.status(415).json({ received: false, code: "DINGER_CALLBACK_CONTENT_TYPE_UNSUPPORTED" });
        return jsonParser(req, res, next);
    }, (req, res) => {
        const config = callbackConfiguration(env);
        try {
            const envelope = validateEnvelope(req.body);
            const exactJsonText = decryptAesEcbPkcs7({ encryptedBase64: envelope.paymentResult, keyBytes: config.key });
            const checksumValid = verifyCallbackChecksum({
                exactJsonText,
                checksum: envelope.checksum,
                contract: { confirmed: true, input: "DECRYPTED_JSON_TEXT", encoding: "HEX_LOWER" }
            });
            if (!checksumValid) throw Object.assign(new Error("checksum mismatch"), { code: "DINGER_CALLBACK_CHECKSUM_INVALID" });
            const result = parseDingerCallbackResult(exactJsonText);
            const replayKey = crypto.createHash("sha256").update(`${result.merchantOrderId}\0${result.transactionId}\0${envelope.checksum}`, "utf8").digest("hex");
            const firstDelivery = replayStore.claim(replayKey);
            logger.info?.("Dinger diagnostic callback verified.", {
                event: firstDelivery ? "DINGER_DIAGNOSTIC_CALLBACK_VERIFIED" : "DINGER_DIAGNOSTIC_CALLBACK_DUPLICATE",
                diagnosticOnly: true,
                transactionStatus: result.transactionStatus,
                providerName: result.providerName,
                methodName: result.methodName,
                totalAmount: result.totalAmount,
                merchantReferenceTag: tag(result.merchantOrderId),
                transactionReferenceTag: tag(result.transactionId)
            });
            return res.status(200).json({ received: true, verified: true, diagnosticOnly: true, duplicate: !firstDelivery, paymentStateChanged: false });
        } catch (error) {
            const code = safeCode(error);
            logger.warn?.("Dinger diagnostic callback rejected.", { event: "DINGER_DIAGNOSTIC_CALLBACK_REJECTED", diagnosticOnly: true, code });
            return res.status(400).json({ received: false, verified: false, diagnosticOnly: true, code, paymentStateChanged: false });
        }
    });

    router.use((error, req, res, next) => {
        if (!error) return next();
        const tooLarge = error.type === "entity.too.large";
        logger.warn?.("Dinger diagnostic callback body rejected.", { event: "DINGER_DIAGNOSTIC_CALLBACK_BODY_REJECTED", diagnosticOnly: true, code: tooLarge ? "DINGER_CALLBACK_BODY_TOO_LARGE" : "DINGER_CALLBACK_JSON_INVALID" });
        return res.status(tooLarge ? 413 : 400).json({ received: false, verified: false, diagnosticOnly: true, code: tooLarge ? "DINGER_CALLBACK_BODY_TOO_LARGE" : "DINGER_CALLBACK_JSON_INVALID", paymentStateChanged: false });
    });

    return router;
}

module.exports = Object.freeze({
    MODE,
    KEY_ENCODING,
    CHECKSUM_INPUT,
    MAX_BODY_BYTES,
    callbackConfiguration,
    configurationFailure,
    validateEnvelope,
    createReplayStore,
    createDingerDiagnosticCallbackRouter
});
