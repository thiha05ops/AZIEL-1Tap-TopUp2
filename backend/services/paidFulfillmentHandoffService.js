"use strict";

const crypto = require("crypto");
const CommerceOrder = require("../models/CommerceOrder");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { ensurePaidOrderFulfillmentWork } = require("./paidFulfillmentRoutingService");
const { dispatchSubmission } = require("./suppliers/supplierFulfillmentDispatcher");

const HANDOFF_VERSION = 1;
const DEFAULT_LIMIT = 25;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_RETRY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const RETRYABLE_PRE_ATTEMPT_ERRORS = new Set([
    "FAZERCARDS_PACKAGE_NOT_PRODUCTION_READY",
    "FROZEN_ROUTE_NOT_EXECUTABLE",
    "SUPPLIER_ADAPTER_NOT_CONFIGURED",
    "SUPPLIER_AUTO_FULFILLMENT_DISABLED",
    "FAZERCARDS_AUTO_FULFILLMENT_DISABLED",
    "WONDD_AUTO_FULFILLMENT_DISABLED",
    "SUPPLIER_DISABLED",
    "SUPPLIER_MAPPING_NOT_FOUND",
    "SUPPLIER_NOT_FOUND"
]);
const UNSAFE_SUBMISSION_STATES = new Set(["SUBMISSION_IN_FLIGHT", "SUBMISSION_UNCERTAIN", "ACCEPTED"]);

const clean = value => String(value == null ? "" : value).trim();
const token = () => crypto.randomBytes(16).toString("hex");
const handoffResultSuccessful = result => [
    "SUPPLIER_FULFILLMENT_STARTED",
    "SUPPLIER_FULFILLMENT_ALREADY_BOUND"
].includes(clean(result?.reason));

