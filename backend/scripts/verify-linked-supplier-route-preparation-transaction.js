#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const AdminAuditLog = require("../models/AdminAuditLog");
const { ACTION } = require("../services/supplierCatalog/supplierRoutePreparationService");
const {
    applyPlansAtomically,
    hasEffectiveTechnicalDelta
} = require("./apply-linked-supplier-route-preparation");

const COUNT = Number(process.env.LINKED_ROUTE_PREPARATION_ISOLATED_COUNT || 820);
const CONFIRM = "I_UNDERSTAND_THIS_IS_AN_ISOLATED_ROUTE_PREPARATION_TRANSACTION_TEST";
const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const now = new Date("2026-09-05T00:00:00.000Z");

function isolatedMongoUri() {
    const explicit = String(process.env.AZIEL_ISOLATED_ROUTE_PREP_MONGO_URI || "").trim();
    if (explicit) return explicit;
    assert.strictEqual(process.env.AZIEL_ISOLATED_ROUTE_PREP_DERIVE_FROM_MONGO_URI, "true", "AZIEL_ISOLATED_ROUTE_PREP_MONGO_URI is required unless explicit derivation is enabled.");
    assert(process.env.MONGO_URI, "MONGO_URI is required for derived isolated URI.");
    const uri = new URL(process.env.MONGO_URI);
    uri.pathname = "/aziel_isolated_route_prep";
    return uri.toString();
}

function assertIsolatedDb() {
    const dbName = mongoose.connection.db.databaseName;
    assert(/^aziel_isolated_route_prep/.test(dbName), `Refusing to run isolated transaction verifier against non-isolated database: ${dbName}`);
    assert(!["azielshop", "aziel", "production", "prod"].includes(dbName.toLowerCase()), "Refusing production database.");
}

function plan(id, index, { updatedAt = now } = {}) {
    const supplierId = new mongoose.Types.ObjectId();
    const offerId = new mongoose.Types.ObjectId();
    const product = "isolated_route_prep_game";
    const sku = `isolated_${index}_pack`;
    const body = {
        artifactType: "SUPPLIER_ROUTE_PREPARATION_PLAN",
        schemaVersion: 1,
        request: { mappingId: id, customerMarkets: ["TH"] },
        adoptionState: "CURRENTLY_ADOPTED",
        outcome: "FULFILLMENT_READY",
        blockers: [],
        evidence: { supplierCode: "FAZERCARDS", supplierProductCode: product, supplierOfferCode: sku, supplierMarket: "GLOBAL", canonicalProductCode: product, canonicalPackageCode: `PKG_${index}`, protocol: "FAZERCARDS_TOPUPS_ORDER_V2" },
        sourceLock: {
            mapping: {
                id,
                updatedAt,
                supplierId: String(supplierId),
                supplierProductCode: product,
                supplierPackageCode: sku,
                supplierCatalogOfferId: String(offerId),
                supplierMarket: "GLOBAL",
                enabled: false,
                productionRole: "DISABLED",
                executionMode: "MANUAL",
                fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 },
                readiness: { supplierMapped: true, pricingReady: false, inputReady: false, validationReady: false, fulfillmentReady: false, storefrontReady: false }
            },
            supplier: { id: String(supplierId), code: "FAZERCARDS", updatedAt },
            supplierProduct: { id: String(new mongoose.Types.ObjectId()), code: product, market: "GLOBAL", sourceRevision: "isolated-product", sourceHash: "a".repeat(64), updatedAt },
            offer: { id: String(offerId), code: sku, lifecycle: "ACTIVE", reconciliation: "EXACT_CANONICAL_MATCH", sourceRevision: "isolated-offer", sourceHash: "b".repeat(64), updatedAt },
            availability: { state: "AVAILABLE", coverageComplete: true, observedAt: updatedAt, updatedAt },
            canonical: { productId: String(new mongoose.Types.ObjectId()), productCode: product, packageIds: [String(new mongoose.Types.ObjectId())], packageCode: `PKG_${index}`, productUpdatedAt: updatedAt, packageUpdatedAt: updatedAt },
            runtime: { adapterConfigured: true, autoFulfillmentEnabled: true, processorSupported: true, protocol: "FAZERCARDS_TOPUPS_ORDER_V2", contractFingerprint: `fingerprint-${index}` }
        },
        proposedChanges: {
            region: "GLOBAL",
            supplierCatalogOfferId: String(offerId),
            supplierProductCode: product,
            supplierPackageCode: sku,
            executionMode: "API",
            supplierMarketEvidence: { normalizedMarket: "GLOBAL", supplierMarketCode: "GLOBAL", marketClassification: "REVIEWED_SUPPLIER_MARKET", restrictions: [], evidenceCode: "SOURCE_LOCKED_SUPPLIER_CATALOG", sourceProductHash: "a".repeat(64) },
            fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "Reviewed GLOBAL supplier route preparation", verifiedAt: new Date(0), version: 2 },
            fulfillmentContract: { version: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", supplierProductCode: product, sourceSupplierCatalogProductId: String(new mongoose.Types.ObjectId()), sourceHash: "a".repeat(64), fields: [{ customerField: "playerId", providerField: "player_id", required: true, type: "text" }], fingerprint: `fingerprint-${index}` },
            readiness: { supplierMapped: true, inputReady: true, validationReady: true, fulfillmentReady: true }
        },
        safety: { enabledWrites: 0, roleWrites: 0, supplierMarketWrites: 0, offerLinkageWrites: 0, pricingWrites: 0, publicationWrites: 0, storefrontWrites: 0, supplierCalls: 0 }
    };
    return { ...body, sourceLockHash: sha(body.sourceLock), planHash: sha(body) };
}

