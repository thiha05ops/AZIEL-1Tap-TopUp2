"use strict";

const assert = require("assert");
const { RETRY_DELAYS_MS, createWeeklySupplierCostJobService } = require("../services/supplierCatalog/weeklySupplierCostJobService");

let checks = 0;
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert(value, message); checks += 1; };
const clone = value => value == null ? value : structuredClone(value);

function matches(job, filter = {}) {
    if (filter._id !== undefined && String(job._id) !== String(filter._id)) return false;
    if (filter.jobId !== undefined && job.jobId !== filter.jobId) return false;
    if (filter.leaseOwnerId !== undefined) {
        const allowed = filter.leaseOwnerId?.$in || [filter.leaseOwnerId];
        if (!allowed.some(value => String(value ?? "") === String(job.leaseOwnerId ?? ""))) return false;
    }
    if (filter.status !== undefined) {
        const allowed = filter.status?.$in || [filter.status];
        if (!allowed.includes(job.status)) return false;
    }
    if (filter.nextRetryAt?.$lte && !(job.nextRetryAt && new Date(job.nextRetryAt) <= new Date(filter.nextRetryAt.$lte))) return false;
    if (filter.$or && !filter.$or.some(branch => matches(job, branch))) return false;
    return true;
}

function query(value) {
    return {
        sort() { return this; },
        lean: async () => clone(value),
        then(resolve, reject) { return Promise.resolve(clone(value)).then(resolve, reject); }
    };
}

function jobModel(state) {
    return {
        create: async value => {
            const job = { _id: `job-${state.jobs.length + 1}`, retryAttempt: 0, supplierResults: [], createdAt: state.now, updatedAt: state.now, ...clone(value) };
            state.jobs.push(job);
            return clone(job);
        },
        findOne(filter) {
            const candidates = state.jobs.filter(job => {
                if (filter.$or) return filter.$or.some(branch => matches(job, branch));
                return matches(job, filter);
            });
            return query(candidates[0] || null);
        },
        async findOneAndUpdate(filter, update) {
            const job = state.jobs.find(row => matches(row, filter));
            if (!job) return null;
            Object.assign(job, clone(update.$set || {}), { updatedAt: state.now });
            return clone(job);
        },
        async updateOne(filter, update) {
            const job = state.jobs.find(row => matches(row, filter));
            state.mutations.push({ filter: clone(filter), matched: Boolean(job), update: clone(update) });
            if (!job) return { matchedCount: 0, modifiedCount: 0 };
            Object.assign(job, clone(update.$set || {}), { updatedAt: state.now });
            return { matchedCount: 1, modifiedCount: 1 };
        }
    };
}

function leaseService(state, owner) {
    return {
        async acquire({ runKey, ttlMs }) {
            if (state.lease && new Date(state.lease.expiresAt) > state.now) {
                throw Object.assign(new Error("running"), { code: "WEEKLY_SUPPLIER_COST_SYNC_ALREADY_RUNNING" });
            }
            state.lease = { _id: "WEEKLY_SUPPLIER_COST_SYNC", ownerId: owner, runKey, expiresAt: new Date(state.now.getTime() + ttlMs), version: Number(state.lease?.version || 0) + 1 };
            return clone(state.lease);
        },
        async renew(lease, ttlMs) {
            if (!state.lease || state.lease.ownerId !== lease.ownerId || new Date(state.lease.expiresAt) <= state.now) throw Object.assign(new Error("lost"), { code: "WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST" });
            state.lease.expiresAt = new Date(state.now.getTime() + ttlMs);
            return clone(state.lease);
        },
        async assertOwned(lease) {
            if (!state.lease || state.lease.ownerId !== lease.ownerId || state.lease.version !== lease.version || new Date(state.lease.expiresAt) <= state.now) throw Object.assign(new Error("lost"), { code: "WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST" });
            return clone(state.lease);
        },
        async withOwnedLeaseTransaction(lease, ttlMs, operation) {
            const current = await this.assertOwned(lease);
            const result = await operation({ session: null, lease: current });
            state.lease.expiresAt = new Date(state.now.getTime() + ttlMs);
            return { lease: clone(state.lease), result };
        },
        async release(lease) {
            if (state.lease?.ownerId === lease.ownerId) state.lease = null;
            return { deletedCount: state.lease ? 0 : 1 };
        }
    };
}

const policyReader = () => ({ enabled: true, jobLeaseTtlMs: 60_000, maximumObservationAgeMs: 60_000, maximumAutomaticChangePercent: 20 });
const successfulSync = { reconcile: async input => input.prepare ? { initialCandidateCount: 0 } : { updated: 0, unchanged: 1, reviewRequired: 0, rejected: 0, initialCandidateCount: 0 } };

async function verifyHealthyLease() {
    const now = new Date("2026-10-13T00:00:00.000Z");
    const state = { now, lease: { _id: "WEEKLY_SUPPLIER_COST_SYNC", ownerId: "healthy-owner", expiresAt: new Date(now.getTime() + 60_000), version: 1 }, jobs: [{ _id: "healthy-job", jobId: "healthy-job", trigger: "WEEKLY", status: "RUNNING", leaseOwnerId: "healthy-owner", retryAttempt: 0, createdAt: now }], mutations: [] };
    const service = createWeeklySupplierCostJobService({ JobModel: jobModel(state), ApprovalModel: { countDocuments: async () => 0 }, leases: leaseService(state, "recovery-owner"), ingest: async () => ({ runId: "unused" }), sync: successfulSync, policyReader, clock: () => state.now });
    const result = await service.recoverDue({ actor: { id: "automation" } });
    equal(result.recovered, false, "healthy active job is not reclaimed");
    equal(result.reason, "ACTIVE_JOB_LEASE_HELD", "healthy lease is a normal no-op recovery outcome");
    equal(state.jobs[0].status, "RUNNING", "healthy job state is unchanged");
    equal(state.mutations.length, 0, "healthy recovery check performs no job mutation");
}

