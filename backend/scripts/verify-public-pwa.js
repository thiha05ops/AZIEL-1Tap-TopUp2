const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function main() {
    const manifest = JSON.parse(read("frontend/manifest.json"));
    const sw = read("frontend/sw.js");
    const runtime = read("frontend/js/pwa-fix.js");
    const offline = read("frontend/offline.html");

    assert.strictEqual(manifest.name, "AZIEL 1Tap Shop", "Manifest name must be production brand.");
    assert.strictEqual(manifest.short_name, "AZIEL", "Manifest short_name must be compact.");
    assert.strictEqual(manifest.start_url, "/", "Manifest start_url must be public root.");
    assert.strictEqual(manifest.scope, "/", "Manifest scope must be root.");
    assert.strictEqual(manifest.display, "standalone", "Manifest display must be standalone.");
    assert.strictEqual(manifest.theme_color, "#070716", "Manifest theme color must match storefront shell.");
    assert(manifest.icons.every(icon => icon.purpose === "any"), "Manifest must not claim maskable support without canonical maskable artwork.");
    assert(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 3, "Manifest should expose useful shortcuts.");

    assert(runtime.includes("registerAzielServiceWorker"), "Shared runtime must own service worker registration.");
    assert(runtime.includes("window.isSecureContext"), "Service worker registration must require a safe context.");
    assert(runtime.includes("aziel:pwaUpdateReady"), "Runtime must expose a restrained update-ready event.");

    assert(sw.includes("NEVER_CACHE_PREFIXES"), "Service worker must declare API exclusions.");
    assert(!sw.includes('"/auth/google/success"'), "Service worker must not restore obsolete Google token transport.");
    assert(sw.includes('if (request.mode === "navigate") return;'), "All top-level navigation must remain browser-owned.");
    assert(sw.indexOf('if (request.mode === "navigate") return;') < sw.indexOf("if (isNeverCachePath(url.pathname))"), "Navigation bypass must precede API and static handling.");
    assert(sw.includes('"/api/"'), "Service worker must keep non-navigation API requests network-only.");
    assert(!sw.includes('caches.match("/home.html")'), "Navigation must not fall back to the redirecting Home alias.");
    assert(sw.includes("staleWhileRevalidateCodeAsset") && sw.includes("cacheFirstMediaAsset"), "Code and media assets must use the declared cache strategies.");
    assert(sw.includes("caches.delete"), "Service worker must clean stale cache versions.");
    assert(offline.includes("noindex, nofollow") && offline.includes("You're offline"), "Offline page must be restrained and not indexed.");

    console.log("Public PWA verification passed.");
}

main();
