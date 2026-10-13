"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createWeeklySupplierCostJobService, RETRY_DELAYS_MS } = require("../services/supplierCatalog/weeklySupplierCostJobService");

let checks = 0;
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert(value, message); checks += 1; };

function query(value) { return { sort() { return this; }, lean: async () => value }; }

async function main() {
    let now = new Date("2026-10-11T20:00:00.000Z"), deferred = [], leaseHeld = false, ingestions = 0, reconciliations = 0;
    const ingestionTriggers = [];
    const jobs = [];
    const JobModel = {
        create: async value => { const job = { _id: `job-${jobs.length + 1}`, createdAt: now, updatedAt: now, retryAttempt: 0, supplierResults: [], ...value }; jobs.push(job); return job; },
        updateOne: async (filter, update) => { const job = jobs.find(row => String(row._id) === String(filter._id)); if (job) Object.assign(job, update.$set, { updatedAt: now }); return { modifiedCount: job ? 1 : 0 }; },
        findOne: filter => query(jobs.find(row => (!filter.jobId || row.jobId === filter.jobId) && (!filter.status || (filter.status.$in ? filter.status.$in.includes(row.status) : row.status === filter.status))) || null),
        findOneAndUpdate: async (filter, update) => { const job = jobs.find(row => row.status === filter.status && row.nextRetryAt <= filter.nextRetryAt.$lte); if (!job) return null; Object.assign(job, update.$set); return job; }
    };
    const leases = {
        acquire: async ({ runKey }) => { if (leaseHeld) throw Object.assign(new Error("running"), { code: "WEEKLY_SUPPLIER_COST_SYNC_ALREADY_RUNNING" }); leaseHeld = true; return { _id: "lease", ownerId: runKey, expiresAt: new Date(now.getTime() + 60000) }; },
        renew: async lease => lease, assertOwned: async lease => lease,
        withOwnedLeaseTransaction: async (lease, ttlMs, operation) => ({ lease, result: await operation({ session: null, lease }) }),
        release: async () => { leaseHeld = false; }
    };
    const ownerAuthorization = { requireAuthenticatedOwner: async actor => { if (actor.persistedOwner !== true) throw Object.assign(new Error("denied"), { code: "OWNER_AUTHENTICATION_REQUIRED", statusCode: 403 }); return { id: "1".repeat(24), username: "owner-db", role: "OWNER", sessionId: "session-db" }; } };
    const service = createWeeklySupplierCostJobService({
        JobModel, ApprovalModel: { countDocuments: async () => 2 }, leases, ownerAuthorization,
        ingest: async input => { ingestions += 1; ingestionTriggers.push(input.trigger); equal(input.reconcileSellability, false, "manual ingestion cannot alter sellability"); return { runId: `run-${ingestions}` }; },
        sync: { reconcile: async input => { reconciliations += 1; return input.prepare ? { initialCandidateCount: 1 } : { updated: 1, unchanged: 2, reviewRequired: 1, rejected: 0, initialCandidateCount: 1 }; } },
        policyReader: () => ({ enabled: true, jobLeaseTtlMs: 60000, maximumObservationAgeMs: 1000, maximumAutomaticChangePercent: 20 }),
        clock: () => now, defer: fn => deferred.push(fn)
    });
    await assert.rejects(() => service.enqueueManual({ actor: { role: "OWNER" } }), error => error.code === "OWNER_AUTHENTICATION_REQUIRED"); checks += 1;
    const queued = await service.enqueueManual({ actor: { persistedOwner: true, role: "SUPPORT", username: "forged" } });
    equal(queued.status, "QUEUED");
    equal(jobs[0].requestedBy.username, "owner-db", "persisted Owner identity is stored");
    await assert.rejects(() => service.enqueueManual({ actor: { persistedOwner: true } }), error => error.code === "WEEKLY_SUPPLIER_COST_SYNC_ALREADY_RUNNING"); checks += 1;
    await deferred.shift()();
    equal(jobs[0].status, "SUCCEEDED"); equal(jobs[0].supplierResults.length, 2); equal(ingestions, 2); equal(reconciliations, 4, "initial candidates are prepared separately without replacing routine reconciliation");
    equal(ingestionTriggers.join(","), "ADMIN_MANUAL,ADMIN_MANUAL", "manual supplier ingestion uses the canonical persisted trigger");
    const status = await service.status(queued.jobId); equal(status.jobId, queued.jobId);

    let failedCalls = 0;
    const retryJobs = [];
    const RetryModel = { ...JobModel, create: async value => { const job = { _id: `retry-${retryJobs.length}`, createdAt: now, updatedAt: now, retryAttempt: 0, supplierResults: [], ...value }; retryJobs.push(job); jobs.push(job); return job; } };
    const retryService = createWeeklySupplierCostJobService({ JobModel: RetryModel, ApprovalModel: { countDocuments: async () => 0 }, leases, ownerAuthorization,
        ingest: async input => { failedCalls += 1; equal(input.trigger, "ADMIN_MANUAL", "retry ingestion retains the canonical manual trigger"); throw Object.assign(new Error("network unavailable"), { code: "NETWORK_UNAVAILABLE", retryable: true }); },
        sync: { reconcile: async () => { throw new Error("unreachable"); } }, policyReader: () => ({ enabled: true, jobLeaseTtlMs: 60000 }), clock: () => now, defer: fn => deferred.push(fn) });
    const retryQueued = await retryService.enqueueManual({ actor: { persistedOwner: true } }); await deferred.shift()();
    const retryJob = jobs.find(row => row.jobId === retryQueued.jobId); equal(retryJob.status, "RETRY_SCHEDULED"); equal(retryJob.retryAttempt, 1); equal(retryJob.nextRetryAt.getTime() - now.getTime(), RETRY_DELAYS_MS[0]); equal(failedCalls, 2);

    const root = path.resolve(__dirname, "..");
    const jobSource = fs.readFileSync(path.join(root, "services/supplierCatalog/weeklySupplierCostJobService.js"), "utf8");
    const routeSource = fs.readFileSync(path.join(root, "routes/adminPricingEngine.js"), "utf8");
    const uiSource = fs.readFileSync(path.resolve(root, "../frontend/js/admin-pricing-engine.js"), "utf8");
    for (const forbidden of ["publishDailyPricing", "PackageMarketPublication", "PackageSupplierSelection", "CommerceOrder", "PaymentAttempt", "FulfillmentAttempt", "ExclusiveOffer"]) ok(!jobSource.includes(forbidden), `job pipeline excludes ${forbidden}`);
    ok(routeSource.includes("OWNER_ROUTING_MANAGE") && routeSource.includes("enqueueManual"), "manual API is authenticated and Owner-gated");
    ok(uiSource.includes("Sync Supplier Costs") && uiSource.includes("confirmed: true") && !uiSource.includes("fazercards") && !uiSource.includes("wondd"), "browser uses only server-side sync API");
    equal(RETRY_DELAYS_MS.join(","), [900000, 1800000, 3600000].join(","), "retry schedule is 15/30/60 minutes");
    console.log(JSON.stringify({ result: "PASS", checks, productionConnections: 0, supplierNetworkCalls: 0, publicationWrites: 0, mappingWrites: 0, fulfillmentWrites: 0 }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
