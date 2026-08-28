"use strict";

const SUPPLIER_GATE_MODES = Object.freeze({
    LEGACY_PRODUCT_ONLY: "LEGACY_PRODUCT_ONLY",
    SUPPLIER_AND_PRODUCT: "SUPPLIER_AND_PRODUCT",
    SUPPLIER_ONLY: "SUPPLIER_ONLY"
});
const SUPPLIER_GATE_KEYS = Object.freeze({
    WONDD: "WONDD_AUTO_FULFILLMENT_ENABLED",
    FAZERCARDS: "FAZERCARDS_AUTO_FULFILLMENT_ENABLED"
});

const normalizeSupplierCode = value => String(value == null ? "" : value).trim().toUpperCase();
const explicitTrue = value => String(value == null ? "" : value).trim().toLowerCase() === "true";

function resolveSupplierGateMode(env = process.env) {
    const configured = String(env.AZIEL_SUPPLIER_GATE_MODE || "").trim().toUpperCase();
    if (!configured) return SUPPLIER_GATE_MODES.LEGACY_PRODUCT_ONLY;
    if (!Object.values(SUPPLIER_GATE_MODES).includes(configured)) throw Object.assign(new Error(`Unsupported supplier gate mode: ${configured}`), { code: "SUPPLIER_GATE_MODE_INVALID" });
    return configured;
}

function supplierAutoFulfillmentGateState(supplierCode, env = process.env) {
    const normalized = normalizeSupplierCode(supplierCode);
    const key = SUPPLIER_GATE_KEYS[normalized];
    const mode = resolveSupplierGateMode(env);
    const supplierGateEnabled = Boolean(key) && explicitTrue(env[key]);
    return Object.freeze({ supplierCode: normalized, supported: Boolean(key), gateKey: key || "", mode, supplierGateEnabled });
}

function isSupplierAutoFulfillmentEnabled(supplierCode, env = process.env) {
    return supplierAutoFulfillmentGateState(supplierCode, env).supplierGateEnabled;
}

function effectiveAutoFulfillmentGateState({ supplierCode, productGateEnabled, env = process.env } = {}) {
    const supplier = supplierAutoFulfillmentGateState(supplierCode, env);
    const productEnabled = productGateEnabled === true;
    const effectiveGateEnabled = supplier.supported && (
        supplier.mode === SUPPLIER_GATE_MODES.LEGACY_PRODUCT_ONLY
            ? productEnabled
            : supplier.mode === SUPPLIER_GATE_MODES.SUPPLIER_AND_PRODUCT
                ? supplier.supplierGateEnabled && productEnabled
                : supplier.supplierGateEnabled
    );
    const blockerCode = effectiveGateEnabled ? "" : !supplier.supported
        ? "SUPPLIER_AUTO_FULFILLMENT_UNSUPPORTED"
        : supplier.mode !== SUPPLIER_GATE_MODES.LEGACY_PRODUCT_ONLY && !supplier.supplierGateEnabled
            ? "SUPPLIER_AUTO_FULFILLMENT_DISABLED"
            : "PRODUCT_AUTO_FULFILLMENT_DISABLED";
    return Object.freeze({ ...supplier, productGateEnabled: productEnabled, effectiveGateEnabled, blockerCode });
}

function assertSupplierAutoFulfillmentEnabled(supplierCode, env = process.env) {
    const state = supplierAutoFulfillmentGateState(supplierCode, env);
    if (!state.supported || !state.supplierGateEnabled) throw Object.assign(new Error(`${state.supplierCode || "UNKNOWN"} automatic fulfillment is disabled by the supplier emergency switch.`), { code: "SUPPLIER_AUTO_FULFILLMENT_DISABLED", gateState: state });
    return state;
}

module.exports = Object.freeze({ SUPPLIER_GATE_MODES, SUPPLIER_GATE_KEYS, resolveSupplierGateMode, supplierAutoFulfillmentGateState, isSupplierAutoFulfillmentEnabled, effectiveAutoFulfillmentGateState, assertSupplierAutoFulfillmentEnabled });
