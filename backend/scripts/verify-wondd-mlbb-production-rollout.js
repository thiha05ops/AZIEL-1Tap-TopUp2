#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const audit = require("../../docs/wondd-catalog-audit.json");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const { createWonddAdapter } = require("../services/suppliers/wonddAdapter");
const { buildWonddGameId } = require("../services/suppliers/wonddGameIdFormatters");
const { resolveFulfillmentCapability } = require("../services/fulfillmentCapabilityService");

(async () => {
    const mlbbCatalog = audit.games.find(game => String(game.serviceid) === "9622");
    assert(mlbbCatalog);
    assert.strictEqual(mlbbCatalog.packages.length, 20);
    assert.strictEqual(mlbbCatalog.servicecode, null, "Catalog serviceid remains distinct from confirmed API servicecode.");

    let transportCalls = 0;
    const adapter = createWonddAdapter({
        env: { WONDD_USERNAME: "configured", WONDD_PASSWORD: "configured", WONDD_MLBB_AUTO_FULFILLMENT_ENABLED: "false" },
        fetchImpl: async () => { transportCalls += 1; throw new Error("Transport must not be called by dry-run verification."); }
    });
    assert.strictEqual(adapter.isAutoFulfillmentEnabled("mlbb"), false);
    await assert.rejects(() => adapter.submitTopup({ productCode: "mlbb", serviceCode: "mlbb", packCode: "ML00086", gameId: "439488505 2409" }), error => error.code === "WONDD_AUTO_FULFILLMENT_DISABLED");
    assert.strictEqual(transportCalls, 0);

    await mongoose.connect(process.env.MONGO_URI);
    const [product, supplier, mappings] = await Promise.all([
        CatalogProduct.findOne({ productCode: "mlbb" }).lean(),
        Supplier.findOne({ supplierCode: "WONDD" }).lean(),
        Mapping.find({ supplierCode: "WONDD", productCode: "mlbb", region: "TH" }).lean()
    ]);
    assert(product?.enabled && product?.commerceState === "PURCHASABLE" && product?.supportedRegions?.includes("TH"));
    assert(supplier?.enabled && supplier?.mode === "API");
    assert.strictEqual(mappings.length, 20);
    assert.strictEqual(new Set(mappings.map(mapping => mapping.supplierPackageCode)).size, 20);
    assert.strictEqual(new Set(mappings.map(mapping => mapping.packageCode)).size, 20);
    const packages = await CatalogPackage.find({ productCode: "mlbb", packageCode: { $in: mappings.map(mapping => mapping.packageCode) }, deletedAt: null }).lean();
    assert.strictEqual(packages.length, 20);
    const packageMap = new Map(packages.map(pkg => [pkg.packageCode, pkg]));

    for (const catalogRow of mlbbCatalog.packages) {
        const mapping = mappings.find(item => item.supplierPackageCode === catalogRow.packcode);
        assert(mapping, `Missing ${catalogRow.packcode}`);
        assert.strictEqual(mapping.supplierProductCode, "mlbb");
        assert.strictEqual(mapping.executionMode, "API");
        assert.strictEqual(mapping.enabled, true);
        assert.deepStrictEqual(mapping.mappingMetadata?.readiness, { supplierMapped: true, inputReady: true, pricingReady: true, fulfillmentReady: true, enabled: true });
        const pkg = packageMap.get(mapping.packageCode);
        assert(pkg?.enabled, `${mapping.packageCode} disabled`);
        assert(pkg.prices?.TH?.enabled, `${mapping.packageCode} TH price disabled`);
        assert.strictEqual(pkg.prices.TH.supplierCode, "WONDD");
        assert.strictEqual(Number(pkg.prices.TH.supplierCost), Number(catalogRow.netpricedealer));
        assert(Number(pkg.prices.TH.amount) > Number(pkg.prices.TH.supplierCost));
        assert.strictEqual(pkg.prices.TH.publishedPriceMode, "POLICY_DERIVED");
        const capability = resolveFulfillmentCapability({ product, mappings: [mapping], suppliers: [supplier], productCode: "mlbb", packageCode: mapping.packageCode, region: "TH" });
        assert.strictEqual(capability.fulfillmentAvailable, true, `${mapping.packageCode} not fulfillment-capable`);
        assert.strictEqual(capability.automatedAvailable, true, `${mapping.packageCode} has no API route`);
        const dryRun = adapter.dryRunTopup({ productCode: "mlbb", serviceCode: "mlbb", packCode: mapping.supplierPackageCode, gameId: buildWonddGameId("mlbb", { userId: "439488505", zoneId: "2409" }) });
        assert.strictEqual(dryRun.status, "DRY_RUN_VALID");
        assert.strictEqual(dryRun.liveEnabled, false);
        assert.strictEqual(dryRun.payload.servicecode, "mlbb");
        assert.strictEqual(dryRun.payload.packcode, catalogRow.packcode);
    }
    const regression = mappings.find(item => item.packageCode === "MLBB_86");
    assert.strictEqual(regression?.supplierPackageCode, "ML00086");
    assert.strictEqual(transportCalls, 0);
    await mongoose.disconnect();
    console.log("WonDD MLBB production rollout verifier passed: 20/20 ready; gate OFF; zero top-up calls.");
})().catch(async error => {
    await mongoose.disconnect().catch(() => null);
    console.error("WonDD MLBB production rollout verifier failed:", error.message);
    process.exitCode = 1;
});
