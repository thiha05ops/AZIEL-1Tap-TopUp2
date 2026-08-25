#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const PricingPolicy = require("../models/PricingPolicy");
const { batchPreviewDailyPricing, loadDailyPricingWorkspace } = require("../services/commerce/adminPricingControlCenterService");
const { resolveExchangeRate } = require("../services/commerce/exchangeRateService");

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const initial = await loadDailyPricingWorkspace({ region: "ALL" });
    const wondd = initial.suppliers.find(item => item.supplierCode === "WONDD");
    const seagm = initial.suppliers.find(item => item.supplierCode === "SEAGM");
    assert(wondd, "WONDD must appear as a mapped pricing supplier.");
    assert(!seagm, "Suppliers whose only mapping targets a soft-deleted package must not appear as a relevant workspace supplier.");

    const wonddAll = await loadDailyPricingWorkspace({ supplierId: wondd.id, productCode: "mlbb", region: "ALL" });
    assert.strictEqual(wonddAll.rows.length, 20);
    assert(wonddAll.rows.every(row => row.supplierCode === "WONDD" && row.mappingRegion === "TH" && row.supplierProductCode === "mlbb" && row.supplierPackageCode));
    assert.strictEqual(new Set(wonddAll.rows.map(row => row.mappingId)).size, 20);
    const ml86 = wonddAll.rows.find(row => row.packageCode === "MLBB_86");
    assert.strictEqual(ml86.supplierPackageCode, "ML00086");
    assert.strictEqual(ml86.supplierCost, 41);
    assert.strictEqual(ml86.supplierCurrency, "THB");

    const thPreview = await batchPreviewDailyPricing({ supplierId: wondd.id, region: "TH", rows: [{ mappingId: ml86.mappingId, productCode: "mlbb", packageCode: "MLBB_86", newSupplierCost: 999999, selected: true }] });
    assert.strictEqual(thPreview.rows[0].newSupplierCost, 41, "Mapping cost authority must override client cost.");
    assert.strictEqual(thPreview.rows[0].regions.length, 1);
    assert.strictEqual(thPreview.rows[0].regions[0].region, "TH");
    assert.strictEqual(thPreview.rows[0].regions[0].exchangeRate, 1);
    assert.strictEqual(thPreview.rows[0].regions[0].exchangeRateSource, "same_currency");
    assert(Number(thPreview.rows[0].regions[0].recommendedSellingPrice) > 41);

    const wonddMm = await loadDailyPricingWorkspace({ supplierId: wondd.id, productCode: "mlbb", region: "MM" });
    assert.strictEqual(wonddMm.rows.length, 20);
    assert(wonddMm.rows.every(row => row.offered === false && /No enabled WONDD mapping exists for MM/.test(row.offerabilityReason)));
    await assert.rejects(() => batchPreviewDailyPricing({ supplierId: wondd.id, region: "MM", rows: [{ mappingId: ml86.mappingId, productCode: "mlbb", packageCode: "MLBB_86", newSupplierCost: 41 }] }), error => error.code === "PRICING_SUPPLIER_REGION_UNAVAILABLE");

    const mmPolicy = await PricingPolicy.findOne({ status: "ACTIVE", region: "MM", currency: "MMK" }).sort({ updatedAt: -1 }).lean();
    assert.strictEqual(mmPolicy?.metadata?.supplierCurrency, "THB");
    assert(Number(mmPolicy?.metadata?.exchangeRate) > 0, "Active MM policy must contain an authoritative THB/MMK rate.");
    const originalDirect = process.env.COMMERCE_EXCHANGE_RATE_THB_MMK;
    const originalLegacy = process.env.EXCHANGE_RATE_THB_MMK;
    const originalTable = process.env.COMMERCE_EXCHANGE_RATES;
    delete process.env.COMMERCE_EXCHANGE_RATE_THB_MMK; delete process.env.EXCHANGE_RATE_THB_MMK; delete process.env.COMMERCE_EXCHANGE_RATES;
    assert.throws(() => resolveExchangeRate({ sourceCurrency: "THB", targetCurrency: "MMK" }), /Missing authoritative exchange rate/);
    if (originalDirect !== undefined) process.env.COMMERCE_EXCHANGE_RATE_THB_MMK = originalDirect;
    if (originalLegacy !== undefined) process.env.EXCHANGE_RATE_THB_MMK = originalLegacy;
    if (originalTable !== undefined) process.env.COMMERCE_EXCHANGE_RATES = originalTable;

    assert.strictEqual(wonddAll.rows.some(row => row.packageCode === "MLBB_1160_186"), false, "Unsupported package must not enter WonDD workspace.");
    await mongoose.disconnect();
    console.log(JSON.stringify({ result: "PASS", suppliers: initial.suppliers.map(item => item.supplierCode), wonddMlbbRows: wonddAll.rows.length, wonddRegions: [...new Set(wonddAll.rows.map(item => item.mappingRegion))], mlbb86Cost: ml86.supplierCost, thFx: thPreview.rows[0].regions[0].exchangeRate, mmOffered: false, activeMmPolicyRate: mmPolicy.metadata.exchangeRate, topupCalls: 0 }, null, 2));
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error("Daily Pricing supplier/region authority verifier failed:", error.message); process.exitCode = 1; });
