"use strict";
const { readSupplierCatalogIngestionPolicy } = require("../../config/supplierCatalogIngestionPolicy");
const { runSupplierCatalogIngestion } = require("./supplierCatalogIngestionOrchestrator");
function createSupplierCatalogIngestionScheduler({ policyReader = () => readSupplierCatalogIngestionPolicy(), run = runSupplierCatalogIngestion, timers = { setInterval, clearInterval }, logger = console } = {}) {
    const active = new Map(), state = { started: false, lastStartedAt: null, suppliers: {} };
    function start() {
        if (state.started) return snapshot();
        state.started = true; state.lastStartedAt = new Date();
        const policy = policyReader();
        if (!policy.executionEnabled || !policy.automatedEnabled) return snapshot();
        for (const supplierPolicy of Object.values(policy.suppliers)) {
            if (!supplierPolicy.enabled) continue;
            state.suppliers[supplierPolicy.supplierCode] = { registered: true, intervalMs: supplierPolicy.intervalMs, inFlight: false, lastResult: null };
            const tick = async () => {
                const row = state.suppliers[supplierPolicy.supplierCode];
                if (row.inFlight) return;
                row.inFlight = true;
                try { row.lastResult = { ok: true, at: new Date(), value: await run({ supplierCode: supplierPolicy.supplierCode, trigger: "SCHEDULED", reason: "Configured automated catalog ingestion" }) }; }
                catch (error) { row.lastResult = { ok: false, at: new Date(), code: error.code || error.name }; logger.error?.("Supplier catalog scheduled ingestion failed", { supplierCode: supplierPolicy.supplierCode, code: error.code || error.name }); }
                finally { row.inFlight = false; }
            };
            const timer = timers.setInterval(tick, supplierPolicy.intervalMs); timer.unref?.(); active.set(supplierPolicy.supplierCode, timer);
        }
        return snapshot();
    }
    function stop() { for (const timer of active.values()) timers.clearInterval(timer); active.clear(); state.started = false; for (const row of Object.values(state.suppliers)) row.registered = false; return snapshot(); }
    function snapshot() { return { started: state.started, lastStartedAt: state.lastStartedAt, activeTimers: active.size, suppliers: JSON.parse(JSON.stringify(state.suppliers)) }; }
    return Object.freeze({ start, stop, snapshot });
}
const scheduler = createSupplierCatalogIngestionScheduler();
module.exports = Object.freeze({ createSupplierCatalogIngestionScheduler, scheduler });