function defaultRepositories(Order = CommerceOrder, Attempt = FulfillmentAttempt) {
    return {
        async dueIds(limit, now) {
            const rows = await Order.find({
                status: { $in: ["paid", "processing"] },
                paymentStatus: "paid",
                "fulfilment.status": { $in: ["not_started", "processing"] },
                "fulfilment.routeSnapshot.routeType": "SUPPLIER_API",
                $or: [
                    { "fulfilment.paidHandoff.status": "PENDING", "fulfilment.paidHandoff.availableAt": { $lte: now } },
                    { "fulfilment.paidHandoff.status": "BLOCKED", "fulfilment.paidHandoff.retryable": true, "fulfilment.paidHandoff.availableAt": { $lte: now } },
                    { "fulfilment.paidHandoff.status": "AWAITING_SUBMISSION", "fulfilment.paidHandoff.availableAt": { $lte: now } },
                    { "fulfilment.paidHandoff.status": "CLAIMED", "fulfilment.paidHandoff.leaseExpiresAt": { $lte: now } }
                ]
            }).select("orderId").sort({ "fulfilment.paidHandoff.availableAt": 1, createdAt: 1 }).limit(limit).lean();
            return rows.map(row => row.orderId);
        },
        async claim(orderId, claimToken, now, leaseExpiresAt) {
            return Order.findOneAndUpdate({
                orderId,
                status: { $in: ["paid", "processing"] },
                paymentStatus: "paid",
                "fulfilment.status": { $in: ["not_started", "processing"] },
                "fulfilment.routeSnapshot.routeType": "SUPPLIER_API",
                $or: [
                    { "fulfilment.paidHandoff.status": "PENDING", "fulfilment.paidHandoff.availableAt": { $lte: now } },
                    { "fulfilment.paidHandoff.status": "BLOCKED", "fulfilment.paidHandoff.retryable": true, "fulfilment.paidHandoff.availableAt": { $lte: now } },
                    { "fulfilment.paidHandoff.status": "AWAITING_SUBMISSION", "fulfilment.paidHandoff.availableAt": { $lte: now } },
                    { "fulfilment.paidHandoff.status": "CLAIMED", "fulfilment.paidHandoff.leaseExpiresAt": { $lte: now } }
                ]
            }, {
                $set: {
                    "fulfilment.paidHandoff.status": "CLAIMED",
                    "fulfilment.paidHandoff.claimToken": claimToken,
                    "fulfilment.paidHandoff.claimedAt": now,
                    "fulfilment.paidHandoff.leaseExpiresAt": leaseExpiresAt,
                    updatedAt: now
                },
                $inc: { "fulfilment.paidHandoff.attemptCount": 1 }
            }, { returnDocument: "after" }).lean();
        },
        async complete(orderId, claimToken, now, result) {
            return Order.findOneAndUpdate({ orderId, "fulfilment.paidHandoff.status": "CLAIMED", "fulfilment.paidHandoff.claimToken": claimToken }, {
                $set: {
                    "fulfilment.paidHandoff.status": "COMPLETED",
                    "fulfilment.paidHandoff.completedAt": now,
                    "fulfilment.paidHandoff.claimToken": "",
                    "fulfilment.paidHandoff.leaseExpiresAt": null,
                    "fulfilment.paidHandoff.lastResult": clean(result?.reason),
                    "fulfilment.paidHandoff.lastError": null,
                    updatedAt: now
                }
            }, { returnDocument: "after" }).lean();
        },
        async awaitingSubmission(orderId, claimToken, now, availableAt) {
            return Order.findOneAndUpdate({ orderId, "fulfilment.paidHandoff.status": "CLAIMED", "fulfilment.paidHandoff.claimToken": claimToken }, {
                $set: {
                    "fulfilment.paidHandoff.status": "AWAITING_SUBMISSION",
                    "fulfilment.paidHandoff.availableAt": availableAt,
                    "fulfilment.paidHandoff.claimToken": "",
                    "fulfilment.paidHandoff.leaseExpiresAt": null,
                    "fulfilment.paidHandoff.lastResult": "SUPPLIER_ATTEMPT_CREATED",
                    updatedAt: now
                }
            }, { returnDocument: "after" }).lean();
        },
        async block(orderId, claimToken, now, failure) {
            return Order.findOneAndUpdate({ orderId, "fulfilment.paidHandoff.status": "CLAIMED", "fulfilment.paidHandoff.claimToken": claimToken }, {
                $set: {
                    "fulfilment.paidHandoff.status": "BLOCKED",
                    "fulfilment.paidHandoff.retryable": failure.retryable === true,
                    "fulfilment.paidHandoff.availableAt": failure.availableAt,
                    "fulfilment.paidHandoff.claimToken": "",
                    "fulfilment.paidHandoff.leaseExpiresAt": null,
                    "fulfilment.paidHandoff.lastError": { code: failure.errorCode, reason: failure.reason, recordedAt: now },
                    updatedAt: now
                },
                $push: { operationalReferences: { type: "paid_fulfillment_start_failed", reason: failure.reason, errorCode: failure.errorCode, recordedAt: now } }
            }, { returnDocument: "after" }).lean();
        },
        async attemptByIdempotency(idempotencyKey) {
            return Attempt.findOne({ idempotencyKey }).lean();
        }
    };
}

