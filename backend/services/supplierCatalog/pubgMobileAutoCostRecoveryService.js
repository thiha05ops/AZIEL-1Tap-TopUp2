"use strict";

const mongoose = require("mongoose");
const AdminAccount = require("../../models/AdminAccount");
const Supplier = require("../../models/Supplier");
const SupplierProductMapping = require("../../models/SupplierProductMapping");
const { readWeeklySupplierCostSyncPolicy } = require("../../config/supplierCatalogIngestionPolicy");
const { createSupplierLatestCostService } = require("./supplierLatestCostService");
const { createRepositories, createWeeklySupplierCostSyncService } = require("./weeklySupplierCostSyncService");
const { PRODUCT_CODE, TARGET_PRODUCT_CODE, PACKAGE_MIGRATIONS } = require("./pubgMobileAutoMigrationService");

const CONFIRMATION = "RECOVER PUBG MOBILE AUTO COST AUTHORITIES";
const clean = value => String(value == null ? "" : value).trim();
const id = value => clean(value?._id || value);
const upper = value => clean(value).toUpperCase();
const fail = (condition, code, message, details = {}) => { if (!condition) throw Object.assign(new Error(message), { code, details }); };

function createPubgMobileAutoCostRecoveryService(options = {}) {
    const Admin = options.Admin || AdminAccount, SupplierModel = options.Supplier || Supplier, Mapping = options.Mapping || SupplierProductMapping;
    const env = options.env || process.env, clock = options.clock || (() => new Date());
    const latest = options.latest || createSupplierLatestCostService(options.latestModels || {}, { clock });
    const baseRepositories = options.repositories || createRepositories(options.models || {});
    const promoter = options.promoter;

    async function context() {
        const supplier = await SupplierModel.findOne({ supplierCode: "FAZERCARDS", enabled: true, mode: "API" }).lean();
        fail(supplier, "SUPPLIER_NOT_READY", "Enabled API FazerCards supplier is required.");
        const mappings = await Mapping.find({ supplierId: supplier._id, productCode: PRODUCT_CODE, supplierProductCode: TARGET_PRODUCT_CODE, packageCode: { $in: PACKAGE_MIGRATIONS.map(value => value.packageCode) }, region: "GLOBAL", archivedAt: null }).lean();
        fail(mappings.length === 6, "TARGET_MAPPING_SET_INCOMPLETE", "All six prepared pubg_mobile_auto mappings are required.");
        const rows = PACKAGE_MIGRATIONS.map(expected => {
            const mapping = mappings.find(value => upper(value.packageCode) === expected.packageCode && clean(value.supplierPackageCode) === expected.offerCode && value.supplierCatalogOfferId);
            fail(mapping, "TARGET_MAPPING_IDENTITY_CONFLICT", `Exact target mapping is missing for ${expected.packageCode}.`);
            return { expected, mapping };
        });
        const evidence = await latest.forOffers(rows.map(row => row.mapping.supplierCatalogOfferId));
        fail(evidence.length === 6, "LATEST_COST_EVIDENCE_INCOMPLETE", "Validated latest supplier cost evidence is required for all six target offers.");
        const runIds = [...new Set(evidence.map(value => id(value.ingestionRunId)))];
        fail(runIds.length === 1 && runIds[0], "LATEST_COST_RUN_MISMATCH", "All six latest costs must belong to one ingestion run.");
        const evidenceByOffer = new Map(evidence.map(value => [id(value.supplierCatalogOfferId), value]));
        rows.forEach(row => fail(evidenceByOffer.has(id(row.mapping.supplierCatalogOfferId)), "LATEST_COST_EVIDENCE_INCOMPLETE", `Latest cost is missing for ${row.expected.packageCode}.`));
        return { supplier, rows, evidence, ingestionRunId: runIds[0] };
    }

    async function inspect({ internal = false } = {}) {
        const state = await context();
        const selections = state.rows.map(row => ({ productCode: PRODUCT_CODE, packageCode: row.expected.packageCode, customerMarket: "GLOBAL", supplierMappingId: row.mapping._id }));
        const repositories = { ...baseRepositories, selections: async () => selections, observations: async (_ids, runId) => state.evidence.filter(value => !runId || id(value.ingestionRunId) === id(runId)) };
        // Reuse the validated reconciliation policy without enabling or invoking the weekly scheduler.
        const policySource = readWeeklySupplierCostSyncPolicy(env);
        const policy = { ...policySource, maximumObservationAgeMs: Math.min(Number(policySource.maximumObservationAgeMs), 24 * 60 * 60 * 1000) };
        const sync = createWeeklySupplierCostSyncService({ repositories, ...(promoter ? { promoter } : {}), clock });
        const report = await sync.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: state.ingestionRunId, dryRun: true, policy, actor: {} });
        const blocked = report.decisions.filter(value => ["REVIEW_REQUIRED", "REJECTED"].includes(value.status));
        const result = { state: blocked.length ? "BLOCKED" : "READY", planHash: report.planHash, ingestionRunId: state.ingestionRunId, decisions: report.decisions, summary: { total: 6, acceptable: report.decisions.filter(value => value.status === "DRY_RUN_ACCEPTABLE").length, unchanged: report.unchanged, blocked: blocked.length } };
        return internal ? { ...result, repositories, policy } : result;
    }

    async function recover(input = {}, actor = {}) {
        fail(env.PUBG_MOBILE_AUTO_COST_RECOVERY_ENABLED === "true", "COST_RECOVERY_GATE_DISABLED", "The migration cost-recovery gate is disabled.");
        fail(env.SUPPLIER_COST_AUTHORITY_MUTATIONS_ENABLED === "true", "COST_AUTHORITY_GATE_DISABLED", "Supplier cost-authority mutations are disabled.");
        fail(input.confirmed === true && clean(input.confirmation) === CONFIRMATION, "COST_RECOVERY_CONFIRMATION_REQUIRED", "Exact OWNER recovery confirmation is required.");
        fail(/^[a-f0-9]{64}$/.test(clean(input.planHash)), "RECOVERY_PLAN_HASH_INVALID", "A reviewed recovery plan hash is required.");
        const admin = await Admin.findById(actor.adminId).lean();
        fail(admin && admin.status === "ACTIVE" && upper(admin.role) === "OWNER" && clean(admin.usernameNormalized) === clean(actor.username).toLowerCase(), "OWNER_NOT_AUTHORIZED", "An active matching OWNER account is required.");
        const plan = await inspect({ internal: true });
        fail(plan.state === "READY", "COST_RECOVERY_BLOCKED", "Recovery evidence contains blocked target mappings.", { decisions: plan.decisions });
        fail(plan.planHash === clean(input.planHash), "RECOVERY_PLAN_CHANGED", "Recovery evidence changed after review.");
        const sync = createWeeklySupplierCostSyncService({ repositories: plan.repositories, ...(promoter ? { promoter } : {}), clock });
        const result = await sync.reconcile({ supplierCode: "FAZERCARDS", ingestionRunId: plan.ingestionRunId, policy: plan.policy, actor: { id: admin._id, username: admin.username, role: admin.role } });
        fail(result.blocked === 0, "COST_RECOVERY_INCOMPLETE", "One or more target authorities were not recovered.", { decisions: result.decisions });
        const verified = await inspect();
        fail(verified.state === "READY" && verified.summary.blocked === 0 && verified.summary.acceptable === 0, "COST_RECOVERY_VERIFICATION_FAILED", "Recovered target authorities did not verify as current.", { decisions: verified.decisions });
        return { applied: result.updated > 0, updated: result.updated, replayed: result.replayed, unchanged: result.unchanged, ingestionRunId: plan.ingestionRunId, reviewedPlanHash: plan.planHash, verificationPlanHash: verified.planHash, decisions: result.decisions };
    }

    return Object.freeze({ inspect, recover });
}

module.exports = Object.freeze({ CONFIRMATION, createPubgMobileAutoCostRecoveryService });