async function verifyTakeover(staleOutcome) {
    const state = { now: new Date("2026-10-13T01:00:00.000Z"), lease: null, jobs: [], mutations: [] };
    const Model = jobModel(state), oldLeases = leaseService(state, "old-owner"), recoveryLeases = leaseService(state, "recovery-owner");
    const oldLease = await oldLeases.acquire({ runKey: "old-run", ttlMs: 60_000 });
    const oldJob = await Model.create({ jobId: `takeover-${staleOutcome}`, trigger: "WEEKLY", status: "QUEUED", leaseOwnerId: oldLease.ownerId, requestedBy: {} });
    let unblock;
    const blocked = new Promise((resolve, reject) => { unblock = staleOutcome === "success" ? resolve : reject; });
    const oldService = createWeeklySupplierCostJobService({ JobModel: Model, ApprovalModel: { countDocuments: async () => 0 }, leases: oldLeases, ingest: async () => blocked.then(() => ({ runId: "old-run" })), sync: successfulSync, policyReader, clock: () => state.now });
    const oldExecution = oldService.execute(oldJob, oldLease, { id: "old" });
    await new Promise(resolve => setImmediate(resolve));
    equal(state.jobs[0].status, "RUNNING", "old worker claimed the queued job");

    state.now = new Date(state.now.getTime() + 61_000);
    const recoveryService = createWeeklySupplierCostJobService({ JobModel: Model, ApprovalModel: { countDocuments: async () => 0 }, leases: recoveryLeases, ingest: async ({ supplierCode }) => ({ runId: `recovered-${supplierCode}` }), sync: successfulSync, policyReader, clock: () => state.now });
    const recovered = await recoveryService.recoverDue({ actor: { id: "automation" } });
    equal(recovered.recovered, true, "expired job lease is recovered");
    equal(state.jobs[0].status, "SUCCEEDED", "recovery owner completes the job");
    equal(state.jobs[0].leaseOwnerId, "", "recovery owner clears ownership only on its own terminal write");

    if (staleOutcome === "success") unblock();
    else unblock(Object.assign(new Error("stale worker failed"), { code: "NETWORK_UNAVAILABLE", retryable: true }));
    await oldExecution;
    equal(state.jobs[0].status, "SUCCEEDED", `stale worker ${staleOutcome} cannot overwrite recovered status`);
    const staleTerminalWrite = state.mutations.find(row => row.filter.leaseOwnerId === "old-owner" && row.update.$set?.leaseOwnerId === "" && row.matched);
    equal(staleTerminalWrite, undefined, `stale worker ${staleOutcome} cannot clear recovery ownership`);
}

async function verifyRetrySequence() {
    const state = { now: new Date("2026-10-13T02:00:00.000Z"), lease: null, jobs: [{ _id: "retry-job", jobId: "retry-job", trigger: "MANUAL", status: "RETRY_SCHEDULED", leaseOwnerId: "", retryAttempt: 0, nextRetryAt: new Date("2026-10-13T02:00:00.000Z"), createdAt: new Date("2026-10-13T01:00:00.000Z") }], mutations: [] };
    const service = createWeeklySupplierCostJobService({ JobModel: jobModel(state), ApprovalModel: { countDocuments: async () => 0 }, leases: leaseService(state, "retry-owner"), ingest: async () => { throw Object.assign(new Error("network unavailable"), { code: "NETWORK_UNAVAILABLE", retryable: true }); }, sync: successfulSync, policyReader, clock: () => state.now });
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        const recovered = await service.recoverDue({ actor: { id: "automation" } });
        equal(recovered.recovered, true, `retry attempt ${attempt + 1} executes`);
        equal(state.jobs[0].status, "RETRY_SCHEDULED", `retry attempt ${attempt + 1} remains scheduled`);
        equal(state.jobs[0].retryAttempt, attempt + 1, `retry attempt ${attempt + 1} is persisted`);
        equal(new Date(state.jobs[0].nextRetryAt).getTime() - state.now.getTime(), RETRY_DELAYS_MS[attempt], `retry delay ${attempt + 1} is correct`);
        state.now = new Date(state.jobs[0].nextRetryAt);
    }
    const final = await service.recoverDue({ actor: { id: "automation" } });
    equal(final.recovered, true, "final due retry executes");
    equal(state.jobs[0].status, "FAILED", "retry sequence stops after 15/30/60 minute retries");
    equal(state.jobs[0].retryAttempt, 3, "retry counter is capped at three");
    equal(state.jobs[0].nextRetryAt, null, "no fourth retry is scheduled");
}

async function main() {
    await verifyHealthyLease();
    await verifyTakeover("success");
    await verifyTakeover("failure");
    await verifyRetrySequence();
    ok(RETRY_DELAYS_MS.join(",") === [900000, 1800000, 3600000].join(","), "retry policy remains 15/30/60 minutes");
    console.log(JSON.stringify({ result: "PASS", checks, productionConnections: 0, supplierCalls: 0, databaseWrites: 0, cases: { healthyLeaseNoOp: true, expiredLeaseTakeover: true, staleCompletionFenced: true, staleFailureFenced: true, fullRetrySequence: true } }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
