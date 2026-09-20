"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
    buildPresentationPayload,
    getHomePresentation,
    isProductPresentationVisible
} = require("../services/homePresentationService");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

function query(result, counter, name) {
    counter.push(name);
    const chain = {
        select() { return chain; },
        lean() { return Promise.resolve(result); }
    };
    return chain;
}

function presentation(region, revision = `revision-${region}`) {
    return {
        success: true,
        region,
        revision,
        sections: [
            {
                key: "POPULAR_MOBILE_GAMES",
                products: [{ productCode: `fixture-${region.toLowerCase()}`, displayName: `Fixture ${region}`, route: `product.html?product=fixture-${region.toLowerCase()}` }]
            },
            { key: "ALL_MOBILE_GAMES", products: [] },
            { key: "SOCIAL_TOPUP", products: [] }
        ]
    };
}

function presentationWithAllSections(region, revision = `layout-${region}`) {
    const payload = presentation(region, revision);
    const products = Array.from({ length: 8 }, (_, index) => ({
        productCode: `fixture-${region.toLowerCase()}-${index + 1}`,
        displayName: `Fixture ${index + 1}`,
        route: `product.html?product=fixture-${region.toLowerCase()}-${index + 1}`
    }));
    payload.sections[0].products = products.slice(0, 4);
    payload.sections[1].products = products;
    payload.sections[2].products = products.slice(0, 3);
    return payload;
}

function homeRuntimeHarness({ initialRegion = "MM", initialStorage = {}, fetchImpl, throwOnFirstRender = false, viewportWidth = 1024 } = {}) {
    const storage = new Map(Object.entries(initialStorage));
    const documentListeners = new Map();
    const windowListeners = new Map();
    let shouldThrow = throwOnFirstRender;
    const targets = new Map();
    ["popularGames", "allMobileGames", "socialTopUp"].forEach(id => targets.set(id, { id, hidden: false, dataset: {} }));
    ["popularGamesList", "allMobileGamesList", "socialTopUpList"].forEach(id => {
        let value = "";
        targets.set(id, {
            id,
            dataset: {},
            removeAttribute() {},
            get innerHTML() { return value; },
            set innerHTML(next) {
                if (shouldThrow && String(next).includes("home-product-panel")) { shouldThrow = false; throw new Error("synthetic render failure"); }
                value = next;
            }
        });
    });
    const localStorage = {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); },
        removeItem(key) { storage.delete(key); }
    };
    const document = {
        readyState: "loading",
        addEventListener(type, handler) { documentListeners.set(type, handler); },
        dispatchEvent() {},
        getElementById(id) { return targets.get(id) || null; }
    };
    const window = {
        AZIEL: { getShopRegion: () => initialRegion },
        addEventListener(type, handler) { windowListeners.set(type, handler); },
        matchMedia(query) { return { matches: /max-width:\s*720px/.test(query) && viewportWidth <= 720, addEventListener() {} }; }
    };
    const sandbox = {
        window,
        document,
        localStorage,
        fetch: fetchImpl || (() => Promise.reject(new Error("offline"))),
        location: { hostname: "example.test" },
        performance: { now: () => 1, mark() {} },
        CustomEvent: function CustomEvent(type, options = {}) { return { type, detail: options.detail }; },
        console,
        Promise,
        JSON,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Set,
        Map,
        encodeURIComponent
    };
    vm.runInContext(read("frontend/js/home-placement-runtime.js"), vm.createContext(sandbox));
    return {
        window,
        storage,
        start() { documentListeners.get("DOMContentLoaded")?.(); },
        changeRegion(next) { window.AZIEL.getShopRegion = () => next; windowListeners.get("aziel:shopRegionChanged")?.({ detail: { region: next } }); },
        snapshot() { return window.AZIEL_HOME_PRESENTATION.getSnapshot(); },
        markup(id) { return targets.get(id)?.innerHTML || ""; },
        testing: window.AZIEL_HOME_PRESENTATION_TESTING
    };
}

async function settle() {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}

