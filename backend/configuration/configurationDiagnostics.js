const { cloneSnapshot } = require("./configurationDefinition");

function summarizeDefinitions(definitions = [], adapters = [], lifecycle = {}) {
    const summary = {
        lifecycleStatus: lifecycle.status || "CREATED",
        initializedAt: lifecycle.initializedAt || null,
        initializationDurationMs: lifecycle.initializationDurationMs || 0,
        definitionCount: definitions.length,
        adapterCount: adapters.length,
        readyCount: 0,
        partialCount: 0,
        blockedCount: 0,
        unknownCount: 0,
        invalidDefinitions: [],
        missingAdapters: [],
        capabilityMismatches: [],
        ownershipConflicts: [],
        resolutionFailures: [],
        validationFailures: [],
        adapterHealth: adapters.map(adapter => cloneSnapshot(adapter.health?.() || {
            adapterId: adapter.id,
            status: "UNKNOWN"
        }))
    };

    definitions.forEach(definition => {
        const readiness = definition.readiness || "UNKNOWN";
        if (readiness === "READY") summary.readyCount += 1;
        else if (readiness === "PARTIAL") summary.partialCount += 1;
        else if (readiness === "BLOCKED") summary.blockedCount += 1;
        else summary.unknownCount += 1;
    });

    return Object.freeze(summary);
}

module.exports = {
    summarizeDefinitions
};
