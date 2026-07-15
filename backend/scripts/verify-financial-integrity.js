const fs = require("fs");
const path = require("path");
const assert = require("assert");

const {
    FINANCIAL_OUTCOMES,
    FinancialIntegrityError,
    assertFulfillmentStartAllowed,
    assertFulfillmentSuccessAllowed,
    assertRefundApprovalAllowed,
    assertRefundRequestAllowed,
    projectFinancialActions
} = require("../services/financialIntegrityService");
const { FULFILLMENT_STATUSES } = require("../models/FulfillmentAttempt");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function paidOrder(overrides = {}) {
    return {
        _id: "order-object-id",
        orderId: "ORD-FIN-001",
        username: "qa-user",
        amount: 1490,
        currency: "THB",
        status: "failed",
        paymentStatus: "paid",
        refundRequested: false,
        refunded: false,
        financialOutcome: "",
        ...overrides
    };
}

function attempt(status, overrides = {}) {
    return {
        fulfillmentId: `FUL-${status}`,
        status,
        ...overrides
    };
}

function expectFinancialError(fn, code) {
    assert.throws(
        fn,
        error => error instanceof FinancialIntegrityError && error.code === code
    );
}

function verifyServiceProjection() {
    const failedPaid = paidOrder();
    const actions = projectFinancialActions(failedPaid, []);
    assert.strictEqual(actions.canRequestRefund, true, "failed paid order should permit refund request");
    assert.strictEqual(actions.canStartFulfillment, true, "failed paid order should permit fulfillment retry before refund ownership");
    assert.doesNotThrow(() => assertRefundRequestAllowed(failedPaid, []));
    assert.doesNotThrow(() => assertFulfillmentStartAllowed(failedPaid, []));

    const refundRequested = paidOrder({ status: "refund_requested", refundRequested: true });
    expectFinancialError(() => assertFulfillmentStartAllowed(refundRequested, []), "REFUND_BLOCKS_FULFILLMENT");
    assert.strictEqual(projectFinancialActions(refundRequested, []).canApproveRefund, true, "refund request should permit approval without fulfillment conflict");

    const active = [attempt(FULFILLMENT_STATUSES.IN_PROGRESS)];
    expectFinancialError(() => assertRefundRequestAllowed(failedPaid, active), "FULFILLMENT_ACTIVE");
    expectFinancialError(() => assertRefundApprovalAllowed(refundRequested, active), "FULFILLMENT_ACTIVE");

    const succeeded = [attempt(FULFILLMENT_STATUSES.SUCCEEDED)];
    expectFinancialError(() => assertRefundRequestAllowed(failedPaid, succeeded), "FULFILLMENT_ALREADY_SUCCEEDED");
    expectFinancialError(() => assertRefundApprovalAllowed(refundRequested, succeeded), "FULFILLMENT_ALREADY_SUCCEEDED");

    const completed = paidOrder({ status: "completed", financialOutcome: FINANCIAL_OUTCOMES.FULFILLMENT_SUCCEEDED });
    expectFinancialError(() => assertRefundRequestAllowed(completed, []), "FULFILLMENT_ALREADY_SUCCEEDED");

    const refunded = paidOrder({
        status: "refunded",
        refunded: true,
        financialOutcome: FINANCIAL_OUTCOMES.REFUND_CREDITED
    });
    expectFinancialError(() => assertFulfillmentStartAllowed(refunded, []), "REFUND_BLOCKS_FULFILLMENT");
    expectFinancialError(() => assertFulfillmentSuccessAllowed(refunded, []), "REFUND_BLOCKS_FULFILLMENT");

    const rejected = paidOrder({ status: "refund_rejected", refundRequested: true });
    assert.doesNotThrow(() => assertFulfillmentStartAllowed(rejected, []));
}

function verifySourceGuards() {
    const financialService = read("backend/services/financialIntegrityService.js");
    assert(financialService.includes("findOneAndUpdate"), "financial outcome ownership must use an atomic update");
    assert(financialService.includes("financialOutcome: { $in: [null, \"\", FINANCIAL_OUTCOMES.NONE] }"), "financial outcome lock must only acquire empty ownership");
    assert(financialService.includes("FINANCIAL_OUTCOMES.FULFILLMENT_SUCCEEDED"), "fulfillment terminal outcome must be represented");
    assert(financialService.includes("FINANCIAL_OUTCOMES.REFUND_CREDITED"), "refund terminal outcome must be represented");

    const orderRoutes = read("backend/routes/order.js");
    assert(orderRoutes.includes("session.withTransaction"), "refund approval must run inside a Mongo transaction");
    assert(orderRoutes.includes("assertRefundApprovalAllowed(order, attempts)"), "refund approval must check fulfillment conflicts");
    assert(orderRoutes.includes("acquireFinancialOutcome(order._id, FINANCIAL_OUTCOMES.REFUND_CREDITED"), "refund approval must acquire refund terminal outcome");
    assert(orderRoutes.includes("creditRefund(order, {"), "refund approval must credit wallet through wallet service");
    assert(orderRoutes.includes("session") && orderRoutes.includes("emit: false"), "refund approval must defer realtime transition emit until after commit");
    assert(orderRoutes.includes("ADMIN_AUDIT_ACTIONS.REFUND_APPROVED"), "refund approval must be admin-audited");
    assert(orderRoutes.includes("ADMIN_AUDIT_ACTIONS.REFUND_REJECTED"), "refund rejection must be admin-audited");

    const fulfillmentService = read("backend/services/fulfillmentService.js");
    assert(fulfillmentService.includes("assertFulfillmentStartAllowed(order, financialAttempts)"), "fulfillment start must check refund ownership");
    assert(fulfillmentService.includes("assertFulfillmentSuccessAllowed(order"), "fulfillment success must check refund ownership");
    assert(fulfillmentService.includes("acquireFinancialOutcome(order._id, FINANCIAL_OUTCOMES.FULFILLMENT_SUCCEEDED"), "fulfillment success must acquire fulfillment terminal outcome");
    assert(fulfillmentService.includes("FULFILLMENT_IDEMPOTENCY_REUSED"), "fulfillment start must preserve idempotency reuse guard");

    const walletService = read("backend/services/walletService.js");
    assert(walletService.includes("options.session"), "wallet mutations must accept caller-owned sessions");
    assert(walletService.includes("findCommittedByIdempotencyKey(input.idempotencyKey, session)"), "wallet ledger must preserve idempotency inside session");

    const walletTransaction = read("backend/models/WalletTransaction.js");
    assert(walletTransaction.includes("idempotencyKey"), "wallet transactions must store idempotency keys");
    assert(walletTransaction.includes("unique: true"), "wallet idempotency key must remain unique");

    const orderStateService = read("backend/services/orderStateService.js");
    assert(orderStateService.includes("[ORDER_STATES.REFUND_REJECTED]"), "refund rejection must keep controlled retry path");
    assert(orderStateService.includes("ORDER_STATES.PROCESSING"), "refund rejection retry path must lead back to processing");
    assert(orderStateService.includes("emitCommittedTransition"), "transaction callers must be able to emit after commit");
}

function main() {
    verifyServiceProjection();
    verifySourceGuards();
    console.log("Financial integrity verifier passed.");
}

main();
