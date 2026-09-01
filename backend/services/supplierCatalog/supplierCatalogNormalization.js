"use strict";

const crypto = require("crypto");

const MAX_RAW_SNAPSHOT_BYTES = 64 * 1024;
const MAX_SNAPSHOT_DEPTH = 8;
const MAX_OBJECT_FIELDS = 100;
const MAX_ARRAY_ITEMS = 200;
const MAX_STRING_LENGTH = 4096;
const DEFAULT_MARKET_CODE = "UNSPECIFIED";
const SECRET_KEY = /^(authorization|proxy-authorization|x-api-key|api[_-]?key|password|passwd|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|bearer|credentials?|balance|customer[_-]?(id|input|record)|player[_-]?id|user[_-]?id|game[_-]?id)$/i;

const clean = (value, max = 240) => String(value == null ? "" : value).trim().slice(0, max);

function canonicalize(value) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
    }
    return null;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function hashSupplierCatalogSnapshot(value) {
    return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sanitizeSupplierCatalogSnapshot(input, options = {}) {
    const limits = {
        maxBytes: Number(options.maxBytes || MAX_RAW_SNAPSHOT_BYTES),
        maxDepth: Number(options.maxDepth || MAX_SNAPSHOT_DEPTH),
        maxObjectFields: Number(options.maxObjectFields || MAX_OBJECT_FIELDS),
        maxArrayItems: Number(options.maxArrayItems || MAX_ARRAY_ITEMS),
        maxStringLength: Number(options.maxStringLength || MAX_STRING_LENGTH)
    };
    const reasons = new Set();
    const seen = new WeakSet();
    function visit(value, depth) {
        if (value === null || ["boolean", "number"].includes(typeof value)) return Number.isFinite(value) || typeof value !== "number" ? value : null;
        if (typeof value === "string") {
            if (value.length > limits.maxStringLength) reasons.add("STRING_LIMIT");
            return value.slice(0, limits.maxStringLength);
        }
        if (value instanceof Date) return value.toISOString();
        if (!value || typeof value !== "object") return null;
        if (seen.has(value)) { reasons.add("CIRCULAR_REFERENCE"); return "[Circular]"; }
        if (depth >= limits.maxDepth) { reasons.add("DEPTH_LIMIT"); return "[Depth limited]"; }
        seen.add(value);
        if (Array.isArray(value)) {
            if (value.length > limits.maxArrayItems) reasons.add("ARRAY_LIMIT");
            return value.slice(0, limits.maxArrayItems).map(item => visit(item, depth + 1));
        }
        const entries = Object.entries(value).filter(([key]) => {
            if (SECRET_KEY.test(key)) { reasons.add("SENSITIVE_KEY_FILTERED"); return false; }
            return !["__proto__", "constructor", "prototype"].includes(key);
        });
        if (entries.length > limits.maxObjectFields) reasons.add("OBJECT_FIELD_LIMIT");
        return Object.fromEntries(entries.slice(0, limits.maxObjectFields).map(([key, item]) => [clean(key, 160), visit(item, depth + 1)]));
    }
    let snapshot = visit(input, 0);
    let bytes = Buffer.byteLength(canonicalJson(snapshot));
    if (bytes > limits.maxBytes) {
        reasons.add("BYTE_LIMIT");
        const preview = canonicalJson(snapshot).slice(0, Math.max(0, limits.maxBytes - 512));
        snapshot = { truncated: true, reason: "BYTE_LIMIT", preview };
        bytes = Buffer.byteLength(canonicalJson(snapshot));
    }
    return {
        snapshot,
        truncation: { truncated: reasons.size > 0, reasons: [...reasons].sort(), originalLimitBytes: limits.maxBytes },
        serializedBytes: bytes
    };
}

function normalizeSupplierMarketCode(value, { evidenceProvided = false } = {}) {
    if (!evidenceProvided) return DEFAULT_MARKET_CODE;
    const normalized = clean(value, 80).toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    return normalized || DEFAULT_MARKET_CODE;
}

function normalizeSupplierProductIdentity(input = {}) {
    const identity = {
        supplierId: clean(input.supplierId, 80),
        catalogNamespace: clean(input.catalogNamespace || "TOPUP", 80).toUpperCase(),
        supplierProductCode: clean(input.supplierProductCode, 160)
    };
    if (!identity.supplierId || !identity.catalogNamespace || !identity.supplierProductCode) throw new TypeError("Supplier product identity is incomplete.");
    return { ...identity, key: `${identity.supplierId}/${identity.catalogNamespace}/${identity.supplierProductCode}` };
}

function normalizeSupplierOfferIdentity(input = {}) {
    const product = normalizeSupplierProductIdentity(input);
    const supplierOfferCode = clean(input.supplierOfferCode, 180);
    if (!supplierOfferCode) throw new TypeError("Supplier offer identity is incomplete.");
    return { ...product, supplierOfferCode, key: `${product.key}/${supplierOfferCode}` };
}

function normalizeSupplierCost(input = {}) {
    const amount = Number(input.amount);
    const currency = clean(input.currency, 12).toUpperCase();
    if (!Number.isFinite(amount) || amount < 0 || !currency) return null;
    const observedAt = input.observedAt ? new Date(input.observedAt) : null;
    if (!observedAt || !Number.isFinite(observedAt.getTime())) return null;
    return { amount, currency, observedAt };
}

function optionalNumber(value) {
    if (value === "" || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeOfferSemantics(input = {}) {
    const output = {
        currencyType: clean(input.currencyType, 80).toUpperCase(),
        baseAmount: optionalNumber(input.baseAmount),
        bonusAmount: optionalNumber(input.bonusAmount),
        displayTotal: optionalNumber(input.displayTotal),
        firstPurchaseOnly: input.firstPurchaseOnly === true,
        repeatability: clean(input.repeatability, 80).toUpperCase(),
        subscriptionDuration: clean(input.subscriptionDuration, 80),
        passType: clean(input.passType, 120).toUpperCase(),
        membershipType: clean(input.membershipType, 120).toUpperCase(),
        marketRestrictions: Array.isArray(input.marketRestrictions) ? input.marketRestrictions.map(value => clean(value, 160)).filter(Boolean) : [],
        accountRestrictions: Array.isArray(input.accountRestrictions) ? input.accountRestrictions.map(value => clean(value, 160)).filter(Boolean) : [],
        eventRestrictions: Array.isArray(input.eventRestrictions) ? input.eventRestrictions.map(value => clean(value, 160)).filter(Boolean) : []
    };
    return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== "" && value !== null && (!Array.isArray(value) || value.length)));
}

function observationTimestamps(existing = {}, observedAt = new Date(), { changed = false } = {}) {
    const observed = new Date(observedAt);
    if (!Number.isFinite(observed.getTime())) throw new TypeError("A valid observation timestamp is required.");
    return {
        firstSeenAt: existing.firstSeenAt ? new Date(existing.firstSeenAt) : observed,
        lastSeenAt: observed,
        lastObservedAt: observed,
        lastChangedAt: changed || !existing.lastChangedAt ? observed : new Date(existing.lastChangedAt)
    };
}

module.exports = Object.freeze({
    MAX_RAW_SNAPSHOT_BYTES,
    MAX_SNAPSHOT_DEPTH,
    MAX_OBJECT_FIELDS,
    MAX_ARRAY_ITEMS,
    DEFAULT_MARKET_CODE,
    canonicalJson,
    hashSupplierCatalogSnapshot,
    sanitizeSupplierCatalogSnapshot,
    normalizeSupplierMarketCode,
    normalizeSupplierProductIdentity,
    normalizeSupplierOfferIdentity,
    normalizeSupplierCost,
    normalizeOfferSemantics,
    observationTimestamps
});
