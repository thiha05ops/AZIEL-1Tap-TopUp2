#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { assertSafeMutatingVerifierDatabase } = require("./verifierDatabaseSafety");
const Supplier = require("../models/Supplier");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const PricingPolicy = require("../models/PricingPolicy");
const ExchangeRateAuthority = require("../models/ExchangeRateAuthority");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const { batchPreviewDailyPricing, publishDailyPricing } = require("../services/commerce/adminPricingControlCenterService");
const { toPublicCatalog, resolvePackagePrice } = require("../services/catalogService");

const ACTOR = { username: "daily-pricing-verifier", role: "OWNER" };
const PRODUCT_CODES = ["freefire", "mlbb", "pubg"];

function json(value) { return JSON.parse(JSON.stringify(value)); }
function key(productCode, packageCode) { return `${productCode}:${packageCode}`; }

async function seedPolicy(region, currency) {
    return PricingPolicy.create({
        name: `Verifier ${region}`,
        code: `VERIFY_${region}_${currency}`,
        status: "ACTIVE",
        region,
        currency,
        defaultProfitRule: { type: "PERCENT", value: 10 },
        defaultRoundingRule: { enabled: region === "MM", mode: region === "MM" ? "UP" : "NONE", increment: region === "MM" ? 100 : 0 },
        minimumProfitAmount: 0,
        minimumProfitMarginPercent: 0,
        createdBy: ACTOR.username,
        updatedBy: ACTOR.username
    });
}

async function seedPackage(productCode, packageCode, prices) {
    return CatalogPackage.create({
        productCode,
        packageCode,
        name: `${productCode} ${packageCode}`,
        enabled: false,
        prices,
        source: "admin",
        metadata: { verifier: true }
    });
}

async function seedMapping(supplier, productCode, packageCode, cost, sequence) {
    return SupplierProductMapping.create({
        supplierId: supplier._id,
        supplierCode: "WONDD",
        productCode,
        packageCode,
        supplierProductCode: `service-${productCode}`,
        supplierPackageCode: `pack-${sequence}`,
        region: "TH",
        supplierMarketEvidence: {
            normalizedMarket: "TH",
            supplierMarketCode: "TH",
            marketClassification: "SUPPLIER_METADATA",
            evidenceCode: "CONTROLLED_TEST"
        },
        enabled: false,
        productionRole: "DISABLED",
        executionMode: "MANUAL",
        supplierCostAuthority: {
            rawSupplierCost: cost,
            supplierCurrency: "THB",
            capturedAt: new Date(),
            source: "CONTROLLED_TEST",
            providerProductCode: `service-${productCode}`,
            providerOfferCode: `pack-${sequence}`
        },
        mappingMetadata: { verifier: true, readiness: { supplierMapped: true, fulfillmentReady: false, storefrontReady: false } },
        fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], version: 1 }
    });
}

async function rowFor(mapping) {
    const pkg = await CatalogPackage.findOne({ productCode: mapping.productCode, packageCode: mapping.packageCode }).lean();
    return {
        rowId: String(mapping._id),
        mappingId: String(mapping._id),
        productCode: mapping.productCode,
        packageCode: mapping.packageCode,
        supplierCurrency: "THB",
        expectedUpdatedAt: pkg.updatedAt,
        selected: true
    };
}

async function preview(rows, supplier) {
    return batchPreviewDailyPricing({ rows, supplierId: String(supplier._id), region: "ALL", actor: ACTOR });
}

async function publish(rows, supplier, region = "ALL") {
    return publishDailyPricing({ rows, supplierId: String(supplier._id), region, admin: ACTOR, actor: ACTOR.username, skipDraftCleanup: true });
}

async function values(productCode, packageCode) {
    return CatalogPackage.findOne({ productCode, packageCode }).lean();
}

