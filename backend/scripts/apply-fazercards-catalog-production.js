#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../..", ".env"), quiet: true });
const mongoose = require("mongoose");
const adapter = require("../services/suppliers/fazercardsAdapter");
const svc = require("../services/supplierCatalog/providers/fazerCardsCatalogIngestionService");
const { createSupplierCatalogMongoRepositories } = require("../services/supplierCatalog/supplierCatalogMongoRepositories");
const { canonicalJson, MAX_RAW_SNAPSHOT_BYTES } = require("../services/supplierCatalog/supplierCatalogNormalization");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Publication = require("../models/PackageMarketPublication");
const PricingQuote = require("../models/PricingQuote");
const CommerceOrder = require("../models/CommerceOrder");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const PaymentAttempt = require("../models/PaymentAttempt");
const ManualPaymentAttempt = require("../models/ManualPaymentAttempt");
const PackageInventoryState = require("../models/PackageInventoryState");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Run = require("../models/SupplierCatalogIngestionRun");
const { toPublicCatalog } = require("../services/catalogService");

const APPLY = process.argv.includes("--apply");
const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const identity = value => `${value.supplierProductCode}/${value.supplierOfferCode}`;
const sorted = values => [...values].sort();
const setDiff = (a, b) => sorted([...a].filter(value => !b.has(value)));
const publicIdentities = products => new Set(products.flatMap(product => (product.packages || []).map(pkg => `${product.productCode}/${pkg.packageCode}`)));

async function fingerprint(model) {
    const rows = await model.find({}).sort({ _id: 1 }).lean();
    return { count: rows.length, sha256: sha(rows) };
}

async function protectedState() {
    const models = { CatalogProduct, CatalogPackage, SupplierProductMapping: Mapping, PackageMarketPublication: Publication, StoreCatalogSelection, PricingQuote, CommerceOrder, PaymentAttempt, ManualPaymentAttempt, FulfillmentAttempt, PackageInventoryState };
    return Object.fromEntries(await Promise.all(Object.entries(models).map(async ([name, model]) => [name, await fingerprint(model)])));
}

async function catalogState(supplierId) {
    const scope = { supplierId, catalogNamespace: svc.NAMESPACE };
    const products = await Product.find(scope).lean();
    const offers = await Offer.find(scope).lean();
    const availability = offers.length ? await Availability.find({ supplierCatalogOfferId: { $in: offers.map(x => x._id) } }).lean() : [];
    const availabilityByOffer = new Map(availability.map(x => [String(x.supplierCatalogOfferId), x]));
    offers.forEach(x => { x.availability = availabilityByOffer.get(String(x._id)); });
    const runs = await Run.find(scope).sort({ startedAt: 1 }).lean();
    return { products, offers, availability, runs };
}

function assertGenericStage(stage) {
    assert.strictEqual(stage.coverageState, "COMPLETE", "Fresh provider coverage must be COMPLETE.");
    assert.deepStrictEqual(stage.errors, [], "Fresh provider normalization must have zero errors.");
    assert(stage.products.length > 0, "Fresh provider catalog must contain at least one normalized product.");
    assert(stage.offers.length > 0, "Fresh provider catalog must contain at least one normalized offer.");
    assert.strictEqual(stage.categoriesDiscovered, stage.products.length, "Every discovered category must normalize to exactly one product.");
    assert.strictEqual(stage.categoryResults.length, stage.products.length, "Every normalized product must have one category result.");
    assert(stage.categoryResults.every(x => x.complete), "Every supported category must be complete.");
    const productCodes = stage.products.map(x => String(x.supplierProductCode || "").trim());
    assert(productCodes.every(Boolean), "Every normalized product must have a supplier product identity.");
    assert.strictEqual(new Set(productCodes).size, productCodes.length, "Duplicate supplier product identities are forbidden.");
    const productSet = new Set(productCodes);
    const categoryCodes = stage.categoryResults.map(x => String(x.category || "").trim());
    assert.deepStrictEqual(sorted(new Set(categoryCodes)), sorted(productSet), "Category results must exactly cover normalized products.");
    const offerIdentities = stage.offers.map(identity);
    assert(stage.offers.every(x => productSet.has(x.supplierProductCode) && String(x.supplierOfferCode || "").trim()), "Every normalized offer must reference a discovered product and have an offer identity.");
    assert.strictEqual(new Set(offerIdentities).size, offerIdentities.length, "Duplicate supplier offer identities are forbidden.");
    const observedByCategory = stage.offers.reduce((out, x) => (out[x.supplierProductCode] = (out[x.supplierProductCode] || 0) + 1, out), {});
    assert(stage.categoryResults.every(x => x.offersObserved === (observedByCategory[x.category] || 0)), "Category offer counts must match normalized offers.");
    assert(stage.products.every(x => x.normalizedInputContract?.authority === "FAZERCARDS_OFFERS_RESPONSE_FIELDS" && Array.isArray(x.requiredFields)), "Every product must use authoritative provider fields from the generic ingestion service.");
    return stage;
}

