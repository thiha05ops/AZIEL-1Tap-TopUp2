const assert = require("assert");
const fs = require("fs");
const path = require("path");

const adminStatsRouter = require("../routes/adminStats");
const Order = require("../models/Order");
const WalletTopup = require("../models/WalletTopup");
const SupportTicket = require("../models/SupportTicket");
const LiveChat = require("../models/LiveChat");

const ROOT = path.join(__dirname, "../..");
const internals = adminStatsRouter._adminDashboardInternals;

assert(internals, "Admin dashboard internals should be exposed for verification");

function verifyManualEvidenceQuery() {
    const query = internals.manualPaymentReviewQuery();

    assert.strictEqual(query.status, "pending_payment");
    assert(Array.isArray(query.$or), "Manual review query should require evidence");
    assert(query.$or.some(condition => condition.paymentSlip), "paymentSlip should count as evidence");
    assert(query.$or.some(condition => condition["paymentEvidence.url"]), "paymentEvidence.url should count as evidence");
    assert(query.$or.some(condition => condition["paymentEvidence.key"]), "paymentEvidence.key should count as evidence");
    assert(query.$or.some(condition => condition["paymentEvidence.storageKey"]), "paymentEvidence.storageKey should count as evidence");
}

function verifyModelTruthFields() {
    assert(Order.schema.path("status"), "Order.status must exist");
    assert(Order.schema.path("paymentSlip"), "Order.paymentSlip must exist");
    assert(Order.schema.path("paymentEvidence.url"), "Order.paymentEvidence.url must exist");
    assert(WalletTopup.schema.path("status"), "WalletTopup.status must exist");
    assert(SupportTicket.schema.path("unreadByAdmin"), "SupportTicket.unreadByAdmin must exist");
    assert(LiveChat.schema.path("messages"), "LiveChat.messages must exist");
}

function verifyTimezoneBoundary() {
    const bounds = internals.getBangkokTodayBounds(new Date("2026-07-13T12:00:00.000Z"));

    assert.strictEqual(internals.DASHBOARD_TIMEZONE, "Asia/Bangkok");
    assert.strictEqual(bounds.start.toISOString(), "2026-07-12T17:00:00.000Z");
    assert.strictEqual(bounds.end.toISOString(), "2026-07-13T17:00:00.000Z");
}

function verifyCurrencyNormalization() {
    assert.strictEqual(internals.normalizeCurrency("THB"), "THB");
    assert.strictEqual(internals.normalizeCurrency("MMK"), "MMK");
    assert.strictEqual(internals.normalizeCurrency("usd"), "MMK");
    assert.strictEqual(internals.normalizeCurrency(""), "MMK");
}

function verifyRouteContracts() {
    const statsSource = fs.readFileSync(path.join(ROOT, "backend/routes/adminStats.js"), "utf8");
    const orderSource = fs.readFileSync(path.join(ROOT, "backend/routes/order.js"), "utf8");
    const walletSource = fs.readFileSync(path.join(ROOT, "backend/routes/wallet.js"), "utf8");
    const supportSource = fs.readFileSync(path.join(ROOT, "backend/routes/support.js"), "utf8");

    assert(statsSource.includes('router.get("/admin/stats", adminMiddleware'), "Dashboard API must require adminMiddleware");
    assert(orderSource.includes('filter === "manual_review"'), "Orders API should support manual_review filter");
    assert(walletSource.includes('router.get("/admin/wallet/topups", adminMiddleware'), "Wallet topups API must require adminMiddleware");
    assert(supportSource.includes('filter === "unreadByAdmin"'), "Support API should support unreadByAdmin filter");
    assert(!statsSource.includes("ManualPaymentAttempt"), "Dashboard queues must not count ManualPaymentAttempt records");
}

function main() {
    verifyManualEvidenceQuery();
    verifyModelTruthFields();
    verifyTimezoneBoundary();
    verifyCurrencyNormalization();
    verifyRouteContracts();
    console.log("Admin dashboard verification checks passed.");
}

main();
