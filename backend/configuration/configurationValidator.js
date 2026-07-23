const { ConfigurationError } = require("./configurationErrors");
const { cloneSnapshot, normalizeContext } = require("./configurationDefinition");

function validateCandidate({ definition, adapter, value, context = {} }) {
    if (!definition?.id) {
        throw new ConfigurationError("CONFIGURATION_NOT_FOUND", "Configuration definition was not found.", 404);
    }
    if (!adapter) {
        throw new ConfigurationError("CONFIGURATION_ADAPTER_NOT_FOUND", "Configuration adapter was not found.", 404, { configurationId: definition.id });
    }
    const safeContext = normalizeContext(context);
    const validation = adapter.validate(value, safeContext);
    return Object.freeze({
        configurationId: definition.id,
        context: safeContext,
        valid: Boolean(validation.valid),
        errors: cloneSnapshot(validation.errors || []),
        warnings: cloneSnapshot(validation.warnings || []),
        normalizedValue: cloneSnapshot(validation.normalizedValue),
        validatedAt: new Date().toISOString()
    });
}

module.exports = {
    validateCandidate
};