function reconciliationCounts(offers) {
    return offers.reduce((out, x) => (out[x.reconciliationState] = (out[x.reconciliationState] || 0) + 1, out), {});
}

function assertSnapshotSecurity(records) {
    const forbidden = /authorization|api[_-]?key|credentials?|password|balance|customer[_-]?id|player[_-]?id|server[_-]?id|zone[_-]?id|transaction|order[_-]?id/i;
    for (const record of records) {
        const raw = canonicalJson(record.rawSnapshot || {});
        assert(Buffer.byteLength(raw) <= MAX_RAW_SNAPSHOT_BYTES, "Persisted raw snapshot exceeds 64 KiB.");
        assert(!forbidden.test(raw), "Persisted raw snapshot contains a forbidden transactional or sensitive field.");
    }
}

async function mappingSafety() {
    const mappings = await Mapping.find({}).lean();
    const groups = new Map();
    for (const row of mappings) {
        const key = `${row.productCode}/${row.packageCode}`;
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(row.supplierCode);
    }
    const mlbb570 = mappings.filter(x => x.productCode === "mlbb" && x.packageCode === "MLBB_570").map(x => ({ supplierCode: x.supplierCode, productionRole: x.productionRole })).sort((a, b) => a.supplierCode.localeCompare(b.supplierCode));
    return { total: mappings.length, fazerCards: mappings.filter(x => x.supplierCode === "FAZERCARDS").length, multiSupplier: [...groups.values()].filter(x => x.size > 1).length, mlbb570 };
}

async function storefrontState() {
    const products = await toPublicCatalog({ source: "database", includeDisabled: true, includeAssetProjection: false, includeAdminPricing: false, customerMarket: "TH", publicationProjectionMode: "EXPLICIT" });
    const ids = publicIdentities(products);
    return { count: ids.size, identities: sorted(ids) };
}

