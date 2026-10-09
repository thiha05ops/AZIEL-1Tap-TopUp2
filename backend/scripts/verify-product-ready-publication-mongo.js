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
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const AdminAuditLog = require("../models/AdminAuditLog");
const { createProductReadyPublicationService } = require("../services/productReadyPublicationService");
const { publishPackageMarketBatch } = require("../services/packageMarketPublicationService");
const { writeAdminAudit } = require("../services/adminAuditService");

const EXPECTED_DATABASE = "aziel_pub_ready_verify";
const PRE_FLIGHT = process.argv.includes("--preflight");
const MUTATION_FLAG = "AZIEL_ALLOW_MUTATING_VERIFIER";
const now = () => new Date();
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const plain = value => JSON.parse(JSON.stringify(value));
const adapter = providerCalls => ({
    isConfigured: () => true,
    isAutoFulfillmentEnabled: () => true,
    createOrder: async () => { providerCalls.count += 1; throw new Error("Provider transport is forbidden in this verifier."); },
    checkOrder: async () => { providerCalls.count += 1; throw new Error("Provider transport is forbidden in this verifier."); }
});

function assertSafeRuntime() {
    assert(process.env.MONGODB_URI, "MONGODB_URI is required.");
    assert(process.env.NODE_ENV !== "production", "Refusing to run from NODE_ENV=production.");
    assert(!process.env.RENDER && !process.env.RENDER_SERVICE_ID, "Refusing to run from a Render service.");
}

function assertExactDatabase() {
    const resolved = String(mongoose.connection.name || "");
    assert.notStrictEqual(resolved, "azielshop", "Production database azielshop is forbidden.");
    assert.strictEqual(resolved, EXPECTED_DATABASE, `Resolved database must be exactly ${EXPECTED_DATABASE}.`);
    return resolved;
}

async function verifyTransactionCapability() {
    const session = await mongoose.startSession();
    try {
        let enteredTransaction = false;
        await session.withTransaction(async () => {
            enteredTransaction = session.inTransaction();
            await CatalogProduct.findOne({ productCode: "__product_ready_preflight_missing__" }).session(session).lean();
        });
        assert.strictEqual(enteredTransaction, true, "Mongo session did not enter a transaction.");
    } finally {
        await session.endSession();
    }
}

async function preflight() {
    assertSafeRuntime();
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const resolved = assertExactDatabase();
    await verifyTransactionCapability();
    console.log(`Resolved database: ${resolved}`);
    console.log("Transaction capability: PASS");
    console.log("Application fixture writes: 0");
    console.log("Product Ready Publication Mongo preflight: PASS");
}

async function snapshotAuthority(productCode) {
    const [product, packages, selections, mappings, stores] = await Promise.all([
        CatalogProduct.findOne({ productCode }).lean(),
        CatalogPackage.find({ productCode }).sort({ packageCode: 1 }).lean(),
        PackageSupplierSelection.find({ productCode }).sort({ customerMarket: 1, packageCode: 1 }).lean(),
        SupplierProductMapping.find({ productCode }).sort({ packageCode: 1 }).lean(),
        StoreCatalogSelection.find({ productCode }).sort({ supplierMarket: 1 }).lean()
    ]);
    return plain({ product, packages, selections, mappings, stores });
}

