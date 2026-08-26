#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Product = require("../models/CatalogProduct");
const Package = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const Supplier = require("../models/Supplier");
const adapter = require("../services/suppliers/fazercardsAdapter");
const { loadDailyPricingWorkspace, batchPreviewDailyPricing } = require("../services/commerce/adminPricingControlCenterService");
const { resolveCheckoutRouteSnapshot } = require("../services/supplierProductionSelectionService");
const CODES = ["HOK_16_TOKENS", "HOK_80_TOKENS", "HOK_240_TOKENS", "HOK_400_TOKENS", "HOK_560_TOKENS", "HOK_830_TOKENS", "HOK_1245_TOKENS", "HOK_2508_TOKENS", "HOK_4180_TOKENS", "HOK_8360_TOKENS"];
async function main() {
    assert.strictEqual(adapter.isAutoFulfillmentEnabled("hok"), false);
    const dryRun = adapter.dryRunTopup({ categoryId: "honor_of_kings", offerId: "16_tokens", fields: { player_id: "TEST_ONLY_PLAYER_ID" }, idempotencyKey: "HOK-STABILIZATION-MOCK" });
    assert.strictEqual(dryRun.status, "DRY_RUN_VALID"); assert.strictEqual(dryRun.liveEnabled, false);
    await mongoose.connect(process.env.MONGO_URI);
    const [hok, pass, packages, mappings, supplier] = await Promise.all([Product.findOne({ productCode: "hok" }).lean(), Product.findOne({ productCode: "hok-pass-cards" }).lean(), Package.find({ productCode: { $in: ["hok", "hok-pass-cards"] }, deletedAt: null }).lean(), Mapping.find({ supplierCode: "FAZERCARDS", productCode: "hok", region: "TH" }).lean(), Supplier.findOne({ supplierCode: "FAZERCARDS" }).lean()]);
    assert.deepStrictEqual(hok.supportedRegions, ["TH"]); assert.strictEqual(pass.enabled, false); assert.strictEqual(pass.commerceState, "HIDDEN"); assert.strictEqual(pass.publicDiscoveryEnabled, false);
    assert.strictEqual(packages.filter(pkg => pkg.productCode === "hok-pass-cards").length, 2); assert(packages.filter(pkg => pkg.productCode === "hok-pass-cards").every(pkg => ["HOK_WEEKLY_CARD", "HOK_WEEKLY_CARD_PLUS"].includes(pkg.packageCode)));
    assert.strictEqual(mappings.length, 10); assert.strictEqual(mappings.filter(m => m.enabled).length, 0); assert.strictEqual(mappings.filter(m => m.productionRole === "PRIMARY").length, 0);
    for (const code of CODES) { const pkg = packages.find(item => item.productCode === "hok" && item.packageCode === code); const mapping = mappings.find(item => item.packageCode === code); assert(pkg && pkg.enabled === true && pkg.packageFamily?.code === "TOKENS", `Canonical package invalid: ${code}`); assert(mapping && mapping.executionMode === "API" && mapping.supplierProductCode === "honor_of_kings" && mapping.supplierCostAuthority?.supplierCurrency === "USD" && Number(mapping.supplierCostAuthority?.rawSupplierCost) > 0, `Mapping invalid: ${code}`); }
    const workspace = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), productCode: "hok", region: "ALL" });
    const rows = workspace.rows.filter(row => CODES.includes(row.packageCode)); assert.strictEqual(rows.length, 10); assert(rows.every(row => row.previewEligible && row.regionalAvailability.TH.eligible && !row.regionalAvailability.MM.eligible));
    const preview = await batchPreviewDailyPricing({ supplierId: String(supplier._id), region: "ALL", rows: rows.map(row => ({ mappingId: row.mappingId, productCode: row.productCode, packageCode: row.packageCode, newSupplierCost: row.supplierCost, selected: false })) });
    assert.strictEqual(preview.rows.length, 10); assert(preview.rows.every(row => row.regions.length === 1 && row.regions[0].region === "TH" && Number(row.regions[0].exchangeRate) === 35.25 && Number(row.regions[0].recommendedSellingPrice) > 0));
    const newCodes = new Set(CODES.slice(5)); assert(packages.filter(pkg => newCodes.has(pkg.packageCode)).every(pkg => !pkg.prices?.TH && !pkg.prices?.MM));
    for (const code of CODES.slice(0, 5)) { const route = await resolveCheckoutRouteSnapshot({ productCode: "hok", packageCode: code, region: "TH" }); assert(route.ready && route.routeSnapshot?.routeType === "MANUAL_ADMIN", `Published ${code} must retain safe manual checkout.`); }
    for (const code of CODES.slice(5)) { const route = await resolveCheckoutRouteSnapshot({ productCode: "hok", packageCode: code, region: "TH" }); assert.strictEqual(route.ready, false, `Unpriced ${code} must not enter checkout.`); }
    console.log(JSON.stringify({ result: "PASS", tokenPackages: packages.filter(pkg => pkg.productCode === "hok").length, exactFazerMappings: mappings.length, thPricingPreviews: preview.rows.length, mmNotOffered: preview.rows.filter(row => !row.regions.some(region => region.region === "MM")).length, existingManualCheckoutRoutes: 5, unpricedCheckoutBlocked: 5, passPackagesHidden: 2, dryRun: "PASS", realOrders: 0, realTopups: 0 }, null, 2));
}
main().catch(error => { console.error(`VERIFY_HOK_STABILIZATION_FAILED: ${error.message}`); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
