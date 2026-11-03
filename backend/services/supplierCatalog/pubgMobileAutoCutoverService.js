"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const AdminAccount = require("../../models/AdminAccount");
const AdminAuditLog = require("../../models/AdminAuditLog");
const CatalogPackage = require("../../models/CatalogPackage");
const FulfillmentAttempt = require("../../models/FulfillmentAttempt");
const PackageSupplierSelection = require("../../models/PackageSupplierSelection");
const StoreCatalogSelection = require("../../models/StoreCatalogSelection");
const Supplier = require("../../models/Supplier");
const SupplierCatalogIngestionRun = require("../../models/SupplierCatalogIngestionRun");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const { getSupplierAdapter } = require("../supplierAdapterRegistry");
const { assessMappingReadiness, READINESS_MODES } = require("../supplierMappingReadinessService");
const { verifiedMappingContract } = require("../suppliers/fazercardsFulfillmentContractService");
const { observedCostHash } = require("./supplierCostComparisonService");
const { canonicalJson } = require("./supplierCatalogNormalization");
const {
    PRODUCT_CODE, SOURCE_PRODUCT_CODE, TARGET_PRODUCT_CODE, NAMESPACE,
    PACKAGE_MIGRATIONS
} = require("./pubgMobileAutoMigrationService");

const CUTOVER_OPERATION = "CUTOVER_PUBG_MOBILE_AUTO_V1";
const CUTOVER_CONFIRMATION = "CUT OVER PUBG MOBILE GLOBAL TO AUTO";
const ROLLBACK_OPERATION = "ROLLBACK_PUBG_MOBILE_AUTO_V1";
const ROLLBACK_CONFIRMATION = "ROLL BACK PUBG MOBILE GLOBAL TO FAST";

class PubgMobileAutoCutoverError extends Error {
    constructor(code, message, details = {}) { super(message); this.name = "PubgMobileAutoCutoverError"; this.code = code; this.details = details; }
}

const clean = value => String(value == null ? "" : value).trim();
const id = value => clean(value?._id || value);
const upper = value => clean(value).toUpperCase();
const sha256 = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const hash64 = value => /^[a-f0-9]{64}$/.test(clean(value).toLowerCase());
const query = (value, session) => session ? value.session(session) : value;
const fail = (condition, code, message, details) => { if (!condition) throw new PubgMobileAutoCutoverError(code, message, details); };
const authoritySnapshot = mapping => {
    const value = mapping?.supplierCostAuthority || {};
    return { amount: value.rawSupplierCost ?? null, currency: upper(value.supplierCurrency), capturedAt: value.capturedAt || null, observedAt: value.observedAt || null, providerProductCode: clean(value.providerProductCode), providerOfferCode: clean(value.providerOfferCode), ingestionRunId: id(value.ingestionRunId), rawSnapshotHash: clean(value.rawSnapshotHash), observedCostHash: clean(value.observedCostHash), verificationMode: upper(value.verificationMode) };
};

