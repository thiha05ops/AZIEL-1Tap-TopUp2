"use strict";

const crypto = require("crypto");

const lower = value => String(value || "").trim().toLowerCase();
const upper = value => String(value || "").trim().toUpperCase();
const objectId = value => String(value?._id || value || "").trim();
const packageKey = (productCode, packageCode) => `${lower(productCode)}:${upper(packageCode)}`;
const marker = plan => `migration:${plan.migrationId};plan:${plan.planHash}`;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

class GlobalSupplierSelectionMigrationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "GlobalSupplierSelectionMigrationError";
        this.code = code;
        this.details = details;
    }
}

function mappingIdentity(mapping = {}) {
    return [objectId(mapping.supplierId), upper(mapping.supplierCode), String(mapping.supplierProductCode || ""), String(mapping.supplierPackageCode || "")].join("|");
}

function validateMapping(mapping, key) {
    const blockers = [];
    if (!mapping) return ["MAPPING_MISSING"];
    if (packageKey(mapping.productCode, mapping.packageCode) !== key) blockers.push("CANONICAL_SCOPE_MISMATCH");
    if (mapping.enabled !== true) blockers.push("MAPPING_DISABLED");
    if (mapping.archivedAt) blockers.push("MAPPING_ARCHIVED");
    if (upper(mapping.productionRole) === "DISABLED") blockers.push("MAPPING_PRODUCTION_ROLE_DISABLED");
    if (upper(mapping.executionMode) !== "API") blockers.push("MAPPING_NOT_API_EXECUTABLE");
    const mode = upper(mapping.fulfillmentEligibility?.mode);
    const allowed = (mapping.fulfillmentEligibility?.allowedCustomerMarkets || []).map(upper);
    if (mode !== "GLOBAL" && !(mode === "CUSTOMER_MARKET_ALLOWLIST" && ["TH", "MM"].every(value => allowed.includes(value)))) {
        blockers.push("MAPPING_NOT_ELIGIBLE_BOTH_MARKETS");
    }
    return blockers;
}

function buildPlan({ packages = [], selections = [], mappings = [], migrationId, generatedAt = new Date().toISOString() } = {}) {
    if (!migrationId || !/^[A-Za-z0-9._:-]{8,160}$/.test(migrationId)) throw new GlobalSupplierSelectionMigrationError("MIGRATION_ID_INVALID", "A stable audit migrationId is required.");
    const mappingById = new Map(mappings.map(item => [objectId(item), item]));
    const selectionGroups = new Map();
    for (const selection of selections) {
        const key = packageKey(selection.productCode, selection.packageCode);
        if (!selectionGroups.has(key)) selectionGroups.set(key, []);
        selectionGroups.get(key).push(selection);
    }
    const records = [];
    const conflicts = [];
    for (const pkg of packages.filter(item => !item.deletedAt).sort((a, b) => packageKey(a.productCode, a.packageCode).localeCompare(packageKey(b.productCode, b.packageCode)))) {
        const key = packageKey(pkg.productCode, pkg.packageCode);
        const rows = selectionGroups.get(key) || [];
        const global = rows.filter(item => upper(item.customerMarket) === "GLOBAL");
        const th = rows.filter(item => upper(item.customerMarket) === "TH");
        const mm = rows.filter(item => upper(item.customerMarket) === "MM");
        if (global.length) { conflicts.push({ key, code: "GLOBAL_ALREADY_PRESENT", count: global.length }); continue; }
        if (th.length !== 1 || mm.length !== 1) { conflicts.push({ key, code: "LEGACY_PAIR_REQUIRED", thCount: th.length, mmCount: mm.length }); continue; }
        if (objectId(th[0].supplierMappingId) !== objectId(mm[0].supplierMappingId)) {
            const thMapping = mappingById.get(objectId(th[0].supplierMappingId));
            const mmMapping = mappingById.get(objectId(mm[0].supplierMappingId));
            conflicts.push({ key, code: mappingIdentity(thMapping) === mappingIdentity(mmMapping) ? "LEGACY_MAPPING_RECORD_CONFLICT" : "MAPPING_IDENTITY_CONFLICT", thMappingId: objectId(th[0].supplierMappingId), mmMappingId: objectId(mm[0].supplierMappingId) });
            continue;
        }
        const supplierMappingId = objectId(th[0].supplierMappingId);
        const mappingBlockers = validateMapping(mappingById.get(supplierMappingId), key);
        if (mappingBlockers.length) { conflicts.push({ key, code: "INVALID_MAPPING", supplierMappingId, blockers: mappingBlockers }); continue; }
        records.push({
            productCode: lower(pkg.productCode), packageCode: upper(pkg.packageCode), customerMarket: "GLOBAL", supplierMappingId,
            expected: {
                globalAbsent: true,
                thSelectionId: objectId(th[0]), thDecisionVersion: Number(th[0].decisionVersion),
                mmSelectionId: objectId(mm[0]), mmDecisionVersion: Number(mm[0].decisionVersion)
            }
        });
    }
    const plan = { schemaVersion: 1, migrationId, generatedAt, authority: "GLOBAL", records, conflicts };
    plan.planHash = hash(records);
    return plan;
}

