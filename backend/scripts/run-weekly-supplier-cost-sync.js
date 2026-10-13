#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const crypto = require("crypto");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const AdminAccount = require("../models/AdminAccount");
const Approval = require("../models/WeeklySupplierCostApproval");
const { ROLES, STATUSES } = require("../services/adminAuthorizationService");
const { SUPPLIERS, readWeeklySupplierCostSyncPolicy } = require("../config/supplierCatalogIngestionPolicy");
const { runSupplierCatalogIngestion } = require("../services/supplierCatalog/supplierCatalogIngestionOrchestrator");
const { createWeeklySupplierCostSyncService } = require("../services/supplierCatalog/weeklySupplierCostSyncService");
const { createWeeklySupplierCostJobLeaseService } = require("../services/supplierCatalog/weeklySupplierCostJobLeaseService");
const { createWeeklySupplierCostJobService } = require("../services/supplierCatalog/weeklySupplierCostJobService");

const argument = name => { const prefix = `--${name}=`; return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || ""; };
const validObjectId = value => /^[a-f0-9]{24}$/i.test(String(value || ""));
async function loadAutomationActor(adminId, AdminModel = AdminAccount) {
    let account = null;
    try { account = await AdminModel.findOne({ _id: adminId, status: STATUSES.ACTIVE, role: { $ne: ROLES.OWNER } }).lean(); }
    catch (_error) { account = null; }
    if (!account) throw Object.assign(new Error("The dedicated automation identity must be an active persisted non-OWNER AdminAccount."), { code: "SUPPLIER_WEEKLY_COST_AUTOMATION_IDENTITY_INVALID" });
    return { id: account._id, username: account.username, role: account.role };
}

async function withJobLease(policy, operation) {
    const leases = createWeeklySupplierCostJobLeaseService(), runKey = `weekly-cost:${new Date().toISOString()}:${crypto.randomUUID()}`;
    let lease = await leases.acquire({ runKey, ttlMs: policy.jobLeaseTtlMs }), leaseFailure = null;
    const heartbeat = setInterval(() => leases.renew(lease, policy.jobLeaseTtlMs).then(value => { lease = value; }).catch(error => { leaseFailure = error; }), Math.max(1000, Math.floor(policy.jobLeaseTtlMs / 3)));
    heartbeat.unref?.();
    const assertLease = async () => { if (leaseFailure) throw leaseFailure; lease = await leases.assertOwned(lease); return true; };
    try { const result = await operation(assertLease); await assertLease(); return result; }
    finally { clearInterval(heartbeat); await leases.release(lease).catch(() => null); }
}

async function main() {
    const dryRun = process.argv.includes("--dry-run"), prepare = process.argv.includes("--prepare-initial-manifest");
    const applyHash = argument("apply-approved-manifest"), policy = readWeeklySupplierCostSyncPolicy(process.env);
    if (!dryRun && !policy.enabled) throw Object.assign(new Error("Weekly supplier cost sync is disabled."), { code: "SUPPLIER_WEEKLY_COST_SYNC_DISABLED" });
    if (!dryRun && !validObjectId(policy.automationActorId)) throw Object.assign(new Error("A dedicated audited automation identity is required."), { code: "SUPPLIER_WEEKLY_COST_AUTOMATION_ACTOR_REQUIRED" });
    await connectDB();
    const actor = dryRun ? {} : await loadAutomationActor(policy.automationActorId);
    if (!dryRun && !prepare && !applyHash) {
        const job = await createWeeklySupplierCostJobService().runNow({ trigger: "WEEKLY", actor });
        console.log(JSON.stringify({ result: ["SUCCEEDED", "PARTIAL"].includes(job.status) ? "PASS" : job.status, mode: "WEEKLY", job }, null, 2));
        if (!["SUCCEEDED", "RETRY_SCHEDULED"].includes(job.status)) process.exitCode = 1;
        return;
    }
    const operation = async assertLease => {
        const sync = createWeeklySupplierCostSyncService(), output = [];
        if (applyHash) {
            const approval = await Approval.findById(applyHash).lean();
            if (!approval || !approval.candidates?.length) throw Object.assign(new Error("Approved manifest not found."), { code: "APPROVAL_MANIFEST_NOT_FOUND" });
            const supplierCode = approval.candidates[0].supplierCode, ingestionRunId = String(approval.candidates[0].ingestionRunId);
            await assertLease();
            output.push({ supplierCode, costSync: await sync.reconcile({ supplierCode, ingestionRunId, approvalHash: applyHash, initialOnly: true, policy, actor, assertLease }) });
            return output;
        }
        for (const supplierCode of SUPPLIERS) {
            try {
                if (dryRun) { output.push({ supplierCode, costSync: await sync.reconcile({ supplierCode, dryRun: true, policy, actor: {}, assertLease }) }); continue; }
                await assertLease();
                const ingestion = await runSupplierCatalogIngestion({ supplierCode, trigger: "EXTERNAL_SCHEDULED", reason: prepare ? "Prepare owner-reviewed initial supplier-cost manifest" : "Weekly supplier cost observation refresh", reconcileSellability: false, actor });
                await assertLease();
                const costSync = await sync.reconcile({ supplierCode, ingestionRunId: ingestion.runId, prepare, policy, actor, assertLease });
                output.push({ supplierCode, ingestion, costSync });
            } catch (error) { output.push({ supplierCode, error: { code: error.code || error.name, message: String(error.message || "Weekly sync failed").slice(0, 300) } }); }
        }
        return output;
    };
    const results = dryRun ? await operation(async () => true) : await withJobLease(policy, operation);
    console.log(JSON.stringify({ result: results.some(row => row.error) ? "PARTIAL" : "PASS", mode: applyHash ? "APPLY_APPROVED" : prepare ? "PREPARE" : dryRun ? "DRY_RUN" : "APPLY", schedule: { local: policy.scheduleLocal, timeZone: policy.scheduleTimeZone, cronUtc: policy.cronUtc }, results }, null, 2));
    if (results.some(row => row.error)) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message })); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
module.exports = Object.freeze({ argument, validObjectId, loadAutomationActor, withJobLease, main });
