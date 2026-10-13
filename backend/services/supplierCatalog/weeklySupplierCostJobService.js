"use strict";

const crypto = require("crypto");
const Job = require("../../models/WeeklySupplierCostJob");
const Approval = require("../../models/WeeklySupplierCostApproval");
const { SUPPLIERS, readWeeklySupplierCostSyncPolicy } = require("../../config/supplierCatalogIngestionPolicy");
const { runSupplierCatalogIngestion } = require("./supplierCatalogIngestionOrchestrator");
const { createWeeklySupplierCostSyncService } = require("./weeklySupplierCostSyncService");
const { createWeeklySupplierCostJobLeaseService } = require("./weeklySupplierCostJobLeaseService");
const { createAdminOwnerAuthorizationService } = require("../adminOwnerAuthorizationService");

const RETRY_DELAYS_MS = Object.freeze([15, 30, 60].map(minutes => minutes * 60 * 1000));
const ACTIVE = Object.freeze(["QUEUED", "RUNNING"]);
class WeeklySupplierCostJobError extends Error { constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; } }
const transientFailure = error => error?.retryable === true || /TIMEOUT|TRANSPORT|NETWORK|ECONN|HTTP_5|UNAVAILABLE|ABORT/i.test(String(error?.code || error?.message || ""));
const safeError = error => ({ code: String(error?.code || error?.name || "SYNC_FAILED").slice(0, 100), message: String(error?.message || "Supplier cost synchronization failed.").slice(0, 500) });
const actorSnapshot = actor => ({ adminId: actor?.id || actor?._id || actor?.adminId || null, username: String(actor?.username || ""), role: String(actor?.role || "") });

