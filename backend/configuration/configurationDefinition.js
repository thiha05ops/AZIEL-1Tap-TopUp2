const { ConfigurationError } = require("./configurationErrors");

const CONFIGURATION_DOMAINS = Object.freeze([
    "HOME",
    "NAVIGATION",
    "GAMES",
    "CAMPAIGNS",
    "REGIONS",
    "LOCALIZATION",
    "FOOTER",
    "SEO",
    "LEGAL",
    "SYSTEM"
]);

const CONFIGURATION_CAPABILITIES = Object.freeze([
    "READ",
    "VALIDATE",
    "PREVIEW",
    "UPDATE",
    "DRAFT",
    "PUBLISH",
    "ROLLBACK",
    "VERSION"
]);

const READ_ONLY_PHASE_CAPABILITIES = Object.freeze(["READ", "VALIDATE", "PREVIEW"]);
const CONFIGURATION_READINESS = Object.freeze(["READY", "PARTIAL", "BLOCKED", "UNKNOWN"]);
const CONFIGURATION_LIFECYCLE = Object.freeze(["CREATED", "INITIALIZING", "READY", "DEGRADED", "FAILED", "DESTROYED"]);
const SUPPORTED_REGIONS = Object.freeze(["MM", "TH"]);
const SUPPORTED_LANGUAGES = Object.freeze(["en", "my", "th"]);

function cloneSnapshot(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
}

function normalizeConfigurationId(id = "") {
    const normalized = String(id || "").trim();
    if (!/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/.test(normalized)) {
        throw new ConfigurationError("INVALID_CONFIGURATION_ID", "Configuration ID is invalid.", 400, { id: normalized });
    }
    return normalized;
}

function normalizeContext(context = {}) {
    const region = String(context.region || "MM").trim().toUpperCase();
    const language = String(context.language || "en").trim().toLowerCase();
    if (!SUPPORTED_REGIONS.includes(region)) {
        throw new ConfigurationError("CONFIGURATION_CONTEXT_INVALID", "Configuration region is unsupported.", 400, { region });
    }
    if (!SUPPORTED_LANGUAGES.includes(language)) {
        throw new ConfigurationError("CONFIGURATION_CONTEXT_INVALID", "Configuration language is unsupported.", 400, { language });
    }
    return Object.freeze({
        environment: String(context.environment || process.env.NODE_ENV || "development"),
        region,
        language,
        route: String(context.route || "/home.html"),
        previewMode: String(context.previewMode || "desktop"),
        timestamp: context.timestamp ? new Date(context.timestamp).toISOString() : new Date().toISOString(),
        actor: context.actor ? {
            role: context.actor.role || "",
            username: context.actor.username || ""
        } : null
    });
}

function normalizeDefinition(definition = {}) {
    const normalized = {
        id: normalizeConfigurationId(definition.id),
        displayName: String(definition.displayName || "").trim(),
        description: String(definition.description || "").trim(),
        domain: String(definition.domain || "").trim().toUpperCase(),
        ownerAppId: String(definition.ownerAppId || "").trim(),
        ownerAdapterId: String(definition.ownerAdapterId || "").trim(),
        sourceType: String(definition.sourceType || "").trim().toUpperCase(),
        sourceReference: String(definition.sourceReference || "").trim(),
        regionScope: Array.isArray(definition.regionScope) ? definition.regionScope.map(region => String(region).toUpperCase()) : ["MM", "TH"],
        languageScope: Array.isArray(definition.languageScope) ? definition.languageScope.map(language => String(language).toLowerCase()) : ["en", "my", "th"],
        schemaVersion: String(definition.schemaVersion || "1.0.0"),
        schema: cloneSnapshot(definition.schema || {}),
        capabilities: Array.isArray(definition.capabilities) ? [...new Set(definition.capabilities.map(capability => String(capability).toUpperCase()))] : ["READ"],
        status: String(definition.status || "OBSERVED").trim().toUpperCase(),
        readiness: String(definition.readiness || "UNKNOWN").trim().toUpperCase(),
        fallbackPolicy: cloneSnapshot(definition.fallbackPolicy || {}),
        metadata: cloneSnapshot(definition.metadata || {}),
        tags: Array.isArray(definition.tags) ? definition.tags.map(tag => String(tag).trim()).filter(Boolean) : [],
        order: Number.isFinite(Number(definition.order)) ? Number(definition.order) : 100,
        enabled: definition.enabled !== false
    };
    const validation = validateDefinition(normalized);
    if (!validation.valid) {
        throw new ConfigurationError("INVALID_CONFIGURATION_DEFINITION", "Configuration definition is invalid.", 400, {
            id: normalized.id,
            errors: validation.errors.length
        });
    }
    return Object.freeze(normalized);
}

function validateDefinition(definition = {}) {
    const errors = [];
    const warnings = [];
    try {
        normalizeConfigurationId(definition.id);
    } catch (_error) {
        errors.push({ code: "INVALID_CONFIGURATION_ID", message: "ID must be lowercase, dot-separated, and deterministic." });
    }
    if (!definition.displayName) errors.push({ code: "DISPLAY_NAME_REQUIRED", message: "Display name is required." });
    if (!CONFIGURATION_DOMAINS.includes(definition.domain)) errors.push({ code: "INVALID_DOMAIN", message: "Domain is unsupported." });
    if (!definition.ownerAdapterId) errors.push({ code: "OWNER_ADAPTER_REQUIRED", message: "Owner adapter is required." });
    if (!definition.ownerAppId) warnings.push({ code: "OWNER_APP_MISSING", message: "Owner app ID is missing." });
    if (!CONFIGURATION_READINESS.includes(definition.readiness)) errors.push({ code: "INVALID_READINESS", message: "Readiness is unsupported." });
    (definition.capabilities || []).forEach(capability => {
        if (!CONFIGURATION_CAPABILITIES.includes(capability)) {
            errors.push({ code: "CONFIGURATION_CAPABILITY_UNSUPPORTED", message: `Capability ${capability} is unsupported.` });
        }
        if (!READ_ONLY_PHASE_CAPABILITIES.includes(capability)) {
            errors.push({ code: "CONFIGURATION_CAPABILITY_UNSUPPORTED", message: `Capability ${capability} is not implemented in Phase 3.` });
        }
    });
    (definition.regionScope || []).forEach(region => {
        if (!SUPPORTED_REGIONS.includes(region)) errors.push({ code: "INVALID_REGION", message: `Region ${region} is unsupported.` });
    });
    (definition.languageScope || []).forEach(language => {
        if (!SUPPORTED_LANGUAGES.includes(language)) errors.push({ code: "INVALID_LANGUAGE", message: `Language ${language} is unsupported.` });
    });
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        normalizedValue: cloneSnapshot(definition)
    };
}

module.exports = {
    CONFIGURATION_CAPABILITIES,
    CONFIGURATION_DOMAINS,
    CONFIGURATION_LIFECYCLE,
    CONFIGURATION_READINESS,
    READ_ONLY_PHASE_CAPABILITIES,
    SUPPORTED_LANGUAGES,
    SUPPORTED_REGIONS,
    cloneSnapshot,
    normalizeConfigurationId,
    normalizeContext,
    normalizeDefinition,
    validateDefinition
};