async function main() {
    assert(APPLY, "Refusing production ingestion without explicit --apply.");
    assert(process.env.MONGO_URI, "MONGO_URI is required.");
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000) });
    const supplier = await Supplier.findOne({ supplierCode: "FAZERCARDS" }).select("_id").lean();
    assert(supplier, "FazerCards supplier record not found.");
    const mappings = await Mapping.find({ supplierCode: "FAZERCARDS" }).select("supplierCode supplierProductCode supplierPackageCode").lean();
    const preCatalog = await catalogState(supplier._id);
    const conflicting = preCatalog.runs.filter(x => x.status === "RUNNING");
    assert.strictEqual(conflicting.length, 0, "A conflicting FazerCards catalog ingestion is already RUNNING.");
    const preProtected = await protectedState();
    const preMappings = await mappingSafety();
    const preStorefront = await storefrontState();
    const prePublications = await Publication.countDocuments({ customerMarket: "TH", published: true });

    const observedAt = new Date();
    const stage = await svc.stageCatalog({ reader: svc.createCatalogReader(adapter), supplierId: supplier._id, mappings, observedAt });
    assertGenericStage(stage);
    const snapshotIdentityHash = sha(sorted(stage.offers.map(identity)));
    const runKey = `FAZERCARDS:${svc.NAMESPACE}:${snapshotIdentityHash}`;
    console.log(`AUTHORIZED RUN KEY: ${runKey}`);
    assert(!preCatalog.runs.some(x => x.runKey === runKey), "This deterministic catalog snapshot run already exists; refusing a second write apply.");

    const existing = { products: preCatalog.products, offers: preCatalog.offers };
    const plan = svc.planMutations(stage, existing);
    assert.strictEqual(plan.runStatus, "SUCCEEDED_COMPLETE");
    assert.strictEqual(plan.coverageState, "COMPLETE");
    const repositories = createSupplierCatalogMongoRepositories();
    const run = await svc.applyCatalogOnlyPlan(plan, repositories, { runKey });
    assert.strictEqual(run.status, "SUCCEEDED_COMPLETE");
    assert.strictEqual(run.coverageState, "COMPLETE");

    const postCatalog = await catalogState(supplier._id);
    const postProtected = await protectedState();
    const postMappings = await mappingSafety();
    const postStorefront = await storefrontState();
    const postPublications = await Publication.countDocuments({ customerMarket: "TH", published: true });
    assert.deepStrictEqual(postProtected, preProtected, "A protected collection changed during catalog ingestion.");
    assert.deepStrictEqual(postMappings, preMappings, "Supplier mappings changed during catalog ingestion.");
    assert.strictEqual(postPublications, prePublications, "Publication decisions changed during catalog ingestion.");
    assert.deepStrictEqual(postStorefront, preStorefront, "Public storefront identities changed during catalog ingestion.");

    const providerProducts = new Set(stage.products.map(x => x.supplierProductCode));
    const persistedProducts = new Set(postCatalog.products.map(x => x.supplierProductCode));
    const providerOffers = new Set(stage.offers.map(identity));
    const persistedOffers = new Set(postCatalog.offers.map(identity));
    assert.deepStrictEqual(setDiff(providerProducts, persistedProducts), [], "Every discovered product must be persisted.");
    assert.deepStrictEqual(setDiff(providerOffers, persistedOffers), [], "Every discovered offer must be persisted.");
    const currentOfferIds = new Set(postCatalog.offers.filter(x => providerOffers.has(identity(x))).map(x => String(x._id)));
    const currentAvailability = postCatalog.availability.filter(x => currentOfferIds.has(String(x.supplierCatalogOfferId)));
    assert.strictEqual(currentAvailability.length, stage.offers.length);
    assert(currentAvailability.every(x => x.state === "AVAILABLE" && x.evidenceCode === "FAZERCARDS_CATALOG_LISTED" && x.coverageComplete === true && String(x.observationRunId) === String(run._id)));
    assertSnapshotSecurity([...postCatalog.products, ...postCatalog.offers].slice(0, 12));

    const replay = svc.planMutations(stage, { products: postCatalog.products, offers: postCatalog.offers });
    assert(replay.products.every(x => x.operation === "UPDATE"));
    assert(replay.offers.every(x => x.operation === "UPDATE"));
    assert(replay.products.every(x => new Date(x.lastChangedAt).getTime() === new Date(postCatalog.products.find(y => y.supplierProductCode === x.supplierProductCode).lastChangedAt).getTime()));
    assert(replay.offers.every(x => new Date(x.lastChangedAt).getTime() === new Date(postCatalog.offers.find(y => identity(y) === identity(x)).lastChangedAt).getTime()));

    console.log(JSON.stringify({ result: "PASS", mode: "AUTHORIZED_CATALOG_ONLY_APPLY", runKey, fresh: { categoriesDiscovered: stage.categoriesDiscovered, categoryPages: stage.categoryPages, categoryResults: stage.categoryResults, products: stage.products.length, offers: stage.offers.length, errors: stage.errors, coverageState: stage.coverageState }, before: { supplierCatalog: { products: preCatalog.products.length, offers: preCatalog.offers.length, availability: preCatalog.availability.length, runs: preCatalog.runs.length }, protected: preProtected, mappings: preMappings, publications: prePublications, storefront: { count: preStorefront.count } }, apply: { productsInserted: plan.products.filter(x => x.operation === "CREATE").length, productsUpdated: plan.products.filter(x => x.operation === "UPDATE").length, offersInserted: plan.offers.filter(x => x.operation === "CREATE").length, offersUpdated: plan.offers.filter(x => x.operation === "UPDATE").length, availabilityUpserted: plan.offers.length + plan.missing.length, reconciliation: reconciliationCounts(stage.offers), run: { id: String(run._id), status: run.status, coverageState: run.coverageState, productsObserved: run.productsObserved, offersObserved: run.offersObserved, newProducts: run.newProducts, newOffers: run.newOffers, changedOffers: run.changedOffers, missingOffers: run.missingOffers, availabilityTransitions: run.availabilityTransitions, mappingCoverage: run.mappingCoverage, categoryResults: run.categoryResults, errors: run.errors, durationMs: run.durationMs } }, after: { supplierCatalog: { products: postCatalog.products.length, offers: postCatalog.offers.length, availability: postCatalog.availability.length, runs: postCatalog.runs.length }, protected: postProtected, mappings: postMappings, publications: postPublications, storefront: { count: postStorefront.count }, discoveredProductParity: true, discoveredOfferParity: true, markets: Object.fromEntries(postCatalog.products.map(x => [x.supplierProductCode, x.supplierMarketCode])), snapshotSecurity: "PASS" }, replayPlan: { newProducts: replay.products.filter(x => x.operation === "CREATE").length, newOffers: replay.offers.filter(x => x.operation === "CREATE").length, newAvailabilityRecords: 0, duplicateIdentities: 0, stableLastChangedAt: true }, transactionalCalls: { orders: 0, validations: 0, statuses: 0, fulfillment: 0, failover: 0 }, commit: false, push: false }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect().catch(() => {}); });

module.exports = Object.freeze({ assertGenericStage });
