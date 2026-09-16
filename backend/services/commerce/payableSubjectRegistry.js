"use strict";

const SUBJECT_TYPES = Object.freeze({
    COMMERCE_ORDER: "COMMERCE_ORDER",
    WALLET_TOPUP: "WALLET_TOPUP"
});

const REQUIRED_ADAPTER_METHODS = Object.freeze([
    "loadOwnedSubject",
    "loadOperationalSubject",
    "getSubjectId",
    "getAuthoritativeAmount",
    "getCurrency",
    "getRegion",
    "getPaymentSnapshot",
    "assertPayable",
    "applyPaymentTransition"
]);

class UnsupportedPayableSubjectError extends Error {
    constructor(subjectType) {
        super(`Unsupported payable subject type: ${String(subjectType || "").trim() || "(empty)"}.`);
        this.name = "UnsupportedPayableSubjectError";
        this.code = "PAYMENT_SUBJECT_UNSUPPORTED";
        this.subjectType = String(subjectType || "").trim();
    }
}

function createPayableSubjectRegistry(initialAdapters = {}) {
    const adapters = new Map();

    function register(subjectType, adapter) {
        const type = String(subjectType || "").trim().toUpperCase();
        if (!type || !adapter || typeof adapter !== "object") throw new TypeError("A payable subject type and adapter are required.");
        for (const method of REQUIRED_ADAPTER_METHODS) {
            if (typeof adapter[method] !== "function") {
                throw new TypeError(`Payable subject adapter ${type} requires function ${method}.`);
            }
        }
        adapters.set(type, adapter);
        return registry;
    }

    function get(subjectType) {
        const type = String(subjectType || "").trim().toUpperCase();
        const adapter = adapters.get(type);
        if (!adapter) throw new UnsupportedPayableSubjectError(type);
        return adapter;
    }

    const registry = Object.freeze({ register, get, has: subjectType => adapters.has(String(subjectType || "").trim().toUpperCase()) });
    Object.entries(initialAdapters).forEach(([subjectType, adapter]) => register(subjectType, adapter));
    return registry;
}

module.exports = Object.freeze({
    createPayableSubjectRegistry,
    UnsupportedPayableSubjectError,
    SUBJECT_TYPES,
    REQUIRED_ADAPTER_METHODS
});
