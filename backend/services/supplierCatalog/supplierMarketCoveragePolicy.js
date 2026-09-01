"use strict";

const COVERAGE_STATES = Object.freeze({
    ELIGIBLE_GLOBAL: "ELIGIBLE_GLOBAL",
    ELIGIBLE_ASIA: "ELIGIBLE_ASIA",
    ELIGIBLE_ASIA_COUNTRY: "ELIGIBLE_ASIA_COUNTRY",
    NON_TARGET_MARKET: "NON_TARGET_MARKET",
    UNKNOWN_MARKET: "UNKNOWN_MARKET",
    SPECIAL: "SPECIAL",
    UNSUPPORTED: "UNSUPPORTED"
});

const DISPOSITIONS = Object.freeze({
    MAPPED: "MAPPED",
    CANONICAL_CREATED_AND_MAPPED: "CANONICAL_CREATED_AND_MAPPED",
    REVIEW_REQUIRED: "REVIEW_REQUIRED",
    UNSUPPORTED: "UNSUPPORTED",
    NON_TARGET_MARKET: "NON_TARGET_MARKET"
});

const ASIA_MULTI_MARKETS = new Set([
    "ASIA", "SEA", "SOUTHEAST ASIA", "SOUTH EAST ASIA",
    "MALAYSIA/SINGAPORE", "MALAYSIA / SINGAPORE", "SINGAPORE / MALAYSIA",
    "TAIWAN / HONG KONG / MACAU"
]);

const ASIA_COUNTRY_MARKETS = new Set([
    "BD", "BANGLADESH", "BN", "BRUNEI", "KH", "CAMBODIA", "CN", "CHINA",
    "HK", "HONG KONG", "IN", "INDIA", "ID", "INDONESIA", "JP", "JAPAN",
    "KZ", "KAZAKHSTAN", "LA", "LAOS", "MY", "MALAYSIA", "MM", "MYANMAR",
    "NP", "NEPAL", "PK", "PAKISTAN", "PH", "PHILIPPINES", "SG", "SINGAPORE",
    "KR", "SOUTH KOREA", "LK", "SRI LANKA", "SA", "SAUDI ARABIA", "AE", "UNITED ARAB EMIRATES",
    "BH", "BAHRAIN", "QA", "QATAR", "KW", "KUWAIT", "OM", "OMAN",
    "TW", "TAIWAN", "TH", "THAILAND",
    "VN", "VIETNAM"
]);

const UNKNOWN_MARKETS = new Set(["", "UNKNOWN", "UNSPECIFIED", "N/A", "NA"]);
const AMBIGUOUS_TRANSREGIONAL_MARKETS = new Set(["MENA", "CIS", "RU", "RUSSIA", "TR", "TURKEY"]);
const clean = value => String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, " ");

function classifySupplierMarket(input = {}) {
    const market = clean(input.supplierMarketCode || input.market || input.regionContext);
    const supportState = clean(input.supportState);
    if (["UNSUPPORTED", "RETIRED"].includes(supportState)) {
        return result(COVERAGE_STATES.UNSUPPORTED, market, false, "SUPPLIER_PRODUCT_UNSUPPORTED");
    }
    if (input.special === true) return result(COVERAGE_STATES.SPECIAL, market, false, "SPECIAL_PRODUCT_REVIEW_REQUIRED");
    if (market === "GLOBAL") return result(COVERAGE_STATES.ELIGIBLE_GLOBAL, market, true, "EXPLICIT_SUPPLIER_GLOBAL_EVIDENCE");
    if (ASIA_MULTI_MARKETS.has(market)) return result(COVERAGE_STATES.ELIGIBLE_ASIA, market, true, "EXPLICIT_SUPPLIER_ASIA_EVIDENCE");
    if (ASIA_COUNTRY_MARKETS.has(market)) return result(COVERAGE_STATES.ELIGIBLE_ASIA_COUNTRY, market, true, "EXPLICIT_TARGET_ASIA_MARKET_EVIDENCE");
    if (UNKNOWN_MARKETS.has(market) || AMBIGUOUS_TRANSREGIONAL_MARKETS.has(market)) return result(COVERAGE_STATES.UNKNOWN_MARKET, market || "UNSPECIFIED", false, "MARKET_EVIDENCE_INSUFFICIENT");
    return result(COVERAGE_STATES.NON_TARGET_MARKET, market, false, "EXPLICIT_NON_TARGET_MARKET");
}

function result(state, normalizedMarket, targetEligible, evidenceCode) {
    return Object.freeze({ state, normalizedMarket, targetEligible, evidenceCode });
}

function dispositionForOffer({ coverage, mappingStatus, reconciliationState, catalogLifecycleState, supportState }) {
    if (!coverage || coverage.state === COVERAGE_STATES.UNKNOWN_MARKET || coverage.state === COVERAGE_STATES.SPECIAL) return DISPOSITIONS.REVIEW_REQUIRED;
    if (coverage.state === COVERAGE_STATES.NON_TARGET_MARKET) return DISPOSITIONS.NON_TARGET_MARKET;
    if (coverage.state === COVERAGE_STATES.UNSUPPORTED || clean(supportState) === "UNSUPPORTED" || clean(catalogLifecycleState) === "RETIRED") return DISPOSITIONS.UNSUPPORTED;
    if (mappingStatus === "LINKED") return DISPOSITIONS.MAPPED;
    if (reconciliationState === "INTENTIONALLY_UNSUPPORTED") return DISPOSITIONS.UNSUPPORTED;
    return DISPOSITIONS.REVIEW_REQUIRED;
}

function isTargetCoverageState(state) {
    return [COVERAGE_STATES.ELIGIBLE_GLOBAL, COVERAGE_STATES.ELIGIBLE_ASIA, COVERAGE_STATES.ELIGIBLE_ASIA_COUNTRY].includes(state);
}

module.exports = Object.freeze({
    COVERAGE_STATES,
    DISPOSITIONS,
    ASIA_MULTI_MARKETS,
    ASIA_COUNTRY_MARKETS,
    classifySupplierMarket,
    dispositionForOffer,
    isTargetCoverageState
});
