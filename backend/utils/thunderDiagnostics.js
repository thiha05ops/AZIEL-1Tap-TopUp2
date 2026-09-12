"use strict";

const crypto = require("crypto");

const ALLOWED_FIELDS = new Set([
    "correlationId", "orderTag", "attemptTag", "mimeType", "fileSize",
    "elapsedMs", "providerHttpStatus", "azielErrorCode", "providerErrorCode",
    "retryable", "validation", "passed", "beforePaymentState",
    "afterPaymentState", "evidenceBound", "reusedExisting", "transactionRefTag"
]);

function safeToken(value, maxLength = 80) {
    return String(value == null ? "" : value)
        .trim()
        .replace(/[^A-Za-z0-9._:-]/g, "_")
        .slice(0, maxLength);
}

function diagnosticTag(value) {
    try {
        const text = String(value == null ? "" : value).trim();
        return text ? crypto.createHash("sha256").update(text).digest("hex").slice(0, 12) : "";
    } catch (_) {
        return "";
    }
}

function safeFields(fields = {}) {
    try {
        const result = {};
        for (const [key, value] of Object.entries(fields || {})) {
            if (!ALLOWED_FIELDS.has(key) || value === undefined || value === null || value === "") continue;
            if (["fileSize", "elapsedMs", "providerHttpStatus"].includes(key)) {
                const numeric = Number(value);
                if (Number.isFinite(numeric)) result[key] = numeric;
            } else if (["retryable", "passed", "evidenceBound", "reusedExisting"].includes(key)) {
                result[key] = value === true;
            } else {
                result[key] = safeToken(value);
            }
        }
        return result;
    } catch (_) {
        return {};
    }
}

function logThunderDiagnostic(logger, event, fields = {}, level = "info") {
    try {
        const target = logger || console;
        const writer = typeof target?.[level] === "function"
            ? target[level].bind(target)
            : (typeof target?.log === "function" ? target.log.bind(target) : null);
        if (!writer) return;
        writer("[THUNDER_DIAGNOSTIC]", {
            event: safeToken(event, 120),
            ...safeFields(fields),
            at: new Date().toISOString()
        });
    } catch (_) {
        // Diagnostics are strictly best-effort and must never affect payment processing.
    }
}

module.exports = Object.freeze({ ALLOWED_FIELDS, diagnosticTag, logThunderDiagnostic, safeFields });