async function verifyHomeRuntimeSafety() {
    const authority = homeRuntimeHarness({ initialRegion: "TH" });
    assert.strictEqual(authority.testing.region(), "TH", "TH must use established AZIEL region authority");
    authority.window.AZIEL.getShopRegion = () => "MM";
    assert.strictEqual(authority.testing.region(), "MM", "MM must use established AZIEL region authority");
    assert.strictEqual(authority.testing.key("TH"), "aziel.home.presentation.v1.TH");
    assert.strictEqual(authority.testing.key("MM"), "aziel.home.presentation.v1.MM");

    const firstVisit = homeRuntimeHarness({
        initialRegion: "MM",
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => presentation("MM", "first-visit") })
    });
    firstVisit.start();
    await settle();
    assert.strictEqual(firstVisit.snapshot().revision, "first-visit", "first visit without cache must recover through presentation network path");

    const requests = [];
    const transitions = homeRuntimeHarness({
        initialRegion: "TH",
        fetchImpl(url) {
            return new Promise(resolve => requests.push({ url, resolve }));
        }
    });
    transitions.start();
    transitions.changeRegion("MM");
    assert.ok(requests[0].url.includes("region=TH") && requests[1].url.includes("region=MM"));
    requests[1].resolve({ ok: true, status: 200, json: async () => presentation("MM") });
    await settle();
    requests[0].resolve({ ok: true, status: 200, json: async () => presentation("TH") });
    await settle();
    assert.strictEqual(transitions.snapshot().region, "MM", "stale TH response must not overwrite current MM presentation");

    const reverseRequests = [];
    const reverse = homeRuntimeHarness({
        initialRegion: "MM",
        fetchImpl(url) { return new Promise(resolve => reverseRequests.push({ url, resolve })); }
    });
    reverse.start();
    reverse.changeRegion("TH");
    reverseRequests[1].resolve({ ok: true, status: 200, json: async () => presentation("TH") });
    await settle();
    reverseRequests[0].resolve({ ok: true, status: 200, json: async () => presentation("MM") });
    await settle();
    assert.strictEqual(reverse.snapshot().region, "TH", "stale MM response must not overwrite current TH presentation");

    for (const [label, malformed] of [
        ["root", "[]"],
        ["sections", JSON.stringify({ region: "MM", revision: "bad", sections: {} })],
        ["products", JSON.stringify({ region: "MM", revision: "bad", sections: [{ key: "POPULAR_MOBILE_GAMES", products: {} }] })]
    ]) {
        const cacheKey = "aziel.home.presentation.v1.MM";
        const harness = homeRuntimeHarness({
            initialRegion: "MM",
            initialStorage: { [cacheKey]: malformed },
            fetchImpl: async () => ({ ok: true, status: 200, json: async () => presentation("MM", `recovered-${label}`) })
        });
        harness.start();
        await settle();
        assert.strictEqual(harness.snapshot().revision, `recovered-${label}`, `malformed ${label} cache must recover from network`);
    }

    const cacheKey = "aziel.home.presentation.v1.MM";
    const renderRecovery = homeRuntimeHarness({
        initialRegion: "MM",
        initialStorage: { [cacheKey]: JSON.stringify(presentation("MM", "cached")) },
        throwOnFirstRender: true,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => presentation("MM", "network-recovery") })
    });
    renderRecovery.start();
    await settle();
    assert.strictEqual(renderRecovery.snapshot().revision, "network-recovery", "cached render exception must not prevent network recovery");

    for (const viewportWidth of [360, 375, 390]) {
        const mobile = homeRuntimeHarness({
            initialRegion: "MM",
            viewportWidth,
            fetchImpl: async () => ({ ok: true, status: 200, json: async () => presentationWithAllSections("MM") })
        });
        mobile.start();
        await settle();
        assert.ok(mobile.markup("allMobileGamesList").includes('class="home-product-panel home-product-panel--mobile-two-row"'), `${viewportWidth}px All Mobile must use approved two-row rail panel`);
        assert.ok(mobile.markup("allMobileGamesList").includes('class="home-product-item'), `${viewportWidth}px All Mobile cards must retain product-card class`);
        assert.ok(!mobile.markup("popularGamesList").includes("home-product-panel--mobile-two-row"), `${viewportWidth}px Popular must retain its independent rail contract`);
        assert.ok(!mobile.markup("socialTopUpList").includes("home-product-panel--mobile-two-row"), `${viewportWidth}px Social must retain its independent rail contract`);
    }

    for (const viewportWidth of [768, 1280]) {
        const wide = homeRuntimeHarness({
            initialRegion: "MM",
            viewportWidth,
            fetchImpl: async () => ({ ok: true, status: 200, json: async () => presentationWithAllSections("MM") })
        });
        wide.start();
        await settle();
        assert.ok(!wide.markup("allMobileGamesList").includes("home-product-panel--mobile-two-row"), `${viewportWidth}px must retain desktop/tablet panel layout`);
    }

    const cachedLayout = presentationWithAllSections("MM", "cached-layout");
    const reconciliation = homeRuntimeHarness({
        initialRegion: "MM",
        viewportWidth: 360,
        initialStorage: { "aziel.home.presentation.v1.MM": JSON.stringify(cachedLayout) },
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => presentationWithAllSections("MM", "network-layout") })
    });
    reconciliation.start();
    const cachedMarkup = reconciliation.markup("allMobileGamesList");
    await settle();
    assert.strictEqual(reconciliation.markup("allMobileGamesList"), cachedMarkup, "cached and network reconciliation must use identical All Mobile markup");
}

