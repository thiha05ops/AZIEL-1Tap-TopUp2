"use strict";

const exactTrue = value => value === "true";

function readSupplierCostEvidencePolicy(env = process.env) {
    const latestOnlyEnabled = exactTrue(env.SUPPLIER_COST_LATEST_ONLY_ENABLED);
    const v2WriteEnabled = exactTrue(env.SUPPLIER_COST_EVIDENCE_V2_WRITE_ENABLED) && !latestOnlyEnabled;
    const v2ReadEnabled = exactTrue(env.SUPPLIER_COST_EVIDENCE_V2_READ_ENABLED);
    const currentRunLegacyObservationsEnabled = exactTrue(env.SUPPLIER_COST_OBSERVATION_CURRENT_RUN_ONLY_ENABLED);
    const legacyWriteRequested = env.SUPPLIER_COST_EVIDENCE_LEGACY_WRITE_ENABLED !== "false";
    return Object.freeze({
        v2WriteEnabled,
        v2ReadEnabled,
        latestOnlyEnabled,
        currentRunLegacyObservationsEnabled,
        // Fail safe: legacy writes cannot be disabled until the v2 writer is explicitly enabled.
        legacyWriteEnabled: legacyWriteRequested || (!v2WriteEnabled && !latestOnlyEnabled)
    });
}

module.exports = Object.freeze({ exactTrue, readSupplierCostEvidencePolicy });
