#!/usr/bin/env node
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const mongoose = require("mongoose");
const assert = require("assert");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const CatalogPackage = require("../models/CatalogPackage");
const adapter = require("../services/suppliers/fazercardsAdapter");
const { loadDailyPricingWorkspace, batchPreviewDailyPricing } = require("../services/commerce/adminPricingControlCenterService");

const EXPECTED = new Map([["60_uc", "PUBG_60_UC"], ["325_uc", "PUBG_FAZER_325_UC"], ["660_uc", "PUBG_FAZER_660_UC"], ["1800_uc", "PUBG_FAZER_1800_UC"], ["3850_uc", "PUBG_FAZER_3850_UC"], ["8100_uc", "PUBG_FAZER_8100_UC"]]);
async function main() {
    assert.notStrictEqual(String(process.env.FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED).toLowerCase(), "true", "live gate must be OFF");
    const before = await adapter.getBalance();
    await mongoose.connect(process.env.MONGO_URI);
    const supplier = await Supplier.findOne({ supplierCode: "FAZERCARDS" }).lean();
    assert(supplier && supplier.mode === "API" && supplier.supplierCurrency === "USD");
    const mappings = await Mapping.find({ supplierId: supplier._id, region: "TH", productCode: "pubg" }).lean();
    assert.strictEqual(mappings.length, 6);
    for (const mapping of mappings) {
        assert.strictEqual(mapping.supplierProductCode, "pubg_mobile_auto"); assert.strictEqual(EXPECTED.get(mapping.supplierPackageCode), mapping.packageCode);
        assert.strictEqual(mapping.executionMode, "API"); assert.strictEqual(mapping.enabled, false); assert.strictEqual(mapping.mappingMetadata?.readiness?.pricingReady, false);
        assert.strictEqual(mapping.supplierCostAuthority?.supplierCurrency, "USD"); assert(Number(mapping.supplierCostAuthority?.rawSupplierCost) > 0);
        assert.strictEqual(mapping.mappingMetadata?.validation?.categoryId, "pubg_mobile");
        assert.deepStrictEqual(mapping.mappingMetadata?.validation?.requiredFields, ["player_id"]);
    }
    const scoped = await CatalogPackage.find({ productCode: "pubg", packageCode: { $in: [...EXPECTED.values()].filter(code => code.includes("_FAZER_")) } }).lean();
    assert.strictEqual(scoped.length, 5); assert(scoped.every(pkg => pkg.enabled === false && !pkg.prices?.TH));
    const workspace = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), productCode: "pubg", region: "TH" });
    assert.strictEqual(workspace.rows.length, 6); assert(workspace.rows.every(row => row.supplierCurrency === "USD" && Number(row.supplierCost) > 0 && row.offered === false));
    assert(workspace.rows.every(row => row.previewEligible === true));
    const preview = await batchPreviewDailyPricing({
        supplierId: String(supplier._id),
        region: "TH",
        rows: workspace.rows.map(row => ({
            rowId: row.rowId,
            mappingId: row.mappingId,
            productCode: row.productCode,
            packageCode: row.packageCode,
            newSupplierCost: row.supplierCost,
            selected: false
        }))
    });
    assert.strictEqual(preview.rows.length, 6);
    const sixty = preview.rows.find(row => row.packageCode === "PUBG_60_UC");
    const th = sixty?.regions?.find(item => item.region === "TH");
    assert(th && th.blockingErrors.length === 0);
    assert(Number.isFinite(Number(th.exchangeRate)) && Number(th.exchangeRate) > 0, "active USD→THB exchange rate must resolve");
    assert.strictEqual(th.rawSupplierCost, 0.8874);
    assert(Math.abs(th.fxConvertedCost - (th.rawSupplierCost * th.exchangeRate)) < 0.000001, `unexpected converted cost ${th.fxConvertedCost}`);
    const economics = preview.rows.map(row => {
        const result = row.regions.find(item => item.region === "TH");
        assert(result && result.blockingErrors.length === 0);
        return { canonicalPackage: row.packageCode, providerOffer: row.supplierPackageCode, rawUSD: result.rawSupplierCost, fxRate: result.exchangeRate, convertedTHB: result.fxConvertedCost, landedTHB: result.landedCost, sellingTHB: result.recommendedSellingPrice, profitTHB: result.netProfit };
    }).sort((a, b) => a.rawUSD - b.rawUSD);
    await mongoose.disconnect();
    const after = await adapter.getBalance();
    console.log(JSON.stringify({ auth: "PASS", supplier: "REUSED", mappings: mappings.length, mappingsEnabled: mappings.filter(item => item.enabled).length, dailyPricingRows: workspace.rows.length, dailyPricingPreview: "PASS", rawUsdCostReady: true, validationCategory: "pubg_mobile", validationCalls: 0, usdToThbFx: th.exchangeRate, economics, publicationPerformed: false, storefrontChanged: false, balanceBefore: before.rawMetadata.balance, balanceAfter: after.rawMetadata.balance, balanceSpent: Number(before.rawMetadata.balance) - Number(after.rawMetadata.balance), realOrderCalls: 0, liveGate: false }, null, 2));
}
main().catch(async error => { console.error(JSON.stringify({ success: false, code: error.code || error.name, message: error.message })); await mongoose.disconnect().catch(() => null); process.exitCode = 1; });
