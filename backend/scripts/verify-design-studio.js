const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
    return fs.existsSync(path.join(root, relativePath));
}

function count(haystack, needle) {
    return (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
}

function verifyFiles() {
    [
        "frontend/admin-design-studio.html",
        "frontend/css/admin/design-studio.css",
        "frontend/js/design-studio/design-studio-presets.js",
        "frontend/js/design-studio/design-studio-drafts.js",
        "frontend/js/design-studio/design-studio-canvas.js",
        "frontend/js/design-studio/design-studio-app.js"
    ].forEach(file => assert.ok(exists(file), `Missing Design Studio file: ${file}`));
}

function verifyAdminNavigation() {
    const adminHtml = read("frontend/admin.html");
    assert.strictEqual(count(adminHtml, "admin-design-studio.html"), 1, "Admin page must contain exactly one Design Studio sidebar entry");
    assert.ok(adminHtml.includes('data-admin-permission="DESIGN_STUDIO_READ"'), "Design Studio nav must be permission-gated");
    assert.ok(adminHtml.includes('fa-palette'), "Design Studio nav must use the existing Font Awesome icon library");
}

function verifyDedicatedPage() {
    const page = read("frontend/admin-design-studio.html");
    assert.ok(page.includes('<body class="admin-body design-studio-body">'), "Design Studio page must use admin body/theme ownership");
    assert.ok(page.includes("/js/admin-api.js"), "Design Studio page must include shared admin API helper");
    assert.ok(page.includes("/js/admin-auth.js"), "Design Studio page must include shared admin auth helper");
    assert.ok(page.includes("/js/ui-feedback.js"), "Design Studio page must include shared UI feedback");
    assert.ok(page.includes("/js/motion.js"), "Design Studio page must include shared motion helpers");
    assert.ok(page.includes("/js/admin/admin-media-selector.js"), "Design Studio page must reuse Admin Media selector");
    assert.ok(page.includes("Back to Admin"), "Design Studio page must provide a visible Back to Admin control");
    assert.ok(!page.includes("socket.io"), "Design Studio Phase 1 must not introduce realtime/collaboration dependencies");

    const unsupportedCdns = [...page.matchAll(/https:\/\/[^"']+/g)]
        .map(match => match[0])
        .filter(url => !url.includes("cdnjs.cloudflare.com/ajax/libs/font-awesome"));
    assert.deepStrictEqual(unsupportedCdns, [], "Design Studio must not introduce unsupported CDN dependencies");
}

function verifyPermissionsAndRedirects() {
    const auth = read("backend/services/adminAuthorizationService.js");
    [
        "DESIGN_STUDIO_READ",
        "DESIGN_STUDIO_MANAGE",
        "DESIGN_STUDIO_EXPORT"
    ].forEach(permission => assert.ok(auth.includes(permission), `Missing permission: ${permission}`));
    assert.ok(auth.includes("PERMISSIONS.DESIGN_STUDIO_READ"), "Catalog role must receive Design Studio read permission");
    assert.ok(auth.includes("PERMISSIONS.DESIGN_STUDIO_MANAGE"), "Catalog role must receive Design Studio manage permission");
    assert.ok(auth.includes("PERMISSIONS.DESIGN_STUDIO_EXPORT"), "Catalog role must receive Design Studio export permission");

    const server = read("backend/server.js");
    assert.ok(server.includes('"/admin-design-studio.html"'), "Production admin redirect must include Design Studio page");
    assert.ok(server.includes("adminProductionOrigin"), "Admin redirect must continue using configured admin origin");
}

function verifyNoForbiddenIntegrations() {
    const packageJson = JSON.parse(read("package.json"));
    const dependencies = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {})
    };
    [
        "fabric",
        "konva",
        "pixi.js",
        "cropperjs",
        "sharp",
        "openai",
        "@googleapis/drive"
    ].forEach(dep => assert.ok(!dependencies[dep], `Forbidden Phase 1 dependency introduced: ${dep}`));

    const designFiles = fs.readdirSync(path.join(root, "frontend/js/design-studio"))
        .filter(file => file.endsWith(".js"))
        .map(file => read(`frontend/js/design-studio/${file}`))
        .join("\n");

    [
        /api\.openai\.com/i,
        /\/oauth\b/i,
        /\boauth2?\b/i,
        /client_secret/i,
        /access_token/i,
        /refresh_token/i
    ].forEach(pattern => {
        assert.ok(!pattern.test(designFiles), `Forbidden integration token found: ${pattern}`);
    });
    assert.ok(!designFiles.includes("localStorage.setItem(\"adminToken\""), "Design Studio must not create a second admin auth implementation");
}

function verifyStorageOwnership() {
    const drafts = read("frontend/js/design-studio/design-studio-drafts.js");
    assert.ok(drafts.includes('DB_NAME = "aziel-design-studio"'), "IndexedDB database name must be aziel-design-studio");
    ["projects", "sourceAssets", "preferences"].forEach(store => {
        assert.ok(drafts.includes(store), `IndexedDB store missing: ${store}`);
    });
    assert.ok(drafts.includes('STORAGE_PREFIX = "aziel_design_studio_"'), "localStorage keys must use Design Studio namespace");

    const allDesignJs = fs.readdirSync(path.join(root, "frontend/js/design-studio"))
        .filter(file => file.endsWith(".js"))
        .map(file => read(`frontend/js/design-studio/${file}`))
        .join("\n");
    assert.ok(!/localStorage\.setItem\([^)]*base64/i.test(allDesignJs), "Image base64 data must not be stored in localStorage");
    assert.ok(!/readAsDataURL/.test(allDesignJs), "Design Studio must not convert imported images to base64 data URLs");
}

function verifyPresets() {
    const presets = read("frontend/js/design-studio/design-studio-presets.js");
    [
        ["home-hero", "2560", "900"],
        ["game-hero", "2560", "900"],
        ["campaign-popup", "1600", "1200"],
        ["product-image", "1200", "1500"],
        ["package-icon", "512", "512"],
        ["open-graph", "1200", "630"]
    ].forEach(([id, width, height]) => {
        const index = presets.indexOf(`id: "${id}"`);
        assert.ok(index >= 0, `Missing preset ${id}`);
        const chunk = presets.slice(index, index + 240);
        assert.ok(chunk.includes(`width: ${width}`), `Preset ${id} width must be ${width}`);
        assert.ok(chunk.includes(`height: ${height}`), `Preset ${id} height must be ${height}`);
    });
}

function verifyExportAndMediaIntegration() {
    const canvas = read("frontend/js/design-studio/design-studio-canvas.js");
    const app = read("frontend/js/design-studio/design-studio-app.js");
    assert.ok(canvas.includes("exportMode"), "Canvas renderer must support export mode");
    assert.ok(canvas.includes("if (!exportMode && this.state.showSafeAreas)"), "Safe-area overlays must be excluded from export rendering");
    assert.ok(app.includes("AZIEL_ADMIN_MEDIA_SELECTOR.open"), "Media Library import must use existing selector");
    assert.ok(app.includes('adminFetch("/api/admin/media"'), "Media Library upload must use existing Admin media API");
    assert.ok(app.includes("FormData"), "Media Library upload must use existing multipart FormData contract");
    assert.ok(app.includes("toggleProjectArchive"), "Project archive/restore must be wired.");
    assert.ok(app.includes("dsPromptComposition"), "Prompt Builder must include composition ownership.");
    assert.ok(app.includes("dsResetLogo"), "Logo reset control must be wired.");
    assert.ok(app.includes('formData.set("name"'), "Media upload must provide name");
    assert.ok(app.includes('formData.set("category"'), "Media upload must provide category");
    assert.ok(app.includes('formData.set("altText"'), "Media upload must provide altText");
    assert.ok(app.includes('formData.set("file"'), "Media upload must provide file");
}

function verifyServiceWorkerUnchanged() {
    const sw = read("frontend/sw.js");
    assert.ok(!sw.includes("admin-design-studio"), "Service worker must not add Design Studio caching in Phase 1");
    assert.ok(sw.includes('"/admin"'), "Service worker must continue excluding Admin/private paths");
}

function verifyPhaseOneSettingsSurface() {
    const page = read("frontend/admin-design-studio.html");
    [
        "dsPerformanceMode",
        "dsDefaultFormat",
        "dsDefaultLogoVariant",
        "Not available in Phase 1"
    ].forEach(fragment => {
        assert.ok(page.includes(fragment), `Missing Phase 1 settings surface: ${fragment}`);
    });
    assert.ok(!/Connect<\/button>|Connect\s*<\/a>/i.test(page), "Phase 1 integrations must not expose fake Connect actions");
    assert.ok(!/api[-_ ]?key/i.test(page), "Phase 1 settings must not request API keys");
}

function main() {
    verifyFiles();
    verifyAdminNavigation();
    verifyDedicatedPage();
    verifyPermissionsAndRedirects();
    verifyNoForbiddenIntegrations();
    verifyStorageOwnership();
    verifyPresets();
    verifyExportAndMediaIntegration();
    verifyServiceWorkerUnchanged();
    verifyPhaseOneSettingsSurface();
    console.log("verify-design-studio: ok");
}

try {
    main();
} catch (error) {
    console.error("verify-design-studio: failed");
    console.error(error);
    process.exit(1);
}
