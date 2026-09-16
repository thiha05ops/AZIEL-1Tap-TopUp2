"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const WalletTopup = require("../models/WalletTopup");
const { normalizeThbTopupAmount, assertThWalletTopup } = require("../services/walletTopupPolicy");
const { createAuthoritativeTopup } = require("../services/walletTopupApplicationService");
const { createWalletTopupSettlementService } = require("../services/walletTopupSettlementService");

async function phase3() {
    const legacy = new WalletTopup({ topupId: "LEGACY-1", username: "legacy", amount: 1000, paymentMethod: "manual" });
    await legacy.validate();
    assert.strictEqual(normalizeThbTopupAmount("100"), 100);
    assert.strictEqual(normalizeThbTopupAmount("100.25"), 100.25);
    for (const invalid of ["99.99", "0", "-100", "1e2", "1,000", "abc", "100.001", NaN, Infinity, -0]) {
        assert.throws(() => normalizeThbTopupAmount(invalid));
    }
    assert.deepStrictEqual(assertThWalletTopup({ amount: 100, currency: "THB", region: "TH" }), { amount: 100, currency: "THB", region: "TH" });

    const records = [];
    const model = {
        async findOne(query) { return records.find(item => String(item.customerUserId) === String(query.customerUserId) && item.creationIdempotencyKey === query.creationIdempotencyKey) || null; },
        async create(payload) { records.push({ ...payload }); return records.at(-1); }
    };
    await assert.rejects(() => createAuthoritativeTopup({ amount: 100, paymentMethod: "promptpay" }, { idempotencyKey: "x" }, { model }), error => error.code === "WALLET_TOPUP_AUTH_REQUIRED");
    const context = { user: { id: "507f1f77bcf86cd799439011", username: "alice", email: "a@example.com" }, idempotencyKey: "create-1" };
    const first = await createAuthoritativeTopup({ amount: "100.00", paymentMethod: "promptpay", userId: "forged", username: "forged" }, context, { model });
    const retry = await createAuthoritativeTopup({ amount: "100", paymentMethod: "promptpay" }, context, { model });
    assert.strictEqual(first.topup.customerUserId, context.user.id);
    assert.strictEqual(first.topup.username, "alice");
    assert.strictEqual(retry.idempotent, true);
    await assert.rejects(() => createAuthoritativeTopup({ amount: 300, paymentMethod: "promptpay" }, context, { model }), error => error.code === "WALLET_TOPUP_IDEMPOTENCY_CONFLICT");
    assert.strictEqual(records.length, 1);
}

