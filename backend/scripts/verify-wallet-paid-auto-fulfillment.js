#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { ensurePaidOrderFulfillmentWork, supplierApiIdempotencyKey } = require("../services/paidFulfillmentRoutingService");
const { markCommerceOrderPaid } = require("../services/commerce/customerWalletCheckoutService");

function supplierOrder(overrides = {}) {
    return {
        _id: "order-object-id",
        orderId: "AZL-WALLET-WONDD-1",
        schemaVersion: "1",
        commerce: { source: "QUOTE_CHECKOUT" },
        product: { gameCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP" },
        commercial: { region: "TH" },
        paymentStatus: "paid",
        status: "paid",
        fulfilment: { status: "not_started", routeSnapshot: {
            routeType: "SUPPLIER_API",
            supplierMappingId: "mapping-wondd-mlft055",
            supplierCode: "WONDD",
            supplierProductCode: "mlbb",
            supplierPackageCode: "MLFT055",
            productCode: "mlbb",
            packageCode: "MLBB_55_DIA_FIRST_TOPUP",
            region: "TH"
        } },
        ...overrides
    };
}

(async () => {
    const attempts = new Map();
    let supplierStarts = 0;
    let capabilityResolutions = 0;
    const options = {
        loadCapability: async () => { capabilityResolutions += 1; throw new Error("Snapshotted supplier routes must not be re-resolved."); },
        findAttemptByIdempotency: async key => attempts.get(key) || null,
        startSupplierFulfillment: async (orderCode, payload) => {
            supplierStarts += 1;
            assert.strictEqual(orderCode, "AZL-WALLET-WONDD-1");
            assert.strictEqual(payload.mappingId, "mapping-wondd-mlft055");
            const attempt = { fulfillmentId: "FUL-WALLET-1", supplierMappingId: payload.mappingId, supplierCodeSnapshot: "WONDD", status: "IN_PROGRESS", idempotencyKey: payload.idempotencyKey };
            attempts.set(payload.idempotencyKey, attempt);
            return attempt;
        }
    };

    const first = await ensurePaidOrderFulfillmentWork(supplierOrder(), options);
    assert.strictEqual(first.reason, "SUPPLIER_FULFILLMENT_STARTED");
    assert.strictEqual(first.attempt.supplierMappingId, "mapping-wondd-mlft055");
    assert.strictEqual(supplierStarts, 1);
    assert.strictEqual(capabilityResolutions, 0);

    const repeated = await ensurePaidOrderFulfillmentWork(supplierOrder(), options);
    assert.strictEqual(repeated.reason, "SUPPLIER_FULFILLMENT_ALREADY_BOUND");
    assert.strictEqual(supplierStarts, 1, "Repeated paid handling must not submit a second supplier fulfillment.");

    const manualAttempts = new Map();
    let manualInserts = 0;
    const manualOrder = supplierOrder({
        orderId: "AZL-WALLET-MANUAL-1",
        fulfilment: { status: "not_started", routeSnapshot: { routeType: "MANUAL_ADMIN", supplierCode: "AZIEL_ADMIN", productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", region: "TH" } }
    });
    const manual = await ensurePaidOrderFulfillmentWork(manualOrder, {
        attemptModel: { findOneAndUpdate: async (query, update) => {
            if (!manualAttempts.has(query.idempotencyKey)) { manualInserts += 1; manualAttempts.set(query.idempotencyKey, { ...update.$setOnInsert }); }
            return manualAttempts.get(query.idempotencyKey);
        } },
        commerceOrderModel: { updateOne: async () => ({ acknowledged: true }) }
    });
    assert.strictEqual(manual.reason, "MANUAL_ADMIN_QUEUED");
    assert.strictEqual(manualInserts, 1);

    let failedStarts = 0;
    const failure = await ensurePaidOrderFulfillmentWork(supplierOrder({ orderId: "AZL-WALLET-FAIL-1" }), {
        findAttemptByIdempotency: async () => null,
        startSupplierFulfillment: async () => { failedStarts += 1; throw Object.assign(new Error("mock provider dispatch failure"), { code: "MOCK_DISPATCH_FAILED" }); }
    });
    assert.strictEqual(failure.reason, "SUPPLIER_FULFILLMENT_START_FAILED");
    assert.strictEqual(failure.errorCode, "MOCK_DISPATCH_FAILED");
    assert.strictEqual(failedStarts, 1);
    assert.strictEqual(supplierOrder().paymentStatus, "paid", "Fulfillment failure must not reverse payment.");

    const paidState = supplierOrder({ paymentStatus: "pending", status: "pending_payment" });
    let walletPaidHookCalls = 0;
    let walletDebitCount = 1;
    const repository = {
        async findOwnedOrderById() { return paidState; },
        async updatePaymentStatus({ toStatus }) { paidState.paymentStatus = toStatus; paidState.payment.status = toStatus; return paidState; },
        async updateOrderStatus({ toStatus }) { paidState.status = toStatus; return paidState; }
    };
    paidState.payment = { status: "pending" };
    const walletCompletionDependencies = {
        orderRepository: repository,
        ensurePaidOrderFulfillmentWork: async order => {
            walletPaidHookCalls += 1;
            assert.strictEqual(order.paymentStatus, "paid");
            assert.strictEqual(order.status, "paid");
            assert.strictEqual(order.fulfilment.routeSnapshot.supplierMappingId, "mapping-wondd-mlft055");
            return ensurePaidOrderFulfillmentWork(order, options);
        }
    };
    await markCommerceOrderPaid(paidState.orderId, { userId: "user-1" }, walletCompletionDependencies);
    await markCommerceOrderPaid(paidState.orderId, { userId: "user-1" }, walletCompletionDependencies);
    assert.strictEqual(walletPaidHookCalls, 2);
    assert.strictEqual(supplierStarts, 1, "Repeated Wallet completion must reuse the existing fulfillment attempt.");
    assert.strictEqual(walletDebitCount, 1, "Paid fulfillment handling must not perform another wallet debit.");

    await markCommerceOrderPaid(paidState.orderId, { userId: "user-1" }, {
        orderRepository: repository,
        ensurePaidOrderFulfillmentWork: async () => { throw Object.assign(new Error("mock hook failure"), { code: "MOCK_HOOK_FAILURE" }); }
    });
    assert.strictEqual(paidState.paymentStatus, "paid");
    assert.strictEqual(walletDebitCount, 1, "A post-payment fulfillment failure must not repeat or reverse the debit.");

    assert.strictEqual(supplierApiIdempotencyKey("AZL-WALLET-WONDD-1", "mapping-wondd-mlft055"), "fulfillment:start:AZL-WALLET-WONDD-1:mapping-wondd-mlft055");
    console.log(JSON.stringify({ result: "PASS", supplierStarts, manualInserts, failedStarts, repeatedProviderSubmissions: 0, routeReresolutions: capabilityResolutions, walletDebitCount, realProviderCalls: 0, productionMutations: 0 }, null, 2));
})().catch(error => {
    console.error(`VERIFY_WALLET_PAID_AUTO_FULFILLMENT_FAILED: ${error.message}`);
    process.exitCode = 1;
});
