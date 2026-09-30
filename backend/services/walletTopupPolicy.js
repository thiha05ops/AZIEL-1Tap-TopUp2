"use strict";

const TH_WALLET_TOPUP_POLICY = Object.freeze({
    region: "TH",
    currency: "THB",
    minimumAmount: 100,
    decimalPlaces: 2,
    presets: Object.freeze([100, 300, 500, 1000])
});

const MM_WALLET_TOPUP_POLICY = Object.freeze({
    region: "MM",
    currency: "MMK",
    minimumAmount: 1000,
    decimalPlaces: 0,
    presets: Object.freeze([1000, 3000, 5000, 10000])
});

class WalletTopupPolicyError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "WalletTopupPolicyError";
        this.code = code;
        this.statusCode = 422;
    }
}

function normalizeThbTopupAmount(input) {
    if (typeof input !== "number" && typeof input !== "string") throw new WalletTopupPolicyError("WALLET_TOPUP_AMOUNT_INVALID", "Top-up amount is invalid.");
    const raw = String(input).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw) || raw.includes(",") || /e/i.test(raw)) {
        throw new WalletTopupPolicyError("WALLET_TOPUP_AMOUNT_INVALID", "Top-up amount must be a valid THB amount with no more than two decimals.");
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount) || Object.is(amount, -0) || amount < TH_WALLET_TOPUP_POLICY.minimumAmount) {
        throw new WalletTopupPolicyError("WALLET_TOPUP_MINIMUM", "Minimum wallet top-up is ฿100.");
    }
    return Number(amount.toFixed(2));
}

function assertThWalletTopup({ amount, currency = "THB", region = "TH" } = {}) {
    if (String(region).trim().toUpperCase() !== "TH" || String(currency).trim().toUpperCase() !== "THB") {
        throw new WalletTopupPolicyError("WALLET_TOPUP_MARKET_INVALID", "Wallet top-up is available for Thailand THB only.");
    }
    return { amount: normalizeThbTopupAmount(amount), currency: "THB", region: "TH" };
}

function normalizeMmkTopupAmount(input) {
    if (typeof input !== "number" && typeof input !== "string") throw new WalletTopupPolicyError("WALLET_TOPUP_AMOUNT_INVALID", "Top-up amount is invalid.");
    const raw = String(input).trim();
    if (!/^[1-9]\d*$/.test(raw)) throw new WalletTopupPolicyError("WALLET_TOPUP_AMOUNT_INVALID", "Top-up amount must be a whole MMK amount.");
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount) || amount < MM_WALLET_TOPUP_POLICY.minimumAmount) {
        throw new WalletTopupPolicyError("WALLET_TOPUP_MINIMUM", "Minimum wallet top-up is 1,000 MMK.");
    }
    return amount;
}

function assertMmWalletTopup({ amount, currency = "MMK", region = "MM" } = {}) {
    if (String(region).trim().toUpperCase() !== "MM" || String(currency).trim().toUpperCase() !== "MMK") {
        throw new WalletTopupPolicyError("WALLET_TOPUP_MARKET_INVALID", "Myanmar wallet top-up requires MMK.");
    }
    return { amount: normalizeMmkTopupAmount(amount), currency: "MMK", region: "MM" };
}

function assertWalletTopup(input = {}) {
    const region = String(input.region || "").trim().toUpperCase();
    if (region === "TH") return assertThWalletTopup(input);
    if (region === "MM") return assertMmWalletTopup(input);
    throw new WalletTopupPolicyError("WALLET_TOPUP_MARKET_INVALID", "Wallet top-up market is unavailable.");
}

module.exports = Object.freeze({
    TH_WALLET_TOPUP_POLICY,
    MM_WALLET_TOPUP_POLICY,
    WalletTopupPolicyError,
    normalizeThbTopupAmount,
    normalizeMmkTopupAmount,
    assertThWalletTopup,
    assertMmWalletTopup,
    assertWalletTopup
});
