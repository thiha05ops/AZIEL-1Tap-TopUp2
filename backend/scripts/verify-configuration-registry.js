const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
require("dotenv").config({
    path: path.join(ROOT, ".env")
});

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, fragment, message) {
    assert(read(file).includes(fragment), `${file}: ${message}`);
}

function notIncludes(file, fragment, message) {
    assert(!read(file).includes(fragment), `${file}: ${message}`);
}

async function verifyRegistryContract() {
    const {
        CONFIGURATION_DOMAINS,
        CONFIGURATION_CAPABILITIES,
        normalizeConfigurationId,
        normalizeContext,
        validateDefinition,
        cloneSnapshot
    } = require("../configuration/configurationDefinition");
    const { createConfigurationRegistry } = require("../configuration/configurationRegistry");

    assert.deepStrictEqual(CONFIGURATION_DOMAINS, ["HOME", "NAVIGATION", "GAMES", "CAMPAIGNS", "REGIONS", "LOCALIZATION", "FOOTER", "SEO", "LEGAL", "SYSTEM"]);
    assert(CONFIGURATION_CAPABILITIES.includes("READ") && CONFIGURATION_CAPABILITIES.includes("VALIDATE") && CONFIGURATION_CAPABILITIES.includes("PREVIEW"));
    assert.throws(() => normalizeConfigurationId("Website.Home"), /Configuration ID is invalid/);
    assert.strictEqual(normalizeConfigurationId("website.home.placements"), "website.home.placements");
    assert.strictEqual(normalizeContext({ region: "TH", language: "my" }).region, "TH");
    assert.throws(() => normalizeContext({ region: "EU" }), /unsupported/);

    const invalidDomain = validateDefinition({
        id: "website.bad.domain",
        displayName: "Bad",
        domain: "BAD",
        ownerAdapterId: "missing",
        capabilities: ["READ"],
        readiness: "UNKNOWN"
    });
    assert.strictEqual(invalidDomain.valid, false, "Invalid domains must be rejected.");

    const invalidCapability = validateDefinition({
        id: "website.bad.capability",
        displayName: "Bad Capability",
        domain: "HOME",
        ownerAdapterId: "missing",
        capabilities: ["PUBLISH"],
        readiness: "UNKNOWN"
    });
    assert.strictEqual(invalidCapability.valid, false, "Unimplemented capabilities must be rejected.");

    const registry = createConfigurationRegistry();
    const first = await registry.initialize();
    const second = await registry.initialize();
    assert.strictEqual(first.definitionCount, second.definitionCount, "Initialization must be idempotent.");
    assert(["READY", "DEGRADED"].includes(first.lifecycleStatus), "Registry must honestly reach READY or DEGRADED.");
    assert(registry.hasDefinition("website.home.placements"), "Home Placements definition must be registered.");
    assert.throws(() => registry.registerDefinition({
        id: "website.home.placements",
        displayName: "Different",
        domain: "HOME",
        ownerAppId: "site-content",
        ownerAdapterId: "home-placement-adapter",
        sourceType: "DATABASE",
        sourceReference: "SitePlacement",
        capabilities: ["READ"],
        readiness: "UNKNOWN"
    }), /already exists/, "Duplicate incompatible definitions must be rejected.");

    const definition = registry.getDefinition("website.home.placements");
    assert.strictEqual(definition.ownerAdapterId, "home-placement-adapter");
    assert(!definition.capabilities.includes("UPDATE"), "Phase 3 must not advertise UPDATE.");
    assert(!definition.capabilities.includes("DRAFT"), "Phase 3 must not advertise DRAFT.");
    assert(!definition.capabilities.includes("PUBLISH"), "Phase 3 must not advertise PUBLISH.");

    const mm = await registry.resolve("website.home.placements", { region: "MM", language: "en", route: "/home.html" });
    const th = await registry.resolve("website.home.placements", { region: "TH", language: "th", route: "/home.html" });
    assert.strictEqual(mm.context.region, "MM", "MM context must resolve safely.");
    assert.strictEqual(th.context.region, "TH", "TH context must resolve safely.");
    assert(mm.configuredValue && mm.fallbackValue && mm.effectiveValue, "Resolution must distinguish configured, fallback, and effective values.");
    assert.notStrictEqual(mm.configuredValue, mm.effectiveValue, "Configured and effective values must not be collapsed.");
    assert.strictEqual(mm.configurationId, "website.home.placements");
    assert(!JSON.stringify(mm).includes("$__"), "Resolution must not expose raw Mongoose documents.");
    assert(!JSON.stringify(mm).match(/password|secret|token|cookie|mongodb/i), "Resolution must not expose secrets.");

    const candidate = cloneSnapshot(mm.configuredValue);
    const before = JSON.stringify(candidate);
    const validation = registry.validate("website.home.placements", candidate, { region: "MM", language: "en" });
    assert.strictEqual(JSON.stringify(candidate), before, "Validation must not mutate input.");
    assert.strictEqual(typeof validation.valid, "boolean", "Validation result must include validity.");

    const diagnostics = registry.diagnostics();
    assert.strictEqual(diagnostics.definitionCount, 1);
    assert.strictEqual(diagnostics.adapterCount, 1);
    assert(Array.isArray(diagnostics.adapterHealth), "Diagnostics must include adapter health.");
    assert(!JSON.stringify(diagnostics).match(/password|secret|token|cookie|mongodb/i), "Diagnostics must not include secrets.");
}

