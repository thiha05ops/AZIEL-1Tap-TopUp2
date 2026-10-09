"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const { projectCommerceOrder, projectCommerceManualAttempt } = require("../routes/order")._test;

function commerceOrder(overrides = {}) {
    return {
        _id: "66aa00000000000000000001",
        orderId: "AZL-CONSISTENCY-1",
        owner: { type: "USER", userId: "customer-1" },
        product: { gameCode: "mlbb", gameName: "Mobile Legends", packageCode: "MLBB_42", packageName: "42 Diamonds", region: "TH" },
        commercial: { totalAmount: 27.24, originalUnitPrice: 27.24, discountAmount: 0, currency: "THB", region: "TH" },
        payment: { status: "pending", paymentMethodId: "promptpay", provider: "MANUAL_PROMPTPAY" },
        paymentStatus: "pending",
        fulfilment: { status: "not_started", input: { userId: "123", serverId: "456" } },
        status: "pending_payment",
        operationalReferences: [],
        statusHistory: [],
        createdAt: new Date("2026-08-14T00:00:00Z"),
        updatedAt: new Date("2026-08-14T00:01:00Z"),
        ...overrides
    };
}

function projectionRegressions() {
    const paidAttempt = { attemptId: "PAY-1", orderId: "AZL-CONSISTENCY-1", status: "PAID", provider: "MANUAL_PROMPTPAY" };
    const paid = projectCommerceOrder(commerceOrder(), { paymentAttempt: paidAttempt });
    assert.strictEqual(paid.status, "paid", "paid attempt must normalize stale pending_payment projection to paid");
    assert.strictEqual(paid.paymentStatus, "paid");

    const processing = projectCommerceOrder(commerceOrder({ status: "processing", paymentStatus: "paid", payment: { status: "paid" }, fulfilment: { status: "processing", input: {} } }), { paymentAttempt: paidAttempt });
    assert.strictEqual(processing.status, "processing");
    assert.strictEqual(processing.fulfillmentStatus, "processing");

    const completed = projectCommerceOrder(commerceOrder({ status: "completed", paymentStatus: "paid", payment: { status: "paid" }, fulfilment: { status: "completed", input: {} }, operationalReferences: [{ type: "manual_payment_receipt" }] }), { paymentAttempt: { ...paidAttempt, status: "PENDING" } });
    assert.strictEqual(completed.status, "completed", "terminal status must outrank stale attempt");
    assert.strictEqual(completed.paymentStatus, "paid");
    assert.strictEqual(completed.fulfillmentStatus, "completed");
    assert.strictEqual(completed.recoverable, false);

    const supplierFields = commerceOrder({
        fulfilment: { status: "not_started", input: { userId: "439488505", zoneId: "-", accountFields: [
            { key: "playerId", label: "Player ID", value: "439488505" },
            { key: "serverId", label: "Server ID", value: "16623" }
        ] } }
    });
    assert.strictEqual(projectCommerceOrder(supplierFields).userId, "439488505", "Customer order projection must display verified playerId as User ID.");
    assert.strictEqual(projectCommerceOrder(supplierFields).zoneId, "16623", "Customer order projection must display verified serverId.");
    const manual = projectCommerceManualAttempt({ attemptId: "PAY-FIELDS", ownerId: "customer-1", status: "PAID", amount: 54, currency: "THB" }, supplierFields);
    assert.strictEqual(manual.userId, "439488505", "Manual/Admin Commerce projection must display verified playerId as User ID.");
    assert.strictEqual(manual.zoneId, "16623", "Manual/Admin Commerce projection must display verified serverId.");

    const blockedHandoff = commerceOrder({
        fulfilment: {
            status: "not_started",
            input: { accountFields: [] },
            routeSnapshot: { routeType: "SUPPLIER_API", supplierCode: "FAZERCARDS", supplierMappingId: "mapping-1" },
            paidHandoff: { status: "BLOCKED", lastError: { code: "FROZEN_ROUTE_NOT_EXECUTABLE", reason: "SUPPLIER_FULFILLMENT_START_FAILED", blockers: ["PROVIDER_FEATURE_GATE_OFF"] } }
        }
    });
    const projectedBlocked = projectCommerceOrder(blockedHandoff);
    assert.strictEqual(projectedBlocked.fulfillment.supplierCode, "FAZERCARDS", "Admin must show frozen supplier identity before an attempt exists.");
    assert.strictEqual(projectedBlocked.fulfillment.handoffStatus, "BLOCKED", "Admin must show durable paid-handoff state.");
    assert.strictEqual(projectedBlocked.fulfillment.failureCode, "FROZEN_ROUTE_NOT_EXECUTABLE", "Admin must show the safe pre-attempt blocker.");
    assert.deepStrictEqual(projectedBlocked.fulfillment.failureBlockers, ["PROVIDER_FEATURE_GATE_OFF"], "Admin must show safe frozen-readiness blocker codes.");
}

function main() {
    projectionRegressions();
    const payableSubjectAdapter = read("backend/services/commerce/commerceOrderPayableSubjectAdapter.js");
    const routes = read("backend/routes/order.js");
    const recovery = read("backend/services/commerce/commercePaymentRecoveryService.js");
    const tracking = read("frontend/js/tracking.js");

    assert(payableSubjectAdapter.includes('targetStatus === "paid"') && payableSubjectAdapter.includes('fromStatuses: ["pending_payment"]') && payableSubjectAdapter.includes('toStatus: "paid"'), "Payment approval must transition CommerceOrder pending_payment to paid through the payable-subject adapter.");
    assert(routes.includes("async function projectOwnedCommerceOrders"), "Recent and exact lookup must share hydrated Commerce projection.");
    assert(routes.includes("paymentAttempt: paymentByOrder.get(order.orderId)"), "Customer projection must hydrate latest PaymentAttempt.");
    assert(routes.includes("fulfillmentAttempts: fulfillmentByOrder.get(String(order._id))"), "Customer projection must hydrate fulfillment state.");
    assert(routes.includes('const terminalCompleted = persistedOrderStatus === "completed"'), "Completed top-level state must have terminal precedence.");
    assert(routes.includes('normalizedPaymentStatus = terminalCompleted') && routes.includes('? "paid"'), "Completed projection must not regress to pending payment.");
    assert(routes.includes('recoverable: normalizedOrderStatus === "pending_payment"'), "Customer DTO must expose canonical recoverability.");
    assert(recovery.includes('RECOVERABLE_ORDER_STATUSES') && recovery.includes('new Set(["pending_payment"])'), "Recovery must include only pending-payment orders.");
    assert(recovery.includes('RECOVERABLE_ORDER_PAYMENT_STATUSES') && recovery.includes('new Set(["pending", "unpaid"])'), "Paid/completed orders must be excluded from recovery.");
    assert(tracking.includes('window.AZIEL.authFetch("/api/order/user/me")') && tracking.includes('trackingApiUrl("/api/order/user/me")'), "Recent Orders must use the authenticated session client with the credentialed fetch compatibility path.");
    assert(tracking.includes('orderStatus === "pending"') && tracking.includes('order.receiptSubmitted === true'), "Stale receipt evidence must not override a completed customer order.");
    assert(routes.includes('"owner.userId": String(req.user?._id'), "Commerce visibility must remain owner-isolated.");

    console.log("Commerce customer state, Recent Orders, terminal precedence, ownership, and recovery contracts passed.");
}

main();
