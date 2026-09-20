#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const PricingPolicy = require("../models/PricingPolicy");
const ExchangeRateAuthority = require("../models/ExchangeRateAuthority");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const { batchPreviewDailyPricing, loadDailyPricingWorkspace } = require("../services/commerce/adminPricingControlCenterService");
const { resolveExchangeRate } = require("../services/commerce/exchangeRateService");
const { SUPPLIER_CURRENCY } = require("../constants/commerce");

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const initial = await loadDailyPricingWorkspace({ region: "ALL" });
    const wondd = initial.suppliers.find(item => item.supplierCode === "WONDD");
    const fazer = initial.suppliers.find(item => item.supplierCode === "FAZERCARDS");
    const seagm = initial.suppliers.find(item => item.supplierCode === "SEAGM");
    assert(wondd, "WONDD must appear as a mapped pricing supplier.");
    assert(fazer, "FAZERCARDS must appear as a mapped pricing supplier.");
    assert(!seagm, "Suppliers whose only mapping targets a soft-deleted package must not appear as a relevant workspace supplier.");

    const wonddAll = await loadDailyPricingWorkspace({ supplierId: wondd.id, productCode: "mlbb", region: "ALL" });
    const wonddMlbbRows = wonddAll.rows.filter(row => row.productCode === "mlbb");
    assert.strictEqual(new Set(wonddMlbbRows.map(row => row.packageCode)).size, 18);
    assert(wonddMlbbRows.every(row => row.supplierCode === "WONDD" && row.mappingRegion === "TH" && row.supplierProductCode && row.supplierPackageCode));
    assert.strictEqual(new Set(wonddMlbbRows.map(row => row.mappingId)).size, 18);
    const wonddPass = await loadDailyPricingWorkspace({ supplierId: wondd.id, productCode: "mlbb-twilight-weekly-pass", region: "ALL" });
    const wonddPassRows = wonddPass.rows.filter(row => row.productCode === "mlbb-twilight-weekly-pass");
    assert.strictEqual(new Set(wonddPassRows.map(row => row.mappingId)).size, 2, "MLBB pass mappings must remain available under their split canonical product.");
    const ml86 = wonddMlbbRows.find(row => row.packageCode === "MLBB_86");
    assert.strictEqual(ml86.supplierPackageCode, "ML00086");
    assert.strictEqual(ml86.supplierCost, 41);
    assert.strictEqual(ml86.supplierCurrency, "THB");

    const thPreview = await batchPreviewDailyPricing({ supplierId: wondd.id, region: "TH", rows: [{ mappingId: ml86.mappingId, productCode: "mlbb", packageCode: "MLBB_86", newSupplierCost: 999999, selected: true }] });
    assert.strictEqual(thPreview.rows[0].newSupplierCost, 41, "Mapping cost authority must override client cost.");
    assert.deepStrictEqual(thPreview.rows[0].regions.map(item => item.region).sort(), ["MM", "TH"]);
    const thRegion = thPreview.rows[0].regions.find(item => item.region === "TH");
    assert.strictEqual(thRegion.exchangeRate, 1);
    assert.strictEqual(thRegion.exchangeRateSource, "same_currency");
    assert(Number(thRegion.recommendedSellingPrice) > 41);

    const pubg60Mapping = await SupplierProductMapping.findOne({ supplierId: fazer.id, productCode: "pubg", packageCode: "PUBG_60_UC", "supplierCostAuthority.rawSupplierCost": { $ne: null } }).select("region").lean();
    assert(pubg60Mapping?.region, "PUBG 60 UC must have an exact FazerCards supplier market.");
    const fazerMm = await loadDailyPricingWorkspace({ supplierId: fazer.id, supplierMarket: pubg60Mapping.region, productCode: "pubg", region: "MM" });
    const mm60 = fazerMm.rows.find(row => row.productCode === "pubg" && row.packageCode === "PUBG_60_UC");
    assert(mm60, "Canonical MM-enabled PUBG 60 UC must enter the MM pricing workspace.");
    const mmPreview = await batchPreviewDailyPricing({ supplierId: fazer.id, region: "MM", rows: [{ mappingId: mm60.mappingId, productCode: "pubg", packageCode: "PUBG_60_UC", newSupplierCost: mm60.supplierCost }] });
    const mmRegion = mmPreview.rows[0].regions.find(item => item.region === "MM");
    assert(mmRegion);
    assert(Number(mmRegion.exchangeRate) > 0);

    const mmPolicy = await PricingPolicy.findOne({ status: "ACTIVE", region: "MM", currency: "MMK" }).sort({ updatedAt: -1 }).lean();
    assert(mmPolicy, "Active MM region business policy must exist.");
    assert.strictEqual(mmPolicy.metadata?.supplierCurrency, undefined, "Region business policy must not own supplier currency.");
    assert.strictEqual(mmPolicy.metadata?.exchangeRate, undefined, "Region business policy must not own an FX rate.");
    const mmFx = await ExchangeRateAuthority.find({ status: "ACTIVE", toCurrency: "MMK", enabled: true, authoritative: true }).lean();
    assert(mmFx.some(row => row.fromCurrency === "USD" && Number(row.rate) > 0), "USD_MMK authority must exist independently.");
    assert(mmFx.some(row => row.fromCurrency === "THB" && Number(row.rate) > 0), "THB_MMK authority must exist independently.");
    const originalDirect = process.env.COMMERCE_EXCHANGE_RATE_THB_MMK;
    const originalLegacy = process.env.EXCHANGE_RATE_THB_MMK;
    const originalTable = process.env.COMMERCE_EXCHANGE_RATES;
    delete process.env.COMMERCE_EXCHANGE_RATE_THB_MMK; delete process.env.EXCHANGE_RATE_THB_MMK; delete process.env.COMMERCE_EXCHANGE_RATES;
    assert.throws(() => resolveExchangeRate({ sourceCurrency: "THB", targetCurrency: "MMK" }), /Missing authoritative exchange rate/);
    if (originalDirect !== undefined) process.env.COMMERCE_EXCHANGE_RATE_THB_MMK = originalDirect;
    if (originalLegacy !== undefined) process.env.EXCHANGE_RATE_THB_MMK = originalLegacy;
    if (originalTable !== undefined) process.env.COMMERCE_EXCHANGE_RATES = originalTable;

    assert.strictEqual(wonddMlbbRows.some(row => row.packageCode === "MLBB_1160_186"), false, "Unsupported package must not enter WonDD workspace.");
    await mongoose.disconnect();
    console.log(JSON.stringify({ result: "PASS", suppliers: initial.suppliers.map(item => item.supplierCode), wonddMlbbPackages: new Set(wonddMlbbRows.map(item => item.packageCode)).size, pricingRegions: [...new Set(wonddMlbbRows.map(item => item.region))], mappingRegions: [...new Set(wonddMlbbRows.map(item => item.mappingRegion))], mlbb86Cost: ml86.supplierCost, thFx: thRegion.exchangeRate, fazerPubg60MmFx: mmRegion.exchangeRate, activeMmPolicyOwnsFx: false, independentMmPairs: mmFx.map(row => `${row.fromCurrency}_${row.toCurrency}`), topupCalls: 0 }, null, 2));
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error("Daily Pricing supplier/region authority verifier failed:", error.message); process.exitCode = 1; });
