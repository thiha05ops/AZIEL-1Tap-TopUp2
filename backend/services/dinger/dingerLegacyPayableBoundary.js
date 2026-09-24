"use strict";

const DINGER_LEGACY_PAYABLE_REJECTION_CODE = "DINGER_LEGACY_PAYABLE_FORBIDDEN";

function text(value) {
    return String(value || "").trim();
}

function compactIdentifier(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isDingerPaymentIdentifier(value) {
    const compact = compactIdentifier(value);
    if (!compact) return false;
    return compact === "dinger" || compact.startsWith("dinger") || compact.endsWith("dinger");
}

function dingerPaymentIdentifierFromPayload(payload = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
    const candidates = [
        payload.paymentMethod,
        payload.methodCode,
        payload.paymentMethodId,
        payload.provider,
        payload.paymentProvider,
        payload.providerId,
        payload.paymentChannel
    ];
    return candidates.find(isDingerPaymentIdentifier) || "";
}

function legacyPayableCreationDecision({ enabled, payload } = {}) {
    if (enabled !== true) return Object.freeze({ allowed: false, reason: "legacy_disabled" });
    if (dingerPaymentIdentifierFromPayload(payload)) {
        return Object.freeze({ allowed: false, reason: "dinger_forbidden" });
    }
    return Object.freeze({ allowed: true, reason: "allowed" });
}

function rejectLegacyDingerPayable(res) {
    return res.status(409).json({
        success: false,
        code: DINGER_LEGACY_PAYABLE_REJECTION_CODE,
        message: "Dinger payments must use the authorized AZIEL Commerce payment flow."
    });
}

module.exports = Object.freeze({
    DINGER_LEGACY_PAYABLE_REJECTION_CODE,
    compactIdentifier,
    isDingerPaymentIdentifier,
    dingerPaymentIdentifierFromPayload,
    legacyPayableCreationDecision,
    rejectLegacyDingerPayable
});
