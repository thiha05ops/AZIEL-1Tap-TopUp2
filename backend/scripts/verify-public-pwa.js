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

    assert(sw.includes("NEVER_CACHE_PREFIXES") && sw.includes("PRIVATE_NAVIGATION_PREFIXES"), "Service worker must declare API and private-navigation exclusions.");
    ["/api/", "/admin", "/account", "/wallet", "/tracking", "/notifications"].forEach(pathPrefix => {
        assert(sw.includes(`"${pathPrefix}"`), `Service worker must never cache ${pathPrefix}.`);
    });
    assert(sw.includes("networkFirstPublicPage"), "Public HTML must use network-first caching.");
    assert(sw.includes("cacheFirstVersionedCodeAsset") && sw.includes("cacheFirstMediaAsset"), "Versioned code and media assets must use safe cache-first strategies.");
    assert(sw.includes("caches.delete"), "Service worker must clean stale cache versions.");
    assert(offline.includes("noindex, nofollow") && offline.includes("You're offline"), "Offline page must be restrained and not indexed.");

    console.log("Public PWA verification passed.");
}

main();
