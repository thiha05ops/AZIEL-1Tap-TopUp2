"use strict";

const { STOREFRONT_CURRENCY, SUPPLIER_CURRENCY } = require("../../constants/commerce");
const ExchangeRateAuthority = require("../../models/ExchangeRateAuthority");

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

async function loadActiveExchangeRateAuthority({ sourceCurrency, targetCurrency, now = new Date() } = {}) {
    const source = assertCurrency(sourceCurrency, "sourceCurrency", SUPPLIER_CURRENCY);
    const target = assertCurrency(targetCurrency, "targetCurrency", STOREFRONT_CURRENCY);
    if (source === target) return null;
    return ExchangeRateAuthority.findOne({
        fromCurrency: source,
        toCurrency: target,
        status: "ACTIVE",
        enabled: true,
        authoritative: true,
        $and: [
            { $or: [{ effectiveFrom: null }, { effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: now } }] },
            { $or: [{ effectiveUntil: null }, { effectiveUntil: { $exists: false } }, { effectiveUntil: { $gte: now } }] }
        ]
    }).sort({ effectiveFrom: -1, updatedAt: -1, _id: -1 }).lean();
}

function snapshotFromAuthority(authority, { sourceCurrency, targetCurrency, now = new Date() } = {}) {
    const source = assertCurrency(sourceCurrency, "sourceCurrency", SUPPLIER_CURRENCY);
    const target = assertCurrency(targetCurrency, "targetCurrency", STOREFRONT_CURRENCY);
    if (source === target) return resolveExchangeRate({ sourceCurrency: source, targetCurrency: target, now });
    const rate = Number(authority?.rate);
    const capturedAt = new Date(authority?.capturedAt || "");
    const maximumAgeSeconds = Number(authority?.maximumAgeSeconds);
    if (!authority || !Number.isFinite(rate) || rate <= 0) throw new Error(`Missing authoritative exchange rate for ${source}_${target}.`);
    if (!Number.isFinite(capturedAt.getTime()) || !Number.isFinite(maximumAgeSeconds) || maximumAgeSeconds < 60) {
        throw new Error(`Bounded authoritative exchange-rate freshness is required for ${source}_${target}.`);
    }
    return {
        rate,
        source: text(authority.source),
        provider: "AZIEL_COMMERCE",
        sourceCurrency: source,
        targetCurrency: target,
        capturedAt: capturedAt.toISOString(),
        maxAgeSeconds: maximumAgeSeconds,
        requireFreshness: true,
        authorityId: text(authority._id),
        authorityCode: text(authority.code)
    };
}

module.exports = Object.freeze({
    loadActiveExchangeRateAuthority,
    snapshotFromAuthority,
    resolveExchangeRate
});
