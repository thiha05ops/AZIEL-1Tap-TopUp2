"use strict";
const SUPPLIERS = Object.freeze(["FAZERCARDS", "WONDD"]);
const exactTrue = value => value === "true";
const positive = (value, fallback) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; };
function readSupplierCatalogIngestionPolicy(env = process.env) {
    const executionEnabled = exactTrue(env.SUPPLIER_CATALOG_INGESTION_EXECUTION_ENABLED);
    const automatedEnabled = exactTrue(env.SUPPLIER_CATALOG_AUTOMATED_INGESTION_ENABLED);
    const suppliers = Object.fromEntries(SUPPLIERS.map(code => {
        const prefix = `SUPPLIER_CATALOG_${code}_`;
        return [code, Object.freeze({
            supplierCode: code,
            enabled: exactTrue(env[`${prefix}AUTOMATION_ENABLED`]),
            intervalMs: positive(env[`${prefix}INTERVAL_MS`], 6 * 60 * 60 * 1000),
            timeoutMs: positive(env[`${prefix}TIMEOUT_MS`], 60 * 1000),
            maxAttempts: Math.min(5, positive(env[`${prefix}MAX_ATTEMPTS`], 3)),
            retryBaseMs: positive(env[`${prefix}RETRY_BASE_MS`], 1000),
            retryMaxMs: positive(env[`${prefix}RETRY_MAX_MS`], 15000),
            lockTtlMs: positive(env[`${prefix}LOCK_TTL_MS`], 2 * 60 * 1000)
        })];
    }));
    return Object.freeze({ executionEnabled, automatedEnabled, suppliers: Object.freeze(suppliers) });
}
module.exports = Object.freeze({ SUPPLIERS, exactTrue, readSupplierCatalogIngestionPolicy });
