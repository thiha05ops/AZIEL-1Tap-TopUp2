"use strict";

const PaymentMethod = require("../models/PaymentMethod");
const { paymentMethodCapabilityState } = require("./paymentProviderRegistry");
const { isDingerMethod, dingerAccessDecision } = require("./dinger/dingerPaymentPolicy");
const { isMyanMyanPayMethod, myanMyanPayAccessDecision } = require("./myanmyanpay/myanMyanPayPaymentPolicy");

const RETIRED_MYANMAR_MANUAL_KEYS = new Set(["ayapay", "wavepay", "kbzpay", "mmqr", "manual_bank"]);

function isPublicCheckoutMethod(method = {}, customer = {}) {
    const market = String(method.region || "").trim().toUpperCase();
    const key = String(method.key || "").trim().toLowerCase();
    if (method.enabled !== true) return false;
    // Stored-value checkout is customer/balance dependent and cannot, by
    // itself, make a package generally purchasable in a market.
    if (key === "wallet" || String(method.paymentType || "").toLowerCase() === "wallet") return false;
    if (market === "MM" && RETIRED_MYANMAR_MANUAL_KEYS.has(key)) return false;
    if (isDingerMethod(method)) return dingerAccessDecision(method, customer).allowed === true;
    if (isMyanMyanPayMethod(method)) return myanMyanPayAccessDecision(method, customer).allowed === true;
    return paymentMethodCapabilityState(method).customerVisible === true;
}

async function publicPaymentMarketReadiness(customerMarket, options = {}) {
    const market = String(customerMarket || "").trim().toUpperCase();
    if (!["MM", "TH"].includes(market)) return { ready: false, market, methodKeys: [] };
    const findMethods = options.findMethods || (query => PaymentMethod.find(query).lean());
    const methods = await findMethods({ region: market, enabled: true });
    const eligible = (methods || []).filter(method => isPublicCheckoutMethod(method, options.customer || {}));
    return { ready: eligible.length > 0, market, methodKeys: eligible.map(method => String(method.key || "")) };
}

module.exports = { isPublicCheckoutMethod, publicPaymentMarketReadiness };