function createWeeklySupplierCostJobService(options = {}) {
    const JobModel = options.JobModel || Job, ApprovalModel = options.ApprovalModel || Approval;
    const leases = options.leases || createWeeklySupplierCostJobLeaseService(), ownerAuth = options.ownerAuthorization || createAdminOwnerAuthorizationService();
    const ingest = options.ingest || runSupplierCatalogIngestion, sync = options.sync || createWeeklySupplierCostSyncService();
    const policyReader = options.policyReader || (() => readWeeklySupplierCostSyncPolicy()), clock = options.clock || (() => new Date());
    const defer = options.defer || (fn => setImmediate(fn));

    async function summary() {
        const [latest, lastSuccessful, active, pendingInitialApproval] = await Promise.all([
            JobModel.findOne({ status: { $in: ["SUCCEEDED", "PARTIAL", "FAILED", "RETRY_SCHEDULED"] } }).sort({ updatedAt: -1 }).lean(),
            JobModel.findOne({ status: "SUCCEEDED" }).sort({ completedAt: -1 }).lean(),
            JobModel.findOne({ status: { $in: ACTIVE } }).sort({ createdAt: -1 }).lean(),
            ApprovalModel.countDocuments({ status: "PENDING" })
        ]);
        return { latest, lastSuccessful, active, pendingInitialApproval, schedule: { label: "Sunday 03:00", timeZone: "Asia/Bangkok", cronUtc: "0 20 * * 6" } };
    }

    async function status(jobId) {
        const job = await JobModel.findOne({ jobId: String(jobId || "") }).lean();
        if (!job) throw new WeeklySupplierCostJobError("SUPPLIER_COST_SYNC_JOB_NOT_FOUND", "Supplier cost sync job was not found.", 404);
        return job;
    }

    async function execute(job, lease, actor) {
        const policy = policyReader(), heartbeatMs = Math.max(1000, Math.floor(policy.jobLeaseTtlMs / 3));
        let currentLease = lease, leaseFailure = null;
        const heartbeat = setInterval(() => leases.renew(currentLease, policy.jobLeaseTtlMs).then(value => { currentLease = value; }).catch(error => { leaseFailure = error; }), heartbeatMs); heartbeat.unref?.();
        const assertLease = async () => { if (leaseFailure) throw leaseFailure; currentLease = await leases.assertOwned(currentLease); return true; };
        const supplierResults = [], failures = [];
        try {
            await JobModel.updateOne({ _id: job._id }, { $set: { status: "RUNNING", startedAt: clock(), leaseOwnerId: currentLease.ownerId, nextRetryAt: null } });
            for (const supplierCode of SUPPLIERS) {
                try {
                    await assertLease();
                    const ingestion = await ingest({ supplierCode, trigger: job.trigger === "WEEKLY" ? "EXTERNAL_SCHEDULED" : "ADMIN_MANUAL", reason: `${job.trigger} supplier cost synchronization`, reconcileSellability: false, actor: actorSnapshot(actor) });
                    await assertLease();
                    const costSync = await sync.reconcile({ supplierCode, ingestionRunId: ingestion.runId, policy, actor, assertLease });
                    let pendingInitialApproval = 0;
                    if (costSync.initialCandidateCount > 0) {
                        const prepared = await sync.reconcile({ supplierCode, ingestionRunId: ingestion.runId, policy, actor, prepare: true, assertLease });
                        pendingInitialApproval = prepared.initialCandidateCount;
                    }
                    supplierResults.push({ supplierCode, status: "SUCCEEDED", updated: costSync.updated, unchanged: costSync.unchanged, reviewRequired: costSync.reviewRequired, failed: costSync.rejected, pendingInitialApproval });
                } catch (error) {
                    const failure = { supplierCode, ...safeError(error), transient: transientFailure(error) }; failures.push(failure);
                    supplierResults.push({ supplierCode, status: "FAILED", updated: 0, unchanged: 0, reviewRequired: 0, failed: 1, pendingInitialApproval: 0, errorCode: failure.code, errorMessage: failure.message });
                }
            }
            await assertLease();
            const retryAttempt = Number(job.retryAttempt || 0), retryable = failures.length > 0 && failures.every(row => row.transient) && retryAttempt < RETRY_DELAYS_MS.length;
            const nextRetryAt = retryable ? new Date(clock().getTime() + RETRY_DELAYS_MS[retryAttempt]) : null;
            const finalStatus = retryable ? "RETRY_SCHEDULED" : failures.length === 0 ? "SUCCEEDED" : failures.length < SUPPLIERS.length ? "PARTIAL" : "FAILED";
            await JobModel.updateOne({ _id: job._id }, { $set: { status: finalStatus, supplierResults, retryAttempt: retryable ? retryAttempt + 1 : retryAttempt, nextRetryAt, completedAt: retryable ? null : clock(), lastFailureCode: failures[0]?.code || "", lastFailureReason: failures[0]?.message || "", leaseOwnerId: "" } });
        } catch (error) {
            const failure = safeError(error);
            await JobModel.updateOne({ _id: job._id }, { $set: { status: "FAILED", completedAt: clock(), lastFailureCode: failure.code, lastFailureReason: failure.message, leaseOwnerId: "" } }).catch(() => null);
        } finally {
            clearInterval(heartbeat); await leases.release(currentLease).catch(() => null);
        }
        return status(job.jobId);
    }

    async function enqueue({ trigger, actor, existingJob = null }) {
        const policy = policyReader();
        if (!policy.enabled) throw new WeeklySupplierCostJobError("SUPPLIER_WEEKLY_COST_SYNC_DISABLED", "Supplier cost synchronization is disabled.", 409);
        const jobId = existingJob?.jobId || `supplier-cost-${clock().getTime()}-${crypto.randomUUID()}`;
        const lease = await leases.acquire({ runKey: `${trigger}:${jobId}`, ttlMs: policy.jobLeaseTtlMs });
        let job = existingJob;
        try {
            if (!job) job = await JobModel.create({ jobId, trigger, status: "QUEUED", requestedBy: actorSnapshot(actor) });
            else await JobModel.updateOne({ _id: job._id }, { $set: { trigger: "RETRY", status: "QUEUED", nextRetryAt: null } });
        } catch (error) { await leases.release(lease).catch(() => null); throw error; }
        defer(() => execute(job, lease, actor).catch(() => null));
        return { jobId, status: "QUEUED" };
    }

    async function enqueueManual({ actor }) {
        let owner;
        try { owner = await ownerAuth.requireAuthenticatedOwner(actor); }
        catch (error) { throw new WeeklySupplierCostJobError(error.code || "OWNER_AUTHENTICATION_REQUIRED", error.message, error.statusCode || 403); }
        return enqueue({ trigger: "MANUAL", actor: owner });
    }

    async function enqueueWeekly({ actor }) { return enqueue({ trigger: "WEEKLY", actor }); }

    async function runNow({ trigger = "WEEKLY", actor }) {
        const policy = policyReader();
        if (!policy.enabled) throw new WeeklySupplierCostJobError("SUPPLIER_WEEKLY_COST_SYNC_DISABLED", "Supplier cost synchronization is disabled.", 409);
        const jobId = `supplier-cost-${clock().getTime()}-${crypto.randomUUID()}`;
        const lease = await leases.acquire({ runKey: `${trigger}:${jobId}`, ttlMs: policy.jobLeaseTtlMs });
        let job;
        try { job = await JobModel.create({ jobId, trigger, status: "QUEUED", requestedBy: actorSnapshot(actor) }); }
        catch (error) { await leases.release(lease).catch(() => null); throw error; }
        return execute(job, lease, actor);
    }

    async function recoverDue({ actor }) {
        const now = clock();
        const candidate = await JobModel.findOne({ $or: [{ status: "RETRY_SCHEDULED", nextRetryAt: { $lte: now } }, { status: { $in: ACTIVE } }] }).sort({ createdAt: 1 });
        if (!candidate) return { recovered: false };
        const policy = policyReader();
        let lease;
        try {
            lease = await leases.acquire({ runKey: `RETRY:${candidate.jobId}`, ttlMs: policy.jobLeaseTtlMs });
            const job = await JobModel.findOneAndUpdate({ _id: candidate._id, status: candidate.status }, { $set: { status: "QUEUED", trigger: "RETRY", nextRetryAt: null } }, { returnDocument: "after" });
            if (!job) { await leases.release(lease).catch(() => null); return { recovered: false }; }
            return { recovered: true, job: await execute(job, lease, actor) };
        }
        catch (error) { if (lease) await leases.release(lease).catch(() => null); throw error; }
    }

    return Object.freeze({ summary, status, execute, enqueueManual, enqueueWeekly, runNow, recoverDue });
}

module.exports = Object.freeze({ RETRY_DELAYS_MS, WeeklySupplierCostJobError, transientFailure, createWeeklySupplierCostJobService });
