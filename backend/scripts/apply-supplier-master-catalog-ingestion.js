#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const Supplier = require("../models/Supplier");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Run = require("../models/SupplierCatalogIngestionRun");
const Mapping = require("../models/SupplierProductMapping");
const Publication = require("../models/PackageMarketPublication");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const PricingPolicy = require("../models/PricingPolicy");
const { canonicalJson, normalizeOfferSemantics } = require("../services/supplierCatalog/supplierCatalogNormalization");

const plan = require("../../docs/supplier-master-catalog-ingestion-plan-2026-08-31.json");
const sources = {
    FAZERCARDS: require("../../docs/fazercards-current-master-catalog-source-2026-08-31.json"),
    WONDD: require("../../docs/wondd-current-master-catalog-source-2026-08-31.json")
};
const confirmation = process.argv.find(value => value.startsWith("--apply-reviewed-plan="))?.slice("--apply-reviewed-plan=".length) || "";
const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const chunk = (rows, size = 400) => Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
const special = name => /first top.?up|first purchase|pass|weekly|monthly|prime|membership|subscription|bundle|pack|rebate|lucky bag|gift|event/i.test(String(name || ""));

async function fingerprint(Model) {
    const rows = await Model.find({}).sort({ _id: 1 }).lean();
    return { count: rows.length, sha256: sha(rows) };
}
async function protectedState() {
    return { SupplierProductMapping: await fingerprint(Mapping), CatalogProduct: await fingerprint(CatalogProduct), CatalogPackage: await fingerprint(CatalogPackage), PackageMarketPublication: await fingerprint(Publication), PricingPolicy: await fingerprint(PricingPolicy) };
}
function assertEqual(actual, expected, code) {
    if (canonicalJson(actual) !== canonicalJson(expected)) throw Object.assign(new Error(code), { code, actual, expected });
}
function initialReconciliation(product, offer) {
    if (product.marketCoverageState === "NON_TARGET_MARKET" || product.marketCoverageState === "UNSUPPORTED") return { state: "INTENTIONALLY_UNSUPPORTED", reason: product.marketCoverageState };
    if (product.marketCoverageState === "UNKNOWN_MARKET") return { state: "MARKET_EVIDENCE_REQUIRED", reason: "MARKET_EVIDENCE_MISSING" };
    if (special(offer.supplierOfferName)) return { state: "SPECIAL_VARIANT", reason: "SPECIAL_ENTITLEMENT_REVIEW_REQUIRED" };
    return { state: "SEMANTIC_REVIEW_REQUIRED", reason: "CANONICAL_PACKAGE_EQUIVALENCE_UNREVIEWED" };
}

