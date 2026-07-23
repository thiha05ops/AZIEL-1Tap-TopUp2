const { ConfigurationError, toSafeError } = require("./configurationErrors");
const {
    cloneSnapshot,
    normalizeConfigurationId,
    normalizeContext,
    normalizeDefinition
} = require("./configurationDefinition");
const { summarizeDefinitions } = require("./configurationDiagnostics");
const { resolveConfiguration } = require("./configurationResolver");
const { validateCandidate } = require("./configurationValidator");
const { createHomePlacementAdapter } = require("./adapters/homePlacementAdapter");

const BUILT_IN_DEFINITIONS = Object.freeze([
    {
        id: "website.home.placements",
        displayName: "Home Placements",
        description: "Read-only configuration contract for current Home placement ownership.",
        domain: "HOME",
        ownerAppId: "site-content",
        ownerAdapterId: "home-placement-adapter",
        sourceType: "MIXED",
        sourceReference: "SitePlacement",
        regionScope: ["MM", "TH"],
        languageScope: ["en", "my", "th"],
        schemaVersion: "1.0.0",
        schema: {
            type: "object",
            required: ["placements"]
        },
        capabilities: ["READ", "VALIDATE", "PREVIEW"],
        status: "OBSERVED",
        readiness: "UNKNOWN",
        fallbackPolicy: {
            supported: true,
            source: "Static Home sections remain fallback."
        },
        metadata: {
            configurationId: "website.home.placements",
            phase: "3",
            authoritativeSource: "SitePlacement service"
        },
        tags: ["website", "home", "site-placement"],
        order: 1,
        enabled: true
    }
]);

class ConfigurationRegistry {
    constructor() {
        this.definitions = new Map();
        this.adapters = new Map();
        this.lifecycleStatus = "CREATED";
        this.initializedAt = null;
        this.initializationDurationMs = 0;
        this.initializationErrors = [];
        this.initPromise = null;
    }

    async initialize() {
        if (this.initPromise) return this.initPromise;
        this.initPromise = Promise.resolve().then(async () => {
            const started = Date.now();
            this.lifecycleStatus = "INITIALIZING";
            this.initializedAt = new Date().toISOString();
            try {
                this.registerAdapter(createHomePlacementAdapter());
                BUILT_IN_DEFINITIONS.forEach(definition => this.registerDefinition(definition));
                await this.resolveReadinessMetadata();
                this.lifecycleStatus = this.initializationErrors.length ? "DEGRADED" : "READY";
            } catch (error) {
                this.initializationErrors.push(toSafeError(error));
                this.lifecycleStatus = "DEGRADED";
            } finally {
                this.initializationDurationMs = Date.now() - started;
            }
            return this.snapshot();
        });
        return this.initPromise;
    }

    registerDefinition(definition) {
        const normalized = normalizeDefinition(definition);
        const existing = this.definitions.get(normalized.id);
        if (existing) {
            if (JSON.stringify(existing) === JSON.stringify(normalized)) return this.getDefinition(normalized.id);
            throw new ConfigurationError("DUPLICATE_CONFIGURATION_DEFINITION", "Configuration definition already exists.", 409, { id: normalized.id });
        }
        const adapter = this.adapters.get(normalized.ownerAdapterId);
        if (!adapter) {
            this.initializationErrors.push({
                code: "CONFIGURATION_ADAPTER_NOT_FOUND",
                message: "Definition adapter is missing.",
                context: { id: normalized.id, ownerAdapterId: normalized.ownerAdapterId }
            });
        } else {
            this.assertAdapterCompatibility(normalized, adapter);
        }
        this.definitions.set(normalized.id, normalized);
        return this.getDefinition(normalized.id);
    }

    unregisterDefinition(id) {
        const normalizedId = normalizeConfigurationId(id);
        return this.definitions.delete(normalizedId);
    }

    registerAdapter(adapter) {
        if (!adapter?.id || !/^[a-z][a-z0-9-]*$/.test(adapter.id)) {
            throw new ConfigurationError("CONFIGURATION_ADAPTER_NOT_FOUND", "Configuration adapter is invalid.", 400);
        }
        const existing = this.adapters.get(adapter.id);
        if (existing) {
            if (existing === adapter || existing.name === adapter.name) return this.getAdapterSnapshot(adapter.id);
            throw new ConfigurationError("DUPLICATE_CONFIGURATION_ADAPTER", "Configuration adapter already exists.", 409, { adapterId: adapter.id });
        }
        this.adapters.set(adapter.id, Object.freeze(adapter));
        return this.getAdapterSnapshot(adapter.id);
    }

    hasDefinition(id) {
        return this.definitions.has(normalizeConfigurationId(id));
    }

    getDefinition(id) {
        const normalizedId = normalizeConfigurationId(id);
        const definition = this.definitions.get(normalizedId);
        if (!definition) {
            throw new ConfigurationError("CONFIGURATION_NOT_FOUND", "Configuration definition was not found.", 404, { id: normalizedId });
        }
        return cloneSnapshot(definition);
    }

