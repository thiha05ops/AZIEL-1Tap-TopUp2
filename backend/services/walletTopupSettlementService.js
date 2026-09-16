"use strict";

const WalletTopup = require("../models/WalletTopup");
const User = require("../models/User");
const paymentAttemptRepository = require("./commerce/paymentAttemptRepository");
const { creditTopup } = require("./walletService");

class WalletTopupSettlementError extends Error {
    constructor(code, message) { super(message); this.name = "WalletTopupSettlementError"; this.code = code; }
}

function text(value) { return String(value || "").trim(); }
function upper(value) { return text(value).toUpperCase(); }

function createWalletTopupSettlementService(dependencies = {}) {
    const model = dependencies.walletTopupModel || WalletTopup;
    const userModel = dependencies.userModel || User;
    const attempts = dependencies.paymentAttemptRepository || paymentAttemptRepository;
    const credit = dependencies.creditTopup || creditTopup;
    const clock = dependencies.clock || (() => new Date());

    async function loadTopup(topupId) {
        let query = model.findOne({ topupId });
        if (typeof query.lean === "function") query = query.lean();
        return query.exec ? query.exec() : query;
    }

    async function settlePaidWalletTopup({ attemptId, topupId } = {}) {
        const attempt = await attempts.findAttemptById({ attemptId: text(attemptId) });
        const subjectId = text(topupId || attempt?.subjectId);
        const topup = await loadTopup(subjectId);
        if (!attempt || !topup) throw new WalletTopupSettlementError("WALLET_SETTLEMENT_NOT_FOUND", "Wallet top-up settlement authority was not found.");
        const ownerId = text(topup.customerUserId?._id || topup.customerUserId);
        if (upper(attempt.status) !== "PAID" || upper(attempt.subjectType) !== "WALLET_TOPUP" || text(attempt.subjectId) !== text(topup.topupId) ||
            text(attempt.ownerId) !== ownerId || Number(attempt.amount) !== Number(topup.amount) || upper(attempt.currency) !== upper(topup.currency) || text(topup.paymentAttemptId) !== text(attempt.attemptId)) {
            throw new WalletTopupSettlementError("WALLET_SETTLEMENT_BINDING_MISMATCH", "Wallet top-up payment binding is invalid.");
        }
        let ownerQuery = userModel.findOne({ _id: ownerId, username: topup.username });
        if (typeof ownerQuery.select === "function") ownerQuery = ownerQuery.select("_id username");
        if (typeof ownerQuery.lean === "function") ownerQuery = ownerQuery.lean();
        const walletOwner = ownerQuery.exec ? await ownerQuery.exec() : await ownerQuery;
        if (!walletOwner) throw new WalletTopupSettlementError("WALLET_SETTLEMENT_OWNER_MISMATCH", "Wallet top-up owner no longer matches the wallet account.");
        if (text(topup.settlementStatus) === "credited" && topup.walletTransactionId) return { credited: true, idempotent: true, topup };
        try {
            const result = await credit(topup, { requireTransaction: true });
            const transactionId = text(result?.transaction?.transactionId);
            if (!transactionId) throw new WalletTopupSettlementError("WALLET_SETTLEMENT_LEDGER_MISSING", "Wallet credit did not return a ledger transaction.");
            const updated = await model.findOneAndUpdate(
                { topupId: topup.topupId, paymentAttemptId: attempt.attemptId },
                { $set: { status: "completed", paymentStatus: "paid", settlementStatus: "credited", walletTransactionId: transactionId, creditedAt: result.transaction.createdAt || clock(), settlementError: { code: "", message: "", recordedAt: null } } },
                { returnDocument: "after", runValidators: true }
            );
            return { credited: true, idempotent: result.duplicate === true, topup: updated, transaction: result.transaction, balance: result.balance };
        } catch (error) {
            await model.updateOne(
                { topupId: topup.topupId, settlementStatus: { $ne: "credited" } },
                { $set: { settlementStatus: "failed", settlementError: { code: text(error.code || error.name), message: text(error.message).slice(0, 300), recordedAt: clock() } } }
            ).catch(() => null);
            throw error;
        }
    }

    return Object.freeze({ settlePaidWalletTopup });
}

const defaultService = createWalletTopupSettlementService();
module.exports = Object.freeze({ createWalletTopupSettlementService, settlePaidWalletTopup: defaultService.settlePaidWalletTopup, WalletTopupSettlementError });
