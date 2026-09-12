"use strict";

const crypto = require("crypto");

const ALLOWED_FIELDS = new Set([
    "correlationId", "orderTag", "attemptTag", "mimeType", "fileSize",
    "elapsedMs", "providerHttpStatus", "azielErrorCode", "providerErrorCode",
    "retryable", "validation", "passed", "beforePaymentState",
    "afterPaymentState", "evidenceBound", "reusedExisting", "transactionRefTag",
    "matchedAccountPresent", "providerBankNumberPresent", "expectedReceiverLength",
    "providerReceiverLength", "providerReceiverMasked", "expectedReceiverFingerprint",
    "providerReceiverFingerprint", "bankCodeClass", "identifierType", "receiverFailureReason"
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

function receiverFingerprint(normalizedValue) {
    try {
        const value = String(normalizedValue == null ? "" : normalizedValue);
        // Diagnostic-only correlation tag. No suitable keyed secret is available at this boundary.
        return value ? crypto.createHash("sha256").update(value).digest("hex").slice(0, 12) : "";
    } catch (_) {
        return "";
    }
}

function buildReceiverDiagnostic(input = {}) {
    try {
        const expected = String(input.expectedNormalized || "");
        const provider = String(input.providerNormalized || "");
        const originalProvider = String(input.originalProviderValue || "");
        const bankCode = safeToken(input.bankCode || "UNKNOWN", 24).toUpperCase();
        return {
            matchedAccountPresent: input.matchedAccountPresent === true,
            providerBankNumberPresent: input.providerBankNumberPresent === true,
            expectedReceiverLength: expected.length,
            providerReceiverLength: provider.length,
            providerReceiverMasked: /[xX*]/.test(originalProvider),
            expectedReceiverFingerprint: receiverFingerprint(expected),
            providerReceiverFingerprint: receiverFingerprint(provider),
            bankCodeClass: /^[A-Z0-9_-]{1,24}$/.test(bankCode) ? bankCode : "UNKNOWN",
            identifierType: safeToken(input.identifierType || "BANK_ACCOUNT", 40).toUpperCase(),
            receiverFailureReason: safeToken(input.receiverFailureReason || "", 60).toUpperCase()
        };
    } catch (_) {
        return {};
    }
}

function safeFields(fields = {}) {
    try {
        const result = {};
        for (const [key, value] of Object.entries(fields || {})) {
            if (!ALLOWED_FIELDS.has(key) || value === undefined || value === null || value === "") continue;
            if (["fileSize", "elapsedMs", "providerHttpStatus", "expectedReceiverLength", "providerReceiverLength"].includes(key)) {
                const numeric = Number(value);
                if (Number.isFinite(numeric)) result[key] = numeric;
            } else if (["retryable", "passed", "evidenceBound", "reusedExisting", "matchedAccountPresent", "providerBankNumberPresent", "providerReceiverMasked"].includes(key)) {
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

module.exports = Object.freeze({ ALLOWED_FIELDS, buildReceiverDiagnostic, diagnosticTag, logThunderDiagnostic, receiverFingerprint, safeFields });