function mappingFromPlan(item) {
    return {
        _id: item.request.mappingId,
        supplierId: item.sourceLock.mapping.supplierId,
        supplierCode: item.evidence.supplierCode,
        productCode: item.evidence.canonicalProductCode,
        packageCode: item.evidence.canonicalPackageCode,
        supplierProductCode: item.sourceLock.mapping.supplierProductCode,
        supplierPackageCode: item.sourceLock.mapping.supplierPackageCode,
        supplierCatalogOfferId: item.sourceLock.mapping.supplierCatalogOfferId,
        supplierDisplayName: "FazerCards",
        region: "GLOBAL",
        supplierMarketEvidence: { normalizedMarket: "GLOBAL", supplierMarketCode: "GLOBAL", marketClassification: "REVIEWED_SUPPLIER_MARKET" },
        enabled: false,
        productionRole: "DISABLED",
        executionMode: "MANUAL",
        fulfillmentEligibility: item.sourceLock.mapping.fulfillmentEligibility,
        mappingMetadata: { readiness: item.sourceLock.mapping.readiness },
        updatedAt: item.sourceLock.mapping.updatedAt,
        createdAt: item.sourceLock.mapping.updatedAt
    };
}

async function seed(plans) {
    await SupplierProductMapping.deleteMany({});
    await AdminAuditLog.deleteMany({});
    await SupplierProductMapping.insertMany(plans.map(mappingFromPlan), { ordered: true });
}

async function main() {
    assert.strictEqual(process.env.AZIEL_ISOLATED_ROUTE_PREP_CONFIRM, CONFIRM, "Explicit isolated verifier confirmation is required.");
    const uri = isolatedMongoUri();
    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000) });
    assertIsolatedDb();
    const plans = Array.from({ length: COUNT }, (_, index) => plan(String(new mongoose.Types.ObjectId()), index));
    const byId = new Map(plans.map(item => [item.request.mappingId, item]));
    await seed(plans);
    const result = await applyPlansAtomically(plans, { username: "isolated-owner", role: "OWNER" }, { generatePlan: async request => byId.get(request.mappingId) });
    assert.deepStrictEqual(result, { attempted: COUNT, applied: COUNT, auditRecords: COUNT });
    const preparedRows = await SupplierProductMapping.find({ executionMode: "API" }).lean();
    const preparedCount = JSON.parse(JSON.stringify(preparedRows)).filter(row => row.mappingMetadata?.technicalPreparation?.authority === ACTION).length;
    assert.strictEqual(preparedCount, COUNT);
    assert.strictEqual(await AdminAuditLog.countDocuments({ action: ACTION }), COUNT);
    const prepared = await SupplierProductMapping.findOne({ executionMode: "API" }).lean();
    const preparedPlan = structuredClone(plans[0]);
    preparedPlan.sourceLock.mapping.executionMode = "API";
    preparedPlan.sourceLock.mapping.fulfillmentEligibility = prepared.fulfillmentEligibility;
    preparedPlan.sourceLock.mapping.readiness = prepared.mappingMetadata.readiness;
    preparedPlan.sourceLock.runtime.contractFingerprint = prepared.mappingMetadata.fulfillmentContract.fingerprint;
    assert.strictEqual(hasEffectiveTechnicalDelta(preparedPlan), false, "Fresh prepared plan shape must be no-op.");

    await seed(plans);
    await assert.rejects(
        () => applyPlansAtomically(plans, { username: "isolated-owner", role: "OWNER" }, {
            generatePlan: async request => byId.get(request.mappingId),
            afterMappingBulkWrite: async () => { throw new Error("INJECTED_AFTER_MAPPING_BULK_WRITE"); }
        }),
        /INJECTED_AFTER_MAPPING_BULK_WRITE/
    );
    assert.strictEqual(await SupplierProductMapping.countDocuments({ executionMode: "API" }), 0, "Injected transaction failure must roll back mapping updates.");
    assert.strictEqual(await AdminAuditLog.countDocuments({ action: ACTION }), 0, "Injected transaction failure must roll back audit writes.");
    console.log(JSON.stringify({
        result: "PASS",
        isolatedDatabase: mongoose.connection.db.databaseName,
        fullBatchSize: COUNT,
        fullBatchCommit: true,
        mappingUpdatesAfterCommit: COUNT,
        auditRecordsAfterCommit: COUNT,
        secondPlanningNoopProof: true,
        injectedRollback: true,
        partialMappingStateAfterRollback: 0,
        partialAuditStateAfterRollback: 0
    }, null, 2));
}

main().catch(error => {
    console.error("VERIFY_LINKED_SUPPLIER_ROUTE_PREPARATION_TRANSACTION_FAILED:", error);
    process.exitCode = 1;
}).finally(async () => {
    if (mongoose.connection.readyState === 1) {
        assertIsolatedDb();
        await mongoose.connection.db.dropDatabase().catch(() => null);
    }
    await mongoose.disconnect().catch(() => null);
});
