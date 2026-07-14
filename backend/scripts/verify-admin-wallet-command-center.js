const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");
const {
    normalizeCurrency,
    projectLedger
} = require("../services/walletService");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function verifyModelTruth() {
    assert(WalletTopup.schema.path("status"), "WalletTopup.status must exist");
    assert(WalletTopup.schema.path("paymentSlip"), "WalletTopup.paymentSlip must exist");
    assert(WalletTopup.schema.path("paymentEvidence.url"), "WalletTopup.paymentEvidence.url must exist");
    assert(WalletTransaction.schema.path("balanceBefore"), "WalletTransaction.balanceBefore must exist");
    assert(WalletTransaction.schema.path("balanceAfter"), "WalletTransaction.balanceAfter must exist");
    assert(WalletTransaction.schema.path("direction"), "WalletTransaction.direction must exist");
    assert(User.schema.path("wallet.MMK"), "User.wallet.MMK must exist");
    assert(User.schema.path("wallet.THB"), "User.wallet.THB must exist");
}

function verifyWalletServiceOwnership() {
    const service = read("backend/services/walletService.js");
    const routes = read("backend/routes/wallet.js");

    assert(service.includes("async function creditTopup"), "creditTopup should own topup credit intent");
    assert(service.includes("idempotencyKey: `wallet:topup:${topup.topupId}:credit`"), "Topup credit should use canonical idempotency key");
    assert(service.includes("async function adjustWallet"), "adjustWallet should own admin adjustment intent");
    assert(routes.includes("const result = await completeWalletTopup(req, topup)"), "Admin approval route should use completeWalletTopup");
    assert(routes.includes("const creditResult = await creditTopup(topup"), "completeWalletTopup should use creditTopup");
    assert(routes.includes("const result = await adjustWallet"), "Admin adjustment route should use walletService.adjustWallet");
    assert(!routes.includes("$inc: { wallet"), "Admin wallet route must not directly increment wallet balance");
}

function verifyAdminRouteContracts() {
    const routes = read("backend/routes/wallet.js");

    assert(routes.includes('router.get("/admin/wallet/topups", adminMiddleware'), "Admin topup list must require adminMiddleware");
    assert(routes.includes('router.get("/admin/wallet/topups/:id/context", adminMiddleware'), "Topup context must require adminMiddleware");
    assert(routes.includes('router.get("/admin/wallet/transactions", adminMiddleware'), "Admin transaction ledger must require adminMiddleware");
    assert(routes.includes("parsePagination"), "Transaction ledger should use bounded pagination");
    assert(routes.includes("Math.min(requestedLimit, 100)"), "Transaction limit should be bounded to 100");
    assert(routes.includes("projectAdminWalletTopup"), "Topups should use Admin-safe projection");
    assert(routes.includes("projectWalletUser"), "Wallet context should use Admin-safe user projection");
    assert(routes.includes("projectLedger"), "Transactions should use ledger projection");
}

function verifyProjectionSafety() {
    const routes = read("backend/routes/wallet.js");
    const projectionStart = routes.indexOf("function projectWalletUser");
    const projection = projectionStart >= 0 ? routes.slice(projectionStart, routes.indexOf("function parsePagination")) : "";

    assert(!projection.includes("password"), "Wallet user projection must not expose password");
    assert(!projection.includes("token"), "Wallet user projection must not expose tokens");
    assert(!projection.includes("OTP"), "Wallet user projection must not expose OTP data");
    assert(!projection.includes("twoFactor"), "Wallet user projection must not expose 2FA data");
}

function verifyLedgerProjection() {
    const projected = projectLedger({
        transactionId: "TX-1",
        username: "tester",
        type: "wallet.topup",
        direction: "credit",
        amount: 500,
        currency: "THB",
        balanceBefore: 120,
        balanceAfter: 620,
        idempotencyKey: "wallet:topup:T1:credit",
        source: "wallet_topup",
        createdAt: new Date("2026-07-14T00:00:00.000Z")
    });

    assert.strictEqual(projected.username, "tester");
    assert.strictEqual(projected.direction, "credit");
    assert.strictEqual(projected.balanceBefore, 120);
    assert.strictEqual(projected.balanceAfter, 620);
    assert.strictEqual(projected.currency, "THB");
    assert.strictEqual(normalizeCurrency("usd"), "MMK");
}

function verifyFrontendContracts() {
    const html = read("frontend/admin.html");
    const walletJs = read("frontend/js/admin-wallet.js");

    assert(html.includes("wallet-command-center"), "Wallet section should use command center shell");
    assert(html.includes('data-wallet-view="pending"'), "Pending topups tab should exist");
    assert(html.includes('data-wallet-view="transactions"'), "Transactions tab should exist");
    assert(html.includes('data-wallet-view="adjustments"'), "Adjustments tab should exist");
    assert(walletJs.includes("/api/admin/wallet/topups/"), "Wallet detail should load topup context");
    assert(walletJs.includes("/api/admin/wallet/transactions"), "Wallet ledger should use Admin transaction endpoint");
    assert(walletJs.includes("/api/admin/wallet/adjust"), "Wallet adjustments should use existing Admin adjustment route");
    assert(walletJs.includes("aziel:admin-dashboard-refresh"), "Wallet actions should refresh dashboard counts");
    assert(!/(^|[^.\w$])confirm\s*\(/.test(walletJs), "Wallet command center should not use native confirm");
}

function main() {
    verifyModelTruth();
    verifyWalletServiceOwnership();
    verifyAdminRouteContracts();
    verifyProjectionSafety();
    verifyLedgerProjection();
    verifyFrontendContracts();
    console.log("Admin wallet command center verification checks passed.");
}

main();
