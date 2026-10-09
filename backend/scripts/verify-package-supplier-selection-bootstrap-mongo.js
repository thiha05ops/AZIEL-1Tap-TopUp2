"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const SupplierCatalogProduct = require("../models/SupplierCatalogProduct");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const AdminAuditLog = require("../models/AdminAuditLog");
const { createPackageSupplierSelectionBootstrapService } = require("../services/packageSupplierSelectionBootstrapService");
const { writeAdminAudit } = require("../services/adminAuditService");

const EXPECTED_DATABASE = "aziel_supplier_bootstrap_verify";
const preflightOnly = process.argv.includes("--preflight");
const sha = value => crypto.createHash("sha256").update(String(value)).digest("hex");

function guardRuntime({ mutating = false } = {}) {
    assert(process.env.MONGODB_URI, "MONGODB_URI is required.");
    assert(process.env.NODE_ENV !== "production", "NODE_ENV=production is forbidden.");
    assert(!process.env.RENDER && !process.env.RENDER_SERVICE_ID, "Hosted Render execution is forbidden.");
    if (mutating) assert.strictEqual(process.env.AZIEL_ALLOW_MUTATING_VERIFIER, "true", "AZIEL_ALLOW_MUTATING_VERIFIER=true is required.");
}

function guardDatabase() {
    const resolved = String(mongoose.connection.name || "");
    assert.notStrictEqual(resolved, "azielshop", "Production database azielshop is forbidden.");
    assert.strictEqual(resolved, EXPECTED_DATABASE, `Resolved database must be exactly ${EXPECTED_DATABASE}.`);
    return resolved;
}

async function transactionPreflight() {
    const session = await mongoose.startSession();
    try {
        let active = false;
        await session.withTransaction(async () => {
            active = session.inTransaction();
            await CatalogProduct.findOne({ productCode: "__supplier_bootstrap_preflight__" }).session(session).lean();
        });
        assert(active, "MongoDB transaction did not become active.");
    } finally { await session.endSession(); }
}

async function preflight() {
    guardRuntime();
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log(`Resolved database: ${guardDatabase()}`);
    await transactionPreflight();
    console.log("Transaction capability: PASS");
    console.log("Application fixture writes: 0");
    console.log("Supplier selection bootstrap Mongo preflight: PASS");
}

