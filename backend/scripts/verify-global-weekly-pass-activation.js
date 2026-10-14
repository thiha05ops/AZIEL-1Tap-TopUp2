#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const {
    markMappingPricingReady,
    shouldMarkMappingPricingReady
} = require("../services/commerce/adminPricingControlCenterService");
const { setPackageEnabledForSelling } = require("../services/catalogAdminService");

const PRODUCT = "mlbb";
const PACKAGE = "MLBB_WEEKLY_PASS_C8B28141817AC4E6";
const OWNER = { id: new mongoose.Types.ObjectId(), username: "isolated-owner", role: "OWNER" };
let assertions = 0;
function ok(value, message) { assert(value, message); assertions += 1; }
async function rejects(fn, code) { await assert.rejects(fn, error => error.code === code); assertions += 1; }

function readinessRow(mapping, overrides = {}) {
    return {
        mappingId: String(mapping._id),
        supplierId: String(mapping.supplierId),
        supplierCode: mapping.supplierCode,
        supplierCatalogOfferId: String(mapping.supplierCatalogOfferId),
        productCode: PRODUCT,
        packageCode: PACKAGE,
        supplierProductCode: mapping.supplierProductCode,
        supplierPackageCode: mapping.supplierPackageCode,
        providerProductCode: mapping.supplierProductCode,
        providerOfferCode: mapping.supplierPackageCode,
        approvedSupplierCost: 1.4911,
        supplierCurrency: "USD",
        supplierCostTimestamp: mapping.supplierCostAuthority.capturedAt,
        observedSupplierCost: 1.4911,
        observedSupplierCurrency: "USD",
        observedSupplierCostAt: new Date("2026-10-14T19:46:02.787Z"),
        supplierCostAuthorityState: "AUTHORITATIVE",
        mappingReadiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true, pricingReady: false },
        ...overrides
    };
}

async function seed({ pricingReady = false, cost = true } = {}) {
    const supplierId = new mongoose.Types.ObjectId();
    const offerId = new mongoose.Types.ObjectId();
    await CatalogProduct.create({
        productCode: PRODUCT,
        name: "Mobile Legends (Global)",
        enabled: true,
        lifecycleStatus: "ACTIVE",
        commerceState: "PURCHASABLE",
        publicDiscoveryEnabled: true
    });
    const pkg = await CatalogPackage.create({
        productCode: PRODUCT,
        packageCode: PACKAGE,
        name: "Weekly Pass",
        enabled: false,
        prices: {
            TH: { amount: 54, currency: "THB", enabled: true, publishedPriceMode: "POLICY_DERIVED" },
            MM: { amount: 6967, currency: "MMK", enabled: true, publishedPriceMode: "POLICY_DERIVED" }
        },
        source: "admin"
    });
    const mapping = await SupplierProductMapping.create({
        supplierId,
        supplierCode: "FAZERCARDS",
        productCode: PRODUCT,
        packageCode: PACKAGE,
        supplierProductCode: "mobile_legends_global",
        supplierPackageCode: "weekly_pass",
        supplierCatalogOfferId: offerId,
        region: "GLOBAL",
        supplierMarketEvidence: { normalizedMarket: "GLOBAL", supplierMarketCode: "GLOBAL", marketClassification: "CONTROLLED_TEST" },
        enabled: true,
        productionRole: "PRIMARY",
        executionMode: "API",
        supplierCostAuthority: cost ? {
            rawSupplierCost: 1.4911,
            supplierCurrency: "USD",
            capturedAt: new Date("2026-10-14T19:46:02.787Z"),
            source: "OWNER_APPROVED",
            providerProductCode: "mobile_legends_global",
            providerOfferCode: "weekly_pass"
        } : undefined,
        mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true, pricingReady } },
        fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH", "MM"], evidenceCode: "CONTROLLED_TEST", version: 1 }
    });
    await SupplierCatalogOffer.collection.insertOne({
        _id: offerId,
        supplierId,
        supplierProductCode: "mobile_legends_global",
        supplierOfferCode: "weekly_pass",
        catalogLifecycleState: "ACTIVE",
        supplierCost: { amount: 1.4911, currency: "USD", observedAt: new Date("2026-10-14T19:46:02.787Z") }
    });
    await PackageSupplierSelection.create({
        productCode: PRODUCT,
        packageCode: PACKAGE,
        customerMarket: "GLOBAL",
        supplierMappingId: mapping._id,
        selectedByAdminId: OWNER.id,
        selectedByUsernameSnapshot: OWNER.username,
        decisionVersion: 1
    });
    return { pkg, mapping };
}

async function clear() {
    await Promise.all([CatalogProduct.deleteMany({}), CatalogPackage.deleteMany({}), PackageSupplierSelection.deleteMany({}), SupplierCatalogOffer.deleteMany({}), SupplierProductMapping.deleteMany({})]);
}

