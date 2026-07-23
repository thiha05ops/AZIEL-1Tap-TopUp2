const { ConfigurationError } = require("../configurationErrors");

class ConfigurationAdapter {
    constructor({ id, name, sourceType, capabilities = [] }) {
        this.id = id;
        this.name = name;
        this.sourceType = sourceType;
        this.capabilities = Object.freeze([...capabilities]);
    }

    canHandle(definition = {}) {
        return definition.ownerAdapterId === this.id;
    }

    async read() {
        throw new ConfigurationError("CONFIGURATION_CAPABILITY_UNSUPPORTED", "Adapter read is not implemented.", 501, { adapterId: this.id });
    }

    validate(value) {
        return {
            valid: true,
            errors: [],
            warnings: [],
            normalizedValue: value
        };
    }

    health() {
        return {
            adapterId: this.id,
            status: "READY",
            capabilities: this.capabilities
        };
    }

    diagnostics() {
        return {
            adapterId: this.id,
            warnings: [],
            failures: []
        };
    }
}

module.exports = {
    ConfigurationAdapter
};