function assertReviewedPlan(plan) {
    if (!plan || plan.schemaVersion !== 1 || !plan.migrationId || !Array.isArray(plan.records) || !Array.isArray(plan.conflicts)) throw new GlobalSupplierSelectionMigrationError("PLAN_INVALID", "Reviewed migration plan is invalid.");
    if (plan.conflicts.length) throw new GlobalSupplierSelectionMigrationError("PLAN_HAS_CONFLICTS", "Migration plan contains unresolved conflicts.", { conflicts: plan.conflicts });
    if (plan.planHash !== hash(plan.records)) throw new GlobalSupplierSelectionMigrationError("PLAN_HASH_MISMATCH", "Reviewed migration plan hash does not match its records.");
    const keys = plan.records.map(item => packageKey(item.productCode, item.packageCode));
    if (new Set(keys).size !== keys.length) throw new GlobalSupplierSelectionMigrationError("PLAN_DUPLICATE_PACKAGE", "Migration plan contains duplicate canonical packages.");
}

function selectionDocument(record, plan, now = new Date()) {
    return {
        productCode: record.productCode, packageCode: record.packageCode, customerMarket: "GLOBAL", supplierMappingId: record.supplierMappingId,
        selectedByAdminId: null, selectedByUsernameSnapshot: "GLOBAL_SUPPLIER_MIGRATION", selectedAt: now,
        decisionVersion: 1, reason: marker(plan), createdAt: now, updatedAt: now
    };
}

async function validateCurrentState(store, plan, options = {}) {
    assertReviewedPlan(plan);
    const current = await store.loadState(options);
    const rebuilt = buildPlan({ packages: current.packages, selections: current.selections, mappings: current.mappings, migrationId: plan.migrationId, generatedAt: plan.generatedAt });
    const existingGlobals = current.selections.filter(item => upper(item.customerMarket) === "GLOBAL");
    const ownGlobals = existingGlobals.filter(item => item.reason === marker(plan) && item.selectedByUsernameSnapshot === "GLOBAL_SUPPLIER_MIGRATION" && Number(item.decisionVersion) === 1);
    if (existingGlobals.length) {
        const expected = new Map(plan.records.map(item => [packageKey(item.productCode, item.packageCode), objectId(item.supplierMappingId)]));
        const replaySafe = existingGlobals.length === plan.records.length && ownGlobals.length === plan.records.length && ownGlobals.every(item => expected.get(packageKey(item.productCode, item.packageCode)) === objectId(item.supplierMappingId));
        if (replaySafe) return { state: current, replay: true, existingGlobals };
        throw new GlobalSupplierSelectionMigrationError("GLOBAL_STATE_CONFLICT", "Unexpected GLOBAL selections exist; refusing to continue.", { existingGlobalCount: existingGlobals.length, ownGlobalCount: ownGlobals.length });
    }
    if (rebuilt.conflicts.length || rebuilt.planHash !== plan.planHash) throw new GlobalSupplierSelectionMigrationError("PRECONDITION_CHANGED", "Legacy selections or mappings changed after plan review.", { currentPlanHash: rebuilt.planHash, reviewedPlanHash: plan.planHash, conflicts: rebuilt.conflicts });
    return { state: current, replay: false, existingGlobals: [] };
}

