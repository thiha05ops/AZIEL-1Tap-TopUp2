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
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const { assertGenericStage, protectedState, mappingSafety, storefrontState } = require("./apply-fazercards-catalog-production");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Observation = require("../models/SupplierCatalogCostObservation");
const Run = require("../models/SupplierCatalogIngestionRun");
const Lock = require("../models/SupplierCatalogIngestionLock");

const TARGET = Object.freeze({
    runId: "6a97936bde1e5d04d8ae88a3",
    runKey: "FAZERCARDS:FAZERCARDS_RESELLER_CATALOG:ade2f1ec19536b0446e9fe651d4130d0bf49eb298316166f5b2a8cdb9adc8879",
    updatedAt: "2026-09-02T03:09:30.625Z"
});
const CONFIRM_FLAG = "--confirm-recovery";
const clean = value => String(value == null ? "" : value).trim();
const identity = value => `${value.supplierProductCode}/${value.supplierOfferCode}`;
const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const arg = name => clean(process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3));
const sameTime = (a, b) => Boolean(a && b) && new Date(a).getTime() === new Date(b).getTime();

function expectedRunKey(stage) {
    return `FAZERCARDS:${svc.NAMESPACE}:${sha(stage.offers.map(identity).sort())}`;
}

function assertRecoveryPreconditions({ requested, run, activeLease, stage, target = TARGET }) {
    assert.strictEqual(requested.confirmed, true, `Explicit ${CONFIRM_FLAG} is required.`);
    assert.strictEqual(requested.runId, target.runId, "Recovery run ID is not the reviewed abandoned run.");
    assert.strictEqual(requested.runKey, target.runKey, "Recovery run key is not the reviewed abandoned run.");
    assert(sameTime(requested.updatedAt, target.updatedAt), "Recovery updatedAt is not the reviewed source lock.");
    assert(run, "Reviewed abandoned ingestion run was not found.");
    assert.strictEqual(String(run._id), requested.runId, "Loaded run ID does not match the recovery request.");
    assert.strictEqual(run.runKey, requested.runKey, "Loaded run key does not match the recovery request.");
    assert.strictEqual(run.catalogNamespace, svc.NAMESPACE, "Loaded run namespace is not FazerCards.");
    assert.strictEqual(run.status, "RUNNING", "Recovery requires the run to remain RUNNING.");
    assert.strictEqual(run.completedAt, null, "Recovery refuses an already completed run.");
    assert(sameTime(run.updatedAt, requested.updatedAt), "Recovery source lock is stale; run updatedAt changed.");
    assert(!activeLease, "Recovery refuses while a durable FazerCards ingestion lease is active.");
    assertGenericStage(stage);
    assert.strictEqual(expectedRunKey(stage), run.runKey, "Fresh live offer identity hash does not match the abandoned run key.");
    return true;
}

async function resumeSameRun({ run, stage, existing, repositories, existingObservationOfferIds, assertSourceLock, verifyCoverage, finalize }) {
    const plan = svc.planMutations(stage, existing);
    assert.strictEqual(plan.runStatus, "SUCCEEDED_COMPLETE");
    assert.strictEqual(plan.coverageState, "COMPLETE");
    await assertSourceLock();
    const productIds = new Map();
    for (const product of plan.products) {
        await assertSourceLock();
        const saved = await repositories.products.upsert(product);
        productIds.set(product.supplierProductCode, saved._id);
    }
    for (const offer of plan.offers) {
        await assertSourceLock();
        const saved = await repositories.offers.upsert({ ...offer, supplierCatalogProductId: productIds.get(offer.supplierProductCode) });
        await repositories.availability.upsert({ ...offer.availability, supplierCatalogOfferId: saved._id, observationRunId: run._id });
        if (!existingObservationOfferIds.has(String(saved._id)) && repositories.observations?.append) {
            await repositories.observations.append({ offer: saved, ingestionRunId: run._id });
            existingObservationOfferIds.add(String(saved._id));
        }
    }
    for (const offer of plan.missing) {
        await assertSourceLock();
        await repositories.availability.upsert({ ...offer.availability, supplierCatalogOfferId: offer._id, observationRunId: run._id });
    }
    await assertSourceLock();
    const coverage = await verifyCoverage({ run, stage });
    assert.strictEqual(coverage.products, stage.products.length, "Recovered product coverage is incomplete.");
    assert.strictEqual(coverage.offers, stage.offers.length, "Recovered offer coverage is incomplete.");
    assert.strictEqual(coverage.availability, stage.offers.length, "Recovered availability coverage is incomplete.");
    assert.strictEqual(coverage.observations, stage.offers.length, "Recovered cost-observation coverage is incomplete.");
    await assertSourceLock();
    return finalize({ run, plan, coverage });
}