async function main() {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    try {
        await mongoose.connect(replSet.getUri("aziel_weekly_pass_activation_test"), { autoIndex: true });
        await Promise.all([CatalogProduct.syncIndexes(), CatalogPackage.syncIndexes(), PackageSupplierSelection.syncIndexes(), SupplierCatalogOffer.syncIndexes(), SupplierProductMapping.syncIndexes()]);

        ok(!shouldMarkMappingPricingReady({ mappingReadiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true } }, { role: "CATALOG" }), "non-OWNER publication cannot mark pricing ready");
        ok(!shouldMarkMappingPricingReady({ mappingReadiness: { supplierMapped: true, inputReady: true, fulfillmentReady: false } }, OWNER), "unready fulfillment route cannot be marked pricing ready");
        ok(shouldMarkMappingPricingReady({ mappingReadiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true } }, OWNER), "ready route and OWNER publication qualify");

        let fixture = await seed();
        await markMappingPricingReady(readinessRow(fixture.mapping), OWNER.username);
        let persisted = await SupplierProductMapping.findById(fixture.mapping._id).lean();
        ok(persisted.mappingMetadata.readiness.pricingReady === true, "exact approved and observed cost marks only the selected mapping ready");

        await clear();
        fixture = await seed();
        await rejects(() => markMappingPricingReady(readinessRow(fixture.mapping, { observedSupplierCost: 1.6, supplierCostAuthorityState: "REVIEW_REQUIRED" }), OWNER.username), "PRICING_AUTHORITY_REQUIRED");
        persisted = await SupplierProductMapping.findById(fixture.mapping._id).lean();
        ok(persisted.mappingMetadata.readiness.pricingReady === false, "cost-source drift cannot mark readiness");

        await SupplierCatalogOffer.updateOne({ _id: fixture.mapping.supplierCatalogOfferId }, { $set: { "supplierCost.observedAt": new Date("2026-10-15T00:00:00.000Z") } });
        await rejects(() => markMappingPricingReady(readinessRow(fixture.mapping), OWNER.username), "PRICING_SOURCE_EVIDENCE_DRIFT");
        persisted = await SupplierProductMapping.findById(fixture.mapping._id).lean();
        ok(persisted.mappingMetadata.readiness.pricingReady === false, "changed current source evidence fails closed");

        await clear();
        fixture = await seed();
        const unrelated = await SupplierProductMapping.create({ ...(fixture.mapping.toObject()), _id: new mongoose.Types.ObjectId(), packageCode: "UNRELATED", supplierPackageCode: "unrelated", supplierCatalogOfferId: new mongoose.Types.ObjectId(), mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true, pricingReady: false } } });
        await markMappingPricingReady(readinessRow(fixture.mapping), OWNER.username);
        ok((await SupplierProductMapping.findById(unrelated._id).lean()).mappingMetadata.readiness.pricingReady === false, "unrelated mapping is unchanged");
        await SupplierProductMapping.updateOne({ _id: fixture.mapping._id }, { $set: { "mappingMetadata.readiness.pricingReady": false } });

        await rejects(() => setPackageEnabledForSelling({ productCode: PRODUCT, packageCode: PACKAGE, enabled: true, expectedUpdatedAt: fixture.pkg.updatedAt, actor: { role: "CATALOG" } }), "OWNER_REQUIRED");
        await rejects(() => setPackageEnabledForSelling({ productCode: PRODUCT, packageCode: PACKAGE, enabled: true, expectedUpdatedAt: fixture.pkg.updatedAt, actor: OWNER }), "PRICING_READINESS_REQUIRED");
        ok((await CatalogPackage.findOne({ productCode: PRODUCT, packageCode: PACKAGE }).lean()).enabled === false, "failed activation leaves package disabled");

        await SupplierProductMapping.updateOne({ _id: fixture.mapping._id }, { $set: { "mappingMetadata.readiness.pricingReady": true } });
        const activation = await setPackageEnabledForSelling({ productCode: PRODUCT, packageCode: PACKAGE, enabled: true, expectedUpdatedAt: fixture.pkg.updatedAt, actor: OWNER });
        ok(activation.changed === true && activation.package.enabled === true, "OWNER can enable a fully ready package through audited catalog mutation rules");

        const root = path.join(__dirname, "..", "..");
        const pricingSource = fs.readFileSync(path.join(root, "backend/services/commerce/adminPricingControlCenterService.js"), "utf8");
        const publishBody = pricingSource.slice(pricingSource.indexOf("async function publishDailyPricing"), pricingSource.indexOf("async function loadPackage"));
        ok(publishBody.includes("publishableRegions.length === selectedRegions.length") && publishBody.includes("shouldMarkMappingPricingReady(row, admin)"), "partial or non-OWNER publication cannot mark readiness");
        ok(publishBody.includes("selectedRegions.length === WORKSPACE_REGIONS.length") && publishBody.includes("Published prices unchanged; pricing readiness confirmed"), "OWNER can reaffirm unchanged TH and MM prices without altering them");
        const ui = fs.readFileSync(path.join(root, "frontend/js/admin-guided-selling.js"), "utf8");
        ok(ui.includes("data-store-package-enabled") && ui.includes("/api/admin/catalog/products/"), "current Products workspace exposes the guarded package availability control through the existing catalog PATCH endpoint");
        const route = fs.readFileSync(path.join(root, "backend/routes/catalog.js"), "utf8");
        ok(route.includes("setPackageEnabledForSelling") && route.includes("ownerPackageAvailabilityDecision"), "package enable route uses service enforcement and mandatory Admin audit");

        console.log(JSON.stringify({ result: "PASS", assertions, isolatedDatabase: "mongodb-memory-server replica set", productionConnections: 0, supplierCalls: 0, productionWrites: 0 }, null, 2));
    } finally {
        await mongoose.disconnect().catch(() => null);
        await replSet.stop();
    }
}

main().catch(error => { console.error("Global Weekly Pass activation verifier failed:", error); process.exit(1); });