async function phase6() {
    const topup = { topupId: "WTU-SETTLE", customerUserId: "507f1f77bcf86cd799439011", username: "alice", amount: 300, currency: "THB", paymentAttemptId: "ATT-SETTLE", paymentStatus: "paid", settlementStatus: "pending", walletTransactionId: "" };
    const attempt = { attemptId: "ATT-SETTLE", subjectType: "WALLET_TOPUP", subjectId: topup.topupId, ownerId: String(topup.customerUserId), amount: 300, currency: "THB", status: "PAID" };
    let creditCalls = 0;
    const ledger = { transactionId: "WLC-ONE", createdAt: new Date() };
    const model = {
        findOne: async ({ topupId }) => topupId === topup.topupId ? { ...topup } : null,
        findOneAndUpdate: async (filter, update) => { if (filter.topupId !== topup.topupId) return null; Object.assign(topup, update.$set); return { ...topup }; },
        updateOne: async () => ({ modifiedCount: 1 })
    };
    const userModel = { findOne: async query => query._id === topup.customerUserId && query.username === topup.username ? { _id: topup.customerUserId, username: topup.username } : null };
    const service = createWalletTopupSettlementService({
        walletTopupModel: model,
        userModel,
        paymentAttemptRepository: { findAttemptById: async () => ({ ...attempt }) },
        creditTopup: async () => { creditCalls += 1; return { duplicate: creditCalls > 1, transaction: ledger, balance: 300 }; }
    });
    const first = await service.settlePaidWalletTopup({ attemptId: attempt.attemptId });
    const retry = await service.settlePaidWalletTopup({ attemptId: attempt.attemptId });
    assert.strictEqual(first.credited, true);
    assert.strictEqual(retry.idempotent, true);
    assert.strictEqual(creditCalls, 1, "completed top-up does not invoke wallet credit twice.");
    assert.strictEqual(topup.walletTransactionId, ledger.transactionId);
    assert.strictEqual(topup.settlementStatus, "credited");

    for (const mutation of [
        { ownerId: "other" }, { amount: 301 }, { currency: "MMK" }, { subjectId: "OTHER" }
    ]) {
        topup.settlementStatus = "pending"; topup.walletTransactionId = "";
        const invalidService = createWalletTopupSettlementService({ walletTopupModel: model, userModel, paymentAttemptRepository: { findAttemptById: async () => ({ ...attempt, ...mutation }) }, creditTopup: async () => { throw new Error("must not credit"); } });
        await assert.rejects(() => invalidService.settlePaidWalletTopup({ attemptId: attempt.attemptId }), error => ["WALLET_SETTLEMENT_BINDING_MISMATCH", "WALLET_SETTLEMENT_NOT_FOUND"].includes(error.code));
    }

    topup.paymentAttemptId = "OTHER-ATTEMPT";
    await assert.rejects(() => service.settlePaidWalletTopup({ attemptId: attempt.attemptId }), error => error.code === "WALLET_SETTLEMENT_BINDING_MISMATCH");
    topup.paymentAttemptId = attempt.attemptId;

    topup.settlementStatus = "pending"; topup.walletTransactionId = "";
    let effectiveCredits = 0;
    let ledgerCommitted = false;
    const concurrentService = createWalletTopupSettlementService({
        walletTopupModel: model,
        userModel,
        paymentAttemptRepository: { findAttemptById: async () => ({ ...attempt }) },
        creditTopup: async () => {
            await Promise.resolve();
            if (!ledgerCommitted) { ledgerCommitted = true; effectiveCredits += 1; }
            return { duplicate: effectiveCredits > 1, transaction: ledger, balance: 300 };
        }
    });
    await Promise.all([
        concurrentService.settlePaidWalletTopup({ attemptId: attempt.attemptId }),
        concurrentService.settlePaidWalletTopup({ attemptId: attempt.attemptId })
    ]);
    assert.strictEqual(effectiveCredits, 1, "concurrent settlement has one effective ledger credit.");

    topup.settlementStatus = "pending"; topup.walletTransactionId = "";
    let crashed = false;
    const recoveryService = createWalletTopupSettlementService({
        walletTopupModel: model,
        userModel,
        paymentAttemptRepository: { findAttemptById: async () => ({ ...attempt }) },
        creditTopup: async () => {
            if (!crashed) { crashed = true; throw Object.assign(new Error("temporary ledger outage"), { code: "TEMPORARY" }); }
            return { duplicate: false, transaction: ledger, balance: 300 };
        }
    });
    await assert.rejects(() => recoveryService.settlePaidWalletTopup({ attemptId: attempt.attemptId }));
    assert.strictEqual(attempt.status, "PAID", "settlement failure never rolls payment backward.");
    await recoveryService.settlePaidWalletTopup({ attemptId: attempt.attemptId });
    assert.strictEqual(topup.settlementStatus, "credited", "PAID-before-credit failure is replayable.");
}

function phase7() {
    const root = path.resolve(__dirname, "../..");
    const routes = fs.readFileSync(path.join(root, "backend/routes/wallet.js"), "utf8");
    const frontend = fs.readFileSync(path.join(root, "frontend/js/wallet.js"), "utf8");
    for (const route of [
        'router.post("/wallet/topups"',
        'router.post("/wallet/topups/:topupId/payment-attempts"',
        'router.post("/wallet/topups/:topupId/payment-attempts/:attemptId/receipt"',
        'router.get("/wallet/topups/:topupId"'
    ]) assert(routes.includes(route), `missing typed wallet route: ${route}`);
    assert(routes.includes('customerUserId: ownerId'), "status lookup must enforce authenticated immutable ownership.");
    assert(routes.includes('subjectType: "WALLET_TOPUP"'), "payment initiation must use the typed wallet subject.");
    assert(frontend.includes('PaymentCheckoutSheet.show'), "wallet must reuse the shared checkout sheet.");
    assert(frontend.includes('"/api/wallet/topups"'), "frontend must use authoritative typed top-up creation.");
    assert(!frontend.includes('body: JSON.stringify({\n                username: user.username,\n                amount,\n                paymentMethod'), "typed top-up request must not submit owner authority.");
}

Promise.resolve().then(phase3).then(phase6).then(phase7).then(() => console.log("Wallet top-up typed flow Phase 3-7 verification passed.")).catch(error => { console.error(error); process.exit(1); });