async function applySupplier(supplierCode, supplier, source, namespace) {
    const observedAt = new Date(source.generatedAt), runKey = `MASTER:${supplierCode}:${source.sourceSetHash}`;
    const priorRun = await Run.findOne({ supplierId: supplier._id, catalogNamespace: namespace, runKey }).lean();
    if (priorRun?.status === "SUCCEEDED_COMPLETE" || priorRun?.status === "SUCCEEDED_PARTIAL") return { replay: true, run: priorRun };
    const run = await Run.findOneAndUpdate({ supplierId: supplier._id, catalogNamespace: namespace, runKey }, { $setOnInsert: { supplierId: supplier._id, catalogNamespace: namespace, runKey, status: "RUNNING", coverageState: "UNKNOWN", startedAt: observedAt, sourceRevision: source.sourceSetHash, trigger: "ADMIN_MANUAL", requestedAt: new Date(), attemptCount: 1, reason: "Reviewed Supplier Master Catalog completion" } }, { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true });
    const existingProducts = await Product.find({ supplierId: supplier._id, catalogNamespace: namespace }).lean(), existingProductByCode = new Map(existingProducts.map(row => [row.supplierProductCode, row]));
    const productOps = source.products.map(row => {
        const old = existingProductByCode.get(row.supplierProductCode), changed = !old || old.rawSnapshotHash !== row.rawSnapshotHash;
        const requiredFields = (row.requiredCustomerInputs || []).map(field => ({ providerField: field.key, required: true, label: field.label, evidenceSource: field.source }));
        return { updateOne: { filter: { supplierId: supplier._id, catalogNamespace: namespace, supplierProductCode: row.supplierProductCode }, update: { $set: { supplierMarketCode: row.supplierMarketCode, displayName: row.displayName, rawName: row.displayName, categoryCode: row.supplierProductCode, supportState: row.supportState, requiredFields, normalizedInputContract: { fields: requiredFields, authority: row.marketEvidenceCode }, restrictions: row.restrictions || [], metadata: { marketCoverageState: row.marketCoverageState, targetMarketEligible: row.targetMarketEligible, marketEvidenceCode: row.marketEvidenceCode, deliveryClass: row.deliveryClass, masterSourceSetHash: source.sourceSetHash }, lastSeenAt: observedAt, lastObservedAt: observedAt, lastChangedAt: changed ? observedAt : old.lastChangedAt, sourceRevision: source.sourceSetHash, rawSnapshotHash: row.rawSnapshotHash, rawSnapshot: row.rawSnapshot }, $setOnInsert: { supplierId: supplier._id, catalogNamespace: namespace, supplierProductCode: row.supplierProductCode, firstSeenAt: observedAt } }, upsert: true } };
    });
    for (const batch of chunk(productOps)) await Product.bulkWrite(batch, { ordered: true });
    const persistedProducts = await Product.find({ supplierId: supplier._id, catalogNamespace: namespace }).lean(), productByCode = new Map(persistedProducts.map(row => [row.supplierProductCode, row]));
    const existingOffers = await Offer.find({ supplierId: supplier._id, catalogNamespace: namespace }).lean(), existingOfferByKey = new Map(existingOffers.map(row => [`${row.supplierProductCode}/${row.supplierOfferCode}`, row]));
    const offerOps = source.offers.map(row => {
        const key = `${row.supplierProductCode}/${row.supplierOfferCode}`, old = existingOfferByKey.get(key), changed = !old || old.rawSnapshotHash !== row.rawSnapshotHash, product = productByCode.get(row.supplierProductCode), classification = initialReconciliation(product.metadata || row, row);
        return { updateOne: { filter: { supplierId: supplier._id, catalogNamespace: namespace, supplierProductCode: row.supplierProductCode, supplierOfferCode: row.supplierOfferCode }, update: { $set: { supplierCatalogProductId: product._id, supplierOfferName: row.supplierOfferName, rawName: row.supplierOfferName, supplierCost: row.supplierCost ? { ...row.supplierCost, observedAt } : undefined, rawSemantics: row.rawSemantics || { providerName: row.supplierOfferName }, normalizedSemantics: row.normalizedSemantics || normalizeOfferSemantics({ providerName: row.supplierOfferName }), catalogLifecycleState: "ACTIVE", reconciliationState: old?.reconciliationState || classification.state, reconciliationEvidence: old?.reconciliationEvidence || { code: classification.reason, marketCoverageState: product.metadata?.marketCoverageState, sourceSetHash: source.sourceSetHash }, lastSeenAt: observedAt, lastObservedAt: observedAt, lastChangedAt: changed ? observedAt : old.lastChangedAt, sourceRevision: source.sourceSetHash, rawSnapshotHash: row.rawSnapshotHash, rawSnapshot: row.rawSnapshot, metadata: { ...(old?.metadata || {}), masterSourceSetHash: source.sourceSetHash } }, $setOnInsert: { supplierCatalogProductId: product._id, supplierId: supplier._id, catalogNamespace: namespace, supplierProductCode: row.supplierProductCode, supplierOfferCode: row.supplierOfferCode, firstSeenAt: observedAt } }, upsert: true } };
    });
    for (const batch of chunk(offerOps)) await Offer.bulkWrite(batch, { ordered: true });
    const persistedOffers = await Offer.find({ supplierId: supplier._id, catalogNamespace: namespace }).select("_id supplierProductCode supplierOfferCode").lean(), sourceKeys = new Set(source.offers.map(row => `${row.supplierProductCode}/${row.supplierOfferCode}`)), currentByKey = new Map(persistedOffers.map(row => [`${row.supplierProductCode}/${row.supplierOfferCode}`, row]));
    const availabilityOps = source.offers.map(row => ({ updateOne: { filter: { supplierCatalogOfferId: currentByKey.get(`${row.supplierProductCode}/${row.supplierOfferCode}`)._id }, update: { $set: { state: "AVAILABLE", evidenceCode: supplierCode === "FAZERCARDS" ? "FAZERCARDS_CATALOG_LISTED" : "WONDD_PACKAGE_LISTED", observedAt, staleAt: null, lastAvailableAt: observedAt, consecutiveMissingCount: 0, observationRunId: run._id, coverageComplete: supplierCode === "FAZERCARDS", metadata: { masterSourceSetHash: source.sourceSetHash } } }, upsert: true } }));
    for (const batch of chunk(availabilityOps)) await Availability.bulkWrite(batch, { ordered: true });
    let missing = 0;
    if (supplierCode === "FAZERCARDS") {
        const absent = persistedOffers.filter(row => !sourceKeys.has(`${row.supplierProductCode}/${row.supplierOfferCode}`)); missing = absent.length;
        if (absent.length) await Availability.updateMany({ supplierCatalogOfferId: { $in: absent.map(row => row._id) } }, { $set: { state: "UNKNOWN", staleAt: observedAt, observedAt, coverageComplete: true, observationRunId: run._id, "metadata.missingFromMasterSourceSetHash": source.sourceSetHash } });
    }
    const status = supplierCode === "FAZERCARDS" ? "SUCCEEDED_COMPLETE" : "SUCCEEDED_PARTIAL", coverageState = supplierCode === "FAZERCARDS" ? "COMPLETE" : "PARTIAL";
    const finalized = await Run.findByIdAndUpdate(run._id, { $set: { status, coverageState, completedAt: new Date(), productsObserved: source.products.length, offersObserved: source.offers.length, newProducts: source.products.filter(row => !existingProductByCode.has(row.supplierProductCode)).length, newOffers: source.offers.filter(row => !existingOfferByKey.has(`${row.supplierProductCode}/${row.supplierOfferCode}`)).length, changedOffers: source.offers.length - source.offers.filter(row => !existingOfferByKey.has(`${row.supplierProductCode}/${row.supplierOfferCode}`)).length, missingOffers: missing, availabilityTransitions: source.offers.length + missing, errors: [], categoryResults: [{ category: "MASTER_CATALOG", complete: supplierCode === "FAZERCARDS", offersObserved: source.offers.length, evidence: source.completeness }], metadata: { completenessEvidence: source.completeness, sourceSetHash: source.sourceSetHash } } }, { returnDocument: "after", runValidators: true }).lean();
    return { replay: false, run: finalized };
}