async function main() {
    await verifyHomeRuntimeSafety();
    const calls = [];
    const fixture = {
        productCode: "fixture-game",
        name: "Fixture Game",
        description: "Fixture description",
        enabled: true,
        deletedAt: null,
        publicDiscoveryEnabled: true,
        homepageEnabled: true,
        homepageCategory: "MOBILE_GAME_TOPUP",
        homepageOrder: 1,
        homepageSections: ["POPULAR_MOBILE_GAMES", "ALL_MOBILE_GAMES"],
        commerceState: "PURCHASABLE",
        lifecycleStatus: "ACTIVE",
        artworkPath: "",
        presentation: { imageAssetId: "fixture-art" },
        updatedAt: "2026-09-20T00:00:00.000Z"
    };
    const models = {
        StoreCatalogSelection: { find: () => query([{ productCode: "fixture-game", updatedAt: fixture.updatedAt }], calls, "selection") },
        CatalogProduct: {
            find: () => query([fixture], calls, "product"),
            findOne: () => query({ _id: "product" }, calls, "product-visible")
        },
        PackageMarketPublication: { find: () => query([{ productCode: "fixture-game", packageCode: "P1", published: true, decisionVersion: 1, updatedAt: fixture.updatedAt }], calls, "publication") },
        MediaAsset: { find: () => query([{ assetId: "fixture-art", secureUrl: "https://res.cloudinary.com/demo/image/upload/sample.webp", altText: "Fixture", status: "active", metadata: { width: 600, height: 600 }, updatedAt: fixture.updatedAt }], calls, "media") }
    };

    const payload = await getHomePresentation({ region: "TH", models });
    assert.deepStrictEqual(calls, ["selection", "product", "publication", "media"], "home presentation must use four bounded query families");
    assert.strictEqual(payload.sections[0].products[0].productCode, "fixture-game");
    assert.ok(payload.sections[0].products[0].artwork.src.includes("f_auto,q_auto,c_limit,w_480"));
    assert.ok(!/(price|package|supplier|quote|fulfillment)/i.test(JSON.stringify(payload)), "presentation payload must not expose commerce authority");

    const same = buildPresentationPayload({
        region: "TH",
        products: [fixture],
        selections: [{ productCode: "fixture-game", updatedAt: fixture.updatedAt }],
        publications: [],
        media: []
    });
    const sameAgain = buildPresentationPayload({
        region: "TH",
        products: [fixture],
        selections: [{ productCode: "fixture-game", updatedAt: fixture.updatedAt }],
        publications: [],
        media: []
    });
    assert.strictEqual(same.revision, sameAgain.revision, "unchanged presentation revision must be deterministic");
    const changed = buildPresentationPayload({
        region: "TH",
        products: [{ ...fixture, homepageOrder: 2 }],
        selections: [{ productCode: "fixture-game", updatedAt: fixture.updatedAt }],
        publications: [],
        media: []
    });
    assert.notStrictEqual(same.revision, changed.revision, "placement change must invalidate revision");
    const renamed = buildPresentationPayload({
        region: "TH",
        products: [{ ...fixture, name: "Renamed Fixture", prices: { TH: { amount: 999 } } }],
        selections: [{ productCode: "fixture-game", updatedAt: fixture.updatedAt }],
        publications: [],
        media: []
    });
    assert.notStrictEqual(same.revision, renamed.revision, "presentation copy change must invalidate revision");
    const priceOnly = buildPresentationPayload({
        region: "TH",
        products: [{ ...fixture, prices: { TH: { amount: 999 } } }],
        selections: [{ productCode: "fixture-game", updatedAt: fixture.updatedAt }],
        publications: [],
        media: []
    });
    assert.strictEqual(same.revision, priceOnly.revision, "commerce-only price changes must not invalidate presentation revision");

    const visibilityCalls = [];
    const visible = await isProductPresentationVisible("fixture-game", {
        region: "TH",
        models: {
            CatalogProduct: { findOne: () => query({ _id: "product" }, visibilityCalls, "product") },
            StoreCatalogSelection: { findOne: () => query({ _id: "selection" }, visibilityCalls, "selection") }
        }
    });
    assert.strictEqual(visible, true);
    assert.deepStrictEqual(visibilityCalls.sort(), ["product", "selection"], "banner visibility must use two scoped lookups");

    const home = read("frontend/home.html");
    const runtime = read("frontend/js/home-placement-runtime.js");
    const deferred = read("frontend/js/home-deferred-runtime.js");
    const sw = read("frontend/sw.js");
    const pwa = read("frontend/js/pwa-fix.js");
    const route = read("backend/routes/catalog.js");
    const service = read("backend/services/homePresentationService.js");

    assert.ok(home.includes("hero-desktop-wide.webp") && home.includes("az-storefront-skeleton"), "static hero and skeleton must remain in HTML");
    assert.ok(home.includes("data-header-canonical=\"true\""), "canonical static header must remain authoritative");
    assert.ok(!home.includes("catalog-discovery.js"), "Home must not start full catalog discovery");
    assert.ok(home.indexOf("catalog-runtime.js") < home.indexOf("home-placement-runtime.js"), "migration bridge must load catalog compatibility before placement runtime");
    assert.ok(!runtime.includes("/api/catalog?"), "Home presentation runtime must not request full catalog");
    assert.ok(runtime.includes("/api/public/home-presentation"), "Home must use scoped presentation endpoint");
    assert.ok(runtime.indexOf("render(cached") < runtime.indexOf("await fetch"), "cached cards must render before revalidation");
    assert.ok(runtime.includes("if (requestId !== sequence) return"), "stale regional responses must be ignored");
    assert.ok(runtime.includes("if (requestId !== sequence || cached) return"), "failure must preserve a useful cached snapshot");
    assert.ok(runtime.includes("If-None-Match"), "revalidation must send the deterministic revision");
    assert.ok(runtime.includes("width=\"") && runtime.includes("height=\""), "product artwork must reserve dimensions");
    assert.ok(runtime.includes("fetchpriority=\"high\"") && runtime.includes("loading=\"${eager ? \"eager\" : \"lazy\"}"), "eager loading must be selective");
    assert.ok(deferred.includes("requestIdleCallback") && deferred.includes("live-chat.js"), "noncritical features must load after the shell");
    assert.ok(deferred.includes("__AZIEL_HOME_DEFERRED_RUNTIME_INITIALIZED__"), "deferred runtime must be idempotent");
    let deferredLoadListeners = 0;
    const deferredWindow = { addEventListener(type) { if (type === "load") deferredLoadListeners += 1; } };
    const deferredContext = vm.createContext({ window: deferredWindow, requestIdleCallback() {}, setTimeout() {}, document: {} });
    vm.runInContext(deferred, deferredContext);
    vm.runInContext(deferred, deferredContext);
    assert.strictEqual(deferredLoadListeners, 1, "duplicate deferred runtime execution must not install duplicate loaders");
    assert.ok(sw.includes("staleWhileRevalidatePublicPage") && sw.includes("staleWhileRevalidateCodeAsset"), "public shell and code must use SWR");
    assert.ok(sw.includes("/api/public/home-presentation") && sw.includes("PRESENTATION_CACHE"), "presentation API needs its own safe cache");
    ["/admin", "/account", "/wallet", "/checkout", "/payment"].forEach(prefix => assert.ok(sw.includes(`\"${prefix}\"`), `${prefix} must remain network-only`));
    assert.ok(!pwa.includes("15 * 60 * 1000"), "service worker must not force a 15-minute update loop");
    assert.ok(route.includes('router.get("/public/home-presentation"') && route.includes("isProductPresentationVisible"), "routes must use new scoped services");
    assert.ok(!service.includes("CatalogPackage") && !service.includes("SupplierProductMapping"), "presentation service must not construct commerce inventory");
    assert.ok(service.includes("PublicationModel.find") && service.includes("SelectionModel.find"), "revision must observe public authority inputs");

    const coreBlock = sw.slice(sw.indexOf("const CORE_ASSETS"), sw.indexOf("];", sw.indexOf("const CORE_ASSETS")) + 2);
    const coreAssets = new Set([...coreBlock.matchAll(/"(\/[^"?]+)(?:\?[^\"]*)?"/g)].map(match => match[1]));
    const directLocalDependencies = [...home.matchAll(/(?:href|src)="([^"#]+)"/g)]
        .map(match => match[1])
        .filter(asset => !/^(?:https?:|\/\/|data:)/i.test(asset))
        .map(asset => `/${asset.split("?")[0].replace(/^\/+/, "")}`)
        .filter(asset => /\.(?:css|js|json)$/i.test(asset));
    directLocalDependencies.forEach(asset => assert.ok(coreAssets.has(asset), `essential Home dependency must be precached: ${asset}`));
    ["/home.html", "/offline.html", "/assets/banners/hero-desktop-wide.webp", "/assets/banners/hero-mobile.webp", "/assets/brand/aziel-logo-primary.svg"].forEach(asset => assert.ok(coreAssets.has(asset), `required app-shell asset must be precached: ${asset}`));
    coreAssets.forEach(asset => assert.ok(fs.existsSync(path.join(root, "frontend", asset)), `precache asset must exist: ${asset}`));
    assert.ok(!coreAssets.has("/api/catalog"), "full catalog must never enter app-shell precache");
    assert.ok(sw.indexOf("cache.addAll(CORE_ASSETS)") < sw.indexOf("self.skipWaiting()"), "precache must complete before worker activation");
    const installBlock = sw.slice(sw.indexOf('self.addEventListener("install"'), sw.indexOf('self.addEventListener("activate"'));
    const activateBlock = sw.slice(sw.indexOf('self.addEventListener("activate"'), sw.indexOf('self.addEventListener("message"'));
    assert.ok(!installBlock.includes("deleteOldAzielCaches") && activateBlock.includes("deleteOldAzielCaches"), "failed installation must not delete old caches");
    const catalogRuntime = read("frontend/js/catalog-runtime.js");
    assert.ok(catalogRuntime.includes("ensureFresh") && catalogRuntime.includes("window.AZIEL_CATALOG"), "migration bridge must expose the API required by an old placement runtime");
    assert.ok(!home.includes("catalog-discovery.js"), "new steady-state Home must not restore old catalog discovery");

    console.log("PASS storefront performance architecture verifier");
    console.log(`PASS bounded home presentation query families: ${calls.length}`);
    console.log(`PASS scoped banner visibility query families: ${visibilityCalls.length}`);
    console.log(`PASS presentation payload bytes (fixture): ${Buffer.byteLength(JSON.stringify({ success: true, ...payload }))}`);
}

main().catch(error => {
    console.error("FAIL storefront performance architecture verifier");
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
