"use strict";

const CUSTOMER_MARKETS = Object.freeze(["MM", "TH"]);
const FULFILLMENT_ELIGIBILITY_MODES = Object.freeze({
    UNKNOWN: "UNKNOWN",
    GLOBAL: "GLOBAL",
    CUSTOMER_MARKET_ALLOWLIST: "CUSTOMER_MARKET_ALLOWLIST"
});
const FULFILLMENT_ELIGIBILITY_EVIDENCE_CODES = Object.freeze([
    "",
    "PROVIDER_CONFIRMED",
    "OPERATOR_CONFIRMED_CAPABILITY",
    "CONTROLLED_TEST",
    "LEGACY_EFFECTIVE_SCOPE"
]);

const text = value => String(value == null ? "" : value).trim();
const upper = value => text(value).toUpperCase();
const marketToken = value => upper(value).replace(/_/g, " ").replace(/\s+/g, " ").trim();
const ASIA_MULTI_MARKETS = new Set([
    "ASIA", "SEA", "SOUTHEAST ASIA", "SOUTH EAST ASIA",
    "MALAYSIA/SINGAPORE", "MALAYSIA / SINGAPORE", "SINGAPORE / MALAYSIA",
    "MALAYSIA SINGAPORE", "SINGAPORE MALAYSIA",
    "TAIWAN / HONG KONG / MACAU", "TAIWAN HONG KONG MACAU"
]);
const ASIA_COUNTRY_MARKETS = new Set([
    "BD", "BANGLADESH", "BN", "BRUNEI", "KH", "CAMBODIA", "CN", "CHINA",
    "HK", "HONG KONG", "IN", "INDIA", "ID", "INDONESIA", "JP", "JAPAN",
    "KZ", "KAZAKHSTAN", "LA", "LAOS", "MY", "MALAYSIA", "MM", "MYANMAR",
    "NP", "NEPAL", "PK", "PAKISTAN", "PH", "PHILIPPINES", "SG", "SINGAPORE",
    "KR", "SOUTH KOREA", "LK", "SRI LANKA", "SA", "SAUDI ARABIA", "AE", "UNITED ARAB EMIRATES",
    "BH", "BAHRAIN", "QA", "QATAR", "KW", "KUWAIT", "OM", "OMAN",
    "TW", "TAIWAN", "TH", "THAILAND", "VN", "VIETNAM"
]);

function normalizeAllowedCustomerMarkets(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(upper).filter(Boolean))].sort();
}

function normalizeFulfillmentEligibility(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const verifiedAt = source.verifiedAt ? new Date(source.verifiedAt) : null;
    const version = Number(source.version);
    return Object.freeze({
        mode: upper(source.mode) || FULFILLMENT_ELIGIBILITY_MODES.UNKNOWN,
        allowedCustomerMarkets: Object.freeze(normalizeAllowedCustomerMarkets(source.allowedCustomerMarkets)),
        evidenceCode: upper(source.evidenceCode),
        evidenceSource: text(source.evidenceSource),
        verifiedAt: verifiedAt && Number.isFinite(verifiedAt.getTime()) ? verifiedAt.toISOString() : null,
        version: Number.isInteger(version) && version > 0 ? version : 1
    });
}

