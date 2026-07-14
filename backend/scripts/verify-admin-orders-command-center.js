const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
    ORDER_STATES,
    getAllowedNextStatuses
} = require("../services/orderStateService");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function verifyTransitionTruth() {
    assert(getAllowedNextStatuses(ORDER_STATES.PENDING_PAYMENT).includes(ORDER_STATES.PAID), "pending_payment should allow paid");
    assert(getAllowedNextStatuses(ORDER_STATES.PAID).includes(ORDER_STATES.PROCESSING), "paid should allow processing");
    assert(getAllowedNextStatuses(ORDER_STATES.PROCESSING).includes(ORDER_STATES.COMPLETED), "processing should allow completed");
    assert(getAllowedNextStatuses(ORDER_STATES.PROCESSING).includes(ORDER_STATES.FAILED), "processing should allow failed");
    assert(!getAllowedNextStatuses(ORDER_STATES.COMPLETED).includes(ORDER_STATES.PENDING_PAYMENT), "completed should not allow pending_payment");
}

function verifyOrderRouteContracts() {
    const source = read("backend/routes/order.js");

    assert(source.includes('router.get("/admin/orders", adminMiddleware'), "Admin orders list must require adminMiddleware");
    assert(source.includes('filter === "manual_review"'), "Admin orders API should support manual_review");
    assert(source.includes('query.status = "pending_payment"'), "Manual review filter should require pending_payment");
    assert(source.includes('"paymentEvidence.url"'), "Manual review should include paymentEvidence.url evidence");
    assert(source.includes('"paymentEvidence.key"'), "Manual review should include paymentEvidence.key evidence");
    assert(source.includes("projectAdminOrder"), "Admin orders should use an explicit projection");
    assert(source.includes("allowedNextStatuses"), "Admin order projection should include allowed transitions");
    assert(source.includes("transitionOrder(order, status"), "Status updates should use canonical transitionOrder");
    assert(!source.includes("ManualPaymentAttempt.find"), "Admin order queues must not query ManualPaymentAttempt");
}

function verifyFrontendCommandCenter() {
    const html = read("frontend/admin.html");
    const ordersJs = read("frontend/js/admin-orders.js");

    assert(html.includes("orders-command-center"), "Orders section should use command center shell");
    assert(html.includes('data-order-filter="manual_review"'), "Manual Review queue tab should exist");
    assert(!html.includes('class="admin-status-select"'), "Unrestricted status dropdown should be removed from HTML");
    assert(ordersJs.includes("getOrderActions"), "Frontend should derive visible actions");
    assert(ordersJs.includes("allowedNextStatuses"), "Frontend should use backend-projected allowed transitions");
    assert(ordersJs.includes("confirmOrderPaid"), "Confirm Paid flow should exist");
    assert(ordersJs.includes("window.AZIEL_UI?.confirm"), "Financial actions should use AZIEL_UI confirmation");
    assert(!ordersJs.includes("confirm(\""), "Native confirm should not be used for order actions");
    assert(ordersJs.includes("getOrderEvidenceUrl"), "Evidence URL projection should exist");
    assert(ordersJs.includes("renderTimeline"), "Persisted timeline should render");
}

function verifyNoSecretsProjected() {
    const source = read("backend/routes/order.js");
    const projectionStart = source.indexOf("function projectAdminOrder");
    const projection = projectionStart >= 0 ? source.slice(projectionStart, source.indexOf("// ADMIN GET ALL ORDERS")) : "";

    assert(!projection.includes("password"), "Admin order projection must not expose password");
    assert(!projection.includes("token"), "Admin order projection must not expose tokens");
    assert(!projection.includes("OTP"), "Admin order projection must not expose OTP data");
    assert(!projection.includes("secret"), "Admin order projection must not expose secrets");
}

function main() {
    verifyTransitionTruth();
    verifyOrderRouteContracts();
    verifyFrontendCommandCenter();
    verifyNoSecretsProjected();
    console.log("Admin orders command center verification checks passed.");
}

main();
