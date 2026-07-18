const crypto = require("crypto");
const { formatPaymentMethod } = require("./paymentDisplayNameService");

const DEFAULT_MANUAL_ATTEMPT_LIMIT = 5;
const DEFAULT_MANUAL_ATTEMPT_TTL_MS = 15 * 60 * 1000;

function getManualAttemptLimit(env = process.env) {
    const value = Number(env.MAX_ACTIVE_MANUAL_PAYMENT_ATTEMPTS);
    return Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_MANUAL_ATTEMPT_LIMIT;
}

function getManualAttemptTtlMs(env = process.env) {
    const minutes = Number(env.MANUAL_PAYMENT_ATTEMPT_TTL_MINUTES);
    return Number.isFinite(minutes) && minutes > 0
        ? minutes * 60 * 1000
        : DEFAULT_MANUAL_ATTEMPT_TTL_MS;
}

function createSecureToken(bytes = 12) {
    return crypto.randomBytes(bytes).toString("hex").toUpperCase();
}

function createAttemptId() {
    return `MPA-${createSecureToken(10)}`;
}

function createManualReference() {
    return `AZL-${createSecureToken(8)}`;
}

function normalizePaymentKey(value) {
    return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "")
        .replaceAll("-", "")
        .replaceAll("_", "")
        .replace(/[^a-z0-9]/g, "");
}

function projectPaymentInstructions(method = {}, reference = "") {
    return {
        method: formatPaymentMethod(method, method.method || "Payment"),
        key: method.key || "",
        paymentType: method.paymentType || "manual",
        provider: method.provider || "manual",
        accountName: method.accountName || "",
        accountNumber: method.accountNumber || "",
        qrImage:
            method.uploadedQrImage ||
            method.qrImageUrl ||
            method.qrImage ||
            "",
        reference
    };
}

function isTransactionUnsupported(error) {
    const text = `${error?.message || ""} ${error?.codeName || ""}`;
    return (
        text.includes("Transaction numbers are only allowed") ||
        text.includes("transactions are not supported") ||
        text.includes("TransactionNotSupported") ||
        text.includes("IllegalOperation")
    );
}

module.exports = {
    DEFAULT_MANUAL_ATTEMPT_LIMIT,
    DEFAULT_MANUAL_ATTEMPT_TTL_MS,
    createAttemptId,
    createManualReference,
    getManualAttemptLimit,
    getManualAttemptTtlMs,
    isTransactionUnsupported,
    normalizePaymentKey,
    projectPaymentInstructions
};
