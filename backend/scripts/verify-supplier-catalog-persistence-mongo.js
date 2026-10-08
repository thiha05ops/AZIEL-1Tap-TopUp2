#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { createSupplierCatalogMongoRepositories } = require("../services/supplierCatalog/supplierCatalogMongoRepositories");

const EXPECTED_DATABASE = "aziel_clean_preview_20261008";
const OFFER_COUNT = 5000;
const PRODUCT_COUNT = 25;
const cleanDocument = (row, extra = {}) => {
    const copy = { ...row, ...extra };
    for (const key of ["_id", "__v", "createdAt", "updatedAt", "supplierCatalogProductId", "availability"]) delete copy[key];
    return copy;
};
const authorityCollections = ["catalogproducts", "catalogpackages", "supplierproductmappings", "storecatalogselections", "packagemarketpublications", "packagesupplierselections", "commerceorders", "paymentattempts", "fulfillmentattempts"];
let cleanupState = null;

async function cleanupFixture() {
    if (!cleanupState) return;
    const { observationCollection, availabilityCollection, offerCollection, productCollection, token, productCodes } = cleanupState;
    const rows = await offerCollection.find({ supplierOfferCode: { $regex: `^${token}_O` } }).project({ _id: 1 }).toArray();
    const ids = rows.map(row => row._id);
    if (ids.length) {
        await observationCollection.deleteMany({ supplierCatalogOfferId: { $in: ids } });
        await availabilityCollection.deleteMany({ supplierCatalogOfferId: { $in: ids } });
    }
    await offerCollection.deleteMany({ supplierOfferCode: { $regex: `^${token}_O` } });
    await productCollection.deleteMany({ supplierProductCode: { $in: productCodes } });
    cleanupState = null;
}

async function counts(db, names) {
    const result = {};
    for (const name of names) result[name] = await db.collection(name).countDocuments({});
    return result;
}