function createPubgMobileAutoCutoverService(dependencies = {}) {
    const M = {
        Admin: dependencies.Admin || AdminAccount,
        Audit: dependencies.Audit || AdminAuditLog,
        Package: dependencies.Package || CatalogPackage,
        Attempt: dependencies.Attempt || FulfillmentAttempt,
        PackageSelection: dependencies.PackageSelection || PackageSupplierSelection,
        StoreSelection: dependencies.StoreSelection || StoreCatalogSelection,
        Supplier: dependencies.Supplier || Supplier,
        Run: dependencies.Run || SupplierCatalogIngestionRun,
        Offer: dependencies.Offer || SupplierCatalogOffer,
        Availability: dependencies.Availability || SupplierOfferAvailability,
        Mapping: dependencies.Mapping || SupplierProductMapping
    };
    const connection = dependencies.connection || mongoose.connection;
    const clock = dependencies.clock || (() => new Date());
    const env = dependencies.env || process.env;
    const adapterResolver = dependencies.adapterResolver || getSupplierAdapter;

    async function assertOwner(actor, session) {
        const admin = await query(M.Admin.findById(actor.adminId), session).lean();
        fail(admin && admin.status === "ACTIVE" && upper(admin.role) === "OWNER" && clean(admin.usernameNormalized) === clean(actor.username).toLowerCase(), "OWNER_NOT_AUTHORIZED", "The confirming OWNER account is not active or does not match the supplied identity.");
        return admin;
    }

    async function loadState({ session = null } = {}) {
        const supplier = await query(M.Supplier.findOne({ supplierCode: "FAZERCARDS" }), session).lean();
        fail(supplier?.enabled === true && upper(supplier.mode) === "API", "SUPPLIER_NOT_READY", "Enabled API FazerCards supplier is required.");
        const packageCodes = PACKAGE_MIGRATIONS.map(item => item.packageCode);
        const [packages, mappings, storeSelection, packageSelections] = await Promise.all([
            query(M.Package.find({ productCode: PRODUCT_CODE, packageCode: { $in: packageCodes }, deletedAt: null }), session).lean(),
            query(M.Mapping.find({ supplierId: supplier._id, productCode: PRODUCT_CODE, packageCode: { $in: packageCodes }, supplierProductCode: { $in: [SOURCE_PRODUCT_CODE, TARGET_PRODUCT_CODE] }, region: "GLOBAL", archivedAt: null }), session).lean(),
            query(M.StoreSelection.findOne({ supplierId: supplier._id, productCode: PRODUCT_CODE, supplierMarket: "GLOBAL", status: "ACTIVE" }), session).lean(),
            query(M.PackageSelection.find({ productCode: PRODUCT_CODE, packageCode: { $in: packageCodes }, customerMarket: "GLOBAL" }), session).lean()
        ]);
        const sourceMappings = mappings.filter(value => clean(value.supplierProductCode) === SOURCE_PRODUCT_CODE);
        const targetMappings = mappings.filter(value => clean(value.supplierProductCode) === TARGET_PRODUCT_CODE);
        fail(packages.length === 6 && sourceMappings.length === 6 && targetMappings.length === 6, "MIGRATION_SET_INCOMPLETE", "Exact six-package source, target, and canonical sets are required.");
        fail(storeSelection && (storeSelection.packages || []).length === 6 && packageSelections.length === 6, "SELECTION_SET_INCOMPLETE", "Store Catalog and six GLOBAL checkout selections are required.");
        const targetOffers = await query(M.Offer.find({ _id: { $in: targetMappings.map(value => value.supplierCatalogOfferId) } }), session).lean();
        const sourceOffers = await query(M.Offer.find({ _id: { $in: sourceMappings.map(value => value.supplierCatalogOfferId) } }), session).lean();
        const allOffers = [...targetOffers, ...sourceOffers];
        const availability = await query(M.Availability.find({ supplierCatalogOfferId: { $in: allOffers.map(value => value._id) } }), session).lean();
        const runIds = [...new Set(availability.map(value => id(value.observationRunId)).filter(Boolean))];
        const runs = await query(M.Run.find({ _id: { $in: runIds } }), session).lean();
        const successfulAttempts = await query(M.Attempt.find({ supplierMappingId: { $in: targetMappings.map(value => value._id) }, status: "SUCCEEDED", supplierReference: { $ne: "" } }), session).lean();
        return { supplier, packages, mappings, sourceMappings, targetMappings, storeSelection, packageSelections, targetOffers, sourceOffers, availability, runs, successfulAttempts };
    }

    function exactRows(state) {
        return PACKAGE_MIGRATIONS.map(expected => {
            const pkg = state.packages.find(value => upper(value.packageCode) === expected.packageCode);
            const source = state.sourceMappings.find(value => upper(value.packageCode) === expected.packageCode && clean(value.supplierPackageCode) === expected.offerCode);
            const target = state.targetMappings.find(value => upper(value.packageCode) === expected.packageCode && clean(value.supplierPackageCode) === expected.offerCode);
            const targetOffer = state.targetOffers.find(value => id(value) === id(target?.supplierCatalogOfferId));
            const sourceOffer = state.sourceOffers.find(value => id(value) === id(source?.supplierCatalogOfferId));
            const targetAvailability = state.availability.find(value => id(value.supplierCatalogOfferId) === id(targetOffer));
            const sourceAvailability = state.availability.find(value => id(value.supplierCatalogOfferId) === id(sourceOffer));
            const packageSelection = state.packageSelections.find(value => upper(value.packageCode) === expected.packageCode);
            fail(pkg && source && target && targetOffer && targetAvailability && packageSelection, "PACKAGE_EVIDENCE_INCOMPLETE", `Incomplete cutover evidence for ${expected.packageCode}.`);
            return { expected, pkg, source, target, targetOffer, sourceOffer, targetAvailability, sourceAvailability, packageSelection };
        });
    }

    function assertRun(run, supplier, expectedId, now) {
        const completedAt = new Date(run?.completedAt);
        fail(run && id(run) === id(expectedId) && id(run.supplierId) === id(supplier) && upper(run.catalogNamespace) === NAMESPACE && run.status === "SUCCEEDED_COMPLETE" && run.coverageState === "COMPLETE" && Number.isFinite(completedAt.getTime()) && completedAt <= now, "INGESTION_RUN_INVALID", "Exact completed supplier ingestion evidence is required.");
    }

    function assertCurrentEvidence(row, state, now, maximumObservationAgeMs, { source = false } = {}) {
        const mapping = source ? row.source : row.target;
        const offer = source ? row.sourceOffer : row.targetOffer;
        const availability = source ? row.sourceAvailability : row.targetAvailability;
        fail(offer && availability, "OFFER_EVIDENCE_MISSING", `Offer evidence is missing for ${row.expected.packageCode}.`);
        fail(id(offer.supplierId) === id(state.supplier) && clean(offer.supplierProductCode) === clean(mapping.supplierProductCode) && clean(offer.supplierOfferCode) === clean(mapping.supplierPackageCode) && upper(offer.catalogLifecycleState) === "ACTIVE", "OFFER_IDENTITY_CONFLICT", `Exact active offer changed for ${row.expected.packageCode}.`);
        const observedAt = new Date(availability.observedAt), costObservedAt = new Date(offer.supplierCost?.observedAt);
        fail(availability.state === "AVAILABLE" && availability.coverageComplete === true && !availability.staleAt && Number.isFinite(observedAt.getTime()) && now - observedAt <= maximumObservationAgeMs && now >= observedAt, "AVAILABILITY_NOT_CURRENT", `Fresh AVAILABLE evidence is required for ${row.expected.packageCode}.`);
        fail(Number(offer.supplierCost?.amount) > 0 && upper(offer.supplierCost?.currency) === "USD" && Number.isFinite(costObservedAt.getTime()) && now - costObservedAt <= maximumObservationAgeMs && now >= costObservedAt, "OFFER_COST_NOT_CURRENT", `Fresh USD cost evidence is required for ${row.expected.packageCode}.`);
        const run = state.runs.find(value => id(value) === id(availability.observationRunId));
        assertRun(run, state.supplier, availability.observationRunId, now);
        const authority = authoritySnapshot(mapping);
        fail(authority.amount === Number(offer.supplierCost.amount) && authority.currency === "USD" && authority.providerProductCode === mapping.supplierProductCode && authority.providerOfferCode === mapping.supplierPackageCode && authority.ingestionRunId === id(run) && authority.verificationMode === "AUTOMATIC_VERIFIED_API" && authority.rawSnapshotHash === clean(offer.rawSnapshotHash) && authority.observedCostHash === observedCostHash(offer) && hash64(authority.rawSnapshotHash) && hash64(authority.observedCostHash), "COST_AUTHORITY_INVALID", `Verified exact current cost authority is required for ${row.expected.packageCode}.`);
        const authorityAt = new Date(authority.observedAt || authority.capturedAt);
        fail(Number.isFinite(authorityAt.getTime()) && now - authorityAt <= maximumObservationAgeMs && now >= authorityAt, "COST_AUTHORITY_STALE", `Fresh cost authority is required for ${row.expected.packageCode}.`);
        fail(authority.observedAt && new Date(authority.observedAt).getTime() === costObservedAt.getTime() && costObservedAt <= new Date(run.completedAt), "COST_EVIDENCE_TIME_MISMATCH", `Cost authority is not correlated to the completed run for ${row.expected.packageCode}.`);
        return run;
    }

    function assertProviderReady(row, state, adapter) {
        const readiness = row.target.mappingMetadata?.readiness || {};
        fail(readiness.supplierMapped === true && readiness.pricingReady === true && readiness.inputReady === true && readiness.validationReady === true && readiness.fulfillmentReady === true, "TARGET_READINESS_INCOMPLETE", `Target readiness is incomplete for ${row.expected.packageCode}.`);
        const contract = verifiedMappingContract(row.target);
        fail(contract && contract.supplierProductCode === TARGET_PRODUCT_CODE && contract.fields?.length === 1 && contract.fields[0].customerField === "playerId" && contract.fields[0].providerField === "player_id", "TARGET_CONTRACT_INVALID", `Exact player_id contract is required for ${row.expected.packageCode}.`);
        const simulated = { ...row.target, enabled: true, productionRole: "PRIMARY" };
        const assessment = assessMappingReadiness({ mode: READINESS_MODES.NEW_ORDER_SELECTABLE, mapping: simulated, supplier: state.supplier, offer: row.targetOffer, availability: row.targetAvailability, customerMarket: "TH", adapter });
        fail(assessment.ready, "TARGET_NOT_SELECTABLE", `Target route is not selectable for ${row.expected.packageCode}.`, { blockers: assessment.blockers });
        const controlled = state.successfulAttempts.find(value => id(value.supplierMappingId) === id(row.target) && clean(value.supplierRequest?.categoryId) === TARGET_PRODUCT_CODE && clean(value.supplierRequest?.offerId) === row.expected.offerCode && clean(value.supplierRequest?.inputContractFingerprint) === clean(contract.fingerprint) && Object.hasOwn(value.supplierRequest?.fields || {}, "player_id"));
        fail(controlled, "CONTROLLED_FULFILLMENT_REQUIRED", `A successful exact-contract controlled fulfillment attempt is required for ${row.expected.packageCode}.`);
    }

    function stateMode(rows, state) {
        const selectedStoreMapping = packageCode => (state.storeSelection.packages || []).find(value => upper(value.packageCode) === packageCode)?.supplierProductMappingId;
        const source = rows.every(row => row.source.enabled === true && upper(row.source.productionRole) === "PRIMARY" && upper(row.target.productionRole) === "DISABLED" && id(selectedStoreMapping(row.expected.packageCode)) === id(row.source) && id(row.packageSelection.supplierMappingId) === id(row.source));
        const target = rows.every(row => row.target.enabled === true && upper(row.target.productionRole) === "PRIMARY" && upper(row.source.productionRole) === "DISABLED" && id(selectedStoreMapping(row.expected.packageCode)) === id(row.target) && id(row.packageSelection.supplierMappingId) === id(row.target));
        if (source) return "SOURCE_ACTIVE";
        if (target) return "TARGET_ACTIVE";
        return "CONFLICT";
    }

    async function preflight({ maximumObservationAgeMs = 24 * 60 * 60 * 1000 } = {}, { session = null } = {}) {
        fail(Number.isFinite(Number(maximumObservationAgeMs)) && Number(maximumObservationAgeMs) > 0 && Number(maximumObservationAgeMs) <= 24 * 60 * 60 * 1000, "OBSERVATION_AGE_INVALID", "Observation age must be positive and cannot exceed 24 hours.");
        const state = await loadState({ session }), rows = exactRows(state), now = clock();
        const mode = stateMode(rows, state);
        fail(mode !== "CONFLICT", "CUTOVER_STATE_CONFLICT", "Mapping roles and selection authorities are inconsistent.");
        const adapter = adapterResolver(state.supplier);
        fail(adapter?.isConfigured?.() === true && adapter?.isAutoFulfillmentEnabled?.(PRODUCT_CODE) === true, "PROVIDER_NOT_READY", "Configured enabled FazerCards automatic fulfillment is required.");
        const prices = rows.map(row => ({ packageCode: row.expected.packageCode, TH: row.pkg.prices?.TH?.amount, MM: row.pkg.prices?.MM?.amount }));
        fail(rows.every(row => row.pkg.enabled === true && row.pkg.prices?.TH?.enabled === true && Number(row.pkg.prices.TH.amount) > 0 && row.pkg.prices?.MM?.enabled === true && Number(row.pkg.prices.MM.amount) > 0), "CUSTOMER_PRICE_INVALID", "Published THB and MMK prices are required for all six packages.");
        const targetRuns = rows.map(row => assertCurrentEvidence(row, state, now, maximumObservationAgeMs));
        fail(new Set(targetRuns.map(id)).size === 1, "TARGET_RUN_MISMATCH", "All target evidence must use one completed ingestion run.");
        rows.forEach(row => assertProviderReady(row, state, adapter));
        const manifest = { schemaVersion: 1, operation: CUTOVER_OPERATION, productCode: PRODUCT_CODE, supplierId: id(state.supplier), mode, storeSelection: { id: id(state.storeSelection), decisionVersion: Number(state.storeSelection.decisionVersion), updatedAt: new Date(state.storeSelection.updatedAt).toISOString() }, prices, rows: rows.map(row => ({ packageCode: row.expected.packageCode, source: { id: id(row.source), updatedAt: new Date(row.source.updatedAt).toISOString(), version: Number(row.source.__v || 0) }, target: { id: id(row.target), updatedAt: new Date(row.target.updatedAt).toISOString(), version: Number(row.target.__v || 0), authority: authoritySnapshot(row.target), offerHash: row.targetOffer.rawSnapshotHash, availabilityObservedAt: new Date(row.targetAvailability.observedAt).toISOString() }, packageSelection: { id: id(row.packageSelection), decisionVersion: Number(row.packageSelection.decisionVersion), updatedAt: new Date(row.packageSelection.updatedAt).toISOString() } })) };
        return { state: mode === "TARGET_ACTIVE" ? "CUTOVER_COMPLETE" : "READY", planHash: sha256(manifest), manifest, ...state, rows };
    }

    async function verifyPostCutover({ planHash = "" } = {}, { session = null } = {}) {
        const state = await loadState({ session }), rows = exactRows(state);
        fail(stateMode(rows, state) === "TARGET_ACTIVE", "POST_CUTOVER_STATE_INVALID", "Target mappings are not the sole selected PRIMARY routes.");
        const primaryCounts = await Promise.all(rows.map(row => query(M.Mapping.countDocuments({ productCode: PRODUCT_CODE, packageCode: row.expected.packageCode, region: "GLOBAL", productionRole: "PRIMARY", archivedAt: null }), session)));
        fail(primaryCounts.every(value => value === 1), "PRIMARY_CARDINALITY_INVALID", "Each package must have exactly one PRIMARY mapping.");
        const audit = await query(M.Audit.findOne({ action: CUTOVER_OPERATION, "metadata.planHash": clean(planHash) }), session).lean();
        fail(audit, "CUTOVER_AUDIT_MISSING", "Mandatory cutover audit is missing.");
        const currentPrices = rows.map(row => ({ packageCode: row.expected.packageCode, TH: row.pkg.prices?.TH?.amount, MM: row.pkg.prices?.MM?.amount }));
        fail(canonicalJson(currentPrices) === canonicalJson(audit.metadata?.prices), "SELLING_PRICE_CHANGED", "Customer selling prices changed after cutover.");
        fail(canonicalJson(rows.map(row => id(row.source))) === canonicalJson(audit.metadata?.sourceMappingIds) && canonicalJson(rows.map(row => id(row.target))) === canonicalJson(audit.metadata?.targetMappingIds), "CUTOVER_AUDIT_INVALID", "Cutover audit mapping identities do not match current canonical rows.");
        return { verified: true, primaryCounts, auditId: id(audit), targetMappingIds: rows.map(row => id(row.target)), sourceMappingIds: rows.map(row => id(row.source)) };
    }

    async function cutover(input = {}, actor = {}) {
        fail(env.PUBG_MOBILE_AUTO_CUTOVER_ENABLED === "true", "CUTOVER_GATE_DISABLED", "The cutover mutation gate is disabled.");
        fail(input.confirmed === true && clean(input.confirmation) === CUTOVER_CONFIRMATION, "CUTOVER_CONFIRMATION_REQUIRED", "Exact OWNER cutover confirmation is required.");
        fail(hash64(input.planHash), "CUTOVER_PLAN_HASH_INVALID", "Reviewed cutover plan hash is required.");
        fail(mongoose.Types.ObjectId.isValid(actor.adminId) && upper(actor.role) === "OWNER" && clean(actor.username), "OWNER_REQUIRED", "Authenticated OWNER identity is required.");
        const session = await connection.startSession(); let result;
        try {
            await session.withTransaction(async () => {
                await assertOwner(actor, session);
                const state = await preflight({ maximumObservationAgeMs: input.maximumObservationAgeMs }, { session });
                if (state.state === "CUTOVER_COMPLETE") { const verified = await verifyPostCutover({ planHash: clean(input.planHash) }, { session }); result = { applied: false, idempotentReplay: true, planHash: clean(input.planHash), ...verified }; return; }
                fail(state.planHash === clean(input.planHash), "CUTOVER_PLAN_CHANGED", "Cutover evidence changed after review.");
                for (const row of state.rows) {
                    const demoted = await M.Mapping.updateOne({ _id: row.source._id, updatedAt: row.source.updatedAt, productionRole: "PRIMARY", enabled: true }, { $set: { productionRole: "DISABLED", "mappingMetadata.migration.cutoverOperation": CUTOVER_OPERATION, "mappingMetadata.migration.cutoverPlanHash": state.planHash } }, { session, runValidators: true });
                    fail(demoted.modifiedCount === 1, "SOURCE_MAPPING_CONCURRENT_CHANGE", `Source mapping changed for ${row.expected.packageCode}.`);
                }
                for (const row of state.rows) {
                    const promoted = await M.Mapping.updateOne({ _id: row.target._id, updatedAt: row.target.updatedAt, productionRole: "DISABLED", enabled: false }, { $set: { enabled: true, productionRole: "PRIMARY", "mappingMetadata.readiness.storefrontReady": true, "mappingMetadata.migration.cutoverOperation": CUTOVER_OPERATION, "mappingMetadata.migration.cutoverPlanHash": state.planHash } }, { session, runValidators: true });
                    fail(promoted.modifiedCount === 1, "TARGET_MAPPING_CONCURRENT_CHANGE", `Target mapping changed for ${row.expected.packageCode}.`);
                    const selection = await M.PackageSelection.updateOne({ _id: row.packageSelection._id, supplierMappingId: row.source._id, decisionVersion: row.packageSelection.decisionVersion, updatedAt: row.packageSelection.updatedAt }, { $set: { supplierMappingId: row.target._id, selectedByAdminId: actor.adminId, selectedByUsernameSnapshot: clean(actor.username), selectedAt: clock(), reason: "OWNER approved PUBG Mobile Global future-order cutover to pubg_mobile_auto" }, $inc: { decisionVersion: 1 } }, { session, runValidators: true });
                    fail(selection.modifiedCount === 1, "PACKAGE_SELECTION_CONCURRENT_CHANGE", `Checkout selection changed for ${row.expected.packageCode}.`);
                }
                const targetByPackage = new Map(state.rows.map(row => [row.expected.packageCode, row.target._id]));
                const storePackages = state.storeSelection.packages.map(value => ({ packageCode: upper(value.packageCode), supplierProductMappingId: targetByPackage.get(upper(value.packageCode)) }));
                const store = await M.StoreSelection.updateOne({ _id: state.storeSelection._id, decisionVersion: state.storeSelection.decisionVersion, updatedAt: state.storeSelection.updatedAt }, { $set: { packages: storePackages, selectedBy: clean(actor.username), selectedAt: clock(), provenance: { source: CUTOVER_OPERATION, sourceHash: sha256(state.manifest), planHash: state.planHash, reversible: true } }, $inc: { decisionVersion: 1 } }, { session, runValidators: true });
                fail(store.modifiedCount === 1, "STORE_SELECTION_CONCURRENT_CHANGE", "Store Catalog selection changed during cutover.");
                await M.Audit.create([{ actorAdminId: actor.adminId, actorUsernameSnapshot: clean(actor.username), actorRoleSnapshot: "OWNER", action: CUTOVER_OPERATION, resourceType: "StoreCatalogSelection", resourceId: id(state.storeSelection), requestId: clean(input.requestId), method: "SCRIPT", route: "cutover-pubg-mobile-auto-migration", metadata: { planHash: state.planHash, sourceMappingIds: state.rows.map(row => id(row.source)), targetMappingIds: state.rows.map(row => id(row.target)), prices: state.manifest.prices, storeSelectionDecisionVersionBefore: state.storeSelection.decisionVersion, packageSelectionDecisionVersionsBefore: state.rows.map(row => ({ id: id(row.packageSelection), version: row.packageSelection.decisionVersion })), futureOrdersOnly: true, canonicalChanges: 0, sellingPriceChanges: 0, historicalOrderChanges: 0, fulfillmentAttemptChanges: 0 } }], { session, ordered: true });
                const verified = await verifyPostCutover({ planHash: state.planHash }, { session });
                result = { applied: true, idempotentReplay: false, planHash: state.planHash, ...verified };
            }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
        } finally { await session.endSession(); }
        return result;
    }

    async function rollbackPreflight({ cutoverPlanHash, maximumObservationAgeMs = 24 * 60 * 60 * 1000 } = {}, { session = null } = {}) {
        fail(Number.isFinite(Number(maximumObservationAgeMs)) && Number(maximumObservationAgeMs) > 0 && Number(maximumObservationAgeMs) <= 24 * 60 * 60 * 1000, "OBSERVATION_AGE_INVALID", "Observation age must be positive and cannot exceed 24 hours.");
        fail(hash64(cutoverPlanHash), "CUTOVER_PLAN_HASH_INVALID", "Original cutover plan hash is required.");
        const state = await loadState({ session }), rows = exactRows(state), now = clock();
        const mode = stateMode(rows, state);
        const cutoverAudit = await query(M.Audit.findOne({ action: CUTOVER_OPERATION, "metadata.planHash": cutoverPlanHash }), session).lean();
        fail(cutoverAudit, "CUTOVER_AUDIT_MISSING", "Original cutover audit is required.");
        if (mode === "SOURCE_ACTIVE") {
            const rollbackAudit = await query(M.Audit.findOne({ action: ROLLBACK_OPERATION, "metadata.cutoverPlanHash": cutoverPlanHash }), session).lean();
            fail(rollbackAudit && hash64(rollbackAudit.metadata?.planHash), "ROLLBACK_STATE_INVALID", "Source is active without a matching completed rollback audit.");
            return { state: "ROLLBACK_COMPLETE", planHash: rollbackAudit.metadata.planHash, cutoverAudit, rollbackAudit, ...state, rows };
        }
        fail(mode === "TARGET_ACTIVE", "ROLLBACK_STATE_INVALID", "Rollback requires the completed target-active cutover state.");
        const adapter = adapterResolver(state.supplier);
        fail(adapter?.isConfigured?.() === true && adapter?.isAutoFulfillmentEnabled?.(PRODUCT_CODE) === true, "PROVIDER_NOT_READY", "Configured enabled provider is required for rollback.");
        rows.forEach(row => { assertCurrentEvidence(row, state, now, maximumObservationAgeMs, { source: true }); const readiness = row.source.mappingMetadata?.readiness || {}; fail(readiness.supplierMapped && readiness.pricingReady && readiness.inputReady && readiness.validationReady && readiness.fulfillmentReady && verifiedMappingContract(row.source), "SOURCE_NOT_ROLLBACK_READY", `Source route is not safely executable for ${row.expected.packageCode}.`); });
        const manifest = { schemaVersion: 1, operation: ROLLBACK_OPERATION, cutoverPlanHash, cutoverAuditId: id(cutoverAudit), rows: rows.map(row => ({ packageCode: row.expected.packageCode, sourceId: id(row.source), sourceUpdatedAt: new Date(row.source.updatedAt).toISOString(), targetId: id(row.target), targetUpdatedAt: new Date(row.target.updatedAt).toISOString(), packageSelectionId: id(row.packageSelection), packageSelectionVersion: row.packageSelection.decisionVersion })), storeSelectionId: id(state.storeSelection), storeDecisionVersion: state.storeSelection.decisionVersion };
        return { state: "READY", planHash: sha256(manifest), manifest, cutoverAudit, ...state, rows };
    }

    async function rollback(input = {}, actor = {}) {
        fail(env.PUBG_MOBILE_AUTO_ROLLBACK_ENABLED === "true", "ROLLBACK_GATE_DISABLED", "The rollback mutation gate is disabled.");
        fail(input.confirmed === true && clean(input.confirmation) === ROLLBACK_CONFIRMATION, "ROLLBACK_CONFIRMATION_REQUIRED", "Exact OWNER rollback confirmation is required.");
        fail(hash64(input.planHash) && hash64(input.cutoverPlanHash), "ROLLBACK_PLAN_HASH_INVALID", "Reviewed rollback and cutover plan hashes are required.");
        fail(mongoose.Types.ObjectId.isValid(actor.adminId) && upper(actor.role) === "OWNER" && clean(actor.username), "OWNER_REQUIRED", "Authenticated OWNER identity is required.");
        const session = await connection.startSession(); let result;
        try {
            await session.withTransaction(async () => {
                await assertOwner(actor, session);
                const state = await rollbackPreflight({ cutoverPlanHash: input.cutoverPlanHash, maximumObservationAgeMs: input.maximumObservationAgeMs }, { session });
                if (state.state === "ROLLBACK_COMPLETE") {
                    fail(state.planHash === input.planHash, "ROLLBACK_PLAN_CHANGED", "Rollback plan hash does not match the completed rollback audit.");
                    result = { applied: false, idempotentReplay: true, planHash: state.planHash, cutoverPlanHash: input.cutoverPlanHash, auditId: id(state.rollbackAudit) };
                    return;
                }
                fail(state.planHash === input.planHash, "ROLLBACK_PLAN_CHANGED", "Rollback evidence changed after review.");
                for (const row of state.rows) {
                    const demoted = await M.Mapping.updateOne({ _id: row.target._id, updatedAt: row.target.updatedAt, productionRole: "PRIMARY", enabled: true }, { $set: { productionRole: "DISABLED", "mappingMetadata.readiness.storefrontReady": false, "mappingMetadata.migration.rollbackOperation": ROLLBACK_OPERATION, "mappingMetadata.migration.rollbackPlanHash": state.planHash } }, { session, runValidators: true });
                    fail(demoted.modifiedCount === 1, "TARGET_MAPPING_CONCURRENT_CHANGE", `Target mapping changed for ${row.expected.packageCode}.`);
                }
                for (const row of state.rows) {
                    const promoted = await M.Mapping.updateOne({ _id: row.source._id, updatedAt: row.source.updatedAt, productionRole: "DISABLED", enabled: true }, { $set: { productionRole: "PRIMARY", "mappingMetadata.migration.rollbackOperation": ROLLBACK_OPERATION, "mappingMetadata.migration.rollbackPlanHash": state.planHash } }, { session, runValidators: true });
                    fail(promoted.modifiedCount === 1, "SOURCE_MAPPING_CONCURRENT_CHANGE", `Source mapping changed for ${row.expected.packageCode}.`);
                    const selection = await M.PackageSelection.updateOne({ _id: row.packageSelection._id, supplierMappingId: row.target._id, decisionVersion: row.packageSelection.decisionVersion, updatedAt: row.packageSelection.updatedAt }, { $set: { supplierMappingId: row.source._id, selectedByAdminId: actor.adminId, selectedByUsernameSnapshot: clean(actor.username), selectedAt: clock(), reason: "OWNER approved rollback to verified pubg_mobile_fast route" }, $inc: { decisionVersion: 1 } }, { session, runValidators: true });
                    fail(selection.modifiedCount === 1, "PACKAGE_SELECTION_CONCURRENT_CHANGE", `Checkout selection changed for ${row.expected.packageCode}.`);
                }
                const sourceByPackage = new Map(state.rows.map(row => [row.expected.packageCode, row.source._id]));
                const storePackages = state.storeSelection.packages.map(value => ({ packageCode: upper(value.packageCode), supplierProductMappingId: sourceByPackage.get(upper(value.packageCode)) }));
                const store = await M.StoreSelection.updateOne({ _id: state.storeSelection._id, decisionVersion: state.storeSelection.decisionVersion, updatedAt: state.storeSelection.updatedAt }, { $set: { packages: storePackages, selectedBy: clean(actor.username), selectedAt: clock(), provenance: { source: ROLLBACK_OPERATION, sourceHash: sha256(state.manifest), planHash: state.planHash, reversible: true } }, $inc: { decisionVersion: 1 } }, { session, runValidators: true });
                fail(store.modifiedCount === 1, "STORE_SELECTION_CONCURRENT_CHANGE", "Store selection changed during rollback.");
                await M.Audit.create([{ actorAdminId: actor.adminId, actorUsernameSnapshot: clean(actor.username), actorRoleSnapshot: "OWNER", action: ROLLBACK_OPERATION, resourceType: "StoreCatalogSelection", resourceId: id(state.storeSelection), requestId: clean(input.requestId), method: "SCRIPT", route: "cutover-pubg-mobile-auto-migration", metadata: { planHash: state.planHash, cutoverPlanHash: input.cutoverPlanHash, sourceMappingIds: state.rows.map(row => id(row.source)), targetMappingIds: state.rows.map(row => id(row.target)), futureOrdersOnly: true, historicalOrderChanges: 0, fulfillmentAttemptChanges: 0, sellingPriceChanges: 0 } }], { session, ordered: true });
                result = { applied: true, planHash: state.planHash, cutoverPlanHash: input.cutoverPlanHash };
            }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
        } finally { await session.endSession(); }
        return result;
    }

    return Object.freeze({ preflight, cutover, verifyPostCutover, rollbackPreflight, rollback });
}

module.exports = Object.freeze({ CUTOVER_OPERATION, CUTOVER_CONFIRMATION, ROLLBACK_OPERATION, ROLLBACK_CONFIRMATION, PubgMobileAutoCutoverError, createPubgMobileAutoCutoverService });
