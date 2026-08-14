const mongoose = require("mongoose");

const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const {
    applyCursorFilter,
    pageResult,
    parseLimit
} = require("./paginationService");
const { formatPaymentDisplayName } = require("./paymentDisplayNameService");

class WalletError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "WalletError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const VALID_CURRENCIES = new Set(["MMK", "THB"]);
const MAX_METADATA_KEYS = 20;

function normalizeCurrency(currency = "MMK") {
    const value = String(currency || "MMK").trim().toUpperCase();
    return value === "THB" ? "THB" : "MMK";
}

function normalizeAmount(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
        throw new WalletError(
            "INVALID_WALLET_AMOUNT",
            "Invalid wallet amount."
        );
    }

    return value;
}

function walletPath(currency) {
    const normalized = normalizeCurrency(currency);

    if (!VALID_CURRENCIES.has(normalized)) {
        throw new WalletError(
            "WALLET_CURRENCY_MISMATCH",
            "Wallet currency is not supported."
        );
    }

    return `wallet.${normalized}`;
}

function createTransactionId(prefix = "WLT") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sanitizeMetadata(metadata = {}) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};

    return Object.entries(metadata)
        .slice(0, MAX_METADATA_KEYS)
        .reduce((safe, [key, value]) => {
            const safeKey = String(key || "").slice(0, 64);
            if (!safeKey) return safe;

            if (["string", "number", "boolean"].includes(typeof value) || value == null) {
                safe[safeKey] = value;
                return safe;
            }

            safe[safeKey] = String(value).slice(0, 500);
            return safe;
        }, {});
}

function isTransactionUnsupported(error) {
    const text = `${error?.message || ""} ${error?.codeName || ""}`;
    return (
        text.includes("Transaction numbers are only allowed") ||
        text.includes("transactions are not supported") ||
        text.includes("TransactionNotSupported") ||
        text.includes("IllegalOperation")
    );
}

async function getWalletBalance(username, currency = "MMK", options = {}) {
    const normalizedCurrency = normalizeCurrency(currency);
    const user = await User.findOne({ username }).session(options.session || null);

    if (!user) {
        throw new WalletError("WALLET_USER_NOT_FOUND", "User not found.", 404);
    }

    return Number(user.wallet?.[normalizedCurrency] || 0);
}

async function findCommittedByIdempotencyKey(idempotencyKey, session = null) {
    if (!idempotencyKey) return null;

    return WalletTransaction.findOne({
        idempotencyKey,
        status: { $in: ["committed", "completed"] }
    }).session(session);
}

async function mutateWallet(input = {}, options = {}) {
    const direction = input.direction;

    if (!["credit", "debit"].includes(direction)) {
        throw new WalletError("WALLET_TRANSACTION_FAILED", "Invalid wallet direction.");
    }

    const username = String(input.username || "").trim();
    if (!username) {
        throw new WalletError("WALLET_USER_NOT_FOUND", "User not found.", 404);
    }

    const amount = normalizeAmount(input.amount);
    const currency = normalizeCurrency(input.currency);
    const idempotencyKey = String(input.idempotencyKey || "").trim();

    if (!idempotencyKey) {
        throw new WalletError(
            "WALLET_TRANSACTION_FAILED",
            "Wallet transaction identity is required."
        );
    }

    if (options.session) {
        return mutateWalletWithinSession({
            ...input,
            username,
            amount,
            currency,
            idempotencyKey,
            direction
        }, options.session);
    }

    if (options.useTransaction === false) {
        return mutateWalletWithoutTransaction({
            ...input,
            username,
            amount,
            currency,
            idempotencyKey,
            direction
        });
    }

    const session = await mongoose.startSession();

    try {
        let result;

        await session.withTransaction(async () => {
            result = await mutateWalletWithinSession({
                ...input,
                username,
                amount,
                currency,
                idempotencyKey,
                direction
            }, session);
        });

        return result;
    } catch (error) {
        if (isTransactionUnsupported(error)) {
            return mutateWalletWithoutTransaction({
                ...input,
                username,
                amount,
                currency,
                idempotencyKey,
                direction
            });
        }

        if (error?.code === 11000) {
            const existing = await findCommittedByIdempotencyKey(idempotencyKey);
            if (existing) return existingResult(existing, true);
        }

        throw error;
    } finally {
        await session.endSession();
    }
}

