const { ConfigurationError } = require("./configurationErrors");
const { cloneSnapshot, normalizeContext } = require("./configurationDefinition");

async function resolveConfiguration({ definition, adapter, context = {} }) {
    if (!definition?.id) {
        throw new ConfigurationError("CONFIGURATION_NOT_FOUND", "Configuration definition was not found.", 404);
    }
    if (!adapter) {
        throw new ConfigurationError("CONFIGURATION_ADAPTER_NOT_FOUND", "Configuration adapter was not found.", 404, { configurationId: definition.id });
    }
    if (!adapter.capabilities?.includes("READ")) {
        throw new ConfigurationError("CONFIGURATION_CAPABILITY_UNSUPPORTED", "Configuration adapter does not support read.", 400, { configurationId: definition.id });
    }

    const safeContext = normalizeContext(context);
    const adapterResult = await adapter.read(safeContext);
    const readiness = adapterResult.readiness || { state: "UNKNOWN", reason: "Adapter did not report readiness." };

    return Object.freeze({
        configurationId: definition.id,
        definition: cloneSnapshot(definition),
        context: safeContext,
        configuredValue: cloneSnapshot(adapterResult.configuredValue),
        fallbackValue: cloneSnapshot(adapterResult.fallbackValue),
        effectiveValue: cloneSnapshot(adapterResult.effectiveValue),
        source: cloneSnapshot(adapterResult.source || { type: definition.sourceType, reference: definition.sourceReference }),
        owner: {
            ownerAppId: definition.ownerAppId,
            ownerAdapterId: definition.ownerAdapterId,
            sourceOwner: definition.displayName
        },
        readiness: cloneSnapshot(readiness),
        validation: cloneSnapshot(adapterResult.validation || { valid: false, errors: [], warnings: [] }),
        capabilities: cloneSnapshot(definition.capabilities || []),
        diagnostics: cloneSnapshot(adapterResult.diagnostics || {}),
        resolvedAt: new Date().toISOString()
    });
}

module.exports = {
    resolveConfiguration
};