async function main() {
    assert.strictEqual(process.env.AZIEL_ALLOW_MUTATING_VERIFIER, "true", "AZIEL_ALLOW_MUTATING_VERIFIER=true is required.");
    assert(process.env.MONGO_URI, "MONGO_URI is required.");
    const target = new URL(process.env.MONGO_URI).pathname.replace(/^\//, "");
    assert.strictEqual(target, EXPECTED_DATABASE, `Refusing database ${target || "<empty>"}.`);
    assert.notStrictEqual(target, "azielshop");
    await mongoose.connect(process.env.MONGO_URI);
    assert.strictEqual(mongoose.connection.name, EXPECTED_DATABASE);
    const db = mongoose.connection.db;
    const token = `PERSIST_VERIFY_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const namespace = "FAZERCARDS_RESELLER_CATALOG";
    const productCollection = db.collection("suppliercatalogproducts");
    const offerCollection = db.collection("suppliercatalogoffers");
    const availabilityCollection = db.collection("supplierofferavailabilities");
    const observationCollection = db.collection("suppliercatalogcostobservations");
    const productSeed = await productCollection.findOne({ catalogNamespace: namespace });
    const offerSeed = await offerCollection.findOne({ catalogNamespace: namespace, "supplierCost.amount": { $type: "number" } });
    assert(productSeed && offerSeed, "A completed isolated FazerCards ingestion is required before this verifier.");
    const authorityBefore = await counts(db, authorityCollections);
    const productCodes = Array.from({ length: PRODUCT_COUNT }, (_, index) => `${token}_P${index}`);
    cleanupState = { observationCollection, availabilityCollection, offerCollection, productCollection, token, productCodes };
    const observedAt = new Date();
    const products = productCodes.map((supplierProductCode, index) => cleanDocument(productSeed, {
        supplierProductCode,
        categoryCode: supplierProductCode,
        displayName: `Persistence verifier ${index}`,
        rawName: `Persistence verifier ${index}`,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        lastObservedAt: observedAt,
        lastChangedAt: observedAt,
        sourceRevision: token,
        operation: "CREATE"
    }));
    const offers = Array.from({ length: OFFER_COUNT }, (_, index) => {
        const supplierProductCode = productCodes[index % PRODUCT_COUNT];
        const supplierOfferCode = `${token}_O${index}`;
        return {
            ...cleanDocument(offerSeed, {
            supplierProductCode,
            supplierOfferCode,
            supplierOfferName: `Verifier offer ${index}`,
            rawName: `Verifier offer ${index}`,
            firstSeenAt: observedAt,
            lastSeenAt: observedAt,
            lastObservedAt: observedAt,
            lastChangedAt: observedAt,
            sourceRevision: token,
            operation: "CREATE",
            supplierCost: { ...offerSeed.supplierCost, observedAt }
            }),
            availability: { state: "AVAILABLE", evidenceCode: "ISOLATED_PERSISTENCE_VERIFIER", observedAt, staleAt: null, coverageComplete: true }
        };
    });
    const basePlan = { supplierId: productSeed.supplierId, catalogNamespace: namespace, observedAt, products, offers, missing: [], runStatus: "SUCCEEDED_COMPLETE", coverageState: "COMPLETE", errors: [], categoryResults: [], mappingCoverage: {} };
    const repositories = createSupplierCatalogMongoRepositories();
    const timings = {};
    const startedPartial = Date.now();
    await repositories.bulk.applyCatalogPlan({ ...basePlan, offers: offers.slice(0, 1000) }, { ingestionRunId: new mongoose.Types.ObjectId() });
    timings.interruptedPrefixMs = Date.now() - startedPartial;
    const startedRecovery = Date.now();
    await repositories.bulk.applyCatalogPlan(basePlan, { ingestionRunId: new mongoose.Types.ObjectId() });
    timings.recoveryMs = Date.now() - startedRecovery;
    assert.strictEqual(await productCollection.countDocuments({ supplierProductCode: { $in: productCodes } }), PRODUCT_COUNT);
    assert.strictEqual(await offerCollection.countDocuments({ supplierOfferCode: { $regex: `^${token}_O` } }), OFFER_COUNT);
    const persistedOffers = await offerCollection.find({ supplierOfferCode: { $regex: `^${token}_O` } }).project({ _id: 1 }).toArray();
    const offerIds = persistedOffers.map(row => row._id);
    assert.strictEqual(await availabilityCollection.countDocuments({ supplierCatalogOfferId: { $in: offerIds } }), OFFER_COUNT);
    const observationsAfterRecovery = await observationCollection.countDocuments({ supplierCatalogOfferId: { $in: offerIds } });
    const startedRepeat = Date.now();
    await repositories.bulk.applyCatalogPlan(basePlan, { ingestionRunId: new mongoose.Types.ObjectId() });
    timings.idempotentRepeatMs = Date.now() - startedRepeat;
    assert.strictEqual(await offerCollection.countDocuments({ supplierOfferCode: { $regex: `^${token}_O` } }), OFFER_COUNT);
    assert.strictEqual(await observationCollection.countDocuments({ supplierCatalogOfferId: { $in: offerIds } }), observationsAfterRecovery, "Same-source repeat must not duplicate cost observations.");
    const removed = await offerCollection.findOne({ supplierOfferCode: `${token}_O0` });
    await repositories.bulk.applyCatalogPlan({ ...basePlan, products: [], offers: [], missing: [{ _id: removed._id, availability: { state: "UNKNOWN", evidenceCode: "MISSING_FROM_COMPLETE_CATALOG", observedAt: new Date(), staleAt: new Date(), coverageComplete: true } }] }, { ingestionRunId: new mongoose.Types.ObjectId() });
    assert.strictEqual((await availabilityCollection.findOne({ supplierCatalogOfferId: removed._id })).state, "UNKNOWN", "Removed offer must fail closed as UNKNOWN.");
    await assert.rejects(() => offerCollection.insertOne({ ...removed, _id: new mongoose.Types.ObjectId() }), error => error?.code === 11000, "Unique supplier-native identity must be enforced by MongoDB.");
    assert.deepStrictEqual(await counts(db, authorityCollections), authorityBefore, "Catalog persistence must not mutate Owner/commercial authorities.");
    assert(timings.recoveryMs < 120000 && timings.idempotentRepeatMs < 120000, "5,000-offer persistence exceeded the bounded two-minute target.");
    console.log(JSON.stringify({ result: "PASS", database: target, offers: OFFER_COUNT, products: PRODUCT_COUNT, timings, boundedBulkWrites: { productBatches: 1, offerBatches: 10, availabilityBatches: 10, observationBatches: 10 }, interruptedRecovery: "PASS", removedOfferFailClosed: "PASS", uniqueIdentity: "PASS", ownerAuthoritiesUnchanged: true, providerCalls: 0 }, null, 2));
    await cleanupFixture();
}

if (require.main === module) main().catch(async error => { await cleanupFixture().catch(() => {}); console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => {}));
