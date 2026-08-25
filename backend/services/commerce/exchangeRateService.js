"use strict";

const { STOREFRONT_CURRENCY, SUPPLIER_CURRENCY } = require("../../constants/commerce");

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function assertCurrency(value, field, domain) {
    const currency = upper(value);
    if (!domain.includes(currency)) {
        throw new Error(`Unsupported ${field}: ${currency || "(empty)"}`);
    }
    return currency;
}

function parseEnvRates() {
    const raw = text(process.env.COMMERCE_EXCHANGE_RATES);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        throw new Error("COMMERCE_EXCHANGE_RATES must be valid JSON.");
    }
}

function envRateFor(sourceCurrency, targetCurrency) {
    const key = `${sourceCurrency}_${targetCurrency}`;
    const direct = process.env[`COMMERCE_EXCHANGE_RATE_${key}`] || process.env[`EXCHANGE_RATE_${key}`];
    if (direct !== undefined && direct !== "") return Number(direct);
    const table = parseEnvRates();
    return Number(table[key] ?? table[`${sourceCurrency}:${targetCurrency}`]);
}

function resolveExchangeRate({ sourceCurrency, targetCurrency, now = new Date() } = {}) {
    const source = assertCurrency(sourceCurrency, "sourceCurrency", SUPPLIER_CURRENCY);
    const target = assertCurrency(targetCurrency, "targetCurrency", STOREFRONT_CURRENCY);

    if (source === target) {
        return {
            rate: 1,
            source: "same_currency",
            provider: "AZIEL_COMMERCE",
            sourceCurrency: source,
            targetCurrency: target,
            capturedAt: now.toISOString()
        };
    }

    const rate = envRateFor(source, target);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Missing authoritative exchange rate for ${source}_${target}.`);
    }

    const pair = `${source}_${target}`;
    const capturedAt = text(process.env[`COMMERCE_EXCHANGE_RATE_${pair}_CAPTURED_AT`]);
    const maxAgeSeconds = Number(process.env[`COMMERCE_EXCHANGE_RATE_${pair}_MAX_AGE_SECONDS`]);
    const requireFreshness = !STOREFRONT_CURRENCY.includes(source);
    if (requireFreshness && (!capturedAt || !Number.isFinite(new Date(capturedAt).getTime()) || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0)) {
        throw new Error(`Bounded authoritative exchange-rate freshness is required for ${pair}.`);
    }
    return {
        rate,
        source: "environment",
        provider: "AZIEL_COMMERCE",
        sourceCurrency: source,
        targetCurrency: target,
        capturedAt: capturedAt || now.toISOString(),
        maxAgeSeconds: Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds : null,
        requireFreshness
    };
}

module.exports = Object.freeze({
    resolveExchangeRate
});
