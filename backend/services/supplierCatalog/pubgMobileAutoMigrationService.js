"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const AdminAuditLog = require("../../models/AdminAuditLog");
const CatalogPackage = require("../../models/CatalogPackage");
const CatalogProduct = require("../../models/CatalogProduct");
const StoreCatalogSelection = require("../../models/StoreCatalogSelection");
const Supplier = require("../../models/Supplier");
const SupplierCatalogIngestionRun = require("../../models/SupplierCatalogIngestionRun");
const SupplierCatalogOffer = require("../../models/SupplierCatalogOffer");
const SupplierCatalogProduct = require("../../models/SupplierCatalogProduct");
const SupplierOfferAvailability = require("../../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const { canonicalJson } = require("./supplierCatalogNormalization");
const { contractFromSupplierCatalog, verifiedMappingContract } = require("../suppliers/fazercardsFulfillmentContractService");

const PRODUCT_CODE = "pubg-mobile-fast-7fbcc7684d";
const SOURCE_PRODUCT_CODE = "pubg_mobile_fast";
const TARGET_PRODUCT_CODE = "pubg_mobile_auto";
const NAMESPACE = "FAZERCARDS_RESELLER_CATALOG";
const OPERATION = "PREPARE_PUBG_MOBILE_AUTO_MIGRATION_V1";
const CONFIRMATION = "PREPARE PUBG MOBILE AUTO MIGRATION";
const PACKAGE_MIGRATIONS = Object.freeze([
    ["PUBG-MOBILE-FAST-7FBCC7684D_60_UC_7A507409811B4ACF", "60_uc", "60 UC"],
    ["PUBG-MOBILE-FAST-7FBCC7684D_325_UC_33EE1FC5DA2AE7B2", "325_uc", "325 UC"],
    ["PUBG-MOBILE-FAST-7FBCC7684D_660_UC_6B93B8B6457232B2", "660_uc", "660 UC"],
    ["PUBG-MOBILE-FAST-7FBCC7684D_1800_UC_79BFED8FD519E627", "1800_uc", "1800 UC"],
    ["PUBG-MOBILE-FAST-7FBCC7684D_3850_UC_E805AC3A50FB3413", "3850_uc", "3850 UC"],
    ["PUBG-MOBILE-FAST-7FBCC7684D_8100_UC_690C8E8C6C356051", "8100_uc", "8100 UC"]
].map(([packageCode, offerCode, name]) => Object.freeze({ packageCode, offerCode, name })));

class PubgMobileAutoMigrationError extends Error {
    constructor(code, message, details = {}) { super(message); this.name = "PubgMobileAutoMigrationError"; this.code = code; this.details = details; }
}

const clean = value => String(value == null ? "" : value).trim();
const id = value => clean(value?._id || value);
const upper = value => clean(value).toUpperCase();
const sha256 = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const query = (value, session) => session ? value.session(session) : value;
const fail = (condition, code, message, details) => { if (!condition) throw new PubgMobileAutoMigrationError(code, message, details); };

function createPubgMobileAutoMigrationService(dependencies = {}) {
    const M = {
        Audit: dependencies.Audit || AdminAuditLog,
        Package: dependencies.Package || CatalogPackage,
        Product: dependencies.Product || CatalogProduct,
        Selection: dependencies.Selection || StoreCatalogSelection,
        Supplier: dependencies.Supplier || Supplier,
        Run: dependencies.Run || SupplierCatalogIngestionRun,
        Offer: dependencies.Offer || SupplierCatalogOffer,
        SupplierProduct: dependencies.SupplierProduct || SupplierCatalogProduct,
        Availability: dependencies.Availability || SupplierOfferAvailability,
        Mapping: dependencies.Mapping || SupplierProductMapping
    };
    const connection = dependencies.connection || mongoose.connection;
    const clock = dependencies.clock || (() => new Date());
    const env = dependencies.env || process.env;

    async function inspect({ maximumObservationAgeMs = 24 * 60 * 60 * 1000 } = {}, { session = null } = {}) {
        const now = clock();
        const supplier = await query(M.Supplier.findOne({ supplierCode: "FAZERCARDS" }), session).lean();
        fail(supplier?.enabled === true, "FAZERCARDS_SUPPLIER_UNAVAILABLE", "Enabled FazerCards supplier authority is required.");
        const [product, packages, sourceMappings, selection, targetProduct, targetOffers] = await Promise.all([
            query(M.Product.findOne({ productCode: PRODUCT_CODE, deletedAt: null }), session).lean(),
            query(M.Package.find({ productCode: PRODUCT_CODE, packageCode: { $in: PACKAGE_MIGRATIONS.map(item => item.packageCode) }, deletedAt: null }), session).lean(),
            query(M.Mapping.find({ supplierId: supplier._id, productCode: PRODUCT_CODE, packageCode: { $in: PACKAGE_MIGRATIONS.map(item => item.packageCode) }, supplierProductCode: SOURCE_PRODUCT_CODE, region: "GLOBAL", archivedAt: null }), session).lean(),
            query(M.Selection.findOne({ supplierId: supplier._id, productCode: PRODUCT_CODE, supplierMarket: "GLOBAL", status: "ACTIVE" }), session).lean(),
            query(M.SupplierProduct.findOne({ supplierId: supplier._id, catalogNamespace: NAMESPACE, supplierProductCode: TARGET_PRODUCT_CODE }), session).lean(),
            query(M.Offer.find({ supplierId: supplier._id, catalogNamespace: NAMESPACE, supplierProductCode: TARGET_PRODUCT_CODE, supplierOfferCode: { $in: PACKAGE_MIGRATIONS.map(item => item.offerCode) } }), session).lean()
        ]);
        fail(product?.enabled === true && product?.commerceState === "PURCHASABLE", "CANONICAL_PRODUCT_CONFLICT", "The customer-facing PUBG Mobile product changed or is unavailable.");
        fail(packages.length === 6, "CANONICAL_PACKAGE_SET_CONFLICT", "All six existing canonical packages are required.");
        fail(sourceMappings.length === 6, "SOURCE_MAPPING_SET_CONFLICT", "All six exact pubg_mobile_fast mappings are required.");
        fail(selection && (selection.packages || []).length === 6, "STORE_SELECTION_CONFLICT", "The active six-package Store Catalog selection is required.");
        fail(targetProduct?.supportState === "SUPPORTED" && upper(targetProduct.supplierMarketCode) === "GLOBAL", "TARGET_PRODUCT_UNSUPPORTED", "pubg_mobile_auto must be a supported Global supplier product.");
        fail(targetOffers.length === 6, "TARGET_OFFER_SET_INCOMPLETE", "All six exact pubg_mobile_auto offers are required.");

        const offerByCode = new Map(targetOffers.map(offer => [clean(offer.supplierOfferCode), offer]));
        const availability = await query(M.Availability.find({ supplierCatalogOfferId: { $in: targetOffers.map(offer => offer._id) } }), session).lean();
        const availabilityByOffer = new Map(availability.map(value => [id(value.supplierCatalogOfferId), value]));
        const runIds = [...new Set(availability.map(value => id(value.observationRunId)).filter(Boolean))];
        fail(runIds.length === 1, "INGESTION_RUN_MISMATCH", "All six availability observations must belong to one ingestion run.");
        const run = await query(M.Run.findById(runIds[0]), session).lean();
        fail(run && id(run.supplierId) === id(supplier) && upper(run.catalogNamespace) === NAMESPACE && run.status === "SUCCEEDED_COMPLETE" && run.coverageState === "COMPLETE" && run.completedAt, "INGESTION_RUN_INVALID", "A completed successful FazerCards ingestion run is required.");

        const rows = PACKAGE_MIGRATIONS.map(expected => {
            const pkg = packages.find(value => upper(value.packageCode) === expected.packageCode);
            const source = sourceMappings.find(value => upper(value.packageCode) === expected.packageCode && clean(value.supplierPackageCode) === expected.offerCode);
            const target = offerByCode.get(expected.offerCode);
            const observed = availabilityByOffer.get(id(target?._id));
            fail(pkg && source && target, "PACKAGE_IDENTITY_CONFLICT", `Exact mapping evidence is missing for ${expected.packageCode}.`);
            fail(source.enabled === true && upper(source.productionRole) === "PRIMARY" && upper(source.executionMode) === "API", "SOURCE_ROUTE_CONFLICT", `The current route changed for ${expected.packageCode}.`);
            fail(target.catalogLifecycleState === "ACTIVE" && target.reconciliationState === "EXACT_CANONICAL_MATCH" && Number(target.supplierCost?.amount) > 0 && upper(target.supplierCost?.currency) === "USD", "TARGET_OFFER_INVALID", `The target offer is not an exact active USD offer for ${expected.packageCode}.`);
            const observedAt = new Date(observed?.observedAt);
            fail(observed?.state === "AVAILABLE" && observed.coverageComplete === true && id(observed.observationRunId) === id(run) && Number.isFinite(observedAt.getTime()) && now - observedAt <= maximumObservationAgeMs && now >= observedAt, "TARGET_AVAILABILITY_INVALID", `Fresh availability is required for ${expected.packageCode}.`);
            const targetMapping = { supplierId: supplier._id, supplierCode: "FAZERCARDS", productCode: PRODUCT_CODE, packageCode: expected.packageCode, supplierProductCode: TARGET_PRODUCT_CODE, supplierPackageCode: expected.offerCode, supplierCatalogOfferId: target._id, region: "GLOBAL", executionMode: "API" };
            const contract = contractFromSupplierCatalog({ mapping: targetMapping, offer: target, supplierProduct: targetProduct, supplierCode: "FAZERCARDS" });
            fail(contract && verifiedMappingContract({ ...targetMapping, mappingMetadata: { fulfillmentContract: contract } }), "FULFILLMENT_CONTRACT_INVALID", `Verified player_id fulfillment contract is required for ${expected.packageCode}.`);
            fail((contract.fields || []).length === 1 && contract.fields[0].customerField === "playerId" && contract.fields[0].providerField === "player_id", "FULFILLMENT_INPUT_CONFLICT", `Unexpected fulfillment input contract for ${expected.packageCode}.`);
            return { expected, pkg, source, target, observed, contract };
        });
        const selectedIds = new Set((selection.packages || []).map(value => id(value.supplierProductMappingId)));
        fail(rows.every(row => selectedIds.has(id(row.source))), "STORE_SELECTION_MAPPING_CONFLICT", "Store Catalog no longer references the six source mappings.");

        const existingTargets = await query(M.Mapping.find({ supplierId: supplier._id, productCode: PRODUCT_CODE, packageCode: { $in: PACKAGE_MIGRATIONS.map(item => item.packageCode) }, supplierProductCode: TARGET_PRODUCT_CODE, region: "GLOBAL", archivedAt: null }), session).lean();
        fail(existingTargets.length === 0 || existingTargets.length === 6, "PARTIAL_PREPARATION_STATE", "A partial target mapping set requires manual recovery.");
        if (existingTargets.length === 6) {
            fail(rows.every(row => existingTargets.some(target => upper(target.packageCode) === row.expected.packageCode && clean(target.supplierPackageCode) === row.expected.offerCode && id(target.supplierCatalogOfferId) === id(row.target) && target.enabled === false && upper(target.productionRole) === "DISABLED" && upper(target.executionMode) === "API" && target.mappingMetadata?.migration?.operation === OPERATION && verifiedMappingContract(target))), "PREPARED_MAPPING_CONFLICT", "The existing prepared mapping set does not match the reviewed migration plan.");
        }
        const manifest = { schemaVersion: 1, operation: OPERATION, productCode: PRODUCT_CODE, supplierId: id(supplier), targetProductId: id(targetProduct), ingestionRunId: id(run), runCompletedAt: new Date(run.completedAt).toISOString(), rows: rows.map(row => ({ packageCode: row.expected.packageCode, sourceMappingId: id(row.source), sourceUpdatedAt: new Date(row.source.updatedAt).toISOString(), sourceVersion: Number(row.source.__v || 0), sourceProductCode: SOURCE_PRODUCT_CODE, sourceOfferCode: row.expected.offerCode, targetOfferId: id(row.target), targetOfferHash: clean(row.target.rawSnapshotHash), targetProductHash: clean(targetProduct.rawSnapshotHash), availabilityObservedAt: new Date(row.observed.observedAt).toISOString(), cost: { amount: Number(row.target.supplierCost.amount), currency: "USD" }, contractFingerprint: row.contract.fingerprint })) };
        return { state: existingTargets.length === 6 ? "PREPARED" : "READY", planHash: sha256(manifest), manifest, supplier, product, packages, selection, targetProduct, run, rows, existingTargets };
    }

    async function prepare(input = {}, actor = {}) {
        fail(env.PUBG_MOBILE_AUTO_MIGRATION_PREPARE_ENABLED === "true", "MIGRATION_GATE_DISABLED", "The migration preparation gate is disabled.");
        fail(input.confirmed === true && clean(input.confirmation) === CONFIRMATION, "CONFIRMATION_REQUIRED", "Exact migration preparation confirmation is required.");
        fail(/^[a-f0-9]{64}$/.test(clean(input.planHash)), "PLAN_HASH_INVALID", "A reviewed plan hash is required.");
        fail(mongoose.Types.ObjectId.isValid(actor.adminId) && upper(actor.role) === "OWNER" && clean(actor.username), "OWNER_REQUIRED", "An authenticated OWNER identity is required.");
        const session = await connection.startSession();
        let output;
        try {
            await session.withTransaction(async () => {
                const state = await inspect({ maximumObservationAgeMs: input.maximumObservationAgeMs }, { session });
                fail(state.planHash === clean(input.planHash), "PLAN_CHANGED", "Supplier or mapping evidence changed after review.");
                if (state.state === "PREPARED") { output = { applied: false, idempotentReplay: true, planHash: state.planHash, mappingIds: state.existingTargets.map(id) }; return; }
                const now = clock();
                const documents = state.rows.map(row => ({ supplierId: state.supplier._id, supplierCode: "FAZERCARDS", productCode: PRODUCT_CODE, packageCode: row.expected.packageCode, supplierProductCode: TARGET_PRODUCT_CODE, supplierPackageCode: row.expected.offerCode, supplierCatalogOfferId: row.target._id, supplierDisplayName: row.expected.name, region: "GLOBAL", supplierMarketEvidence: { normalizedMarket: "GLOBAL", supplierMarketCode: "GLOBAL", marketClassification: "AUTHENTICATED_SUPPLIER_CATALOG", restrictions: state.targetProduct.restrictions || [], evidenceCode: "FAZERCARDS_CURRENT_ORDERABLE_OFFER_CATALOG", sourceProductHash: state.targetProduct.rawSnapshotHash }, enabled: false, productionRole: "DISABLED", archivedAt: null, executionMode: "API", supplierCostAuthority: { rawSupplierCost: null, supplierCurrency: null, capturedAt: null, source: "", providerProductCode: "", providerOfferCode: "", fundingCost: 0, otherAcquisitionCost: 0 }, mappingMetadata: { migration: { operation: OPERATION, planHash: state.planHash, sourceMappingId: id(row.source), preparedAt: now }, readiness: { supplierMapped: true, pricingReady: false, inputReady: true, validationReady: true, fulfillmentReady: false, storefrontReady: false }, fulfillmentContract: row.contract, blocker: "CONTROLLED_FULFILLMENT_VERIFICATION_AND_COST_SYNC_REQUIRED" }, fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: `Authenticated FazerCards catalog ${id(state.run)}`, verifiedAt: row.observed.observedAt, version: 1 } }));
                const created = await M.Mapping.create(documents, { session, ordered: true });
                await M.Audit.create([{ actorAdminId: actor.adminId, actorUsernameSnapshot: clean(actor.username), actorRoleSnapshot: "OWNER", action: OPERATION, resourceType: "CatalogProduct", resourceId: PRODUCT_CODE, requestId: clean(input.requestId), method: "SCRIPT", route: "prepare-pubg-mobile-auto-migration", metadata: { planHash: state.planHash, sourceMappingIds: state.rows.map(row => id(row.source)), preparedMappingIds: created.map(id), ingestionRunId: id(state.run), canonicalProductsChanged: 0, canonicalPackagesChanged: 0, sellingPricesChanged: 0, storeSelectionsChanged: 0, sourceMappingsChanged: 0, commerceOrdersChanged: 0, fulfillmentAttemptsChanged: 0, activationPerformed: false, publicationPerformed: false } }], { session, ordered: true });
                output = { applied: true, idempotentReplay: false, planHash: state.planHash, mappingIds: created.map(id) };
            }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
        } finally { await session.endSession(); }
        return output;
    }

    return Object.freeze({ inspect, prepare });
}

module.exports = Object.freeze({ PRODUCT_CODE, SOURCE_PRODUCT_CODE, TARGET_PRODUCT_CODE, NAMESPACE, OPERATION, CONFIRMATION, PACKAGE_MIGRATIONS, PubgMobileAutoMigrationError, createPubgMobileAutoMigrationService });
