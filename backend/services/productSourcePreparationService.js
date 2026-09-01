"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const Offer = require("../models/SupplierCatalogOffer");
const CatalogPackage = require("../models/CatalogPackage");
const AdminAuditLog = require("../models/AdminAuditLog");
const { canonicalJson } = require("./supplierCatalog/supplierCatalogNormalization");

const ACTIONS = Object.freeze({ PLANNED: "PRODUCT_SOURCE_PREPARATION_PLANNED", PREPARED: "PRODUCT_SOURCE_PREPARED" });
const clean = value => String(value == null ? "" : value).trim();
const lower = value => clean(value).toLowerCase();
const upper = value => clean(value).toUpperCase();
const id = value => clean(value?._id || value);
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");

class ProductSourcePreparationError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message); this.name = "ProductSourcePreparationError"; this.code = code; this.statusCode = statusCode; this.details = details;
    }
}

function normalizeSelection(input = {}) {
    const mappingIds = [...new Set((input.selectedMappingIds || input.mappingIds || []).map(clean).filter(Boolean))].sort();
    const selection = {
        productCode: lower(input.productCode), supplierId: clean(input.supplierId), supplierCode: upper(input.supplierCode),
        supplierMarket: upper(input.supplierMarket), customerMarket: upper(input.customerMarket || "TH"), selectedMappingIds: mappingIds
    };
    if (!selection.productCode || !selection.supplierId || !selection.supplierMarket || !mappingIds.length) {
        throw new ProductSourcePreparationError("ACTIVATION_SELECTION_INCOMPLETE", "Product, supplier, exact supplier market, and selected packages are required.");
    }
    return selection;
}

function mappingState(mapping) {
    return {
        mappingId: id(mapping), updatedAt: mapping.updatedAt ? new Date(mapping.updatedAt).toISOString() : null,
        supplierId: id(mapping.supplierId), supplierCode: upper(mapping.supplierCode), productCode: lower(mapping.productCode),
        packageCode: upper(mapping.packageCode), supplierProductCode: clean(mapping.supplierProductCode),
        supplierPackageCode: clean(mapping.supplierPackageCode), supplierCatalogOfferId: id(mapping.supplierCatalogOfferId),
        supplierMarket: upper(mapping.region), enabled: mapping.enabled === true,
        productionRole: clean(mapping.productionRole) || null, executionMode: upper(mapping.executionMode), archivedAt: mapping.archivedAt || null
    };
}

function structuralBlockers({ mapping, supplier, offer, pkg, selection }) {
    const blockers = [];
    if (!mapping) return ["MAPPING_NOT_FOUND"];
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (lower(mapping.productCode) !== selection.productCode) blockers.push("PRODUCT_SCOPE_MISMATCH");
    if (id(mapping.supplierId) !== selection.supplierId) blockers.push("SUPPLIER_SCOPE_MISMATCH");
    if (upper(mapping.region) !== selection.supplierMarket) blockers.push("SUPPLIER_MARKET_SCOPE_MISMATCH");
    if (!supplier || supplier.enabled !== true) blockers.push("SUPPLIER_NOT_ENABLED");
    else if (upper(mapping.supplierCode) !== upper(supplier.supplierCode) || (selection.supplierCode && selection.supplierCode !== upper(supplier.supplierCode))) blockers.push("SUPPLIER_IDENTITY_MISMATCH");
    if (!clean(mapping.supplierProductCode) || !clean(mapping.supplierPackageCode)) blockers.push("SUPPLIER_SKU_MISSING");
    if (!pkg || pkg.deletedAt) blockers.push("CANONICAL_PACKAGE_MISSING");
    if (!mapping.supplierCatalogOfferId || !offer) blockers.push("SUPPLIER_OFFER_MISSING");
    else {
        if (id(offer.supplierId) !== id(mapping.supplierId)) blockers.push("SUPPLIER_OFFER_SUPPLIER_MISMATCH");
        if (clean(offer.supplierOfferCode) !== clean(mapping.supplierPackageCode)) blockers.push("SUPPLIER_OFFER_SKU_MISMATCH");
    }
    if (!['API', 'MANUAL'].includes(upper(mapping.executionMode))) blockers.push("EXECUTION_MODE_UNSUPPORTED");
    if (mapping.productionRole && !["PRIMARY", "BACKUP", "DISABLED"].includes(upper(mapping.productionRole))) blockers.push("PRODUCTION_ROLE_INVALID");
    return [...new Set(blockers)].sort();
}