async function main() {
    const safety = assertSafeMutatingVerifierDatabase("verify-daily-pricing-controlled-write");
    assert.strictEqual(safety.databaseName, "aziel_daily_pricing_verifier");
    await mongoose.connect(safety.mongoUri, { serverSelectionTimeoutMS: 15000 });
    assert.strictEqual(mongoose.connection.db.databaseName, "aziel_daily_pricing_verifier");
    await mongoose.connection.db.dropDatabase();

    const now = new Date();
    const supplier = await Supplier.create({
        supplierCode: "WONDD",
        name: "WonDD Disposable Verifier",
        mode: "MANUAL",
        enabled: true,
        supportedRegions: ["TH"],
        supplierCurrency: "THB",
        configurationStatus: "MANUAL_READY",
        metadata: { verifier: true }
    });
    await Promise.all([
        seedPolicy("TH", "THB"),
        seedPolicy("MM", "MMK"),
        ExchangeRateAuthority.create({
            code: "VERIFY_THB_MMK",
            fromCurrency: "THB",
            toCurrency: "MMK",
            rate: 130,
            source: "CONTROLLED_TEST",
            capturedAt: now,
            maximumAgeSeconds: 86400,
            status: "ACTIVE",
            authoritative: true,
            enabled: true,
            effectiveFrom: new Date(now.getTime() - 60000),
            createdBy: ACTOR.username,
            updatedBy: ACTOR.username
        }),
        ...PRODUCT_CODES.map((productCode, index) => CatalogProduct.create({
            productCode,
            name: `Verifier ${productCode}`,
            enabled: false,
            commerceState: "HIDDEN",
            publicDiscoveryEnabled: false,
            supportedRegions: [],
            sortOrder: index,
            source: "admin",
            metadata: { verifier: true }
        }))
    ]);

    const specs = [
        ["freefire", "VERIFY_FIRST", 100, undefined],
        ["freefire", "VERIFY_TH_ONLY", 110, { TH: { amount: 121, currency: "THB", enabled: true, publishedPriceMode: "POLICY_DERIVED", supplierCost: 110, supplierCurrency: "THB" } }],
        ["freefire", "VERIFY_MM_ONLY", 120, { MM: { amount: 17200, currency: "MMK", enabled: true, publishedPriceMode: "POLICY_DERIVED", supplierCost: 120, supplierCurrency: "THB" } }],
        ["freefire", "VERIFY_PACKAGE_A", 130, undefined],
        ["freefire", "VERIFY_PACKAGE_B", 140, undefined],
        ["freefire", "VERIFY_PRODUCT_A", 150, undefined],
        ["freefire", "VERIFY_PRODUCT_B", 160, undefined],
        ["mlbb", "VERIFY_SELECTION", 170, undefined],
        ["mlbb", "VERIFY_WORKSPACE", 180, undefined],
        ["pubg", "VERIFY_WORKSPACE", 190, undefined],
        ["pubg", "VERIFY_PARTIAL_VALID", 200, undefined],
        ["pubg", "VERIFY_STALE", 210, undefined],
        ["pubg", "VERIFY_EXISTING", 220, undefined]
    ];
    const mappings = new Map();
    for (let index = 0; index < specs.length; index += 1) {
        const [productCode, packageCode, cost, prices] = specs[index];
        await seedPackage(productCode, packageCode, prices);
        const mapping = await seedMapping(supplier, productCode, packageCode, cost, index + 1);
        mappings.set(key(productCode, packageCode), mapping.toObject());
    }

    const protectedBefore = {
        products: json(await CatalogProduct.find().sort({ productCode: 1 }).lean()),
        mappings: json(await SupplierProductMapping.find().sort({ productCode: 1, packageCode: 1 }).lean()),
        selections: json(await StoreCatalogSelection.find().lean()),
        publications: json(await PackageMarketPublication.find().lean())
    };

    const firstRow = await rowFor(mappings.get(key("freefire", "VERIFY_FIRST")));
    const firstPreview = await preview([firstRow], supplier);
    const firstPreviewRow = firstPreview.rows[0];
    assert.deepStrictEqual(firstPreviewRow.regions.map(item => item.region).sort(), ["MM", "TH"]);
    assert(firstPreviewRow.regions.every(item => item.priceState === "NEW" && item.currentPublishedPrice === null && item.existingAmount === null));
    const firstPublish = await publish([firstRow], supplier);
    assert.strictEqual(firstPublish.summary.published, 2);
    const firstSaved = await values("freefire", "VERIFY_FIRST");
    for (const region of ["TH", "MM"]) {
        const expected = firstPreviewRow.regions.find(item => item.region === region);
        assert.strictEqual(firstSaved.prices[region].currency, region === "TH" ? "THB" : "MMK");
        assert.strictEqual(firstSaved.prices[region].amount, expected.finalPreviewPrice);
    }
    assert.strictEqual(mappings.get(key("freefire", "VERIFY_FIRST")).region, "TH");

    const thOnlyBefore = await values("freefire", "VERIFY_TH_ONLY");
    const thOnlyRow = await rowFor(mappings.get(key("freefire", "VERIFY_TH_ONLY")));
    const thOnlyPublish = await publish([thOnlyRow], supplier, "MM");
    assert.strictEqual(thOnlyPublish.summary.published, 1);
    const thOnlyAfter = await values("freefire", "VERIFY_TH_ONLY");
    assert.deepStrictEqual(json(thOnlyAfter.prices.TH), json(thOnlyBefore.prices.TH));
    assert(thOnlyAfter.prices.MM);

    const mmOnlyBefore = await values("freefire", "VERIFY_MM_ONLY");
    const mmOnlyRow = await rowFor(mappings.get(key("freefire", "VERIFY_MM_ONLY")));
    const mmOnlyPublish = await publish([mmOnlyRow], supplier, "TH");
    assert.strictEqual(mmOnlyPublish.summary.published, 1);
    const mmOnlyAfter = await values("freefire", "VERIFY_MM_ONLY");
    assert.deepStrictEqual(json(mmOnlyAfter.prices.MM), json(mmOnlyBefore.prices.MM));
    assert(mmOnlyAfter.prices.TH);

    const packageARow = await rowFor(mappings.get(key("freefire", "VERIFY_PACKAGE_A")));
    const packageMode = await publish([packageARow], supplier);
    assert.strictEqual(packageMode.summary.published, 2);
    assert((await values("freefire", "VERIFY_PACKAGE_A")).prices.TH);
    assert.strictEqual((await values("freefire", "VERIFY_PACKAGE_B")).prices?.TH, undefined);

    const selectionRows = [
        await rowFor(mappings.get(key("freefire", "VERIFY_PACKAGE_B"))),
        await rowFor(mappings.get(key("mlbb", "VERIFY_SELECTION"))),
        { ...(await rowFor(mappings.get(key("freefire", "VERIFY_PRODUCT_A")))), selected: false }
    ];
    const selectionMode = await publish(selectionRows, supplier);
    assert.strictEqual(selectionMode.summary.published, 4);
    assert((await values("freefire", "VERIFY_PACKAGE_B")).prices.TH);
    assert((await values("mlbb", "VERIFY_SELECTION")).prices.TH);
    assert.strictEqual((await values("freefire", "VERIFY_PRODUCT_A")).prices?.TH, undefined);

    const productRows = [
        await rowFor(mappings.get(key("freefire", "VERIFY_PRODUCT_A"))),
        await rowFor(mappings.get(key("freefire", "VERIFY_PRODUCT_B")))
    ];
    const productMode = await publish(productRows, supplier);
    assert.strictEqual(productMode.summary.published, 4);
    assert((await values("freefire", "VERIFY_PRODUCT_A")).prices.MM);
    assert((await values("freefire", "VERIFY_PRODUCT_B")).prices.MM);
    assert.strictEqual((await values("mlbb", "VERIFY_WORKSPACE")).prices?.TH, undefined);

    const workspaceRows = [
        await rowFor(mappings.get(key("mlbb", "VERIFY_WORKSPACE"))),
        await rowFor(mappings.get(key("pubg", "VERIFY_WORKSPACE")))
    ];
    const workspaceMode = await publish(workspaceRows, supplier);
    assert.strictEqual(workspaceMode.summary.published, 4);
    assert((await values("mlbb", "VERIFY_WORKSPACE")).prices.TH);
    assert((await values("pubg", "VERIFY_WORKSPACE")).prices.MM);

    const validPartialRow = await rowFor(mappings.get(key("pubg", "VERIFY_PARTIAL_VALID")));
    const invalidRow = { ...validPartialRow, rowId: "invalid", mappingId: new mongoose.Types.ObjectId().toString(), packageCode: "VERIFY_INVALID" };
    const partialPreview = await preview([validPartialRow, invalidRow], supplier);
    assert(partialPreview.rows.some(item => item.status === "Blocked"));
    const partialFailure = await publish([validPartialRow, invalidRow], supplier);
    assert.strictEqual(partialFailure.summary.published, 2);
    assert((await values("pubg", "VERIFY_PARTIAL_VALID")).prices.TH);

    const staleRow = await rowFor(mappings.get(key("pubg", "VERIFY_STALE")));
    const stalePreview = await preview([staleRow], supplier);
    assert(stalePreview.rows[0].publishEligible);
    await CatalogPackage.updateOne({ productCode: "pubg", packageCode: "VERIFY_STALE" }, { $set: { pricingNote: "revision changed" }, $currentDate: { updatedAt: true } });
    const stalePublish = await publish([staleRow], supplier);
    assert.strictEqual(stalePublish.summary.failed, 2);
    assert(stalePublish.results.every(item => item.code === "CATALOG_CONFLICT"));

    const idempotentRow = await rowFor(mappings.get(key("freefire", "VERIFY_FIRST")));
    const beforeIdempotent = json(await values("freefire", "VERIFY_FIRST"));
    const idempotent = await publish([idempotentRow], supplier);
    assert.strictEqual(idempotent.summary.published, 0);
    assert(idempotent.results.every(item => item.reason === "No changes"));
    const afterIdempotent = json(await values("freefire", "VERIFY_FIRST"));
    assert.deepStrictEqual(afterIdempotent, beforeIdempotent);

    const existingRow = await rowFor(mappings.get(key("pubg", "VERIFY_EXISTING")));
    const existingInitial = await publish([existingRow], supplier);
    assert.strictEqual(existingInitial.summary.published, 2);
    const existingCurrentRow = await rowFor(mappings.get(key("pubg", "VERIFY_EXISTING")));
    const existingBefore = json(await values("pubg", "VERIFY_EXISTING"));
    const existingRepeat = await publish([existingCurrentRow], supplier);
    assert.strictEqual(existingRepeat.summary.published, 0);
    assert.deepStrictEqual(json(await values("pubg", "VERIFY_EXISTING")), existingBefore);

    const protectedAfter = {
        products: json(await CatalogProduct.find().sort({ productCode: 1 }).lean()),
        mappings: json(await SupplierProductMapping.find().sort({ productCode: 1, packageCode: 1 }).lean()),
        selections: json(await StoreCatalogSelection.find().lean()),
        publications: json(await PackageMarketPublication.find().lean())
    };
    assert.deepStrictEqual(protectedAfter.products, protectedBefore.products);
    assert.deepStrictEqual(protectedAfter.mappings, protectedBefore.mappings);
    assert.deepStrictEqual(protectedAfter.selections, []);
    assert.deepStrictEqual(protectedAfter.publications, []);
    assert.strictEqual(await StoreCatalogSelection.countDocuments(), 0);
    assert.strictEqual(await PackageMarketPublication.countDocuments(), 0);

    const previousMode = process.env.STORE_CATALOG_SELECTION_MODE;
    process.env.STORE_CATALOG_SELECTION_MODE = "EXPLICIT";
    const publicCatalog = await toPublicCatalog({ source: "database", customerMarket: "TH", includeDisabled: false });
    assert(!publicCatalog.some(product => PRODUCT_CODES.includes(product.productCode)));
    await assert.rejects(
        () => resolvePackagePrice({ productCode: "freefire", packageCode: "VERIFY_FIRST", region: "TH" }, { source: "database" }),
        error => ["PRODUCT_NOT_OFFERED", "PACKAGE_NOT_OFFERED"].includes(error.code)
    );
    if (previousMode == null) delete process.env.STORE_CATALOG_SELECTION_MODE;
    else process.env.STORE_CATALOG_SELECTION_MODE = previousMode;

    console.log(JSON.stringify({
        result: "PASS",
        database: safety.databaseName,
        firstPrice: { TH: firstSaved.prices.TH.amount, MM: firstSaved.prices.MM.amount, supplierMarket: "TH", customerMarkets: ["TH", "MM"] },
        partialRegions: { thPreservedWhenCreatingMM: true, mmPreservedWhenCreatingTH: true },
        modes: { PACKAGE: packageMode.summary, SELECTION: selectionMode.summary, PRODUCT_CHANGED: productMode.summary, WORKSPACE_CHANGED: workspaceMode.summary },
        partialFailure: { blocked: true, validPublished: partialFailure.summary.published },
        staleWrite: { rejected: true, code: "CATALOG_CONFLICT" },
        idempotency: { published: idempotent.summary.published, unchanged: true },
        authority: { productUnchanged: true, mappingUnchanged: true, selections: 0, publications: 0, sellable: false },
        existingPriceCompatibility: true,
        productionWrites: 0
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
}).finally(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db.databaseName === "aziel_daily_pricing_verifier") {
        await mongoose.connection.db.dropDatabase().catch(() => null);
    }
    await mongoose.disconnect().catch(() => null);
});
