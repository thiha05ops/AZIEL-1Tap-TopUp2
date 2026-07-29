"use strict";

const { CURRENCY } = require("../../constants/commerce");

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function assertCurrency(value, field) {
    const currency = upper(value);
    if (!CURRENCY.includes(currency)) {
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
    const source = assertCurrency(sourceCurrency, "sourceCurrency");
    const target = assertCurrency(targetCurrency, "targetCurrency");

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

    return {
        rate,
        source: "environment",
        provider: "AZIEL_COMMERCE",
        sourceCurrency: source,
        targetCurrency: target,
        capturedAt: now.toISOString()
    };
}

module.exports = Object.freeze({
    resolveExchangeRate
});
