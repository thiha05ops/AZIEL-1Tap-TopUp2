#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const audit = require("../../docs/wondd-catalog-audit.json");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const { createWonddAdapter, normalizeWonddStatus } = require("../services/suppliers/wonddAdapter");
const { buildWonddGameId } = require("../services/suppliers/wonddGameIdFormatters");
const { validateWonddMapping } = require("../services/suppliers/wonddFulfillmentProcessor");
const { resolveFulfillmentCapability } = require("../services/fulfillmentCapabilityService");
const { getCatalogProductDetail } = require("../services/catalogService");
const { loadDailyPricingWorkspace } = require("../services/commerce/adminPricingControlCenterService");

(async () => {
    const game = audit.games.find(item => String(item.serviceid) === "9602");
    assert(game && game.packages.length === 19);
    assert.strictEqual(game.servicecode, null, "serviceid 9602 must remain metadata, not API servicecode");
    assert.strictEqual(new Set(game.packages.map(item => item.packcode)).size, 19);
    assert.strictEqual(buildWonddGameId("freefire", { userId: " 123456789 ", zoneId: "2409", serverId: "ignored" }), "123456789");
    assert.strictEqual(buildWonddGameId("mlbb", { userId: "123456789", zoneId: "2409" }), "123456789 2409");
    assert.throws(() => buildWonddGameId("freefire", { userId: "   " }), error => error.code === "WONDD_FREEFIRE_PLAYER_ID_REQUIRED");

    let transportCalls = 0;
    const adapter = createWonddAdapter({
        env: { WONDD_USERNAME: "configured", WONDD_PASSWORD: "configured", WONDD_FREEFIRE_AUTO_FULFILLMENT_ENABLED: "false", WONDD_MLBB_AUTO_FULFILLMENT_ENABLED: "false" },
        fetchImpl: async () => { transportCalls += 1; throw new Error("Gate-off verification must not call transport."); }
    });
    const dry = adapter.dryRunTopup({ productCode: "freefire", serviceCode: "freefire", packCode: "F00033", gameId: buildWonddGameId("freefire", { userId: "123456789" }) });
    assert.deepStrictEqual(dry.payload, { method: "topup", servicecode: "freefire", packcode: "F00033", gameid: "12***89" });
    assert.strictEqual(dry.liveEnabled, false);
    await assert.rejects(() => adapter.submitTopup({ productCode: "freefire", serviceCode: "freefire", packCode: "F00033", gameId: "123456789" }), error => error.code === "WONDD_AUTO_FULFILLMENT_DISABLED");
    assert.strictEqual(transportCalls, 0);
    const legacyGlobalGate = createWonddAdapter({ env: { WONDD_USERNAME: "configured", WONDD_PASSWORD: "configured", WONDD_AUTO_FULFILLMENT_ENABLED_PRODUCTS: "freefire" } });
    assert.strictEqual(legacyGlobalGate.isAutoFulfillmentEnabled("freefire"), false, "The dedicated Free Fire gate must not be bypassed by the legacy global list.");
    let mockCalls = 0;
    let submittedBody = "";
    const mockLive = createWonddAdapter({
        env: { WONDD_USERNAME: "configured", WONDD_PASSWORD: "configured", WONDD_FREEFIRE_AUTO_FULFILLMENT_ENABLED: "true" },
        fetchImpl: async (_url, options) => { mockCalls += 1; submittedBody = options.body; return { ok: true, status: 200, async text() { return JSON.stringify({ errorcode: "00", orderid: "MOCK-FF-1" }); } }; }
    });
    const accepted = await mockLive.submitTopup({ productCode: "freefire", serviceCode: "freefire", packCode: "F00033", gameId: "123456789" });
    const submitted = new URLSearchParams(submittedBody);
    assert.strictEqual(submitted.get("servicecode"), "freefire");
    assert.strictEqual(submitted.get("packcode"), "F00033");
    assert.strictEqual(submitted.get("gameid"), "123456789");
    assert.strictEqual(accepted.status, "PENDING", "Initial acceptance must remain non-terminal.");
    assert.strictEqual(mockCalls, 1);
    assert.strictEqual(normalizeWonddStatus({ transactionstatus: "process" }).status, "PENDING");
    assert.strictEqual(normalizeWonddStatus({ transactionstatus: "complete" }).status, "SUCCEEDED");
    assert.strictEqual(normalizeWonddStatus({ transactionstatus: "fail" }).status, "FAILED");

    await mongoose.connect(process.env.MONGO_URI);
    const [products, supplier, mappings] = await Promise.all([
        CatalogProduct.find({ productCode: { $in: ["freefire", "freefire-pass-membership"] } }).lean(),
        Supplier.findOne({ supplierCode: "WONDD", enabled: true, mode: "API" }).lean(),
        Mapping.find({ supplierCode: "WONDD", productCode: { $in: ["freefire", "freefire-pass-membership"] }, region: "TH" }).lean()
    ]);
    const product = products.find(item => item.productCode === "freefire");
    const passProduct = products.find(item => item.productCode === "freefire-pass-membership");
    assert(product?.enabled && product?.supportedRegions?.includes("TH"));
    assert(passProduct?.enabled && passProduct?.supportedRegions?.includes("TH"));
    assert.strictEqual(product.metadata?.wondd?.serviceId, "9602");
    assert.strictEqual(product.metadata?.wondd?.serviceCode, "freefire");
    assert.strictEqual(product.metadata?.wondd?.inputContract, "FREEFIRE_PLAYER_ID");
    assert.strictEqual(mappings.length, 19);
    assert.strictEqual(new Set(mappings.map(item => item.supplierPackageCode)).size, 19);
    assert.strictEqual(new Set(mappings.map(item => item.packageCode)).size, 19);
    const packages = await CatalogPackage.find({ $or: mappings.map(item => ({ productCode: item.productCode, packageCode: item.packageCode })), deletedAt: null }).lean();
    assert.strictEqual(packages.length, 19);
    const packageMap = new Map(packages.map(item => [item.packageCode, item]));
    for (const mapping of mappings) {
        assert.strictEqual(mapping.enabled, true);
        assert.strictEqual(mapping.supplierProductCode, "freefire");
        assert.strictEqual(mapping.executionMode, "API");
        for (const readinessKey of ["supplierMapped", "inputReady", "pricingReady", "storefrontReady", "fulfillmentReady", "enabled"]) {
            assert.strictEqual(mapping.mappingMetadata?.readiness?.[readinessKey], true, `${mapping.packageCode} missing ${readinessKey}`);
        }
        validateWonddMapping(mapping);
        const live = game.packages.find(item => item.packcode === mapping.supplierPackageCode);
        assert(live, `Missing live packcode ${mapping.supplierPackageCode}`);
        const pkg = packageMap.get(mapping.packageCode);
        assert(pkg?.enabled && pkg.prices?.TH?.enabled);
        assert.strictEqual(pkg.prices.TH.supplierCode, "WONDD");
        assert.strictEqual(Number(pkg.prices.TH.supplierCost), Number(live.netpricedealer));
        assert(Number(pkg.prices.TH.amount) > Number(pkg.prices.TH.supplierCost));
        assert.strictEqual(pkg.prices.TH.publishedPriceMode, "POLICY_DERIVED");
        assert(!/[\u0E00-\u0E7F]/.test(pkg.name), `${pkg.packageCode} exposes Thai supplier text`);
        const mappingProduct = mapping.productCode === "freefire-pass-membership" ? passProduct : product;
        const capability = resolveFulfillmentCapability({ product: mappingProduct, mappings: [mapping], suppliers: [supplier], productCode: mapping.productCode, packageCode: mapping.packageCode, region: "TH" });
        assert.strictEqual(capability.automatedAvailable, true);
        assert.strictEqual(capability.manualAdminAllowed, mapping.productionRole !== "PRIMARY");
    }
    const allPackages = await CatalogPackage.find({ productCode: "freefire", deletedAt: null }).lean();
    const unsupported = allPackages.filter(pkg => !mappings.some(mapping => mapping.packageCode === pkg.packageCode));
    for (const pkg of unsupported) {
        const capability = resolveFulfillmentCapability({ product, mappings, suppliers: [supplier], productCode: "freefire", packageCode: pkg.packageCode, region: "TH" });
        assert.strictEqual(capability.fulfillmentAvailable, false, `${pkg.packageCode} has no verified fulfillment route`);
    }
    const storefront = await getCatalogProductDetail("freefire", { source: "database", includeDisabled: false });
    const passStorefront = await getCatalogProductDetail("freefire-pass-membership", { source: "database", includeDisabled: false });
    assert.strictEqual(storefront.packages.length, 9);
    assert.strictEqual(passStorefront.packages.length, 10);
    assert([...storefront.packages, ...passStorefront.packages].every(pkg => mappings.some(mapping => mapping.packageCode === pkg.packageCode)));
    assert([...storefront.packages, ...passStorefront.packages].every(pkg => !/[\u0E00-\u0E7F]/.test(pkg.name)));
    const daily = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), productCode: "freefire", region: "TH" });
    const passDaily = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), productCode: "freefire-pass-membership", region: "TH" });
    assert.strictEqual(daily.rows.length, 9);
    assert.strictEqual(passDaily.rows.length, 10);
    assert(daily.rows.every(row => row.mappingRegion === "TH" && row.supplierProductCode === "freefire" && row.supplierPackageCode));
    assert.strictEqual(transportCalls, 0);
    const disabledMapping = { ...mappings[0], enabled: false };
    assert.throws(() => validateWonddMapping(disabledMapping), error => error.code === "WONDD_PACKAGE_MAPPING_MISSING");
    const checkoutHtml = fs.readFileSync(path.resolve(__dirname, "../../frontend/freefire.html"), "utf8");
    const checkoutJs = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/freefire.js"), "utf8");
    assert(checkoutHtml.includes('id="userId"'));
    assert(checkoutJs.includes('zoneIdSelector: ""'));
    assert(!checkoutJs.includes('zoneIdSelector: "#serverId"'));
    await mongoose.disconnect();
    console.log(JSON.stringify({ result: "PASS", mappings: mappings.length, diamondsMappings: mappings.filter(item => item.productCode === "freefire").length, passMappings: mappings.filter(item => item.productCode === "freefire-pass-membership").length, inputReady: 19, pricingReady: 19, storefrontReady: storefront.packages.length + passStorefront.packages.length, fulfillmentReady: 19, enabled: mappings.filter(item => item.enabled).length, dailyPricingRows: daily.rows.length + passDaily.rows.length, unsupportedRetained: unsupported.length, gate: "OFF", realTopupCalls: transportCalls, mockedAcceptanceCalls: mockCalls }, null, 2));
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error("WonDD Free Fire rollout verifier failed:", error.message); process.exitCode = 1; });