async function mutateWalletWithinSession(input, session) {
    const existing = await findCommittedByIdempotencyKey(input.idempotencyKey, session);
    if (existing) return existingResult(existing, true);

    const balanceBefore = await getWalletBalance(input.username, input.currency, { session });
    const path = walletPath(input.currency);
    const inc = input.direction === "credit" ? input.amount : -input.amount;
    const query = { username: input.username };

    if (input.direction === "debit") {
        query[path] = { $gte: input.amount };
    }

    const user = await User.findOneAndUpdate(
        query,
        { $inc: { [path]: inc } },
        { returnDocument: "after", session }
    );

    if (!user) {
        throw new WalletError(
            input.direction === "debit" ? "INSUFFICIENT_WALLET_BALANCE" : "WALLET_USER_NOT_FOUND",
            input.direction === "debit" ? "Insufficient wallet balance." : "User not found.",
            input.direction === "debit" ? 409 : 404
        );
    }

    const balanceAfter = Number(user.wallet?.[input.currency] || 0);
    const [ledger] = await WalletTransaction.create([buildLedgerEntry(input, balanceBefore, balanceAfter)], { session });

    return {
        duplicate: false,
        transaction: ledger,
        balance: balanceAfter,
        balanceBefore,
        balanceAfter,
        currency: input.currency
    };
}

async function mutateWalletWithoutTransaction(input) {
    const existing = await findCommittedByIdempotencyKey(input.idempotencyKey);
    if (existing) return existingResult(existing, true);

    const balanceBefore = await getWalletBalance(input.username, input.currency);
    const path = walletPath(input.currency);
    const inc = input.direction === "credit" ? input.amount : -input.amount;
    const query = { username: input.username };

    if (input.direction === "debit") {
        query[path] = { $gte: input.amount };
    }

    const user = await User.findOneAndUpdate(
        query,
        { $inc: { [path]: inc } },
        { returnDocument: "after" }
    );

    if (!user) {
        throw new WalletError(
            input.direction === "debit" ? "INSUFFICIENT_WALLET_BALANCE" : "WALLET_USER_NOT_FOUND",
            input.direction === "debit" ? "Insufficient wallet balance." : "User not found.",
            input.direction === "debit" ? 409 : 404
        );
    }

    const balanceAfter = Number(user.wallet?.[input.currency] || 0);

    try {
        const ledger = await WalletTransaction.create(buildLedgerEntry(input, balanceBefore, balanceAfter));

        return {
            duplicate: false,
            transaction: ledger,
            balance: balanceAfter,
            balanceBefore,
            balanceAfter,
            currency: input.currency,
            transactionFallback: true
        };
    } catch (error) {
        await User.updateOne({ username: input.username }, { $inc: { [path]: -inc } });

        if (error?.code === 11000) {
            const duplicate = await findCommittedByIdempotencyKey(input.idempotencyKey);
            if (duplicate) return existingResult(duplicate, true);
        }

        throw error;
    }
}

function buildLedgerEntry(input, balanceBefore, balanceAfter) {
    return {
        transactionId: input.transactionId || createTransactionId(input.direction === "credit" ? "WLC" : "WLD"),
        username: input.username,
        orderId: input.orderId || "",
        topupId: input.topupId || "",
        type: input.type || (input.direction === "credit" ? "wallet.adjustment" : "wallet.payment"),
        direction: input.direction,
        amount: input.amount,
        currency: input.currency,
        status: "committed",
        balanceBefore,
        balanceAfter,
        source: input.source || "wallet_service",
        referenceType: input.referenceType || "",
        referenceId: input.referenceId || input.orderId || input.topupId || "",
        idempotencyKey: input.idempotencyKey,
        description: input.description || "",
        performedBy: input.performedBy || "system",
        reversalOf: input.reversalOf || "",
        metadata: sanitizeMetadata(input.metadata)
    };
}

