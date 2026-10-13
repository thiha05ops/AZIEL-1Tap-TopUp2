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
            timeoutMs: positive(env[`${prefix}TIMEOUT_MS`], code === "FAZERCARDS" ? 4 * 60 * 1000 : 60 * 1000),
            maxAttempts: Math.min(5, positive(env[`${prefix}MAX_ATTEMPTS`], 3)),
            retryBaseMs: positive(env[`${prefix}RETRY_BASE_MS`], 1000),
            retryMaxMs: positive(env[`${prefix}RETRY_MAX_MS`], 15000),
            lockTtlMs: positive(env[`${prefix}LOCK_TTL_MS`], 2 * 60 * 1000)
        })];
    }));
    return Object.freeze({ executionEnabled, automatedEnabled, suppliers: Object.freeze(suppliers) });
}
function readWeeklySupplierCostSyncPolicy(env = process.env) {
    return Object.freeze({
        enabled: exactTrue(env.SUPPLIER_WEEKLY_COST_SYNC_ENABLED),
        scheduleTimeZone: "Asia/Bangkok",
        scheduleLocal: "Sunday 03:00",
        cronUtc: "0 20 * * 6",
        maximumObservationAgeMs: positive(env.SUPPLIER_WEEKLY_COST_MAX_AGE_MS, 24 * 60 * 60 * 1000),
        maximumAutomaticChangePercent: Math.min(100, positive(env.SUPPLIER_WEEKLY_COST_MAX_CHANGE_PERCENT, 20)),
        jobLeaseTtlMs: positive(env.SUPPLIER_WEEKLY_COST_JOB_LEASE_TTL_MS, 10 * 60 * 1000),
        automationActorId: String(env.SUPPLIER_WEEKLY_COST_AUTOMATION_ACTOR_ID || "").trim()
    });
}
module.exports = Object.freeze({ SUPPLIERS, exactTrue, readSupplierCatalogIngestionPolicy, readWeeklySupplierCostSyncPolicy });
