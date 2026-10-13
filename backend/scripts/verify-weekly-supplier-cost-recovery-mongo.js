#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Job = require("../models/WeeklySupplierCostJob");
const Lease = require("../models/WeeklySupplierCostJobLease");
const { createWeeklySupplierCostJobLeaseService } = require("../services/supplierCatalog/weeklySupplierCostJobLeaseService");

let assertions = 0;
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); assertions += 1; };
const ok = (value, message) => { assert(value, message); assertions += 1; };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function guardedJobUpdate(service, lease, filter, update, ttlMs = 5_000) {
    return service.withOwnedLeaseTransaction(lease, ttlMs, async ({ session }) => {
        const result = await Job.updateOne(filter, update, { session });
        if (result.matchedCount !== 1) {
            const error = new Error("Job state fence rejected the mutation.");
            error.code = "WEEKLY_SUPPLIER_COST_SYNC_JOB_FENCE_LOST";
            throw error;
        }
        return result;
    });
}

async function verifyExpiryTakeover() {
    const oldService = createWeeklySupplierCostJobLeaseService({ ownerId: () => "old-worker" });
    const recoveryService = createWeeklySupplierCostJobLeaseService({ ownerId: () => "recovery-worker" });
    const oldLease = await oldService.acquire({ runKey: "old-run", ttlMs: 75 });
    const job = await Job.create({ jobId: "expiry-takeover", trigger: "WEEKLY", status: "RUNNING", leaseOwnerId: oldLease.ownerId });

    await oldService.assertOwned(oldLease);
    assertions += 1;
    await delay(110);
    const recoveryLease = await recoveryService.acquire({ runKey: "recovery-run", ttlMs: 5_000 });
    equal(recoveryLease.version, oldLease.version + 1, "lease takeover increments the acquisition generation");

    await assert.rejects(
        () => guardedJobUpdate(oldService, oldLease, { _id: job._id, status: "RUNNING", leaseOwnerId: oldLease.ownerId }, { $set: { status: "SUCCEEDED", leaseOwnerId: "" } }),
        error => error.code === "WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST"
    );
    assertions += 1;
    await assert.rejects(
        () => guardedJobUpdate(oldService, oldLease, { _id: job._id, status: { $in: ["QUEUED", "RUNNING"] }, leaseOwnerId: oldLease.ownerId }, { $set: { status: "FAILED", leaseOwnerId: "" } }),
        error => error.code === "WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST"
    );
    assertions += 1;
    equal((await Job.findById(job._id).lean()).status, "RUNNING", "stale terminal and failure writes both leave the job unchanged");

    let guarded = await guardedJobUpdate(recoveryService, recoveryLease,
        { _id: job._id, status: "RUNNING", leaseOwnerId: oldLease.ownerId },
        { $set: { status: "QUEUED", trigger: "RETRY", leaseOwnerId: recoveryLease.ownerId } });
    guarded = await guardedJobUpdate(recoveryService, guarded.lease,
        { _id: job._id, status: "QUEUED", leaseOwnerId: recoveryLease.ownerId },
        { $set: { status: "RUNNING" } });
    guarded = await guardedJobUpdate(recoveryService, guarded.lease,
        { _id: job._id, status: "RUNNING", leaseOwnerId: recoveryLease.ownerId },
        { $set: { status: "SUCCEEDED", leaseOwnerId: "" } });
    const completed = await Job.findById(job._id).lean();
    equal(completed.status, "SUCCEEDED", "recovery owner completes after stale workers are rejected");
    equal(completed.leaseOwnerId, "", "only the recovery owner clears job ownership");
}

async function verifyTransactionRollback() {
    await Lease.deleteMany({});
    const service = createWeeklySupplierCostJobLeaseService({ ownerId: () => "rollback-worker" });
    const lease = await service.acquire({ runKey: "rollback-run", ttlMs: 5_000 });
    const job = await Job.create({ jobId: "rollback", trigger: "WEEKLY", status: "QUEUED", leaseOwnerId: lease.ownerId });
    const before = await Lease.findById(lease._id).lean();
    await assert.rejects(() => service.withOwnedLeaseTransaction(lease, 10_000, async ({ session }) => {
        await Job.updateOne({ _id: job._id }, { $set: { status: "RUNNING" } }, { session });
        throw Object.assign(new Error("simulated transaction abort"), { code: "SIMULATED_ABORT" });
    }), error => error.code === "SIMULATED_ABORT");
    assertions += 1;
    equal((await Job.findById(job._id).lean()).status, "QUEUED", "aborted transaction rolls back the job mutation");
    equal((await Lease.findById(lease._id).lean()).expiresAt.getTime(), before.expiresAt.getTime(), "aborted transaction rolls back the lease renewal");
}

async function verifyConcurrentClaimConflict() {
    await Lease.deleteMany({});
    const service = createWeeklySupplierCostJobLeaseService({ ownerId: () => "concurrent-worker" });
    const lease = await service.acquire({ runKey: "concurrent-run", ttlMs: 10_000 });
    const job = await Job.create({ jobId: "concurrent-claim", trigger: "WEEKLY", status: "QUEUED", leaseOwnerId: lease.ownerId });
    const claim = marker => guardedJobUpdate(service, lease,
        { _id: job._id, status: "QUEUED", leaseOwnerId: lease.ownerId },
        { $set: { status: "RUNNING", lastFailureReason: marker } });
    const outcomes = await Promise.allSettled([claim("claim-a"), claim("claim-b")]);
    equal(outcomes.filter(row => row.status === "fulfilled").length, 1, "only one concurrent QUEUED to RUNNING claim commits");
    equal(outcomes.filter(row => row.status === "rejected").length, 1, "the conflicting state transition fails closed");
    equal((await Job.findById(job._id).lean()).status, "RUNNING", "the winning transaction leaves one RUNNING job");
}

async function verifyGenerationMismatch() {
    await Lease.deleteMany({});
    const service = createWeeklySupplierCostJobLeaseService({ ownerId: () => "generation-worker" });
    const lease = await service.acquire({ runKey: "generation-run", ttlMs: 5_000 });
    const job = await Job.create({ jobId: "generation-mismatch", trigger: "WEEKLY", status: "QUEUED", leaseOwnerId: lease.ownerId });
    await Lease.updateOne({ _id: lease._id }, { $inc: { version: 1 } });
    await assert.rejects(
        () => guardedJobUpdate(service, lease, { _id: job._id, status: "QUEUED", leaseOwnerId: lease.ownerId }, { $set: { status: "RUNNING" } }),
        error => error.code === "WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST"
    );
    assertions += 1;
    equal((await Job.findById(job._id).lean()).status, "QUEUED", "generation mismatch cannot mutate job state");
}

async function main() {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    const databaseName = "aziel_weekly_recovery_fencing_test";
    try {
        await mongoose.connect(replSet.getUri(databaseName));
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        ok(Boolean(hello.setName && hello.logicalSessionTimeoutMinutes), "isolated database is a transaction-capable replica set");
        equal(mongoose.connection.name, databaseName, "test uses only the explicit isolated database");
        await Promise.all([Job.init(), Lease.init()]);
        await verifyExpiryTakeover();
        await verifyTransactionRollback();
        await verifyConcurrentClaimConflict();
        await verifyGenerationMismatch();
        console.log(JSON.stringify({ result: "PASS", assertions, database: databaseName, replicaSet: true, productionConnections: 0, supplierCalls: 0 }, null, 2));
    } finally {
        if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
        await replSet.stop();
    }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