async function runMutatingVerifier() {
    assertSafeRuntime();
    assert.strictEqual(process.env[MUTATION_FLAG], "true", `${MUTATION_FLAG}=true is required.`);
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    assertExactDatabase();
    await verifyTransactionCapability();

    const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    const productCode = `prp-${suffix}`;
    const supplierCode = `PRP_${suffix.toUpperCase()}`.slice(0, 40);
    const namespace = `PRP_${suffix.toUpperCase()}`.slice(0, 80);
    const readyCodes = ["HAPPY", "STALE", "OPTIMISTIC", "ROLLBACK", "INDEPENDENT"];
    const allCodes = [...readyCodes, "BLOCKED"];
    const auditResourceIds = ["TH", "MM"].map(market => `${productCode}:${market}`);
    const providerCalls = { count: 0 };
    let supplierId = null;
    let catalogProductId = null;
    let offerIds = [];
    let authorityBefore = null;
    let completed = false;

    const cleanup = async () => {
        if (mongoose.connection.readyState !== 1) return;
        await AdminAuditLog.deleteMany({ resourceId: { $in: auditResourceIds } });
        await PackageMarketPublication.deleteMany({ productCode });
        await PackageSupplierSelection.deleteMany({ productCode });
        await StoreCatalogSelection.deleteMany({ productCode });
        await SupplierProductMapping.deleteMany({ productCode });
        if (offerIds.length) {
            await SupplierOfferAvailability.deleteMany({ supplierCatalogOfferId: { $in: offerIds } });
            await SupplierCatalogOffer.deleteMany({ _id: { $in: offerIds } });
        }
        if (catalogProductId) await SupplierCatalogProduct.deleteOne({ _id: catalogProductId });
        await CatalogPackage.deleteMany({ productCode });
        await CatalogProduct.deleteOne({ productCode });
        if (supplierId) await Supplier.deleteOne({ _id: supplierId });
        const remaining = await Promise.all([
            AdminAuditLog.countDocuments({ resourceId: { $in: auditResourceIds } }),
            PackageMarketPublication.countDocuments({ productCode }),
            PackageSupplierSelection.countDocuments({ productCode }),
            StoreCatalogSelection.countDocuments({ productCode }),
            SupplierProductMapping.countDocuments({ productCode }),
            CatalogPackage.countDocuments({ productCode }),
            CatalogProduct.countDocuments({ productCode })
        ]);
        if (offerIds.length) {
            remaining.push(await SupplierOfferAvailability.countDocuments({ supplierCatalogOfferId: { $in: offerIds } }));
            remaining.push(await SupplierCatalogOffer.countDocuments({ _id: { $in: offerIds } }));
        }
        if (catalogProductId) remaining.push(await SupplierCatalogProduct.countDocuments({ _id: catalogProductId }));
        if (supplierId) remaining.push(await Supplier.countDocuments({ _id: supplierId }));
        assert(remaining.every(count => count === 0), `Run-scoped cleanup left ${remaining.reduce((sum, count) => sum + count, 0)} document(s).`);
    };

    try {
        const observedAt = now();
        const staleAt = new Date(observedAt.getTime() + 60 * 60 * 1000);
        const supplier = await Supplier.create({
            supplierCode,
            name: `Product Ready Verifier ${suffix}`,
            mode: "API",
            enabled: true,
            supportedRegions: ["TH", "MM"],
            configurationStatus: "CONFIGURED"
        });
        supplierId = supplier._id;
        const catalogProduct = await SupplierCatalogProduct.create({
            supplierId,
            catalogNamespace: namespace,
            supplierProductCode: productCode,
            supplierMarketCode: "GLOBAL",
            displayName: `Product Ready Verifier ${suffix}`,
            supportState: "SUPPORTED",
            firstSeenAt: observedAt,
            lastSeenAt: observedAt,
            lastObservedAt: observedAt,
            lastChangedAt: observedAt,
            sourceRevision: suffix,
            rawSnapshotHash: hash(`${suffix}:product`),
            rawSnapshot: { verifierRun: suffix }
        });
        catalogProductId = catalogProduct._id;
        await CatalogProduct.create({
            productCode,
            name: `Product Ready Verifier ${suffix}`,
            enabled: true,
            publicDiscoveryEnabled: true,
            commerceState: "PURCHASABLE",
            lifecycleStatus: "ACTIVE",
            supportedRegions: ["TH", "MM"],
            source: "admin"
        });
        await CatalogPackage.insertMany(allCodes.map((packageCode, index) => ({
            productCode,
            packageCode,
            name: packageCode,
            enabled: packageCode !== "BLOCKED",
            deletedAt: null,
            sortOrder: index,
            source: "admin",
            prices: {
                TH: { amount: 100 + index, currency: "THB", enabled: true },
                MM: { amount: 1000 + index, currency: "MMK", enabled: true }
            }
        })));

        const offers = [];
        for (const packageCode of readyCodes) {
            offers.push(await SupplierCatalogOffer.create({
                supplierCatalogProductId: catalogProductId,
                supplierId,
                catalogNamespace: namespace,
                supplierProductCode: productCode,
                supplierOfferCode: `${suffix}-${packageCode}`,
                supplierOfferName: packageCode,
                catalogLifecycleState: "ACTIVE",
                reconciliationState: "EXACT_CANONICAL_MATCH",
                firstSeenAt: observedAt,
                lastSeenAt: observedAt,
                lastObservedAt: observedAt,
                lastChangedAt: observedAt,
                sourceRevision: suffix,
                rawSnapshotHash: hash(`${suffix}:${packageCode}`),
                rawSnapshot: { verifierRun: suffix, packageCode }
            }));
        }
        offerIds = offers.map(item => item._id);
        await SupplierOfferAvailability.insertMany(offers.map(offer => ({
            supplierCatalogOfferId: offer._id,
            state: "AVAILABLE",
            evidenceCode: "VERIFIER_FIXTURE",
            observedAt,
            staleAt,
            lastAvailableAt: observedAt,
            consecutiveMissingCount: 0,
            coverageComplete: true,
            metadata: { verifierRun: suffix }
        })));
        const mappings = await SupplierProductMapping.insertMany(offers.map((offer, index) => ({
            supplierId,
            supplierCode,
            productCode,
            packageCode: readyCodes[index],
            supplierProductCode: productCode,
            supplierPackageCode: offer.supplierOfferCode,
            supplierCatalogOfferId: offer._id,
            supplierDisplayName: offer.supplierOfferName,
            region: "GLOBAL",
            supplierMarketEvidence: {
                normalizedMarket: "GLOBAL",
                supplierMarketCode: "GLOBAL",
                marketClassification: "VERIFIED_GLOBAL",
                evidenceCode: "VERIFIER_FIXTURE",
                sourceProductHash: hash(`${suffix}:market`)
            },
            enabled: true,
            productionRole: "DISABLED",
            executionMode: "API",
            mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true, pricingReady: true } },
            fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "isolated verifier", verifiedAt: observedAt, version: 1 }
        })));
        await PackageSupplierSelection.insertMany(["TH", "MM"].flatMap(customerMarket => mappings.map(mapping => ({
            productCode,
            packageCode: mapping.packageCode,
            customerMarket,
            supplierMappingId: mapping._id,
            selectedByUsernameSnapshot: "product-ready-verifier",
            selectedAt: observedAt,
            decisionVersion: 1,
            reason: "Isolated verifier fixture"
        }))));
        await StoreCatalogSelection.create({
            productCode,
            supplierId,
            supplierCode,
            supplierMarket: "GLOBAL",
            sellingRegions: ["TH", "MM"],
            visibleRegions: ["TH", "MM"],
            packages: mappings.map(mapping => ({ packageCode: mapping.packageCode, supplierProductMappingId: mapping._id })),
            status: "ACTIVE",
            selectedBy: "product-ready-verifier",
            provenance: { source: "ISOLATED_VERIFIER", sourceHash: hash(suffix), planHash: hash(`${suffix}:plan`), reversible: true }
        });

        authorityBefore = await snapshotAuthority(productCode);
        const service = createProductReadyPublicationService({}, {
            adapterFor: () => adapter(providerCalls),
            storeCatalogMode: () => "EXPLICIT"
        });
        const actor = { username: "product-ready-verifier", role: "OWNER" };

        const happyPlan = await service.plan({ productCode, markets: ["TH", "MM"] });
        assert(happyPlan.markets.TH.readyPackages.some(row => row.packageCode === "HAPPY"));
        assert(happyPlan.markets.TH.blockedPackages.some(row => row.packageCode === "BLOCKED"));
        const happy = await service.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: happyPlan.markets.TH.marketPlanToken } }, { actor });
        assert.strictEqual(happy.markets.TH.status, "APPLIED");
        assert.strictEqual((await PackageMarketPublication.findOne({ productCode, packageCode: "HAPPY", customerMarket: "TH" }).lean()).published, true);
        assert.strictEqual(await PackageMarketPublication.countDocuments({ productCode, customerMarket: "MM" }), 0);
        assert.strictEqual(await PackageMarketPublication.countDocuments({ productCode, packageCode: "BLOCKED" }), 0);
        assert.strictEqual(await AdminAuditLog.countDocuments({ resourceId: `${productCode}:TH` }), 1);
        console.log("Happy path, correct market, blocked no-write, publication+audit commit: PASS");

        await PackageMarketPublication.deleteMany({ productCode });
        await AdminAuditLog.deleteMany({ resourceId: { $in: auditResourceIds } });
        const stalePlan = await service.plan({ productCode, markets: ["TH"] });
        const staleOffer = offers[readyCodes.indexOf("STALE")];
        await SupplierOfferAvailability.updateOne({ supplierCatalogOfferId: staleOffer._id }, { $set: { state: "UNAVAILABLE", observedAt: now(), lastUnavailableAt: now() } });
        const stale = await service.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: stalePlan.markets.TH.marketPlanToken } }, { actor });
        assert.strictEqual(stale.markets.TH.status, "CONFLICT");
        assert.strictEqual(stale.markets.TH.conflictCode, "PUBLICATION_READY_PLAN_STALE");
        assert.strictEqual(await PackageMarketPublication.countDocuments({ productCode }), 0);
        await SupplierOfferAvailability.updateOne({ supplierCatalogOfferId: staleOffer._id }, { $set: { state: "AVAILABLE", observedAt, lastUnavailableAt: null } });
        console.log("Stale readiness token conflict with zero publication writes: PASS");

        await PackageMarketPublication.create({ productCode, packageCode: "OPTIMISTIC", customerMarket: "TH", published: false, decisionVersion: 1, decisionNote: "fixture" });
        await PackageMarketPublication.updateOne({ productCode, packageCode: "OPTIMISTIC", customerMarket: "TH" }, { $set: { decisionVersion: 2, decisionNote: "concurrent" } });
        const optimisticSession = await mongoose.startSession();
        let optimisticError = null;
        try {
            await optimisticSession.withTransaction(async () => publishPackageMarketBatch({
                productCode,
                customerMarket: "TH",
                packages: [{ packageCode: "OPTIMISTIC", expectedDecisionVersion: 1 }],
                actor: actor.username,
                decisionNote: "stale attempt",
                session: optimisticSession
            }));
        } catch (error) { optimisticError = error; }
        finally { await optimisticSession.endSession(); }
        assert.strictEqual(optimisticError?.code, "PUBLICATION_BATCH_STALE");
        const optimisticPublication = await PackageMarketPublication.findOne({ productCode, packageCode: "OPTIMISTIC", customerMarket: "TH" }).lean();
        assert.strictEqual(optimisticPublication.decisionVersion, 2);
        assert.strictEqual(optimisticPublication.published, false);
        await PackageMarketPublication.deleteMany({ productCode });
        console.log("Optimistic publication decisionVersion conflict: PASS");

        const rollbackService = createProductReadyPublicationService({}, {
            adapterFor: () => adapter(providerCalls),
            storeCatalogMode: () => "EXPLICIT",
            audit: async () => { throw Object.assign(new Error("Injected post-bulk audit failure"), { code: "INJECTED_AUDIT_FAILURE" }); }
        });
        const rollbackPlan = await rollbackService.plan({ productCode, markets: ["TH"] });
        const rollback = await rollbackService.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: rollbackPlan.markets.TH.marketPlanToken } }, { actor });
        assert.strictEqual(rollback.markets.TH.status, "FAILED");
        assert.strictEqual(rollback.markets.TH.conflictCode, "INJECTED_AUDIT_FAILURE");
        assert.strictEqual(await PackageMarketPublication.countDocuments({ productCode }), 0);
        console.log("Real rollback after post-bulk audit failure: PASS");

        const independentService = createProductReadyPublicationService({}, {
            adapterFor: () => adapter(providerCalls),
            storeCatalogMode: () => "EXPLICIT",
            audit: async input => {
                if (input.metadata?.customerMarket === "TH") throw Object.assign(new Error("Injected TH audit failure"), { code: "INJECTED_TH_FAILURE" });
                return writeAdminAudit(input);
            }
        });
        const independentPlan = await independentService.plan({ productCode, markets: ["TH", "MM"] });
        const independent = await independentService.apply({
            productCode,
            markets: ["TH", "MM"],
            marketPlanTokens: { TH: independentPlan.markets.TH.marketPlanToken, MM: independentPlan.markets.MM.marketPlanToken }
        }, { actor });
        assert.strictEqual(independent.markets.TH.status, "FAILED");
        assert.strictEqual(independent.markets.MM.status, "APPLIED");
        assert.strictEqual(await PackageMarketPublication.countDocuments({ productCode, customerMarket: "TH" }), 0);
        assert.strictEqual((await PackageMarketPublication.findOne({ productCode, packageCode: "INDEPENDENT", customerMarket: "MM" }).lean()).published, true);
        assert.strictEqual(await PackageMarketPublication.countDocuments({ productCode, packageCode: "BLOCKED" }), 0);
        assert.strictEqual(await AdminAuditLog.countDocuments({ resourceId: `${productCode}:TH` }), 0);
        assert.strictEqual(await AdminAuditLog.countDocuments({ resourceId: `${productCode}:MM` }), 1);
        console.log("Independent TH failure and MM transaction commit: PASS");

        const authorityAfter = await snapshotAuthority(productCode);
        assert.deepStrictEqual(authorityAfter, authorityBefore, "Publication flow mutated product, price, selection, mapping, or Store Catalog authority.");
        assert.strictEqual(providerCalls.count, 0, "A provider transport method was called.");
        console.log("No unrelated authority mutation and zero provider requests: PASS");
        completed = true;
    } finally {
        await cleanup();
        console.log("Run-scoped cleanup: PASS");
    }
    assert.strictEqual(completed, true);
    console.log("Product Ready Publication real Mongo verifier: PASS");
}

(async () => {
    try {
        if (PRE_FLIGHT) await preflight();
        else await runMutatingVerifier();
    } catch (error) {
        console.error(`Product Ready Publication Mongo verifier: FAIL (${error.message})`);
        process.exitCode = 1;
    } finally {
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    }
})();