async function verifyMongo() {
    guardRuntime({ mutating: true });
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    guardDatabase();
    await transactionPreflight();
    const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    const productCode = `ssb-${suffix}`;
    const supplierCode = `SSB_${suffix.toUpperCase()}`.slice(0, 40);
    const auditIds = ["TH", "MM"].map(market => `${productCode}:${market}`);
    let supplierId = null, supplierProductId = null, offerId = null;
    let providerCalls = 0;
    const localAdapter = { isConfigured: () => true, isAutoFulfillmentEnabled: () => true, createOrder: async () => { providerCalls += 1; throw new Error("Provider transport forbidden."); } };
    const cleanup = async () => {
        await AdminAuditLog.deleteMany({ resourceId: { $in: auditIds } });
        await PackageSupplierSelection.deleteMany({ productCode });
        await PackageMarketPublication.deleteMany({ productCode });
        await StoreCatalogSelection.deleteMany({ productCode });
        await SupplierProductMapping.deleteMany({ productCode });
        if (offerId) { await SupplierOfferAvailability.deleteMany({ supplierCatalogOfferId: offerId }); await SupplierCatalogOffer.deleteOne({ _id: offerId }); }
        if (supplierProductId) await SupplierCatalogProduct.deleteOne({ _id: supplierProductId });
        await CatalogPackage.deleteMany({ productCode });
        await CatalogProduct.deleteOne({ productCode });
        if (supplierId) await Supplier.deleteOne({ _id: supplierId });
        const remaining = await Promise.all([PackageSupplierSelection.countDocuments({ productCode }), PackageMarketPublication.countDocuments({ productCode }), StoreCatalogSelection.countDocuments({ productCode }), SupplierProductMapping.countDocuments({ productCode }), CatalogPackage.countDocuments({ productCode }), CatalogProduct.countDocuments({ productCode }), AdminAuditLog.countDocuments({ resourceId: { $in: auditIds } })]);
        assert(remaining.every(count => count === 0), "Run-scoped cleanup left fixture documents.");
    };
    try {
        const observedAt = new Date();
        const supplier = await Supplier.create({ supplierCode, name: `Supplier Bootstrap ${suffix}`, mode: "API", enabled: true, supportedRegions: ["TH", "MM"], configurationStatus: "CONFIGURED" });
        supplierId = supplier._id;
        const supplierProduct = await SupplierCatalogProduct.create({ supplierId, catalogNamespace: supplierCode, supplierProductCode: productCode, supplierMarketCode: "GLOBAL", displayName: productCode, supportState: "SUPPORTED", firstSeenAt: observedAt, lastSeenAt: observedAt, lastObservedAt: observedAt, lastChangedAt: observedAt, sourceRevision: suffix, rawSnapshotHash: sha(`${suffix}:product`), rawSnapshot: { verifier: suffix } });
        supplierProductId = supplierProduct._id;
        const offer = await SupplierCatalogOffer.create({ supplierCatalogProductId: supplierProductId, supplierId, catalogNamespace: supplierCode, supplierProductCode: productCode, supplierOfferCode: `${suffix}-offer`, supplierOfferName: "Ready Package", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH", firstSeenAt: observedAt, lastSeenAt: observedAt, lastObservedAt: observedAt, lastChangedAt: observedAt, sourceRevision: suffix, rawSnapshotHash: sha(`${suffix}:offer`), rawSnapshot: { verifier: suffix } });
        offerId = offer._id;
        await SupplierOfferAvailability.create({ supplierCatalogOfferId: offerId, state: "AVAILABLE", evidenceCode: "VERIFIER", observedAt, staleAt: new Date(observedAt.getTime() + 3600000), lastAvailableAt: observedAt, consecutiveMissingCount: 0, coverageComplete: true });
        await CatalogProduct.create({ productCode, name: productCode, enabled: true, supportedRegions: ["TH", "MM"], source: "admin" });
        await CatalogPackage.create({ productCode, packageCode: "READY", name: "Ready", enabled: true, source: "admin", prices: { TH: { amount: 10, currency: "THB", enabled: true }, MM: { amount: 100, currency: "MMK", enabled: true } } });
        const mapping = await SupplierProductMapping.create({ supplierId, supplierCode, productCode, packageCode: "READY", supplierProductCode: productCode, supplierPackageCode: offer.supplierOfferCode, supplierCatalogOfferId: offerId, region: "GLOBAL", supplierMarketEvidence: { normalizedMarket: "GLOBAL", supplierMarketCode: "GLOBAL", marketClassification: "VERIFIED_GLOBAL", evidenceCode: "VERIFIER", sourceProductHash: sha(`${suffix}:market`) }, enabled: true, productionRole: "DISABLED", executionMode: "API", fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "isolated verifier", verifiedAt: observedAt, version: 1 }, mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true } } });
        await StoreCatalogSelection.create({ productCode, supplierId, supplierCode, supplierMarket: "GLOBAL", sellingRegions: ["TH", "MM"], visibleRegions: ["TH", "MM"], packages: [{ packageCode: "READY", supplierProductMappingId: mapping._id }], status: "ACTIVE", selectedBy: "verifier" });
        const service = createPackageSupplierSelectionBootstrapService({}, { getSupplierAdapter: () => localAdapter });

        const happyPlan = await service.plan({ productCode, markets: ["TH"] });
        const happy = await service.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: happyPlan.markets.TH.marketPlanToken } }, { actor: { username: "verifier", role: "OWNER" } });
        assert.strictEqual(happy.markets.TH.created, 1);
        assert(await PackageSupplierSelection.findOne({ productCode, packageCode: "READY", customerMarket: "TH", supplierMappingId: mapping._id }));
        assert(await AdminAuditLog.findOne({ resourceId: `${productCode}:TH` }));
        const replayPlan = await service.plan({ productCode, markets: ["TH"] });
        const replay = await service.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: replayPlan.markets.TH.marketPlanToken } }, { actor: { username: "verifier" } });
        assert.strictEqual(replay.markets.TH.created, 0);
        console.log("Actual creation, audit commit, and idempotent replay: PASS");

        const stalePlan = await service.plan({ productCode, markets: ["MM"] });
        await SupplierOfferAvailability.updateOne({ supplierCatalogOfferId: offerId }, { $set: { state: "UNAVAILABLE", observedAt: new Date() } });
        const stale = await service.apply({ productCode, markets: ["MM"], marketPlanTokens: { MM: stalePlan.markets.MM.marketPlanToken } }, { actor: { username: "verifier" } });
        assert.strictEqual(stale.markets.MM.status, "CONFLICT");
        assert.strictEqual(await PackageSupplierSelection.countDocuments({ productCode, customerMarket: "MM" }), 0);
        await SupplierOfferAvailability.updateOne({ supplierCatalogOfferId: offerId }, { $set: { state: "AVAILABLE", observedAt } });
        console.log("Stale plan zero-write: PASS");

        await PackageSupplierSelection.deleteMany({ productCode });
        await AdminAuditLog.deleteMany({ resourceId: { $in: auditIds } });
        const rollbackService = createPackageSupplierSelectionBootstrapService({}, { getSupplierAdapter: () => localAdapter, writeAdminAudit: async () => { throw new Error("injected audit failure"); } });
        const rollbackPlan = await rollbackService.plan({ productCode, markets: ["TH"] });
        const rollback = await rollbackService.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: rollbackPlan.markets.TH.marketPlanToken } }, { actor: { username: "verifier" } });
        assert.strictEqual(rollback.markets.TH.status, "FAILED");
        assert.strictEqual(await PackageSupplierSelection.countDocuments({ productCode }), 0);
        console.log("Actual audit rollback: PASS");

        const independentService = createPackageSupplierSelectionBootstrapService({}, { getSupplierAdapter: () => localAdapter, writeAdminAudit: async input => { if (input.metadata.customerMarket === "TH") throw new Error("injected TH failure"); return writeAdminAudit(input); } });
        const independentPlan = await independentService.plan({ productCode, markets: ["TH", "MM"] });
        const independent = await independentService.apply({ productCode, markets: ["TH", "MM"], marketPlanTokens: { TH: independentPlan.markets.TH.marketPlanToken, MM: independentPlan.markets.MM.marketPlanToken } }, { actor: { username: "verifier" } });
        assert.strictEqual(independent.markets.TH.status, "FAILED");
        assert.strictEqual(independent.markets.MM.status, "APPLIED");
        assert.strictEqual(await PackageSupplierSelection.countDocuments({ productCode, customerMarket: "TH" }), 0);
        assert.strictEqual(await PackageSupplierSelection.countDocuments({ productCode, customerMarket: "MM" }), 1);
        assert.strictEqual(await PackageMarketPublication.countDocuments({ productCode }), 0);
        assert.strictEqual(providerCalls, 0);
        console.log("TH/MM independence, no publication write, zero provider calls: PASS");
    } finally {
        await cleanup();
        console.log("Run-scoped cleanup: PASS");
    }
    console.log("Supplier selection bootstrap real Mongo verifier: PASS");
}

(async () => {
    try { if (preflightOnly) await preflight(); else await verifyMongo(); }
    catch (error) { console.error(`Supplier selection bootstrap Mongo verifier: FAIL (${error.message})`); process.exitCode = 1; }
    finally { if (mongoose.connection.readyState !== 0) await mongoose.disconnect(); }
})();
