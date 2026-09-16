"use strict";

const crypto = require("crypto");
const WalletTopup = require("../models/WalletTopup");
const { assertThWalletTopup } = require("./walletTopupPolicy");

class WalletTopupApplicationError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message); this.name = "WalletTopupApplicationError"; this.code = code; this.statusCode = statusCode;
    }
}

function text(value) { return String(value || "").trim(); }
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function topupId() { return `WTU-${Date.now()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`; }

function authenticatedUser(user = {}) {
    const id = text(user._id || user.id);
    if (!id) throw new WalletTopupApplicationError("WALLET_TOPUP_AUTH_REQUIRED", "Authentication is required.", 401);
    const username = text(user.username);
    if (!username) throw new WalletTopupApplicationError("WALLET_TOPUP_OWNER_INVALID", "Authenticated wallet owner is unavailable.", 403);
    return { id, username, email: text(user.email).toLowerCase() };
}

async function createAuthoritativeTopup(input = {}, context = {}, dependencies = {}) {
    const owner = authenticatedUser(context.user);
    const policy = assertThWalletTopup({ amount: input.amount, region: "TH", currency: "THB" });
    const paymentMethod = text(input.paymentMethod).toLowerCase();
    if (!paymentMethod || paymentMethod === "wallet") throw new WalletTopupApplicationError("WALLET_TOPUP_METHOD_INVALID", "Select a valid payment method.", 422);
    const idempotencyKey = text(context.idempotencyKey);
    if (!idempotencyKey) throw new WalletTopupApplicationError("WALLET_TOPUP_IDEMPOTENCY_REQUIRED", "Idempotency-Key is required.", 400);
    const creationFingerprint = fingerprint({ amount: policy.amount, currency: policy.currency, region: policy.region, paymentMethod });
    const model = dependencies.model || WalletTopup;
    const existing = await model.findOne({ customerUserId: owner.id, creationIdempotencyKey: idempotencyKey });
    if (existing) {
        if (existing.creationFingerprint !== creationFingerprint) throw new WalletTopupApplicationError("WALLET_TOPUP_IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used for a different top-up.", 409);
        return { topup: existing, idempotent: true };
    }
    try {
        const topup = await model.create({
            topupId: topupId(), username: owner.username, customerEmail: owner.email, customerUserId: owner.id,
            amount: policy.amount, currency: policy.currency, region: policy.region, paymentMethod,
            paymentProvider: text(input.paymentProvider), paymentSnapshot: input.paymentSnapshot || {},
            paymentStatus: "unpaid", settlementStatus: "not_ready", status: "pending",
            creationIdempotencyKey: idempotencyKey, creationFingerprint
        });
        return { topup, idempotent: false };
    } catch (error) {
        if (error?.code === 11000) {
            const raced = await model.findOne({ customerUserId: owner.id, creationIdempotencyKey: idempotencyKey });
            if (raced?.creationFingerprint === creationFingerprint) return { topup: raced, idempotent: true };
            throw new WalletTopupApplicationError("WALLET_TOPUP_IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used for a different top-up.", 409);
        }
        throw error;
    }
}

module.exports = Object.freeze({ createAuthoritativeTopup, authenticatedUser, WalletTopupApplicationError });
