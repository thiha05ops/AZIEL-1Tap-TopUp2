#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const PricingPolicy = require("../models/PricingPolicy");
const ExchangeRateAuthority = require("../models/ExchangeRateAuthority");

const APPLY = process.argv.includes("--apply");
const REQUIRED = [["USD", "THB"], ["USD", "MMK"], ["THB", "MMK"]];
const upper = value => String(value || "").trim().toUpperCase();

async function latestLegacy(fromCurrency, toCurrency) {
    return PricingPolicy.findOne({
        currency: toCurrency,
        "metadata.supplierCurrency": fromCurrency,
        "metadata.exchangeRate": { $gt: 0 },
        "metadata.exchangeRateSource": { $exists: true, $ne: "" },
        "metadata.exchangeRateCapturedAt": { $exists: true, $ne: "" }
    }).sort({ updatedAt: -1, _id: -1 }).lean();
}

(async () => {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
    await mongoose.connect(process.env.MONGO_URI);
    const before = await ExchangeRateAuthority.find({ status: "ACTIVE" }).lean();
    const matrix = [];
    for (const [fromCurrency, toCurrency] of REQUIRED) {
        const existing = before.find(row => row.fromCurrency === fromCurrency && row.toCurrency === toCurrency);
        const legacy = await latestLegacy(fromCurrency, toCurrency);
        const authority = existing || (legacy ? {
            rate: Number(legacy.metadata.exchangeRate),
            source: legacy.metadata.exchangeRateSource,
            capturedAt: legacy.metadata.exchangeRateCapturedAt,
            maximumAgeSeconds: Number(legacy.metadata.exchangeRateMaxAgeSeconds || 86400),
            legacyPolicyId: String(legacy._id),
            legacyPolicyCode: legacy.code
        } : null);
        matrix.push({ pair: `${fromCurrency}_${toCurrency}`, found: Boolean(authority), source: authority?.source || "", rate: authority?.rate || null, capturedAt: authority?.capturedAt || null, legacyPolicyCode: authority?.legacyPolicyCode || "", action: existing ? "REUSE" : authority ? "CREATE" : "BLOCKED_MISSING_AUTHORITY" });
    }
    console.log(JSON.stringify({ mode: APPLY ? "APPLY" : "DRY_RUN", before: before.map(row => ({ pair: `${row.fromCurrency}_${row.toCurrency}`, rate: row.rate, source: row.source, capturedAt: row.capturedAt })), matrix }, null, 2));
    if (!APPLY) return;
    const missing = matrix.filter(row => !row.found);
    if (missing.length) throw new Error(`Migration blocked; missing authoritative pairs: ${missing.map(row => row.pair).join(", ")}`);
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            const now = new Date();
            for (const row of matrix.filter(item => item.action === "CREATE")) {
                const [fromCurrency, toCurrency] = row.pair.split("_");
                await ExchangeRateAuthority.create([{
                    code: `AZIEL_FX_${fromCurrency}_${toCurrency}_MIGRATED_${now.getTime()}`,
                    fromCurrency, toCurrency, rate: row.rate, source: row.source,
                    capturedAt: row.capturedAt, maximumAgeSeconds: 86400,
                    status: "ACTIVE", authoritative: true, enabled: true, effectiveFrom: now,
                    metadata: { migratedFromPricingPolicyCode: row.legacyPolicyCode, authorityModel: "CURRENCY_PAIR" },
                    createdBy: "multi_currency_fx_migration", updatedBy: "multi_currency_fx_migration"
                }], { session });
            }
            await PricingPolicy.updateMany({ status: { $in: ["ACTIVE", "DRAFT"] } }, {
                $unset: {
                    "metadata.exchangeRate": "",
                    "metadata.supplierCurrency": "",
                    "metadata.exchangeRateSource": "",
                    "metadata.exchangeRateCapturedAt": "",
                    "metadata.exchangeRateEffectiveAt": "",
                    "metadata.exchangeRateExpiresAt": "",
                    "metadata.exchangeRateMaxAgeSeconds": ""
                },
                $set: { "metadata.authorityModel": "REGION_BUSINESS_POLICY" }
            }, { session });
        });
    } finally { await session.endSession(); }
    const after = await ExchangeRateAuthority.find({ status: "ACTIVE" }).sort({ fromCurrency: 1, toCurrency: 1 }).lean();
    console.log(JSON.stringify({ result: "PASS", activeAuthorities: after.map(row => ({ pair: `${upper(row.fromCurrency)}_${upper(row.toCurrency)}`, rate: row.rate, source: row.source, capturedAt: row.capturedAt, maximumAgeSeconds: row.maximumAgeSeconds })) }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