function createPaidFulfillmentHandoffService(dependencies = {}) {
    const clock = dependencies.clock || (() => new Date());
    const repos = dependencies.repositories || defaultRepositories(dependencies.Order, dependencies.Attempt);
    const ensureWork = dependencies.ensurePaidOrderFulfillmentWork || ensurePaidOrderFulfillmentWork;
    const dispatch = dependencies.dispatchSubmission || dispatchSubmission;
    const leaseMs = Math.max(30_000, Number(dependencies.leaseMs || DEFAULT_LEASE_MS));
    const retryMs = Math.max(30_000, Number(dependencies.retryMs || DEFAULT_RETRY_MS));
    let recoveryInFlight = null;

    async function processOrder(orderId) {
        const now = clock();
        const claimToken = token();
        const order = await repos.claim(orderId, claimToken, now, new Date(now.getTime() + leaseMs));
        if (!order) return { processed: false, reason: "HANDOFF_NOT_CLAIMED" };
        let result;
        try {
            const idempotencyKey = `fulfillment:start:${order.orderId}:${clean(order.fulfilment?.routeSnapshot?.supplierMappingId)}`;
            const existingAttempt = await repos.attemptByIdempotency(idempotencyKey);
            result = existingAttempt
                ? { created: false, reason: "SUPPLIER_FULFILLMENT_ALREADY_BOUND", attempt: existingAttempt }
                : await ensureWork(order);
        } catch (error) {
            result = { created: false, reason: "PAID_FULFILLMENT_START_FAILED", errorCode: clean(error?.code || error?.name || "PAID_FULFILLMENT_START_FAILED") };
        }
        if (handoffResultSuccessful(result)) {
            const attempt = result.attempt || await repos.attemptByIdempotency(`fulfillment:start:${order.orderId}:${clean(order.fulfilment?.routeSnapshot?.supplierMappingId)}`);
            const submissionState = clean(attempt?.supplierRequest?.submissionState).toUpperCase();
            const submissionOwned = Boolean(clean(attempt?.supplierReference)) || UNSAFE_SUBMISSION_STATES.has(submissionState);
            if (attempt && submissionOwned) {
                await repos.complete(orderId, claimToken, clock(), result);
                return { processed: true, created: result.created === true, reason: result.reason };
            }
            if (attempt && attempt.status === "IN_PROGRESS") {
                if (result.created !== true) dispatch(attempt.supplierCodeSnapshot, attempt._id);
                const deferredAt = clock();
                await repos.awaitingSubmission(orderId, claimToken, deferredAt, new Date(deferredAt.getTime() + Math.min(retryMs, 60_000)));
                return { processed: true, created: result.created === true, reason: "SUPPLIER_SUBMISSION_AWAITING_DURABLE_CLAIM" };
            }
            result = { created: false, reason: "SUPPLIER_FULFILLMENT_START_FAILED", errorCode: "FULFILLMENT_ATTEMPT_MISSING" };
        }
        const attemptCount = Number(order.fulfilment?.paidHandoff?.attemptCount || 1);
        const errorCode = clean(result?.errorCode || result?.reason || "PAID_FULFILLMENT_START_FAILED");
        const retryable = RETRYABLE_PRE_ATTEMPT_ERRORS.has(errorCode) && attemptCount < MAX_ATTEMPTS;
        await repos.block(orderId, claimToken, clock(), {
            reason: clean(result?.reason || "PAID_FULFILLMENT_START_FAILED"),
            errorCode,
            retryable,
            availableAt: retryable ? new Date(clock().getTime() + retryMs) : null
        });
        return { processed: true, created: false, reason: result?.reason || "PAID_FULFILLMENT_START_FAILED", errorCode, retryable, durablyRecorded: true };
    }

    async function recoverDue({ limit = DEFAULT_LIMIT } = {}) {
        if (recoveryInFlight) return recoveryInFlight;
        recoveryInFlight = (async () => {
            const bounded = Math.max(1, Math.min(100, Number(limit) || DEFAULT_LIMIT));
            const now = clock();
            const orderIds = await repos.dueIds(bounded, now);
            const results = [];
            for (const orderId of orderIds) results.push(await processOrder(orderId));
            return { processed: results.filter(item => item.processed).length, results };
        })().finally(() => { recoveryInFlight = null; });
        return recoveryInFlight;
    }

    return Object.freeze({ processOrder, recoverDue });
}

const service = createPaidFulfillmentHandoffService();
module.exports = Object.freeze({
    HANDOFF_VERSION,
    MAX_ATTEMPTS,
    RETRYABLE_PRE_ATTEMPT_ERRORS,
    createPaidFulfillmentHandoffService,
    processPaidFulfillmentHandoff: service.processOrder,
    recoverPaidFulfillmentHandoffs: service.recoverDue
});
