"use strict";

const CUSTOMER_PAYABLE_DECIMALS = Object.freeze({
    THB: 2,
    MMK: 0
});

class CustomerPayableAmountError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "CustomerPayableAmountError";
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function payableDecimals(currency) {
    const normalized = String(currency || "").trim().toUpperCase();
    const decimals = CUSTOMER_PAYABLE_DECIMALS[normalized];
    if (decimals === undefined) {
        throw new CustomerPayableAmountError(
            "UNSUPPORTED_SETTLEMENT_CURRENCY",
            "Customer payable currency is unsupported.",
            { currency: normalized }
        );
    }
    return decimals;
}

function finalizeCustomerPayableAmount(amount, currency) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new CustomerPayableAmountError(
            "INVALID_CUSTOMER_PAYABLE_AMOUNT",
            "Customer payable amount must be finite and non-negative."
        );
    }

    const decimals = payableDecimals(currency);
    const scale = 10 ** decimals;
    const rounded = Math.round((numeric + Number.EPSILON) * scale) / scale;
    const finalized = Number(rounded.toFixed(decimals));
    return Object.is(finalized, -0) ? 0 : finalized;
}

module.exports = Object.freeze({
    CUSTOMER_PAYABLE_DECIMALS,
    CustomerPayableAmountError,
    finalizeCustomerPayableAmount,
    payableDecimals
});