async function applyPlan(store, plan, { now = new Date() } = {}) {
    assertReviewedPlan(plan);
    return store.withTransaction(async session => {
        const before = await validateCurrentState(store, plan, { session });
        if (before.replay) return { insertedCount: 0, verifiedGlobalCount: before.existingGlobals.length, idempotentReplay: true };
        const documents = plan.records.map(record => selectionDocument(record, plan, now));
        const insertedCount = await store.insertGlobals(documents, { session });
        if (insertedCount !== plan.records.length) throw new GlobalSupplierSelectionMigrationError("PARTIAL_INSERT", "Not all GLOBAL selections were inserted; transaction must abort.", { insertedCount, expected: plan.records.length });
        const after = await store.loadState({ session });
        const globals = after.selections.filter(item => upper(item.customerMarket) === "GLOBAL");
        if (globals.length !== plan.records.length || globals.some(item => item.reason !== marker(plan))) throw new GlobalSupplierSelectionMigrationError("POST_WRITE_VERIFICATION_FAILED", "GLOBAL selection post-write verification failed.", { globalCount: globals.length, expected: plan.records.length });
        return { insertedCount, verifiedGlobalCount: globals.length, idempotentReplay: false };
    });
}

async function rollbackPlan(store, plan) {
    assertReviewedPlan(plan);
    return store.withTransaction(async session => {
        const state = await store.loadState({ session });
        const globals = state.selections.filter(item => upper(item.customerMarket) === "GLOBAL");
        const expected = new Map(plan.records.map(item => [packageKey(item.productCode, item.packageCode), objectId(item.supplierMappingId)]));
        const targeted = globals.filter(item => item.reason === marker(plan) && item.selectedByUsernameSnapshot === "GLOBAL_SUPPLIER_MIGRATION" && Number(item.decisionVersion) === 1);
        if (globals.length !== targeted.length || targeted.length !== plan.records.length || targeted.some(item => expected.get(packageKey(item.productCode, item.packageCode)) !== objectId(item.supplierMappingId))) {
            throw new GlobalSupplierSelectionMigrationError("ROLLBACK_TARGET_MISMATCH", "GLOBAL state no longer exactly matches this migration; refusing blanket rollback.", { globalCount: globals.length, targetedCount: targeted.length, expected: plan.records.length });
        }
        const deletedCount = await store.deleteMigrationGlobals({ migrationId: plan.migrationId, planHash: plan.planHash, records: plan.records }, { session });
        if (deletedCount !== plan.records.length) throw new GlobalSupplierSelectionMigrationError("PARTIAL_ROLLBACK", "Rollback did not delete every targeted record; transaction must abort.", { deletedCount, expected: plan.records.length });
        const after = await store.loadState({ session });
        if (after.selections.some(item => upper(item.customerMarket) === "GLOBAL")) throw new GlobalSupplierSelectionMigrationError("ROLLBACK_VERIFICATION_FAILED", "GLOBAL records remain after targeted rollback.");
        return { deletedCount, verifiedGlobalCount: 0 };
    });
}

module.exports = { GlobalSupplierSelectionMigrationError, applyPlan, assertReviewedPlan, buildPlan, hash, marker, packageKey, rollbackPlan, selectionDocument, validateMapping };