function existingResult(transaction, duplicate = false) {
    return {
        duplicate,
        transaction,
        balance: Number(transaction.balanceAfter ?? 0),
        balanceBefore: Number(transaction.balanceBefore ?? 0),
        balanceAfter: Number(transaction.balanceAfter ?? 0),
        currency: transaction.currency
    };
}

async function creditWallet(input = {}, options = {}) {
    return mutateWallet({
        ...input,
        direction: "credit"
    }, options);
}

async function debitWallet(input = {}, options = {}) {
    return mutateWallet({
        ...input,
        direction: "debit"
    }, options);
}

async function payOrderWithWallet(order, options = {}) {
    if (!order) {
        throw new WalletError("WALLET_ORDER_NOT_FOUND", "Order not found.", 404);
    }

    if (order.status === "paid" || order.paymentStatus === "paid") {
        throw new WalletError(
            "WALLET_ORDER_ALREADY_PAID",
            "This order is already paid.",
            409
        );
    }

    return debitWallet({
        username: order.username,
        amount: order.amount,
        currency: order.currency,
        type: "wallet.payment",
        source: "wallet_payment",
        referenceType: "order",
        referenceId: order.orderId,
        orderId: order.orderId,
        idempotencyKey: `wallet:order:${order.orderId}:payment`,
        description: `Paid for ${order.game} - ${order.packageName}`,
        metadata: {
            orderId: order.orderId,
            game: order.game,
            packageName: order.packageName
        }
    }, options);
}

async function creditTopup(topup, options = {}) {
    if (!topup) {
        throw new WalletError("WALLET_TOPUP_NOT_FOUND", "Topup not found.", 404);
    }

    return creditWallet({
        username: topup.username,
        amount: topup.amount,
        currency: topup.currency,
        type: "wallet.topup",
        source: "wallet_topup",
        referenceType: "topup",
        referenceId: topup.topupId,
        topupId: topup.topupId,
        idempotencyKey: `wallet:topup:${topup.topupId}:credit`,
        description: `Wallet topup via ${formatPaymentDisplayName(topup.paymentMethod, topup.paymentMethod || "Payment")}`,
        metadata: {
            topupId: topup.topupId,
            paymentMethod: topup.paymentMethod,
            paymentProvider: topup.paymentProvider || ""
        }
    }, options);
}

async function creditRefund(order, options = {}) {
    if (!order) {
        throw new WalletError("WALLET_ORDER_NOT_FOUND", "Order not found.", 404);
    }

    return creditWallet({
        username: order.username,
        amount: order.refundAmount || order.amount,
        currency: order.currency,
        type: "wallet.refund",
        source: "wallet_refund",
        referenceType: "refund",
        referenceId: order.orderId,
        orderId: order.orderId,
        idempotencyKey: `wallet:refund:${order.orderId}:credit`,
        description: `Refund for ${order.game} - ${order.packageName}`,
        performedBy: options.performedBy || "admin",
        metadata: {
            orderId: order.orderId,
            refundReason: order.refundReason || order.refundRequestReason || ""
        }
    }, options);
}

async function adjustWallet(input = {}, options = {}) {
    const direction = String(input.direction || "").trim().toLowerCase();
    const amount = normalizeAmount(input.amount);
    const currency = normalizeCurrency(input.currency);
    const adjustmentRef = input.adjustmentRef || createTransactionId("WADJ");

    if (!["credit", "debit"].includes(direction)) {
        throw new WalletError("WALLET_TRANSACTION_FAILED", "Invalid wallet adjustment direction.");
    }

    const reason = String(input.reason || "").trim();
    if (!reason || reason.length > 240) {
        throw new WalletError("WALLET_ADJUSTMENT_REASON_REQUIRED", "Adjustment reason is required.");
    }

    return mutateWallet({
        username: input.username,
        amount,
        currency,
        direction,
        type: "wallet.adjustment",
        source: "admin",
        referenceType: "admin_adjustment",
        referenceId: adjustmentRef,
        idempotencyKey: `wallet:adjustment:${adjustmentRef}`,
        description: "Wallet adjustment",
        performedBy: options.performedBy || input.performedBy || "admin",
        metadata: {
            adjustmentRef,
            reason,
            actor: options.performedBy || input.performedBy || "admin"
        }
    }, options);
}

