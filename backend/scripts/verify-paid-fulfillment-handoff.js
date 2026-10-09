"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createPaidFulfillmentHandoffService } = require("../services/paidFulfillmentHandoffService");
const { ensurePaidOrderFulfillmentWork } = require("../services/paidFulfillmentRoutingService");

const ROOT = path.join(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const clone = value => structuredClone(value);

function fixture(orderId = "AZL-HANDOFF-1") {
    return {
        _id: `db-${orderId}`,
        orderId,
        status: "paid",
        paymentStatus: "paid",
        fulfilment: {
            status: "not_started",
            routeSnapshot: { snapshotVersion: 2, routeType: "SUPPLIER_API", supplierMappingId: "mapping-1", supplierCode: "FAZERCARDS" },
            paidHandoff: null
        },
        operationalReferences: []
    };
}

function newPaidFixture(orderId, now) {
    const order = fixture(orderId);
    order.fulfilment.paidHandoff = {
        version: 1,
        status: "PENDING",
        requestedAt: now,
        availableAt: now,
        attemptCount: 0,
        retryable: true,
        claimToken: "",
        claimedAt: null,
        leaseExpiresAt: null,
        completedAt: null,
        lastError: null
    };
    return order;
}

function fakeRepositories(initial, clock) {
    const orders = new Map(initial.map(order => [order.orderId, clone(order)]));
    const attempts = new Map();
    const eligible = order => ["paid", "processing"].includes(order.status) && order.paymentStatus === "paid" && ["not_started", "processing"].includes(order.fulfilment.status) && order.fulfilment.routeSnapshot?.routeType === "SUPPLIER_API";
    return {
        orders,
        attempts,
        async dueIds(limit, now) {
            return [...orders.values()].filter(order => {
                const handoff = order.fulfilment.paidHandoff;
                return eligible(order) && handoff && (
                    (handoff.status === "PENDING" && new Date(handoff.availableAt) <= now) ||
                    (handoff.status === "BLOCKED" && handoff.retryable && new Date(handoff.availableAt) <= now) ||
                    (handoff.status === "AWAITING_SUBMISSION" && new Date(handoff.availableAt) <= now) ||
                    (handoff.status === "CLAIMED" && new Date(handoff.leaseExpiresAt) <= now)
                );
            }).slice(0, limit).map(order => order.orderId);
        },
        async claim(orderId, claimToken, now, leaseExpiresAt) {
            const order = orders.get(orderId);
            const handoff = order?.fulfilment?.paidHandoff;
            const due = handoff && ((handoff.status === "PENDING" && new Date(handoff.availableAt) <= now) || (handoff.status === "BLOCKED" && handoff.retryable && new Date(handoff.availableAt) <= now) || (handoff.status === "AWAITING_SUBMISSION" && new Date(handoff.availableAt) <= now) || (handoff.status === "CLAIMED" && new Date(handoff.leaseExpiresAt) <= now));
            if (!order || !eligible(order) || !due) return null;
            handoff.status = "CLAIMED"; handoff.claimToken = claimToken; handoff.claimedAt = now; handoff.leaseExpiresAt = leaseExpiresAt; handoff.attemptCount += 1;
            return clone(order);
        },
        async complete(orderId, claimToken, now, result) {
            const handoff = orders.get(orderId)?.fulfilment?.paidHandoff;
            if (!handoff || handoff.claimToken !== claimToken) return null;
            Object.assign(handoff, { status: "COMPLETED", completedAt: now, claimToken: "", leaseExpiresAt: null, lastResult: result.reason, lastError: null });
            return clone(orders.get(orderId));
        },
        async awaitingSubmission(orderId, claimToken, now, availableAt) {
            const handoff = orders.get(orderId)?.fulfilment?.paidHandoff;
            if (!handoff || handoff.claimToken !== claimToken) return null;
            Object.assign(handoff, { status: "AWAITING_SUBMISSION", availableAt, claimToken: "", leaseExpiresAt: null, lastResult: "SUPPLIER_ATTEMPT_CREATED" });
            return clone(orders.get(orderId));
        },
        async block(orderId, claimToken, now, failure) {
            const order = orders.get(orderId); const handoff = order?.fulfilment?.paidHandoff;
            if (!handoff || handoff.claimToken !== claimToken) return null;
            Object.assign(handoff, { status: "BLOCKED", retryable: failure.retryable, availableAt: failure.availableAt, claimToken: "", leaseExpiresAt: null, lastError: { code: failure.errorCode, reason: failure.reason, blockers: failure.blockers, recordedAt: now } });
            order.operationalReferences.push({ type: "paid_fulfillment_start_failed", reason: failure.reason, errorCode: failure.errorCode, recordedAt: now });
            return clone(order);
        },
        async attemptByIdempotency(key) { return attempts.get(key) || null; }
    };
}

async function main() {
    let now = new Date("2030-01-01T00:00:00.000Z");
    const clock = () => new Date(now);

    const walletRepos = fakeRepositories([newPaidFixture("AZL-WALLET", now)], clock);
    let walletStarts = 0;
    const walletService = createPaidFulfillmentHandoffService({ repositories: walletRepos, clock, ensurePaidOrderFulfillmentWork: async order => { walletStarts += 1; return { created: true, reason: "SUPPLIER_FULFILLMENT_STARTED", attempt: { _id: "a-wallet", status: "IN_PROGRESS", supplierCodeSnapshot: "FAZERCARDS", supplierRequest: { submissionState: "SUBMISSION_IN_FLIGHT" } } }; } });
    const wallet = await walletService.processOrder("AZL-WALLET");
    assert.strictEqual(wallet.created, true);
    assert.strictEqual(walletStarts, 1);
    assert.strictEqual(walletRepos.orders.get("AZL-WALLET").fulfilment.paidHandoff.status, "COMPLETED");

    const concurrentRepos = fakeRepositories([newPaidFixture("AZL-CONCURRENT", now)], clock);
    let concurrentStarts = 0;
    const concurrentService = createPaidFulfillmentHandoffService({ repositories: concurrentRepos, clock, ensurePaidOrderFulfillmentWork: async () => { concurrentStarts += 1; await Promise.resolve(); return { created: true, reason: "SUPPLIER_FULFILLMENT_STARTED", attempt: { status: "IN_PROGRESS", supplierRequest: { submissionState: "SUBMISSION_IN_FLIGHT" } } }; } });
    await Promise.all([concurrentService.processOrder("AZL-CONCURRENT"), concurrentService.processOrder("AZL-CONCURRENT")]);
    assert.strictEqual(concurrentStarts, 1, "Atomic handoff claim must allow only one fulfillment starter.");

    const diagnosticOrder = newPaidFixture("AZL-DIAGNOSTIC", now);
    diagnosticOrder.product = { gameCode: "mlbb", packageCode: "MLBB-WEEKLY.PASS" };
    diagnosticOrder.commercial = { region: "TH" };
    Object.assign(diagnosticOrder.fulfilment.routeSnapshot, { productCode: "mlbb", packageCode: "MLBB-WEEKLY.PASS", customerMarket: "TH" });
    const diagnosticResults = new Map();
    const diagnosticLogs = [];
    const originalConsoleError = console.error;
    console.error = (...args) => { diagnosticLogs.push(args); };
    try {
        for (const blocker of ["SUPPLIER_ADAPTER_NOT_READY", "PROVIDER_FEATURE_GATE_OFF"]) {
            const result = await ensurePaidOrderFulfillmentWork(diagnosticOrder, {
                findAttemptByIdempotency: async () => null,
                startSupplierFulfillment: async () => {
                    throw Object.assign(new Error("safe diagnostic"), {
                        code: "FROZEN_ROUTE_NOT_EXECUTABLE",
                        details: { blockers: [blocker, "NOT_AN_ALLOWLISTED_BLOCKER"] }
                    });
                }
            });
            diagnosticResults.set(blocker, result);
            assert.deepStrictEqual(result.blockers, [blocker], `${blocker} must survive routing as an allowlisted diagnostic.`);
        }
    } finally {
        console.error = originalConsoleError;
    }
    assert.strictEqual(diagnosticLogs.length, 2, "Each failed start must emit one sanitized diagnostic log.");
    diagnosticLogs.forEach(([, fields]) => {
        assert.deepStrictEqual(Object.keys(fields).sort(), ["blockers", "errorCode", "orderId"], "Diagnostic logs must contain only safe fields.");
        assert.strictEqual(fields.orderId, "AZL-DIAGNOSTIC");
        assert.strictEqual(fields.errorCode, "FROZEN_ROUTE_NOT_EXECUTABLE");
        assert(!JSON.stringify(fields).includes("NOT_AN_ALLOWLISTED_BLOCKER"), "Unapproved diagnostic values must not reach logs.");
    });

    for (const blocker of ["SUPPLIER_ADAPTER_NOT_READY", "PROVIDER_FEATURE_GATE_OFF"]) {
        const orderId = `AZL-BLOCKED-${blocker}`;
        const blockedRepos = fakeRepositories([newPaidFixture(orderId, now)], clock);
        const blockedService = createPaidFulfillmentHandoffService({ repositories: blockedRepos, clock, ensurePaidOrderFulfillmentWork: async () => diagnosticResults.get(blocker) });
        const blocked = await blockedService.processOrder(orderId);
        const persisted = blockedRepos.orders.get(orderId);
        assert.strictEqual(blocked.retryable, true);
        assert.strictEqual(persisted.fulfilment.paidHandoff.lastError.code, "FROZEN_ROUTE_NOT_EXECUTABLE");
        assert.deepStrictEqual(persisted.fulfilment.paidHandoff.lastError.blockers, [blocker], `${blocker} must be durable.`);
        assert.strictEqual(persisted.operationalReferences.length, 1, "Pre-attempt failures must be durable and Admin-visible.");
    }

    const restartOrder = fixture("AZL-RESTART");
    restartOrder.fulfilment.paidHandoff = { version: 1, status: "CLAIMED", requestedAt: now, availableAt: now, attemptCount: 1, retryable: true, claimToken: "dead-worker", claimedAt: now, leaseExpiresAt: new Date(now.getTime() - 1), completedAt: null, lastError: null };
    const restartRepos = fakeRepositories([restartOrder], clock);
    let restartStarts = 0;
    const restartService = createPaidFulfillmentHandoffService({ repositories: restartRepos, clock, ensurePaidOrderFulfillmentWork: async () => { restartStarts += 1; return { created: true, reason: "SUPPLIER_FULFILLMENT_STARTED", attempt: { status: "IN_PROGRESS", supplierRequest: { submissionState: "SUBMISSION_IN_FLIGHT" } } }; } });
    const recovered = await restartService.recoverDue();
    assert.strictEqual(recovered.processed, 1);
    assert.strictEqual(restartStarts, 1, "Expired worker lease must be recovered after restart.");

    const resumeRepos = fakeRepositories([newPaidFixture("AZL-RESUME", now)], clock);
    const resumeAttempt = { _id: "attempt-resume", status: "IN_PROGRESS", supplierCodeSnapshot: "FAZERCARDS", supplierReference: "", supplierRequest: {} };
    resumeRepos.attempts.set("fulfillment:start:AZL-RESUME:mapping-1", resumeAttempt);
    let safeDispatches = 0;
    const resumeService = createPaidFulfillmentHandoffService({ repositories: resumeRepos, clock, ensurePaidOrderFulfillmentWork: async () => ({ created: false, reason: "SUPPLIER_FULFILLMENT_ALREADY_BOUND", attempt: resumeAttempt }), dispatchSubmission: () => { safeDispatches += 1; return true; } });
    await resumeService.processOrder("AZL-RESUME");
    await resumeService.processOrder("AZL-RESUME");
    assert.strictEqual(safeDispatches, 1, "A safely pre-provider attempt may be resumed once, and completed handoff cannot redispatch it.");

    const interruptedOrder = fixture("AZL-POST-ATTEMPT-CRASH");
    interruptedOrder.status = "processing";
    interruptedOrder.fulfilment.status = "processing";
    interruptedOrder.fulfilment.paidHandoff = { version: 1, status: "AWAITING_SUBMISSION", requestedAt: now, availableAt: now, attemptCount: 1, retryable: true, claimToken: "", claimedAt: now, leaseExpiresAt: null, completedAt: null, lastError: null };
    const interruptedRepos = fakeRepositories([interruptedOrder], clock);
    const interruptedAttempt = { _id: "attempt-interrupted", status: "IN_PROGRESS", supplierCodeSnapshot: "FAZERCARDS", supplierReference: "", supplierRequest: {} };
    interruptedRepos.attempts.set("fulfillment:start:AZL-POST-ATTEMPT-CRASH:mapping-1", interruptedAttempt);
    let interruptedDispatches = 0;
    const interruptedService = createPaidFulfillmentHandoffService({ repositories: interruptedRepos, clock, ensurePaidOrderFulfillmentWork: async () => { throw new Error("Existing attempt must be recovered without creating another."); }, dispatchSubmission: () => { interruptedDispatches += 1; return true; } });
    await interruptedService.recoverDue();
    assert.strictEqual(interruptedDispatches, 1, "A restart after attempt creation but before provider claim must resume only the existing attempt.");

    const uncertainRepos = fakeRepositories([newPaidFixture("AZL-UNCERTAIN", now)], clock);
    const uncertainAttempt = { _id: "attempt-uncertain", status: "IN_PROGRESS", supplierCodeSnapshot: "FAZERCARDS", supplierReference: "", supplierRequest: { submissionState: "SUBMISSION_UNCERTAIN" } };
    let unsafeDispatches = 0;
    const uncertainService = createPaidFulfillmentHandoffService({ repositories: uncertainRepos, clock, ensurePaidOrderFulfillmentWork: async () => ({ created: false, reason: "SUPPLIER_FULFILLMENT_ALREADY_BOUND", attempt: uncertainAttempt }), dispatchSubmission: () => { unsafeDispatches += 1; } });
    await uncertainService.processOrder("AZL-UNCERTAIN");
    assert.strictEqual(unsafeDispatches, 0, "Uncertain provider submissions must never be retried automatically.");

    const historicalIds = [
        "AZL-1791561417504-7fb6b02307",
        "AZL-1791564120066-c8f5283736",
        "AZL-HISTORICAL-WITHOUT-HANDOFF"
    ];
    const historicalRepos = fakeRepositories(historicalIds.map(fixture), clock);
    let historicalStarts = 0;
    let historicalDispatches = 0;
    const historicalService = createPaidFulfillmentHandoffService({
        repositories: historicalRepos,
        clock,
        ensurePaidOrderFulfillmentWork: async () => { historicalStarts += 1; throw new Error("Historical orders must not reach fulfillment startup."); },
        dispatchSubmission: () => { historicalDispatches += 1; }
    });
    const historicalRecovery = await historicalService.recoverDue();
    assert.strictEqual(historicalRecovery.processed, 0, "Startup recovery must not discover historical paid orders without an explicit handoff.");
    for (const orderId of historicalIds) {
        const direct = await historicalService.processOrder(orderId);
        assert.strictEqual(direct.processed, false, "Direct processing must not synthesize a handoff for a historical order.");
        assert.strictEqual(historicalRepos.orders.get(orderId).fulfilment.paidHandoff, null, "Historical handoff state must remain unchanged.");
    }
    assert.strictEqual(historicalStarts, 0, "Historical orders without paidHandoff must never reach supplier-start orchestration.");
    assert.strictEqual(historicalDispatches, 0, "Historical orders without paidHandoff must never reach supplier dispatch.");

    const repositorySource = read("backend/services/commerce/orderRepository.js");
    const handoffSource = read("backend/services/paidFulfillmentHandoffService.js");
    const walletSource = read("backend/services/commerce/customerWalletCheckoutService.js");
    const manualSource = read("backend/services/commerce/manualPaymentApplicationService.js");
    const serverSource = read("backend/server.js");
    assert(repositorySource.includes('config.queryField === "paymentStatus" && normalized.toStatus === "paid"'), "Verified PAID transition must atomically enqueue the handoff.");
    assert(walletSource.includes("processPaidFulfillmentHandoff") && walletSource.includes("processHandoff(orderId)"), "Wallet settlement must process the durable handoff.");
    assert(manualSource.includes("processPaidFulfillmentHandoff(order.orderId)"), "Verified webhook/manual provider settlement must process the same durable handoff.");
    assert(serverSource.includes("recoverPaidFulfillmentHandoffs"), "Startup worker must recover durable paid handoffs.");
    assert(!handoffSource.includes("seedMissing"), "Recovery must not seed historical paid orders.");
    assert(!handoffSource.includes("repos.ensure"), "Immediate processing must require an already persisted handoff.");
    assert(handoffSource.includes('"fulfilment.paidHandoff.status": "PENDING"'), "Recovery selection must require explicit paidHandoff state.");

    console.log(JSON.stringify({ result: "PASS", walletPaidHandoff: true, verifiedWebhookHandoff: true, durableFailure: true, frozenDiagnostics: [...diagnosticResults.keys()], sanitizedDiagnosticLogs: diagnosticLogs.length, restartRecovery: true, concurrentClaims: 1, safePreProviderResumes: safeDispatches, uncertainProviderResubmissions: unsafeDispatches, historicalOrdersSelected: historicalRecovery.processed, historicalSupplierStarts: historicalStarts, historicalSupplierDispatches: historicalDispatches, providerCalls: 0, walletDebits: 0, productionWrites: 0 }, null, 2));
}

main().catch(error => { console.error("VERIFY_PAID_FULFILLMENT_HANDOFF_FAILED:", error.stack || error); process.exitCode = 1; });
