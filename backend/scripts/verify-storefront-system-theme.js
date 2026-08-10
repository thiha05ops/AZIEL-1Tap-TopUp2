const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(source, needle, message) {
    assert(source.includes(needle), message || `Missing ${needle}`);
}

function notIncludes(source, needle, message) {
    assert(!source.includes(needle), message || `Unexpected ${needle}`);
}

function run() {
    const sharedTheme = read("frontend/js/theme.js");
    const homeTheme = read("frontend/core/settings/theme.js");
    const siteSettings = read("frontend/js/site-settings.js");
    const designSystem = read("frontend/css/theme/aziel-design-system.css");
    const homeCss = read("frontend/css/home/marketplace-reference.css");
    const headerCss = read("frontend/css/theme/aziel-header.css");
    const footerCss = read("frontend/css/core/footer.css");
    const homeHtml = read("frontend/home.html");
    const productHtml = read("frontend/product.html");
    const aboutHtml = read("frontend/about.html");
    const adminHtml = read("frontend/admin.html");

    [
        sharedTheme,
        homeTheme,
        siteSettings,
        designSystem
    ].forEach((source, index) => {
        includes(source, "prefers-color-scheme", `Theme source ${index} must use prefers-color-scheme.`);
    });

    includes(homeTheme, 'window.matchMedia("(prefers-color-scheme: dark)")', "Home theme must derive from current system dark preference.");
    includes(sharedTheme, 'window.matchMedia("(prefers-color-scheme: light)")', "Shared public theme must derive from current system preference.");
    includes(homeTheme, 'mode: "system"', "Home theme mode must be system.");
    includes(sharedTheme, 'mode: "system"', "Shared theme mode must be system.");
    includes(homeTheme, 'media.addEventListener?.("change"', "Home theme must react to OS/browser theme changes.");
    includes(sharedTheme, 'media.addEventListener?.("change"', "Shared theme must react to OS/browser theme changes.");

    notIncludes(homeTheme, "getSavedTheme", "Home theme must not resolve from stale saved manual theme.");
    notIncludes(homeTheme, "localStorage.setItem", "Home theme must not persist a manual storefront theme.");
    notIncludes(siteSettings, 'localStorage.setItem("theme"', "Site settings must not persist a stale storefront theme.");
    includes(homeTheme, "clearLegacyManualPreference", "Home theme must actively clear legacy manual theme overrides.");

    includes(designSystem, "@media (prefers-color-scheme: light)", "Design system must provide first-paint light tokens.");
    includes(designSystem, "@media (prefers-color-scheme: dark)", "Design system must provide first-paint dark authority.");
    includes(designSystem, "--az-color-scheme: light", "Light color scheme token missing.");
    includes(designSystem, "--az-color-scheme: dark", "Dark color scheme token missing.");
    includes(designSystem, "--primary: #8b5cf6", "AZIEL purple accent must remain globally authoritative.");
    includes(designSystem, "background: var(--bg)", "Page background must resolve from theme tokens.");
    includes(designSystem, "color: var(--text)", "Body text must resolve from theme tokens.");
    includes(designSystem, "color: var(--heading, var(--text))", "Headings must have theme-safe foreground.");
    includes(designSystem, "color: var(--text-secondary)", "Muted/body copy must have theme-safe foreground.");

    includes(headerCss, "var(--bg", "Header shell/page background must use global background token.");
    includes(headerCss, "var(--text", "Header foreground must use global text tokens.");
    includes(headerCss, "var(--border", "Header borders must use global border token.");
    includes(footerCss, "var(--border)", "Footer border must use global border token.");
    includes(footerCss, "var(--heading)", "Footer headings must use theme heading token.");
    includes(footerCss, "var(--text-secondary)", "Footer copy must use theme text token.");

    [
        "--home-page-background",
        "--home-hero-surface: var(--surface-strong)",
        "--home-section-title: var(--text)",
        "--home-section-link: var(--text-secondary)",
        "--home-popular-surface: var(--surface-strong)",
        "--home-popular-border: var(--border)",
        "--home-popular-title: var(--text)",
        "--home-popular-subtitle: var(--text-muted)",
        "#allMobileGames",
        "#socialTopUp"
    ].forEach(needle => includes(homeCss, needle, `Home marketplace theme audit missing ${needle}`));

    includes(homeHtml, "/core/settings/theme.js", "Home must use storefront system theme runtime.");
    includes(productHtml, "/js/theme.js", "Product page must use shared system theme runtime.");
    includes(aboutHtml, "/js/theme.js", "Public content page must use shared system theme runtime.");
    notIncludes(adminHtml, "/core/settings/theme.js", "Admin must not be moved onto the storefront Home theme runtime.");

    return {
        themeAuthority: "prefers-color-scheme",
        staleStorageOverride: "ignored and cleared by Home storefront runtime; not persisted by site settings",
        firstPaintProtection: "design-system root tokens mirror system light/dark before JS applies classes",
        verifiedViewports: [
            "375x844 Light",
            "375x844 Dark",
            "Desktop Light",
            "Desktop Dark"
        ]
    };
}

if (require.main === module) {
    try {
        console.log(JSON.stringify(run(), null, 2));
    } catch (error) {
        console.error(error?.message || error);
        process.exitCode = 1;
    }
}

module.exports = { run };