function createProductSourcePreparationService(models = {}) {
    const M = { Supplier: models.Supplier || Supplier, Mapping: models.Mapping || Mapping, Offer: models.Offer || Offer, CatalogPackage: models.CatalogPackage || CatalogPackage, Audit: models.Audit || AdminAuditLog };
    const connection = models.connection || mongoose.connection;

    async function generatePlan(input = {}, options = {}) {
        const selection = normalizeSelection(input);
        const query = M.Mapping.find({ _id: { $in: selection.selectedMappingIds } });
        const mappings = await (options.session ? query.session(options.session) : query).lean();
        const byId = new Map(mappings.map(item => [id(item), item]));
        const supplierQuery = M.Supplier.findById(selection.supplierId);
        const supplier = await (options.session ? supplierQuery.session(options.session) : supplierQuery).lean();
        const offerIds = mappings.map(item => item.supplierCatalogOfferId).filter(Boolean);
        const packageKeys = mappings.map(item => ({ productCode: lower(item.productCode), packageCode: upper(item.packageCode) }));
        const offerQuery = M.Offer.find({ _id: { $in: offerIds } });
        const packageQuery = M.CatalogPackage.find({ $or: packageKeys.length ? packageKeys : [{ _id: null }] });
        const [offers, packages] = await Promise.all([
            (options.session ? offerQuery.session(options.session) : offerQuery).lean(),
            (options.session ? packageQuery.session(options.session) : packageQuery).lean()
        ]);
        const offerById = new Map(offers.map(item => [id(item), item]));
        const packageByKey = new Map(packages.map(item => [`${lower(item.productCode)}/${upper(item.packageCode)}`, item]));
        const targets = [], excluded = [], primaryConflicts = [];
        for (const mappingId of selection.selectedMappingIds) {
            const mapping = byId.get(mappingId), offer = mapping ? offerById.get(id(mapping.supplierCatalogOfferId)) : null;
            const pkg = mapping ? packageByKey.get(`${lower(mapping.productCode)}/${upper(mapping.packageCode)}`) : null;
            const blockers = structuralBlockers({ mapping, supplier, offer, pkg, selection });
            if (blockers.length) { excluded.push({ mappingId, packageCode: mapping ? upper(mapping.packageCode) : "", blockers }); continue; }
            const current = mappingState(mapping), proposed = { enabled: true, productionRole: current.productionRole || "DISABLED", executionMode: current.executionMode };
            targets.push({ mappingId, expectedUpdatedAt: current.updatedAt, packageCode: current.packageCode, packageName: pkg.name || pkg.displayName || current.packageCode, supplierCatalogOfferId: current.supplierCatalogOfferId, current: { enabled: current.enabled, productionRole: current.productionRole, executionMode: current.executionMode }, proposed, mutationRequired: current.enabled !== true || current.productionRole == null, reason: "EXPLICIT_PRODUCT_SOURCE_PREPARATION_ONLY" });
        }
        if (targets.length) {
            const primaryQuery = M.Mapping.find({ productCode: selection.productCode, region: selection.supplierMarket, packageCode: { $in: targets.map(item => item.packageCode) }, productionRole: "PRIMARY", archivedAt: null });
            const primaries = await (options.session ? primaryQuery.session(options.session) : primaryQuery).lean();
            primaries.filter(item => !selection.selectedMappingIds.includes(id(item))).forEach(item => primaryConflicts.push({ packageCode: upper(item.packageCode), currentPrimaryMappingId: id(item), currentSupplierCode: upper(item.supplierCode), selectedSupplierCode: upper(supplier?.supplierCode) }));
        }
        const states = selection.selectedMappingIds.map(mappingId => mappingState(byId.get(mappingId) || { _id: mappingId })).sort((a, b) => a.mappingId.localeCompare(b.mappingId));
        const sourceRows = offers.map(item => ({ offerId: id(item), rawSnapshotHash: item.rawSnapshotHash || "", sourceRevision: item.sourceRevision || "" })).sort((a, b) => a.offerId.localeCompare(b.offerId));
        const sourceSetHash = sha(sourceRows), mappingStateHash = sha(states);
        const body = { artifactType: "PRODUCT_ACTIVATION_HANDOFF_PLAN", schemaVersion: 1, selection, summary: { selected: selection.selectedMappingIds.length, validMappings: targets.length, alreadyEnabled: targets.filter(item => item.current.enabled).length, mappingsToEnable: targets.filter(item => !item.current.enabled).length, rolesToNormalize: targets.filter(item => item.current.productionRole == null).length, excludedMappings: excluded.length, conflicts: primaryConflicts.length }, targets, excluded, primaryConflicts, sourceSetHash, mappingStateHash, safety: { primaryAssignments: 0, executionModeWrites: 0, priceWrites: 0, costApprovalWrites: 0, eligibilityWrites: 0, publicationWrites: 0, supplierCalls: 0 } };
        return { ...body, planHash: sha(body) };
    }

    async function applyPlan(plan, { actor = null } = {}) {
        if (upper(actor?.role) !== "OWNER") throw new ProductSourcePreparationError("OWNER_SOURCE_PREPARATION_REQUIRED", "Only the Owner can prepare a production supplier source.", 403);
        const suppliedHash = clean(plan?.planHash), hashBody = { ...plan }; delete hashBody.planHash;
        if (!suppliedHash || sha(hashBody) !== suppliedHash) throw new ProductSourcePreparationError("ACTIVATION_PLAN_HASH_MISMATCH", "The reviewed activation plan hash is invalid.", 409);
        const existing = await M.Audit.findOne({ action: ACTIONS.PREPARED, "metadata.planHash": suppliedHash }).lean();
        if (existing) return { applied: 0, idempotentReplay: true, planHash: suppliedHash };
        const session = await connection.startSession();
        try {
            let result;
            await session.withTransaction(async () => {
                const replay = await M.Audit.findOne({ action: ACTIONS.PREPARED, "metadata.planHash": suppliedHash }).session(session).lean();
                if (replay) { result = { applied: 0, idempotentReplay: true, planHash: suppliedHash }; return; }
                const fresh = await generatePlan(plan.selection, { session });
                if (fresh.mappingStateHash !== plan.mappingStateHash || fresh.sourceSetHash !== plan.sourceSetHash || fresh.planHash !== suppliedHash) {
                    throw new ProductSourcePreparationError("STALE_ACTIVATION_PLAN", "Mapping or supplier catalog state changed after review.", 409);
                }
                let applied = 0;
                for (const target of fresh.targets.filter(item => item.mutationRequired)) {
                    const update = { enabled: true };
                    if (target.current.productionRole == null) update.productionRole = "DISABLED";
                    const write = await M.Mapping.updateOne({ _id: target.mappingId, updatedAt: new Date(target.expectedUpdatedAt), enabled: target.current.enabled, ...(target.current.productionRole == null ? { $or: [{ productionRole: { $exists: false } }, { productionRole: null }, { productionRole: "" }] } : { productionRole: target.current.productionRole }) }, { $set: update }, { session, runValidators: true });
                    if (write.matchedCount !== 1) throw new ProductSourcePreparationError("STALE_ACTIVATION_PLAN", "A selected mapping changed during activation.", 409);
                    applied += write.modifiedCount;
                }
                await M.Audit.create([{ actorAdminId: actor.id || actor._id || null, actorUsernameSnapshot: actor.username || "", actorRoleSnapshot: actor.role || "", action: ACTIONS.PREPARED, resourceType: "ProductSourcePreparation", resourceId: suppliedHash, metadata: { productCode: fresh.selection.productCode, supplierId: fresh.selection.supplierId, supplierCode: fresh.selection.supplierCode, supplierMarket: fresh.selection.supplierMarket, customerMarket: fresh.selection.customerMarket, mappingIds: fresh.targets.map(item => item.mappingId), before: fresh.targets.map(item => ({ mappingId: item.mappingId, ...item.current })), after: fresh.targets.map(item => ({ mappingId: item.mappingId, ...item.proposed })), planHash: suppliedHash } }], { session });
                result = { applied, idempotentReplay: false, planHash: suppliedHash, preparedMappingIds: fresh.targets.map(item => item.mappingId), excluded: fresh.excluded };
            });
            return result;
        } finally { await session.endSession(); }
    }
    return { generatePlan, applyPlan };
}

const service = createProductSourcePreparationService();
module.exports = Object.freeze({ ACTIONS, ProductSourcePreparationError, normalizeSelection, mappingState, structuralBlockers, createProductSourcePreparationService, generatePlan: service.generatePlan, applyPlan: service.applyPlan });
