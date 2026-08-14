"use strict";

const assert = require("assert");
const {
    AdminOrderCommandError,
    createAdminOrderCommandService
} = require("../services/adminOrderCommandService");

function matches(record, query = {}) {
    if (query.$or) return query.$or.some(item => matches(record, item));
    return Object.entries(query).every(([key, value]) => String(record[key] || "") === String(value));
}

function query(value) {
    return {
        sort() { return Promise.resolve(value); },
        then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
    };
}

function model(records = []) {
    return {
        findOne(filter) {
            return query(records.find(record => matches(record, filter)) || null);
        }
    };
}

async function verify() {
    const legacy = { _id: "64a000000000000000000001", orderId: "LEGACY-1", status: "paid" };
    const commerce = { _id: "64a000000000000000000002", orderId: "COMMERCE-1", status: "pending_payment" };
    const payment = { attemptId: "ATTEMPT-1", orderId: "COMMERCE-1", status: "PENDING" };
    const transitions = [];
    const service = createAdminOrderCommandService({
        LegacyOrder: model([legacy]),
        CommerceOrder: model([commerce]),
        PaymentAttempt: model([payment]),
        transitionLegacyOrder: async (order, status) => {
            transitions.push({ order, status });
            return { changed: true, order: { ...order, status } };
        }
    });

    const bySyntheticId = await service.getAdminDetail("commerce-order:COMMERCE-1");
    assert.strictEqual(bySyntheticId.orderType, "commerce");
    assert.strictEqual(bySyntheticId.order, commerce);
    assert.strictEqual(bySyntheticId.paymentAttempt, payment);

    const byBusinessId = await service.resolve("COMMERCE-1");
    assert.strictEqual(byBusinessId.orderType, "commerce");
    const byMongoId = await service.resolve(commerce._id);
    assert.strictEqual(byMongoId.orderType, "commerce");
    const byAttemptId = await service.getAdminDetail("commerce:ATTEMPT-1");
    assert.strictEqual(byAttemptId.order, commerce);
    assert.strictEqual(byAttemptId.paymentAttempt, payment);

    await assert.rejects(
        service.transitionStatus({ identifier: "COMMERCE-1", status: "completed" }),
        error => error instanceof AdminOrderCommandError && error.code === "INVALID_ORDER_TRANSITION" && error.statusCode === 409
    );
    assert.strictEqual(transitions.length, 0, "Commerce status must not use the legacy transition function.");

    const legacyResult = await service.transitionStatus({ identifier: legacy._id, status: "processing" });
    assert.strictEqual(legacyResult.order.status, "processing");
    assert.strictEqual(transitions.length, 1);

    await assert.rejects(
        service.resolve("missing-order"),
        error => error instanceof AdminOrderCommandError && error.code === "ORDER_NOT_FOUND"
    );
}

verify().then(() => {
    console.log("Admin order command authority verification passed.");
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