async function main() {
    if (confirmation !== plan.sourcePlanHash) throw Object.assign(new Error("Exact reviewed plan hash confirmation is required."), { code: "REVIEWED_PLAN_CONFIRMATION_REQUIRED" });
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    assertEqual(await protectedState(), plan.before.protectedState, "PROTECTED_SOURCE_SET_CHANGED");
    for (const [code, source] of Object.entries(sources)) if (source.sourceSetHash !== plan.suppliers[code].sourceSetHash) throw Object.assign(new Error(`${code} source artifact hash differs from the reviewed plan.`), { code: "SOURCE_ARTIFACT_CHANGED" });
    const suppliers = await Supplier.find({ supplierCode: { $in: ["FAZERCARDS", "WONDD"] } }); const byCode = new Map(suppliers.map(row => [row.supplierCode, row]));
    const results = [];
    results.push(await applySupplier("FAZERCARDS", byCode.get("FAZERCARDS"), sources.FAZERCARDS, plan.suppliers.FAZERCARDS.namespace));
    results.push(await applySupplier("WONDD", byCode.get("WONDD"), sources.WONDD, plan.suppliers.WONDD.namespace));
    const after = { products: await Product.countDocuments(), offers: await Offer.countDocuments(), availability: await Availability.countDocuments(), protectedState: await protectedState() };
    assertEqual(after.protectedState, plan.before.protectedState, "PROTECTED_AUTHORITY_CHANGED");
    if (after.products !== 327 || after.offers !== 5570 || after.availability !== 5570) throw Object.assign(new Error("Supplier catalog post-apply counts differ from the reviewed plan."), { code: "POST_APPLY_COUNT_MISMATCH", after });
    console.log(JSON.stringify({ result: "PASS", planHash: plan.sourcePlanHash, results: results.map(item => ({ replay: item.replay, runId: String(item.run._id), status: item.run.status, products: item.run.productsObserved, offers: item.run.offersObserved })), after, protectedAuthorityExactEquality: true, publicationWrites: 0, pricingWrites: 0, mappingWrites: 0, routingRoleWrites: 0, orderCalls: 0, fulfillmentCalls: 0, supplierTransactionalCalls: 0 }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message, actual: error.actual, expected: error.expected }, null, 2)); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
