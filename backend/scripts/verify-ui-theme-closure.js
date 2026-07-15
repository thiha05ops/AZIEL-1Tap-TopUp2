const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function verifyExploreHeaderOwnership() {
    const file = "frontend/explore.html";
    const source = read(file);

    includes(file, 'id="azHeaderMount" data-nav="explore"', "Explore must use the shared header mount.");
    includes(file, "css/theme/aziel-header.css", "Explore must load the shared header stylesheet.");
    includes(file, "css/theme/aziel-design-system.css", "Explore must load the shared design-system tokens.");
    includes(file, "js/header-loader.js", "Explore must use the shared header loader.");
    includes(file, "js/header.js", "Explore must use the shared header controller.");
    includes(file, "js/theme.js", "Explore must use the shared theme controller.");

    assert(!source.includes("css/explore/explore-header.css"), "frontend/explore.html: legacy Explore header stylesheet must not be active.");
    assert(!/<header[^>]*class="[^"]*explore-header/.test(source), "frontend/explore.html: legacy Explore header markup must not exist.");
    assert(!/class="[^"]*explore-nav/.test(source), "frontend/explore.html: legacy Explore nav markup must not exist.");
}

function verifyExploreNoStaleHeaderOverrides() {
    const cssFiles = [
        "frontend/css/explore/explore.css",
        "frontend/css/explore/explore-mobile.css",
        "frontend/css/explore/explore-hero.css",
        "frontend/css/explore/explore-brand.css",
        "frontend/css/explore/explore-features.css",
        "frontend/css/explore/explore-showcase.css",
        "frontend/css/explore/explore-youtube.css",
        "frontend/css/explore/explore-stats.css",
        "frontend/css/explore/explore-footer.css"
    ];

    cssFiles.forEach(file => {
        const source = read(file);
        assert(!/(^|[\s,{])\.az-header\b/.test(source), `${file}: Explore CSS must not override shared header internals.`);
        assert(!/(^|[\s,{])\.az-logo\b/.test(source), `${file}: Explore CSS must not override shared header logo.`);
        assert(!/(^|[\s,{])\.az-nav\b/.test(source), `${file}: Explore CSS must not override shared header nav.`);
        assert(!/(^|[\s,{])\.az-profile-dropdown\b/.test(source), `${file}: Explore CSS must not override shared profile dropdown.`);
        assert(!/(^|[\s,{])\.explore-header\b/.test(source), `${file}: active Explore CSS must not carry legacy header rules.`);
        assert(!/(^|[\s,{])\.explore-nav\b/.test(source), `${file}: active Explore CSS must not carry legacy nav rules.`);
    });

    includes("frontend/css/explore/explore.css", "padding-top: calc(var(--az-header-height", "Explore desktop content offset must be derived from shared header height.");
    includes("frontend/css/explore/explore-mobile.css", "padding-top: 0;", "Explore mobile must avoid a duplicate header offset.");
    includes("frontend/css/explore/explore.css", "body.theme-dark", "Explore CSS must honor shared dark theme class.");
}

function verifyExploreClaimSafety() {
    ["frontend/explore.html", "frontend/js/explore.js"].forEach(file => {
        notMatches(file, /100%\s*Secure|24\/7\s*Support|Best Price|ultimate top up platform|instant delivery|always low price|Fast,\s*secure,\s*and\s*trusted/i, "unsupported absolute launch claim found.");
        notMatches(file, /localhost|127\.0\.0\.1|process\.env|JWT_SECRET|SESSION_SECRET|OMISE_SECRET|EMAIL_PASS/i, "public Explore surface must not expose local URLs or secrets.");
    });

    const js = read("frontend/js/explore.js");
    assert(!js.includes("prefers-color-scheme"), "frontend/js/explore.js: Explore must not own theme state.");
    assert(!js.includes("function applyTheme"), "frontend/js/explore.js: Explore must not define a competing theme controller.");
    assert(!js.includes("explore-nav"), "frontend/js/explore.js: shared header navigation must not be managed by Explore JS.");
}

function verifyAdminThemeClosure() {
    const admin = read("frontend/admin.html");
    const css = read("frontend/css/admin/admin-design-system.css");

    [
        "dashboard",
        "orders",
        "wallet",
        "fulfillment",
        "support",
        "chat",
        "catalog",
        "promos",
        "media",
        "site-content",
        "campaigns",
        "users",
        "broadcast",
        "admin-security",
        "payments",
        "settings"
    ].forEach(section => {
        assert(admin.includes(`data-section="${section}"`), `frontend/admin.html: ${section} nav registration missing.`);
        assert(admin.includes(`id="section-${section}"`), `frontend/admin.html: ${section} section missing.`);
    });

    assert(admin.includes("/css/admin/admin-design-system.css"), "frontend/admin.html: admin design-system stylesheet must be loaded.");
    assert(css.includes("Phase 16.2 theme closure"), "frontend/css/admin/admin-design-system.css: theme closure block missing.");
    assert(css.includes("body.theme-light.admin-body"), "frontend/css/admin/admin-design-system.css: light-theme admin override missing.");
    assert(css.includes("var(--admin-text)"), "frontend/css/admin/admin-design-system.css: repaired controls must use admin text tokens.");
    assert(css.includes("var(--admin-surface)"), "frontend/css/admin/admin-design-system.css: repaired controls must use admin surface tokens.");
    assert(css.includes(".admin-body .broadcast-form input"), "frontend/css/admin/admin-design-system.css: broadcast form controls must be tokenized.");
    assert(css.includes(".admin-body .payment-method-card input"), "frontend/css/admin/admin-design-system.css: payment method controls must be tokenized.");
    assert(css.includes(".admin-body .settings-row input"), "frontend/css/admin/admin-design-system.css: settings controls must be tokenized.");
    assert(css.includes(".admin-body .chat-sidebar"), "frontend/css/admin/admin-design-system.css: live chat surfaces must be tokenized.");
    assert(!/\*\s*\{[^}]*color\s*:/s.test(css), "frontend/css/admin/admin-design-system.css: destructive global color rule is not allowed.");
}

function verifyNoThemeMonkeyPatch() {
    [
        "frontend/js/admin.js",
        "frontend/js/admin-app.js",
        "frontend/js/admin-orders.js",
        "frontend/js/admin-wallet.js",
        "frontend/js/admin-live-chat.js",
        "frontend/js/admin-support.js"
    ].forEach(file => {
        const source = read(file);
        assert(!/addEventListener\(["']wheel["']/.test(source), `${file}: JS wheel interception must not be introduced.`);
        assert(!/classList\.(add|remove|toggle)\(["']theme-(light|dark)["']/.test(source), `${file}: admin JS must not monkey-patch theme classes.`);
    });
}

function verifyOfficialSocialsStillPresent() {
    const officialLinks = [
        "https://www.facebook.com/share/1DhL7dQ16a/?mibextid=wwXIfr",
        "https://t.me/aziel1tap",
        "https://youtube.com/@aziel1tapshop",
        "https://discord.gg/txTGuTK76"
    ];

    ["frontend/home.html", "frontend/mobile-games.html", "frontend/pc-games.html", "frontend/about.html", "frontend/contact.html"].forEach(file => {
        const source = read(file);
        officialLinks.forEach(link => {
            assert(source.includes(`href="${link}" target="_blank" rel="noopener noreferrer"`), `${file}: official safe social link missing: ${link}`);
        });
    });
}

function main() {
    verifyExploreHeaderOwnership();
    verifyExploreNoStaleHeaderOverrides();
    verifyExploreClaimSafety();
    verifyAdminThemeClosure();
    verifyNoThemeMonkeyPatch();
    verifyOfficialSocialsStillPresent();
    console.log("UI theme closure verification passed.");
}

main();