function validateFulfillmentEligibility(value, { allowMissing = false } = {}) {
    const missing = value === undefined || value === null;
    const normalized = normalizeFulfillmentEligibility(value);
    const rawMarkets = Array.isArray(value?.allowedCustomerMarkets) ? value.allowedCustomerMarkets.map(upper) : [];
    const errors = [];
    if (missing && !allowMissing) errors.push("FULFILLMENT_ELIGIBILITY_MISSING");
    if (!missing && (typeof value !== "object" || Array.isArray(value))) errors.push("FULFILLMENT_ELIGIBILITY_MALFORMED");
    if (!Object.values(FULFILLMENT_ELIGIBILITY_MODES).includes(normalized.mode)) errors.push("FULFILLMENT_ELIGIBILITY_MODE_INVALID");
    if (!Array.isArray(value?.allowedCustomerMarkets)) errors.push("FULFILLMENT_ELIGIBILITY_MARKETS_INVALID");
    if (rawMarkets.some(market => !CUSTOMER_MARKETS.includes(market))) errors.push("FULFILLMENT_ELIGIBILITY_MARKET_UNKNOWN");
    if (!FULFILLMENT_ELIGIBILITY_EVIDENCE_CODES.includes(normalized.evidenceCode)) errors.push("FULFILLMENT_ELIGIBILITY_EVIDENCE_INVALID");
    if (!Number.isInteger(Number(value?.version)) || Number(value?.version) < 1) errors.push("FULFILLMENT_ELIGIBILITY_VERSION_INVALID");
    if (value?.verifiedAt && normalized.verifiedAt === null) errors.push("FULFILLMENT_ELIGIBILITY_VERIFIED_AT_INVALID");
    if (
        [FULFILLMENT_ELIGIBILITY_MODES.UNKNOWN, FULFILLMENT_ELIGIBILITY_MODES.GLOBAL].includes(normalized.mode) &&
        normalized.allowedCustomerMarkets.length
    ) errors.push("FULFILLMENT_ELIGIBILITY_ALLOWLIST_MUST_BE_EMPTY");
    if (
        normalized.mode === FULFILLMENT_ELIGIBILITY_MODES.CUSTOMER_MARKET_ALLOWLIST &&
        normalized.allowedCustomerMarkets.length === 0
    ) errors.push("FULFILLMENT_ELIGIBILITY_ALLOWLIST_REQUIRED");
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), value: normalized });
}

function isCustomerMarketEligible(value, customerMarket) {
    const market = upper(customerMarket);
    if (!CUSTOMER_MARKETS.includes(market)) return false;
    const assessment = validateFulfillmentEligibility(value);
    if (!assessment.valid) return false;
    if (assessment.value.mode === FULFILLMENT_ELIGIBILITY_MODES.GLOBAL) return true;
    if (assessment.value.mode === FULFILLMENT_ELIGIBILITY_MODES.CUSTOMER_MARKET_ALLOWLIST) {
        return assessment.value.allowedCustomerMarkets.includes(market);
    }
    return false;
}

function supplierMarketCompatibility(supplierMarket, customerMarket) {
    const supplier = marketToken(supplierMarket);
    const customer = upper(customerMarket);
    if (!CUSTOMER_MARKETS.includes(customer)) return Object.freeze({ compatible: false, deterministic: true, code: "CUSTOMER_MARKET_UNSUPPORTED" });
    if (supplier === "GLOBAL") return Object.freeze({ compatible: true, deterministic: true, code: "GLOBAL_COMMERCE_COMPATIBILITY" });
    if (ASIA_MULTI_MARKETS.has(supplier)) return Object.freeze({ compatible: true, deterministic: true, code: "ASIA_COMMERCE_COMPATIBILITY" });
    if (["TH", "THAILAND"].includes(supplier)) return Object.freeze({ compatible: customer === "TH", deterministic: true, code: customer === "TH" ? "TH_COMMERCE_COMPATIBILITY" : "SUPPLIER_MARKET_MISMATCH" });
    if (["MM", "MYANMAR"].includes(supplier)) return Object.freeze({ compatible: customer === "MM", deterministic: true, code: customer === "MM" ? "MM_COMMERCE_COMPATIBILITY" : "SUPPLIER_MARKET_MISMATCH" });
    if (ASIA_COUNTRY_MARKETS.has(supplier)) return Object.freeze({ compatible: false, deterministic: true, code: "SUPPLIER_MARKET_UNSUPPORTED_FOR_AZIEL_COMMERCE" });
    return Object.freeze({ compatible: false, deterministic: false, code: supplier === "UNSPECIFIED" || !supplier ? "SUPPLIER_MARKET_UNSPECIFIED" : "SUPPLIER_MARKET_COMPATIBILITY_UNPROVEN" });
}

function isCustomerMarketCompatible(mapping, customerMarket) {
    if (isCustomerMarketEligible(mapping?.fulfillmentEligibility, customerMarket)) return true;
    return supplierMarketCompatibility(mapping?.region, customerMarket).compatible;
}

module.exports = Object.freeze({
    CUSTOMER_MARKETS,
    FULFILLMENT_ELIGIBILITY_MODES,
    FULFILLMENT_ELIGIBILITY_EVIDENCE_CODES,
    normalizeFulfillmentEligibility,
    validateFulfillmentEligibility,
    isCustomerMarketEligible
    ,supplierMarketCompatibility,
    isCustomerMarketCompatible
});
