const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, fragment, message) {
    assert(read(file).includes(fragment), `${file}: ${message}`);
}

function notIncludes(file, fragment, message) {
    assert(!read(file).includes(fragment), `${file}: ${message}`);
}

function verifyBackendReadOnlyRuntime() {
    const route = read("backend/routes/websiteRuntime.js");
    const service = read("backend/services/websiteRuntimeService.js");
    const server = read("backend/server.js");

    includes("backend/server.js", "websiteRuntimeRoutes", "Website runtime route must be mounted.");
    includes("backend/routes/websiteRuntime.js", "router.get(\"/admin/website-runtime\"", "Runtime endpoint must be GET.");
    includes("backend/routes/websiteRuntime.js", "requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ)", "Runtime endpoint must preserve Site Content read permission.");
    includes("backend/routes/websiteRuntime.js", "Cache-Control\", \"no-store", "Runtime endpoint must avoid stale Admin diagnostics.");
    assert(!/router\.(post|put|patch|delete)\(\"\/admin\/website-runtime/.test(route), "Website runtime must not add mutation endpoints.");
    assert(server.indexOf("websiteRuntimeRoutes") > server.indexOf("sitePlacementRoutes"), "Website runtime route should be mounted with Admin routes.");

    [
        "DATABASE",
        "API",
        "ADMIN_MANAGED",
        "STATIC_HTML",
        "STATIC_JAVASCRIPT",
        "STATIC_CSS",
        "CONFIG_FILE",
        "ENVIRONMENT",
        "FALLBACK",
        "MIXED",
        "UNKNOWN"
    ].forEach(type => includes("backend/services/websiteRuntimeService.js", `"${type}"`, `Source type ${type} must be supported.`));

    [
        "FULLY_MANAGED",
        "PARTIALLY_MANAGED",
        "OBSERVED_ONLY",
        "HARDCODED",
        "LEGACY",
        "UNKNOWN"
    ].forEach(state => includes("backend/services/websiteRuntimeService.js", `"${state}"`, `Management state ${state} must be supported.`));

    includes("backend/services/websiteRuntimeService.js", "HomeBanner.countDocuments", "Home Banners must be observed from current model.");
    includes("backend/services/websiteRuntimeService.js", "Campaign.countDocuments", "Campaigns must be observed from current model.");
    includes("backend/services/websiteRuntimeService.js", "CatalogProduct.countDocuments", "Catalog visibility must be observed from current model.");
    includes("backend/services/websiteRuntimeService.js", "StorefrontSection.countDocuments", "Storefront sections must be observed from current model.");
    includes("backend/services/websiteRuntimeService.js", "SitePlacement.countDocuments", "Site placements must be observed from current model.");
    includes("backend/services/websiteRuntimeService.js", "status = failures.length ? \"DEGRADED\" : \"OBSERVING\"", "Runtime must not falsely report READY.");
    includes("backend/services/websiteRuntimeService.js", "ALLOWED_DOMAINS", "Runtime must expose normalized domain taxonomy.");
    includes("backend/services/websiteRuntimeService.js", "READINESS_STATES", "Runtime must expose readiness states.");
    includes("backend/services/websiteRuntimeService.js", "calculateConfigurationReadiness", "Runtime must calculate per-item readiness.");
    includes("backend/services/websiteRuntimeService.js", "buildRuntimeHealth", "Runtime must calculate runtime health.");
    includes("backend/services/websiteRuntimeService.js", "buildMigrationQueue", "Runtime must provide deterministic migration queue.");
    includes("backend/services/websiteRuntimeService.js", "buildRouteReadiness", "Runtime must provide route readiness.");
    includes("backend/services/websiteRuntimeService.js", "buildDiagnostics", "Runtime must provide structured diagnostics.");

    [
        "\"Home\"",
        "\"Navigation\"",
        "\"Games\"",
        "\"Campaigns\"",
        "\"Regions\"",
        "\"Localization\"",
        "\"Footer\"",
        "\"SEO\"",
        "\"Legal\"",
        "\"Runtime\"",
        "\"System\""
    ].forEach(domain => includes("backend/services/websiteRuntimeService.js", domain, `Domain ${domain} must be supported.`));

    [
        "Explore / categories",
        "Storefront sections",
        "Games / products",
        "Campaigns / popups",
        "Region-specific experience",
        "SEO / metadata",
        "PWA assets",
        "Legal links/pages"
    ].forEach(oldDomain => notIncludes("backend/services/websiteRuntimeService.js", oldDomain, `Old domain ${oldDomain} must not remain in runtime projection.`));

    assert(!/process\.env\[[^\]]+\]|JWT|SECRET|TOKEN|PASSWORD|COOKIE/i.test(service), "Runtime projection must not expose secret-oriented environment values.");
}

function verifyPreviewSafety() {
    const { PUBLIC_ROUTES, isAllowedPreviewRoute, normalizePreviewRegion, normalizePreviewRoute } = require("../services/websiteRuntimeService");

    assert(PUBLIC_ROUTES.some(route => route.path === "/home.html"), "Home preview route must exist.");
    assert.strictEqual(isAllowedPreviewRoute("/home.html"), true, "Approved public route should be previewable.");
    assert.strictEqual(isAllowedPreviewRoute("https://evil.example"), false, "External URLs must be rejected.");
    assert.strictEqual(isAllowedPreviewRoute("//evil.example"), false, "Protocol-relative URLs must be rejected.");
    assert.strictEqual(normalizePreviewRoute("/admin.html"), "", "Admin routes must not be previewable.");
    assert.strictEqual(normalizePreviewRoute("/home.html?x=1"), "/home.html", "Preview route normalization should strip query before allow-listing.");
    assert.strictEqual(normalizePreviewRegion("TH"), "TH", "TH preview region must be accepted.");
    assert.strictEqual(normalizePreviewRegion("MM"), "MM", "MM preview region must be accepted.");
    assert.strictEqual(normalizePreviewRegion("EU"), "MM", "Unsupported region must fall back safely.");
}

function verifyAdminWorkspaceAndKernelIntegration() {
    includes("frontend/admin.html", "data-section=\"website\"", "Website app nav item must exist.");
    includes("frontend/admin.html", "data-admin-permission=\"SITE_CONTENT_READ\"", "Website app must use Site Content read permission.");
    includes("frontend/admin.html", "id=\"section-website\"", "Website workspace section must exist.");
    includes("frontend/admin.html", "Website Workspace", "Website section must present owner-first workspace label.");
    includes("frontend/admin.html", "What do you want to do today?", "Website landing must answer the owner task question.");
    includes("frontend/admin.html", 'data-website-runtime-tab="home"', "Owner task navigation must expose Manage Home.");
    includes("frontend/admin.html", 'data-website-runtime-tab="configuration" hidden', "Runtime-only draft controls must remain hidden until publication is implemented.");
    includes("frontend/admin.html", "website-runtime-tab--developer", "Developer tabs must remain available without dominating owner navigation.");
    includes("frontend/admin.html", "/js/admin-website-runtime.js", "Website runtime frontend controller must load.");
    includes("frontend/js/admin-app.js", "website:", "Website section title must be registered.");
    includes("frontend/js/os/apps/core-app-manifest.js", "website: 15", "Kernel app ordering must include Website.");
    includes("frontend/js/os/apps/core-app-manifest.js", "experience: \"EXPERIENCE\"", "Kernel app groups must include Experience.");

    const frontend = read("frontend/js/admin-website-runtime.js");
    includes("frontend/js/admin-website-runtime.js", "adminFetch(\"/api/admin/website-runtime\")", "Website app must use Admin runtime endpoint.");
    includes("frontend/js/admin-website-runtime.js", "window.AZIELOS?.runtimes", "Website runtime must register with Kernel runtime registry.");
    includes("frontend/js/admin-website-runtime.js", "website.runtime.registered", "Website runtime registered event must be emitted.");
    includes("frontend/js/admin-website-runtime.js", "website.inventory.loaded", "Website inventory loaded event must be emitted.");
    includes("frontend/js/admin-website-runtime.js", "window.AZIELOS?.navigation?.openApp", "Open Owner actions must use Kernel navigation.");
    includes("frontend/js/admin-website-runtime.js", "sandbox=\"allow-same-origin allow-scripts allow-forms\"", "Preview iframe must be sandboxed.");
    includes("frontend/js/admin-website-runtime.js", "humanizeEnum", "Frontend must humanize runtime enums.");
    includes("frontend/js/admin-website-runtime.js", "formatBangkokTimestamp", "Frontend must format Bangkok timestamps.");
    includes("frontend/js/admin-website-runtime.js", "Asia/Bangkok", "Frontend timestamps must show Bangkok timezone.");
    includes("frontend/js/admin-website-runtime.js", "configurationReadiness", "Frontend must render configuration readiness.");
    includes("frontend/js/admin-website-runtime.js", "renderRuntimeHealth", "Frontend must render runtime health.");
    includes("frontend/js/admin-website-runtime.js", "renderMigrationQueue", "Frontend must render migration queue.");
    includes("frontend/js/admin-website-runtime.js", "renderOwnerContextBar", "Owner workspace must show region, draft, preview, and publish context.");
    includes("frontend/js/admin-website-runtime.js", "ownerActionCard", "Owner workspace must provide task cards.");
    includes("frontend/js/admin-website-runtime.js", "website-developer-tools", "Developer tools must remain available through progressive disclosure.");
    includes("frontend/js/admin-website-runtime.js", "ownerReadinessLabel", "Owner workspace must translate technical readiness into owner language.");
    includes("frontend/js/admin-website-runtime.js", "Start editing to create a new editing session.", "Technical empty session state must have owner-facing copy.");
    includes("frontend/js/admin-website-runtime.js", "data-website-inventory-search", "Frontend must expose inventory search.");
    includes("frontend/js/admin-website-runtime.js", "websitePreviewHealth", "Frontend must render preview health.");
    includes("frontend/js/admin-website-runtime.js", "buildPreviewUrl", "Preview must use one canonical URL builder.");
    includes("frontend/js/admin-website-runtime.js", "normalizePreviewRoute", "Preview route changes must be allow-listed and normalized.");
    includes("frontend/js/admin-website-runtime.js", "normalizePreviewRegion", "Preview region changes must be allow-listed and normalized.");
    includes("frontend/js/admin-website-runtime.js", "navigatePreview", "Route, region, and refresh must use the same preview navigation path.");
    includes("frontend/js/admin-website-runtime.js", "data-preview-frame", "Preview iframe must have a stable runtime selector.");
    includes("frontend/js/admin-website-runtime.js", "iframeLoaded", "Preview health must include iframe loaded.");
    includes("frontend/js/admin-website-runtime.js", "previewLatencyMs", "Preview health must include latency.");
    includes("frontend/js/admin-website-runtime.js", "sameOriginState", "Preview health must include same-origin state.");
    includes("frontend/js/admin-website-runtime.js", "previewLoadToken", "Preview health must track each iframe load independently.");
    includes("frontend/js/admin-website-runtime.js", "previewTimeoutId", "Preview health must expose timeout ownership.");
    includes("frontend/js/admin-website-runtime.js", "refreshState: \"Timeout\"", "Preview health must leave loading state on iframe timeout.");
    includes("frontend/js/admin-website-runtime.js", "actionLoading", "Configuration actions must expose loading/disabled state.");
    includes("frontend/js/admin-website-runtime.js", "getKernelService", "Configuration actions must safely fall back when Kernel services are unavailable.");
    includes("frontend/js/admin-website-runtime.js", "handleConfigurationSessionError", "Expired sessions must clear stale session and draft state.");
    includes("frontend/js/admin-website-runtime.js", "state.configuration.session = null;", "Region/context changes must clear stale sessions.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "const hasConfiguration", "Configuration bridge must register services independently.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "const hasSession", "Configuration session bridge must not be skipped when configuration service exists.");
    notIncludes("frontend/js/os/configuration/configuration-runtime-bridge.js", "let registered = false", "Configuration bridge must not use one global registered flag for both services.");
    includes("frontend/js/admin-website-runtime.js", "diagnosticSection(\"Migration Candidates\"", "Diagnostics must render migration candidates.");
    includes("frontend/js/admin-website-runtime.js", "diagnosticSection(\"Needs Review\"", "Diagnostics must render needs-review items.");
    includes("frontend/js/admin-website-runtime.js", "diagnosticSection(\"Observation Warnings\"", "Diagnostics must render observation warnings.");
    includes("frontend/js/admin-website-runtime.js", "diagnosticSection(\"Configuration Gaps\"", "Diagnostics must render configuration gaps.");
    notIncludes("frontend/js/admin-website-runtime.js", "no_items_require_attention", "Diagnostics must not claim no items require attention while blocked/hardcoded items exist.");
    assert(!frontend.includes("allow-top-navigation"), "Preview iframe must not allow top navigation.");
    assert(!frontend.includes("contentWindow") && !frontend.includes("postMessage("), "Preview must not inject scripts or messages into public iframe.");
}

function verifyPublicUnchanged() {
    [
        "frontend/home.html",
        "frontend/mlbb.html",
        "frontend/wallet.html",
        "frontend/tracking.html",
        "frontend/support.html"
    ].forEach(file => {
        notIncludes(file, "/js/admin-website-runtime.js", `${file} must not load Admin Website runtime.`);
        notIncludes(file, "/js/os/kernel.js", `${file} must not load Admin OS kernel.`);
    });
}

function verifyResponsiveAndI18n() {
    includes("frontend/css/admin/admin-design-system.css", ".website-runtime-workspace", "Website workspace styles must exist.");
    includes("frontend/css/admin/admin-design-system.css", ".website-owner-action-grid", "Owner action card layout must exist.");
    includes("frontend/css/admin/admin-design-system.css", ".website-owner-context", "Owner context bar layout must exist.");
    includes("frontend/css/admin/admin-design-system.css", ".website-developer-tools", "Developer tools progressive disclosure styling must exist.");
    includes("frontend/css/admin/admin-design-system.css", ".website-preview-frame-wrap.mobile iframe", "Mobile preview width must be bounded.");
    includes("frontend/css/admin/admin-design-system.css", ".website-runtime-detail-card", "Expandable inventory cards must be styled.");
    includes("frontend/css/admin/admin-design-system.css", ".website-runtime-health-grid", "Runtime health grid must be styled.");
    includes("frontend/css/admin/admin-design-system.css", ".website-runtime-migration-list", "Migration queue must be styled.");
    includes("frontend/css/admin/admin-design-system.css", ".website-runtime-search", "Inventory search must be styled.");
    includes("frontend/css/admin/admin-design-system.css", "@media (max-width: 767px)", "Phone responsive ownership must remain at the established breakpoint.");
    [
        "website",
        "website_sub",
        "website_runtime",
        "website_observation",
        "open_public_site",
        "games_explore",
        "website_preview_note"
    ].forEach(key => {
        includes("frontend/lang/admin/en.js", `${key}:`, `English dictionary missing ${key}.`);
        includes("frontend/lang/admin/my.js", `${key}:`, `Myanmar dictionary missing ${key}.`);
        includes("frontend/lang/admin/th.js", `${key}:`, `Thai dictionary missing ${key}.`);
    });
}

function verifyRuntimeProjectionContract() {
    const {
        ALLOWED_DOMAINS,
        PUBLIC_ROUTES,
        READINESS_STATES,
        calculateConfigurationReadiness
    } = require("../services/websiteRuntimeService");

    assert.deepStrictEqual(ALLOWED_DOMAINS, [
        "Home",
        "Navigation",
        "Games",
        "Campaigns",
        "Regions",
        "Localization",
        "Footer",
        "SEO",
        "Legal",
        "Runtime",
        "System"
    ], "Allowed domains must match approved taxonomy exactly.");
    assert(PUBLIC_ROUTES.every(route => ALLOWED_DOMAINS.includes(route.domain)), "Every public route must use an approved domain.");
    assert.deepStrictEqual(READINESS_STATES, ["READY", "PARTIAL", "BLOCKED", "UNKNOWN"], "Readiness states must remain stable.");
    assert.strictEqual(calculateConfigurationReadiness({
        sourceType: "ADMIN_MANAGED",
        sourceOwner: "Catalog",
        managementState: "FULLY_MANAGED",
        fallbackBehavior: ""
    }).state, "READY", "Fully managed single-owner item should be ready.");
    assert.strictEqual(calculateConfigurationReadiness({
        sourceType: "MIXED",
        sourceOwner: "Header Runtime",
        managementState: "PARTIALLY_MANAGED",
        fallbackBehavior: "Static fallback."
    }).state, "PARTIAL", "Mixed ownership or fallback should be partial.");
    assert.strictEqual(calculateConfigurationReadiness({
        sourceType: "STATIC_HTML",
        sourceOwner: "Shared markup",
        managementState: "HARDCODED",
        fallbackBehavior: ""
    }).state, "BLOCKED", "Hardcoded item should be blocked.");
    assert.strictEqual(calculateConfigurationReadiness({}).state, "UNKNOWN", "Incomplete observation should be unknown.");
}

function verifyPackageScript() {
    includes("package.json", "\"verify:website-runtime\"", "package.json must expose verify:website-runtime.");
}

verifyBackendReadOnlyRuntime();
verifyPreviewSafety();
verifyRuntimeProjectionContract();
verifyAdminWorkspaceAndKernelIntegration();
verifyPublicUnchanged();
verifyResponsiveAndI18n();
verifyPackageScript();

console.log("Website runtime observation verification checks passed.");
