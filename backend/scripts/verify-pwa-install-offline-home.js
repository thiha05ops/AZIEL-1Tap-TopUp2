#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const sw = read("frontend/sw.js");
const install = read("frontend/js/pwa-install.js");
const loader = read("frontend/js/header-loader.js");
const header = read("frontend/js/header.js");
const offline = read("frontend/offline.html");
const recovery = read("frontend/js/offline-home.js");

assert(header.indexOf("data-aziel-install-action") > header.indexOf('href="/support"'), "install must follow Help/Support");
assert(header.indexOf("data-aziel-install-action") < header.indexOf("az-mobile-drawer-social"), "install must precede Follow Us");
assert(loader.includes("pwa-install.js?v=20261026-pwa-offline-v1"), "install controller must load early with an immutable URL");
assert(install.includes('"beforeinstallprompt"') && install.includes("event.preventDefault()") && install.includes("prompt.prompt()"), "Android must use the native install event");
assert(install.includes("navigator.standalone") && install.includes('display-mode: standalone') && install.includes('"appinstalled"'), "installed mode must hide the action");
assert(install.includes("Add to Home Screen") && install.includes("isSafari"), "iOS must show browser-aware instructions");
assert(!install.includes("location.reload"), "install flow must not reload the storefront");

const offlineBlock = sw.slice(sw.indexOf("const OFFLINE_NAVIGATION_ALLOWLIST"), sw.indexOf("]);", sw.indexOf("const OFFLINE_NAVIGATION_ALLOWLIST")));
["/", "/explore", "/mobile-games", "/policies/privacy"].forEach(route => assert(offlineBlock.includes(`"${route}"`), `${route} must be offline-safe`));
["/login", "/register", "/verify-email", "/account", "/wallet", "/orders", "/checkout", "/payment", "/support", "/products/"].forEach(route => assert(!offlineBlock.includes(`"${route}"`), `${route} must remain network-owned`));
assert(sw.includes('caches.match("/offline.html", { cacheName: CORE_CACHE })'), "failed safe navigations must use the offline shell");
assert(sw.includes('"/css/core/offline-home.css?v=20261026-pwa-offline-v1"'), "offline styles must be precached under their immutable request URL");
assert(sw.includes('"/js/offline-home.js?v=20261026-pwa-offline-v1"'), "offline recovery must be precached under its immutable request URL");
assert(sw.includes("await cache.match(cacheKey) || await caches.match(cacheKey)"), "versioned shell assets must be discoverable in the core cache");
assert(!sw.includes("cache.put(request, response.clone())") || sw.includes("staleWhileRevalidatePresentation"), "review navigation responses: live HTML must not be cached");
const navigation = sw.slice(sw.indexOf("async function networkFirstPublicNavigation"), sw.indexOf("function isCodeAsset"));
assert(!navigation.includes("cache.put") && !navigation.includes("caches.open"), "navigation handler must not cache HTML");
assert(sw.includes('event.data?.type === "REFRESH_PUBLIC_HOME"') && sw.includes('["MM", "TH"]'), "recovery must refresh only the two public regional Home presentations");
assert(recovery.includes('fetch("/ready"') && recovery.includes('cache: "no-store"'), "recovery must verify backend readiness without cache");
assert(recovery.includes("recovery || Date.now() - lastAttempt < 3000"), "recovery must coalesce and throttle checks");
assert(recovery.includes('window.location.replace("/")'), "successful recovery must return to canonical Home");
assert(!sw.includes("backgroundsync") && !sw.includes('addEventListener("sync"'), "worker must never replay offline mutations");
assert(offline.includes("data-offline-notice") && offline.includes("aria-disabled=\"true\""), "offline shell must explain and lock network actions");

function installHarness({ userAgent, standalone = false }) {
    const windowEvents = new Map();
    const documentEvents = new Map();
    const button = { hidden: true, setAttribute(name, value) { this[name] = value; } };
    const media = { matches: standalone, addEventListener() {} };
    const document = {
        readyState: "complete",
        body: { classList: { remove() {} }, appendChild() {} },
        querySelectorAll(selector) { return selector === "[data-aziel-install-action]" ? [button] : []; },
        querySelector() { return null; },
        addEventListener(type, handler) { documentEvents.set(type, handler); },
        createElement() { throw new Error("dialog creation is not needed in this harness"); }
    };
    const window = {
        matchMedia: () => media,
        addEventListener(type, handler) { windowEvents.set(type, handler); },
        AZIEL_I18N: { t: (_key, fallback) => fallback }
    };
    window.window = window;
    vm.runInNewContext(install, {
        window,
        document,
        navigator: { userAgent, platform: "Linux", maxTouchPoints: 0, standalone },
        Promise,
        console
    });
    return { button, windowEvents, documentEvents };
}

(async () => {
    const android = installHarness({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130" });
    assert.strictEqual(android.button.hidden, true, "Android action must wait for native install eligibility");
    let prevented = false;
    let prompted = false;
    android.windowEvents.get("beforeinstallprompt")({
        preventDefault() { prevented = true; },
        prompt: async () => { prompted = true; },
        userChoice: Promise.resolve({ outcome: "accepted" })
    });
    assert.strictEqual(prevented, true);
    assert.strictEqual(android.button.hidden, false, "eligible Android must reveal Install AZIEL");
    await android.documentEvents.get("click")({ target: { closest: () => android.button } });
    assert.strictEqual(prompted, true, "Android action must open the captured native prompt");

    const ios = installHarness({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari" });
    assert.strictEqual(ios.button.hidden, false, "iOS must reveal the instruction action without a native prompt event");
    const installed = installHarness({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130", standalone: true });
    assert.strictEqual(installed.button.hidden, true, "standalone mode must keep Install AZIEL hidden");

    console.log("PWA install and offline Home verification passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

for (const lang of ["en", "my", "th"]) {
    const source = read(`frontend/lang/${lang}.js`);
    ["pwa_install_action", "pwa_install_ios_title", "pwa_install_ios_safari", "pwa_install_ios_other", "pwa_install_close"].forEach(key => {
        assert(source.includes(key), `${lang} is missing ${key}`);
    });
}