async function main() {
    const requested = { confirmed: process.argv.includes(CONFIRM_FLAG), runId: arg("run-id"), runKey: arg("run-key"), updatedAt: arg("updated-at") };
    assert(requested.confirmed, `Refusing recovery without explicit ${CONFIRM_FLAG}.`);
    assert(process.env.MONGO_URI, "MONGO_URI is required.");
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000) });
    const supplier = await Supplier.findOne({ supplierCode: "FAZERCARDS" }).select("_id").lean();
    assert(supplier, "FazerCards supplier record not found.");
    const run = await Run.findOne({ _id: requested.runId, supplierId: supplier._id }).lean();
    const activeLease = await Lock.findOne({ supplierId: supplier._id, expiresAt: { $gt: new Date() } }).lean();
    const mappings = await Mapping.find({ supplierCode: "FAZERCARDS" }).select("supplierCode supplierProductCode supplierPackageCode").lean();
    const scope = { supplierId: supplier._id, catalogNamespace: svc.NAMESPACE };
    const [products, offers, observationRows] = await Promise.all([Product.find(scope).lean(), Offer.find(scope).lean(), run ? Observation.find({ ingestionRunId: run._id }).select("supplierCatalogOfferId").lean() : []]);
    const stage = await svc.stageCatalog({ reader: svc.createCatalogReader(adapter), supplierId: supplier._id, mappings, observedAt: new Date() });
    assertRecoveryPreconditions({ requested, run, activeLease, stage });
    const preProtected = await protectedState(), preMappings = await mappingSafety(), preStorefront = await storefrontState();
    const sourceFilter = () => ({ _id: run._id, runKey: run.runKey, status: "RUNNING", completedAt: null, updatedAt: new Date(requested.updatedAt) });
    const assertSourceLock = async () => {
        assert(await Run.exists(sourceFilter()), "Recovery source lock was lost; run changed.");
        assert(!(await Lock.exists({ supplierId: supplier._id, expiresAt: { $gt: new Date() } })), "A durable ingestion lease became active during recovery.");
    };
    const verifyCoverage = async ({ run: currentRun, stage: currentStage }) => {
        const productCodes = currentStage.products.map(x => x.supplierProductCode), keys = new Set(currentStage.offers.map(identity));
        const persistedProducts = await Product.find({ ...scope, supplierProductCode: { $in: productCodes } }).select("_id supplierProductCode").lean();
        const persistedOffers = (await Offer.find({ ...scope, supplierProductCode: { $in: productCodes } }).select("_id supplierProductCode supplierOfferCode").lean()).filter(x => keys.has(identity(x)));
        const ids = persistedOffers.map(x => x._id);
        const [availability, observations] = await Promise.all([Availability.countDocuments({ supplierCatalogOfferId: { $in: ids }, observationRunId: currentRun._id }), Observation.countDocuments({ supplierCatalogOfferId: { $in: ids }, ingestionRunId: currentRun._id })]);
        return { products: persistedProducts.length, offers: persistedOffers.length, availability, observations };
    };
    const finalize = async ({ run: currentRun, plan, coverage }) => {
        const completedAt = new Date();
        const finalized = await Run.findOneAndUpdate(sourceFilter(), { $set: { status: "SUCCEEDED_COMPLETE", coverageState: "COMPLETE", completedAt, productsObserved: coverage.products, offersObserved: coverage.offers, newProducts: 0, newOffers: 0, changedOffers: plan.offers.length, missingOffers: plan.missing.length, availabilityTransitions: plan.offers.length + plan.missing.length, mappingCoverage: plan.mappingCoverage || {}, categoryResults: plan.categoryResults, errors: [], durationMs: Math.max(0, completedAt.getTime() - new Date(currentRun.startedAt).getTime()), metadata: { ...(currentRun.metadata || {}), recovery: { resumedSameRun: true, recoveredAt: completedAt, sourceLockedUpdatedAt: requested.updatedAt } } } }, { returnDocument: "after", runValidators: true });
        assert(finalized, "Recovery finalization source lock failed.");
        return finalized;
    };
    const finalized = await resumeSameRun({ run, stage, existing: { products, offers }, repositories: createSupplierCatalogMongoRepositories(), existingObservationOfferIds: new Set(observationRows.map(x => String(x.supplierCatalogOfferId))), assertSourceLock, verifyCoverage, finalize });
    const postProtected = await protectedState(), postMappings = await mappingSafety(), postStorefront = await storefrontState();
    assert.deepStrictEqual(postProtected, preProtected, "A protected business collection changed during recovery.");
    assert.deepStrictEqual(postMappings, preMappings, "Supplier mappings changed during recovery.");
    assert.deepStrictEqual(postStorefront, preStorefront, "Public storefront changed during recovery.");
    console.log(JSON.stringify({ result: "PASS", mode: "EXPLICIT_SAME_RUN_RECOVERY", runId: String(finalized._id), runKey: finalized.runKey, status: finalized.status, coverageState: finalized.coverageState, protectedAuthoritiesUnchanged: true }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => {}));

module.exports = Object.freeze({ TARGET, CONFIRM_FLAG, expectedRunKey, assertRecoveryPreconditions, resumeSameRun });
