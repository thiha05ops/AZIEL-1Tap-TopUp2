#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const compressible = require("compressible");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const publicPages = fs.readdirSync(path.join(ROOT, "frontend"))
    .filter(name => name.endsWith(".html") && !name.startsWith("admin"))
    .map(name => `frontend/${name}`)
    .filter(file => read(file).includes("/js/i18n.js") || read(file).includes("js/i18n.js"));

function verifyLocales() {
    for (const file of publicPages) {
        const html = read(file);
        assert.strictEqual((html.match(/locale-loader\.js/g) || []).length, 1, `${file} must load one locale bootstrap.`);
        assert(!/lang\/(?:en|my|th|storefront-static)\.js/.test(html), `${file} must not preload inactive locale sources.`);
        assert(html.indexOf("locale-loader.js") < html.indexOf("i18n.js"), `${file} must load its active dictionary before i18n.`);
        const versions = [...html.matchAll(/\?v=([^"'\s>]+)/g)].map(match => match[1]);
        const allowedVersions = file === "frontend/home.html"
            ? new Set(["20260829-p4", "20260829-dynamic-ambient-r2", "20260829-header-hero-seam-r3"])
            : new Set(["20260829-p4"]);
        assert(versions.every(version => allowedVersions.has(version)), `${file} has an unexpected public asset version.`);
        if (file === "frontend/home.html") {
            assert.strictEqual((html.match(/home-banner-runtime\.js\?v=20260829-dynamic-ambient-r2/g) || []).length, 1, "Home carousel composition must use one cache-busted canonical runtime.");
            assert.strictEqual((html.match(/marketplace-reference\.css\?v=20260829-header-hero-seam-r3/g) || []).length, 1, "Home carousel composition must use one cache-busted canonical stylesheet.");
            assert.strictEqual((html.match(/aziel-header\.css\?v=20260829-header-hero-seam-r3/g) || []).length, 1, "Home must use the cache-busted header/seam stylesheet.");
        }
    }

    for (const lang of ["en", "my", "th"]) {
        const context = { window: {} };
        vm.runInNewContext(read(`frontend/lang/runtime/${lang}.js`), context);
        const dict = context.window.AZIEL_LANG?.[lang];
        assert(dict && Object.keys(dict).length > 500, `${lang} delivery dictionary is incomplete.`);
        assert(dict.nav_home && dict["preferences.title"] && dict["checkout.reviewOrder"], `${lang} delivery dictionary lacks shared fallback keys.`);
    }

    const loader = read("frontend/js/locale-loader.js");
    const i18n = read("frontend/js/i18n.js");
    assert(loader.includes("pending = new Map()") && loader.includes("pending.has(locale)"), "Locale requests must be deduplicated.");
    assert(i18n.includes("await window.AZIEL_LOCALE_LOADER?.load?.(nextLang)"), "Live switching must load its dictionary before translation.");
}

function verifyHeroDelivery() {
    const home = read("frontend/home.html");
    const runtime = read("frontend/js/home-banner-runtime.js");
    const desktop = fs.statSync(path.join(ROOT, "frontend/assets/banners/hero-desktop-wide.webp")).size;
    const mobile = fs.statSync(path.join(ROOT, "frontend/assets/banners/hero-mobile.webp")).size;
    assert(desktop < 200000 && mobile < 120000, "Default delivery heroes exceed Phase 4 budgets.");
    assert(home.includes("hero-desktop-wide.webp?v=20260829-p4") && home.includes("hero-mobile.webp?v=20260829-p4"));
    assert(home.includes('fetchpriority="high"') && home.includes('loading="eager"'));
    assert(runtime.includes("preloadFirstResponsiveBanner(banners[0])"), "Only the first responsive managed banner may be preloaded.");
    assert(!runtime.includes("banners.slice(0, 2).flatMap"), "Managed preload must not fetch multiple variants/slides.");
    assert(runtime.includes('index === 0 ? "eager" : "lazy"'), "Later managed banners must be lazy.");
}

function verifyStaticDelivery() {
    const server = read("backend/server.js");
    const sw = read("frontend/sw.js");
    const account = read("frontend/account.html");
    assert(server.includes('require("compression")') && server.includes("threshold: 1024"));
    assert(server.includes("if (req.headers.range) return false"), "Range responses must bypass compression.");
    assert(server.includes('public, max-age=31536000, immutable'));
    assert(server.includes('no-cache, must-revalidate'));
    assert(server.includes('public, max-age=0, must-revalidate'));
    assert(sw.includes("code-v3-phase4") && sw.includes("media-v2-phase4"));
    assert(sw.includes("isVersionedCodeAsset(url) ? request : createNormalizedCacheKey(request)"));
    assert.strictEqual((account.match(/aziel-header\.css/g) || []).length, 1, "Account must load header CSS once.");
    assert(publicPages.every(file => !read(file).includes("header-scroll.js")), "Public pages must not load the no-op header shim.");
}

function verifyCompressionTypes() {
    assert.strictEqual(compressible("text/javascript"), true, "JavaScript must be compression eligible.");
    assert.strictEqual(compressible("text/css"), true, "CSS must be compression eligible.");
    assert.strictEqual(compressible("application/json"), true, "JSON must be compression eligible.");
    assert(!compressible("image/webp"), "WebP must not be recompressed.");
}

async function main() {
    verifyLocales();
    verifyHeroDelivery();
    verifyStaticDelivery();
    verifyCompressionTypes();
    console.log(JSON.stringify({
        result: "PASS",
        initialLocaleRequests: 1,
        defaultDesktopHeroBytes: fs.statSync(path.join(ROOT, "frontend/assets/banners/hero-desktop-wide.webp")).size,
        defaultMobileHeroBytes: fs.statSync(path.join(ROOT, "frontend/assets/banners/hero-mobile.webp")).size,
        duplicateHeaderStylesheetsOnAccount: 0,
        noOpHeaderScriptsOnPublicPages: 0,
        textCompression: true,
        compressedMediaRecompression: false
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
