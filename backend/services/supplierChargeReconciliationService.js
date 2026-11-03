"use strict";

const FulfillmentAttempt = require("../models/FulfillmentAttempt");

const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const AMOUNT_KEYS = ["charged_amount", "chargedAmount", "amount_charged", "actualCharge", "deducted", "netpricedealer", "price_usd"];
const CURRENCY_KEYS = ["charged_currency", "chargedCurrency", "currency", "currency_code"];

function findValue(value, keys, depth = 0) {
    if (!value || typeof value !== "object" || depth > 5) return undefined;
    for (const key of keys) if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
    for (const nested of Object.values(value)) {
        const found = findValue(nested, keys, depth + 1);
        if (found !== undefined) return found;
    }
    return undefined;
}

function reconcileAttempt(attempt = {}) {
    const quote = attempt.supplierRequest?.costAuthoritySnapshot || null;
    const metadata = attempt.supplierResult?.rawMetadata || {};
    const actualAmount = Number(findValue(metadata, AMOUNT_KEYS));
    const actualCurrency = upper(findValue(metadata, CURRENCY_KEYS));
    const quotedAmount = Number(quote?.amount);
    const quotedCurrency = upper(quote?.currency);
    if (!quote || !(quotedAmount > 0) || !quotedCurrency) return { status: "PREORDER_COST_EVIDENCE_MISSING", quotedAmount: null, actualAmount: Number.isFinite(actualAmount) ? actualAmount : null };
    if (!(actualAmount > 0)) return { status: "ACTUAL_CHARGE_UNAVAILABLE", quotedAmount, quotedCurrency, actualAmount: null, note: "The supplier response did not provide a verifiable deduction; the catalog quote is not treated as the settled charge." };
    if (actualCurrency && actualCurrency !== quotedCurrency) return { status: "CURRENCY_MISMATCH", quotedAmount, quotedCurrency, actualAmount, actualCurrency };
    const difference = Number((actualAmount - quotedAmount).toFixed(6));
    return { status: Math.abs(difference) < 0.000001 ? "MATCH" : "DIFFERENCE", quotedAmount, quotedCurrency, actualAmount, actualCurrency: actualCurrency || quotedCurrency, difference, note: difference ? "Investigate reseller discount, provider adjustment, data freshness, or SKU identity before changing pricing." : "" };
}

async function auditHistoricalCharges({ supplierCode = "", limit = 500 } = {}) {
    const query = { status: "SUCCEEDED", ...(supplierCode ? { supplierCodeSnapshot: upper(supplierCode) } : {}) };
    const attempts = await FulfillmentAttempt.find(query).sort({ completedAt: -1 }).limit(Math.min(Number(limit) || 500, 2000)).lean();
    const rows = attempts.map(attempt => ({ fulfillmentId: attempt.fulfillmentId, supplierCode: attempt.supplierCodeSnapshot, productCode: attempt.productCode, packageCode: attempt.packageCode, ...reconcileAttempt(attempt) }));
    return { inspected: rows.length, counts: rows.reduce((out, row) => ({ ...out, [row.status]: (out[row.status] || 0) + 1 }), {}), rows };
}

module.exports = Object.freeze({ reconcileAttempt, auditHistoricalCharges });