    listDefinitions(filters = {}) {
        const domain = filters.domain ? String(filters.domain).trim().toUpperCase() : "";
        const ownerAppId = filters.ownerAppId ? String(filters.ownerAppId).trim() : "";
        return Object.freeze([...this.definitions.values()]
            .filter(definition => !domain || definition.domain === domain)
            .filter(definition => !ownerAppId || definition.ownerAppId === ownerAppId)
            .sort((a, b) => Number(a.order || 100) - Number(b.order || 100) || a.id.localeCompare(b.id))
            .map(definition => cloneSnapshot(definition)));
    }

    async resolve(id, context = {}) {
        const definition = this.getDefinition(id);
        const adapter = this.adapters.get(definition.ownerAdapterId);
        return resolveConfiguration({ definition, adapter, context: normalizeContext(context) });
    }

    validate(id, value, context = {}) {
        const definition = this.getDefinition(id);
        const adapter = this.adapters.get(definition.ownerAdapterId);
        return validateCandidate({ definition, adapter, value, context: normalizeContext(context) });
    }

    getReadiness(id) {
        const definition = this.getDefinition(id);
        return {
            configurationId: definition.id,
            readiness: definition.readiness,
            reason: definition.metadata?.readinessReason || "Readiness is observed through the owner adapter."
        };
    }

    getCapabilities(id) {
        return Object.freeze([...(this.getDefinition(id).capabilities || [])]);
    }

    getOwner(id) {
        const definition = this.getDefinition(id);
        return {
            ownerAppId: definition.ownerAppId,
            ownerAdapterId: definition.ownerAdapterId,
            sourceType: definition.sourceType,
            sourceReference: definition.sourceReference
        };
    }

    diagnostics() {
        const definitions = this.listDefinitions();
        const adapters = [...this.adapters.values()];
        const summary = summarizeDefinitions(definitions, adapters, {
            status: this.lifecycleStatus,
            initializedAt: this.initializedAt,
            initializationDurationMs: this.initializationDurationMs
        });
        return Object.freeze({
            ...summary,
            initializationErrors: cloneSnapshot(this.initializationErrors),
            missingAdapters: definitions
                .filter(definition => !this.adapters.has(definition.ownerAdapterId))
                .map(definition => ({ configurationId: definition.id, ownerAdapterId: definition.ownerAdapterId })),
            capabilityMismatches: definitions
                .filter(definition => {
                    const adapter = this.adapters.get(definition.ownerAdapterId);
                    return adapter && !definition.capabilities.every(capability => adapter.capabilities.includes(capability));
                })
                .map(definition => ({ configurationId: definition.id, ownerAdapterId: definition.ownerAdapterId }))
        });
    }

    snapshot() {
        return Object.freeze({
            lifecycleStatus: this.lifecycleStatus,
            initializedAt: this.initializedAt,
            initializationDurationMs: this.initializationDurationMs,
            definitionCount: this.definitions.size,
            adapterCount: this.adapters.size,
            definitions: this.listDefinitions(),
            diagnostics: this.diagnostics()
        });
    }

    getAdapterSnapshot(adapterId) {
        const adapter = this.adapters.get(adapterId);
        if (!adapter) {
            throw new ConfigurationError("CONFIGURATION_ADAPTER_NOT_FOUND", "Configuration adapter was not found.", 404, { adapterId });
        }
        return Object.freeze({
            id: adapter.id,
            name: adapter.name,
            sourceType: adapter.sourceType,
            capabilities: [...adapter.capabilities],
            health: adapter.health?.()
        });
    }

    assertAdapterCompatibility(definition, adapter) {
        if (!adapter.canHandle(definition)) {
            throw new ConfigurationError("CONFIGURATION_OWNERSHIP_CONFLICT", "Adapter cannot handle this definition.", 400, { id: definition.id });
        }
        const missing = definition.capabilities.filter(capability => !adapter.capabilities.includes(capability));
        if (missing.length) {
            throw new ConfigurationError("CONFIGURATION_CAPABILITY_UNSUPPORTED", "Adapter capability does not match definition.", 400, { id: definition.id });
        }
    }

    async resolveReadinessMetadata() {
        const nextDefinitions = new Map();
        for (const definition of this.definitions.values()) {
            try {
                const resolved = await this.resolve(definition.id, { region: "MM", language: "en", route: "/home.html" });
                nextDefinitions.set(definition.id, Object.freeze({
                    ...definition,
                    readiness: resolved.readiness?.state || "UNKNOWN",
                    metadata: {
                        ...definition.metadata,
                        readinessReason: resolved.readiness?.reason || ""
                    }
                }));
            } catch (error) {
                this.initializationErrors.push(toSafeError(error));
                nextDefinitions.set(definition.id, Object.freeze({
                    ...definition,
                    readiness: "BLOCKED",
                    metadata: {
                        ...definition.metadata,
                        readinessReason: "Readiness resolution failed."
                    }
                }));
            }
        }
        this.definitions = nextDefinitions;
    }
}

let singleton = null;

async function getConfigurationRegistry() {
    if (!singleton) singleton = new ConfigurationRegistry();
    await singleton.initialize();
    return singleton;
}

function createConfigurationRegistry() {
    return new ConfigurationRegistry();
}

module.exports = {
    BUILT_IN_DEFINITIONS,
    ConfigurationRegistry,
    createConfigurationRegistry,
    getConfigurationRegistry
};