function projectLedger(transaction = {}) {
    const item = typeof transaction.toObject === "function"
        ? transaction.toObject()
        : transaction;

    const direction =
        item.direction ||
        (item.type === "payment" || item.type === "wallet.payment" ? "debit" : "credit");

    return {
        id: item._id ? String(item._id) : "",
        transactionId: item.transactionId || "",
        username: item.username || "",
        type: item.type || "wallet.transaction",
        direction,
        amount: Number(item.amount || 0),
        currency: normalizeCurrency(item.currency),
        status: item.status || "completed",
        balanceBefore: item.balanceBefore,
        balanceAfter: item.balanceAfter,
        description: item.description || "",
        referenceType: item.referenceType || "",
        referenceId: item.referenceId || item.orderId || item.topupId || "",
        orderId: item.orderId || "",
        topupId: item.topupId || "",
        createdAt: item.createdAt || new Date()
    };
}

function isCanonicalLedgerEntry(item = {}) {
    return Boolean(
        item.direction &&
        item.idempotencyKey &&
        item.source &&
        item.source !== "legacy"
    );
}

async function getWalletTimeline(username, options = {}) {
    const currency = options.currency ? normalizeCurrency(options.currency) : "";
    const limit = parseLimit(options.limit, { defaultLimit: 30, maxLimit: 100 });
    const query = { username };

    if (currency) query.currency = currency;
    if (!options.includeMigration) query.type = { $ne: "wallet.migration" };

    const transactions = await WalletTransaction.find(applyCursorFilter(query, options.cursor))
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();
    const { page, pagination } = pageResult(transactions, limit);
    const balance = currency ? await getWalletBalance(username, currency) : 0;

    return {
        balance,
        currency,
        transactions: page.map(projectLedger),
        nextCursor: pagination.nextCursor,
        pagination
    };
}

async function reconcileWallet(username, currency = "MMK") {
    const normalizedCurrency = normalizeCurrency(currency);
    const transactions = await WalletTransaction.find({
        username,
        currency: normalizedCurrency,
        status: { $in: ["committed", "completed"] }
    }).sort({ createdAt: 1 });

    let openingBaseline = 0;
    let canonicalCredits = 0;
    let canonicalDebits = 0;
    let migrationCount = 0;
    let canonicalCount = 0;
    let legacyCount = 0;

    transactions.forEach(transaction => {
        const item = projectLedger(transaction);
        const raw = typeof transaction.toObject === "function" ? transaction.toObject() : transaction;

        if (!isCanonicalLedgerEntry(raw)) {
            legacyCount++;
            return;
        }

        if (item.type === "wallet.migration") {
            openingBaseline += item.amount;
            migrationCount++;
            return;
        }

        canonicalCount++;

        if (item.direction === "debit") {
            canonicalDebits += item.amount;
        } else if (item.direction === "credit") {
            canonicalCredits += item.amount;
        }
    });

    const storedBalance = await getWalletBalance(username, normalizedCurrency);
    const expectedBalance = openingBaseline + canonicalCredits - canonicalDebits;
    const difference = storedBalance - expectedBalance;
    const matches = Math.abs(difference) < 0.000001;
    const status = matches
        ? "RECONCILED"
        : migrationCount === 0 && legacyCount > 0
            ? "LEGACY_BASELINE_REQUIRED"
            : "MISMATCH";

    return {
        username,
        currency: normalizedCurrency,
        storedBalance,
        openingBaseline,
        canonicalCredits,
        canonicalDebits,
        expectedBalance,
        ledgerBalance: expectedBalance,
        difference,
        transactionCount: transactions.length,
        canonicalCount,
        legacyCount,
        migrationCount,
        status,
        matches
    };
}

module.exports = {
    WalletError,
    creditWallet,
    debitWallet,
    payOrderWithWallet,
    creditTopup,
    creditRefund,
    adjustWallet,
    getWalletBalance,
    getWalletTimeline,
    projectLedger,
    reconcileWallet,
    normalizeCurrency
};