function verifyRoutesAndReadOnly() {
    includes("backend/routes/configurationRegistry.js", "router.get(\"/admin/configuration-registry\"", "Registry list endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "router.get(\"/admin/configuration-registry/:id\"", "Registry detail endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "router.post(\"/admin/configuration-registry/:id/resolve\"", "Resolve endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "router.post(\"/admin/configuration-registry/:id/validate\"", "Validate endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ)", "Registry endpoints must require Site Content read permission.");
    notIncludes("backend/routes/configurationRegistry.js", "router.put(", "Registry must not expose PUT routes.");
    notIncludes("backend/routes/configurationRegistry.js", "router.patch(", "Registry must not expose PATCH routes.");
    notIncludes("backend/routes/configurationRegistry.js", "router.delete(", "Registry must not expose DELETE routes.");
    includes("backend/server.js", "configurationRegistryRoutes", "Server must mount configuration registry route.");
}

function verifyWebsiteRuntimeIntegration() {
    includes("backend/services/websiteRuntimeService.js", "getConfigurationRegistry", "Website Runtime must observe Configuration Registry.");
    includes("backend/services/websiteRuntimeService.js", "configurationId: \"website.home.placements\"", "Home placements inventory must reference configuration ID.");
    includes("backend/services/websiteRuntimeService.js", "configurationRegistry", "Website Runtime projection must include registry status.");
}

function verifyFrontendIntegration() {
    includes("frontend/admin.html", "data-website-runtime-tab=\"configuration\"", "Website app must include Configuration tab.");
    includes("frontend/admin.html", "/js/os/configuration/configuration-client.js", "Configuration client must load.");
    includes("frontend/admin.html", "/js/os/configuration/configuration-runtime-bridge.js", "Configuration bridge must load.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "kernel.services.register(SERVICE_NAME", "Configuration bridge must register Kernel service.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configuration.registry.ready", "Bridge must emit safe ready event.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configuration.resolved", "Bridge must emit safe resolve event.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configuration.validation.completed", "Bridge must emit safe validation event.");
    includes("frontend/js/admin-website-runtime.js", "renderConfiguration", "Website app must render Configuration surface.");
    includes("frontend/js/admin-website-runtime.js", "Configured", "Configuration UI must show configured summary.");
    includes("frontend/js/admin-website-runtime.js", "Fallback", "Configuration UI must show fallback summary.");
    includes("frontend/js/admin-website-runtime.js", "Effective", "Configuration UI must show effective summary.");
    includes("frontend/js/admin-website-runtime.js", "data-configuration-resolve", "Configuration UI must expose read-only resolve action.");
    includes("frontend/js/admin-website-runtime.js", "data-configuration-validate", "Configuration UI must expose read-only validate action.");
    includes("frontend/css/admin/admin-design-system.css", ".website-runtime-config-actions", "Configuration UI must have responsive controls.");
}

function verifyPackageScript() {
    includes("package.json", "\"verify:configuration-registry\"", "package.json must expose verify:configuration-registry.");
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });
    try {
        await verifyRegistryContract();
        verifyRoutesAndReadOnly();
        verifyWebsiteRuntimeIntegration();
        verifyFrontendIntegration();
        verifyPackageScript();
        console.log("Configuration registry foundation verification checks passed.");
    } finally {
        await mongoose.connection.close(false);
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
