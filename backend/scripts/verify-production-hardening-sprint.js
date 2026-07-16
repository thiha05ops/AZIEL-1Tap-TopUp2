const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertIncludes(file, needle, message) {
    assert(read(file).includes(needle), `${file}: ${message}`);
}

function listHtmlFiles() {
    return fs.readdirSync(path.join(root, "frontend"))
        .filter(file => file.endsWith(".html"))
        .filter(file => /^<!doctype html/i.test(read(`frontend/${file}`).trim()))
        .map(file => `frontend/${file}`);
}

async function verifyCorsAndDomains() {
    const security = require("../config/security");
    const required = [
        "https://azielplay.com",
        "https://www.azielplay.com",
        "https://admin.azielplay.com",
        "https://aziel-1tap-topup2.onrender.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500"
    ];

    const developmentOrigins = security.getAllowedOrigins({ NODE_ENV: "development" });
    required.forEach(origin => {
        assert(developmentOrigins.includes(origin), `Allowed origins missing ${origin}`);
    });

    const productionOrigins = security.getAllowedOrigins({ NODE_ENV: "production" });
    required.slice(0, 4).forEach(origin => {
        assert(productionOrigins.includes(origin), `Production origins missing ${origin}`);
    });
    assert(!productionOrigins.includes("*"), "Wildcard origin must not be allowed.");

    const unknownRejected = await new Promise(resolve => {
        security.corsOptions.origin("https://evil.example", error => resolve(Boolean(error)));
    });
    assert(unknownRejected, "Unknown origins must be rejected by CORS.");

    const adminAccepted = await new Promise(resolve => {
        security.socketCorsOptions.origin("https://admin.azielplay.com", error => resolve(!error));
    });
    assert(adminAccepted, "Socket.IO CORS must accept admin.azielplay.com.");

    const csp = security.getCspConnectSources({ NODE_ENV: "production" });
    assert(csp.includes("https://admin.azielplay.com"), "CSP connect-src missing admin HTTPS origin.");
    assert(csp.includes("wss://admin.azielplay.com"), "CSP connect-src missing admin WSS origin.");
}

function verifyAdminRouting() {
    const server = read("backend/server.js");
    assert(server.includes("isAdminHost(req)") && server.includes("res.redirect(302, \"/admin-login.html\")"), "Admin host root must redirect to admin login.");
    assert(server.includes("isPublicProductionHost(req)") && server.includes("adminProductionOrigin"), "Public admin URLs must redirect to admin origin.");
    assert(!/redirect\([^)]*req\.originalUrl/.test(server), "Admin redirects must not forward raw query strings.");
    assertIncludes("backend/middleware/adminMiddleware.js", "return res.status(401)", "Unauthenticated admin requests must return 401.");
    assertIncludes("backend/services/adminAuthorizationService.js", "return res.status(403)", "Unauthorized admin roles must return 403.");
}

function verifyPwaAndMobile() {
    const htmlFiles = listHtmlFiles();

    htmlFiles.forEach(file => {
        const html = read(file);
        const viewports = html.match(/<meta\s+name=["']viewport["'][^>]*>/gi) || [];
        assert(viewports.length === 1, `${file}: expected exactly one viewport meta.`);
        assert(viewports[0].includes("viewport-fit=cover"), `${file}: viewport must include viewport-fit=cover.`);
        assert(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(viewports[0]), `${file}: viewport must not disable zoom.`);
        assert(/apple-mobile-web-app-capable/i.test(html), `${file}: missing apple standalone metadata.`);
        assert(/apple-mobile-web-app-status-bar-style/i.test(html), `${file}: missing Apple status-bar metadata.`);
    });

    const main = read("frontend/css/core/main.css");
    const design = read("frontend/css/theme/aziel-design-system.css");
    [main, design].forEach((css, index) => {
        const label = index === 0 ? "frontend/css/core/main.css" : "frontend/css/theme/aziel-design-system.css";
        assert(css.includes("-webkit-text-size-adjust: 100%"), `${label}: missing iOS text-size-adjust.`);
        assert(/font-size:\s*max\(16px,\s*1em\)/.test(css), `${label}: mobile controls must own 16px minimum font size.`);
        assert(css.includes("env(safe-area-inset-left)") && css.includes("env(safe-area-inset-right)"), `${label}: missing safe-area side ownership.`);
    });
}

function verifyManagedContent() {
    assertIncludes("frontend/home.html", 'id="bannerZone" data-managed-content-state="resolving"', "Home banner must reserve managed-state before reveal.");

    [
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html",
        "frontend/genshin.html",
        "frontend/roblox.html"
    ].forEach(file => {
        assertIncludes(file, 'class="game-banner" data-managed-content-state="resolving"', "Game banner must reserve managed-state before reveal.");
    });

    ["frontend/js/home-banner-runtime.js", "frontend/js/game-presentation-runtime.js"].forEach(file => {
        const js = read(file);
        assert(js.includes("data-managed-content-state"), `${file}: missing managed content state ownership.`);
        assert(js.includes("preloadImages") && js.includes(".decode()"), `${file}: managed images must be prepared before reveal.`);
        assert(js.includes("releaseStaticFallback"), `${file}: failed/never-managed requests must exit loading state.`);
    });
}

function verifyCredentialRotation() {
    const script = read("backend/scripts/rotate-admin-owner-credentials.js");
    assert(script.includes("ADMIN_NEW_USERNAME"), "Credential rotation script must use env-provided username.");
    assert(script.includes("ADMIN_NEW_PASSWORD"), "Credential rotation script must use env-provided password.");
    assert(script.includes("AdminSession.updateMany"), "Credential rotation must revoke existing sessions.");
    assert(script.includes("writeAdminAudit"), "Credential rotation must write an audit entry.");
    assert(!/console\.log\([^)]*ADMIN_NEW_PASSWORD|console\.log\([^)]*newPassword/.test(script), "Credential rotation must not log plaintext passwords.");
}

function verifyCleanupSafety() {
    assert(!fs.existsSync(path.join(root, "frontend/sw.js")), "No active service worker should exist without cache hardening.");
    assert(!/navigator\.serviceWorker\.register/i.test(read("frontend/home.html")), "Home must not register a stale service worker.");
}

async function main() {
    await verifyCorsAndDomains();
    verifyAdminRouting();
    verifyPwaAndMobile();
    verifyManagedContent();
    verifyCredentialRotation();
    verifyCleanupSafety();
    console.log("Production hardening sprint verifier passed.");
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
