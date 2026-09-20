const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const swSource = read("frontend/sw.js");
const currentLiveChat = read("frontend/js/live-chat.js");

function keyOf(input) {
    const value = typeof input === "string" ? input : input.url;
    const url = new URL(value, "https://aziel.test");
    return `${url.pathname}${url.search}`;
}

function makeHarness({ legacy = true, failInstall = false, failNetwork = false } = {}) {
    const stores = new Map();
    const oldCore = "aziel-runtime-core-v5-storefront-performance";
    const oldCode = "aziel-runtime-code-v5-storefront-performance";
    if (legacy) {
        stores.set(oldCore, new Map([["/home.html", "OLD_HOME"]]));
        stores.set(oldCode, new Map([["/js/live-chat.js", "OLD_UNGUARDED_LIVE_CHAT"]]));
    }
    stores.set("unrelated-application-cache", new Map([["/keep", "KEEP"]]));

    const cacheApi = name => ({
        async addAll(assets) {
            if (failInstall) throw new Error("simulated precache failure");
            const store = stores.get(name);
            for (const asset of assets) {
                const diskPath = path.join(root, "frontend", asset.replace(/^\//, ""));
                store.set(keyOf(asset), fs.existsSync(diskPath) ? read(`frontend/${asset.replace(/^\//, "")}`) : asset);
            }
        },
        async match(request) {
            const value = stores.get(name)?.get(keyOf(request));
            return value === undefined ? undefined : new Response(value, { status: 200 });
        },
        async put(request, response) {
            stores.get(name).set(keyOf(request), await response.clone().text());
        }
    });

    const events = {};
    let claimed = 0;
    let skipped = 0;
    const navigations = [];
    const windowClients = [
        { url: "https://aziel.test/home.html", navigate: async url => navigations.push(url) },
        { url: "https://aziel.test/payment.html", navigate: async url => navigations.push(url) }
    ];
    const context = {
        URL,
        Request,
        Response,
        Promise,
        caches: {
            async open(name) {
                if (!stores.has(name)) stores.set(name, new Map());
                return cacheApi(name);
            },
            async keys() { return [...stores.keys()]; },
            async delete(name) { return stores.delete(name); },
            async match(request) {
                for (const name of stores.keys()) {
                    const response = await cacheApi(name).match(request);
                    if (response) return response;
                }
                return undefined;
            }
        },
        fetch: async request => {
            if (failNetwork) throw new Error("simulated offline network");
            const pathname = new URL(typeof request === "string" ? request : request.url, "https://aziel.test").pathname;
            const diskPath = path.join(root, "frontend", pathname.replace(/^\//, ""));
            return new Response(fs.existsSync(diskPath) ? fs.readFileSync(diskPath) : "NETWORK", { status: 200 });
        },
        self: {
            location: { origin: "https://aziel.test" },
            registration: { navigationPreload: { enable: async () => {} } },
            clients: {
                claim: async () => { claimed += 1; },
                matchAll: async () => windowClients
            },
            skipWaiting: async () => { skipped += 1; },
            addEventListener(type, handler) { events[type] = handler; }
        }
    };
    vm.runInNewContext(swSource, context, { filename: "sw.js" });

    async function dispatch(type, extra = {}) {
        let pending;
        events[type]({
            request: extra.request,
            preloadResponse: Promise.resolve(undefined),
            respondWith(value) { pending = Promise.resolve(value); },
            waitUntil(value) { pending = Promise.resolve(value); }
        });
        return pending;
    }

    async function dispatchFetch(request) {
        let pending;
        let respondWithCalls = 0;
        events.fetch({
            request,
            preloadResponse: Promise.resolve(undefined),
            respondWith(value) { respondWithCalls += 1; pending = Promise.resolve(value); },
            waitUntil() {}
        });
        return { respondWithCalls, response: pending ? await pending : null };
    }

    return { stores, dispatch, dispatchFetch, navigations, counts: () => ({ claimed, skipped }) };
}

(async () => {
    const coreBlock = swSource.slice(swSource.indexOf("const CORE_ASSETS"), swSource.indexOf("];", swSource.indexOf("const CORE_ASSETS")) + 2);
    const coreAssets = [...coreBlock.matchAll(/"(\/[^"?]+)(?:\?[^\"]*)?"/g)].map(match => match[1]);
    const digest = crypto.createHash("sha256");
    coreAssets.forEach(asset => {
        digest.update(asset);
        digest.update("\0");
        digest.update(fs.readFileSync(path.join(root, "frontend", asset.replace(/^\//, ""))));
        digest.update("\0");
    });
    const expectedRevision = `v7-${digest.digest("hex").slice(0, 16)}`;
    assert(swSource.includes(`const SHELL_REVISION = "${expectedRevision}"`), "precache content changed without a shell revision bump");
    assert(swSource.includes('"/js/live-chat.js"') && swSource.includes('"/css/support/live-chat.css"'));
    assert(swSource.indexOf("cache.addAll(CORE_ASSETS)") < swSource.indexOf("self.skipWaiting()"));

    const upgrade = makeHarness({ legacy: true });
    await upgrade.dispatch("install");
    assert.strictEqual(upgrade.counts().skipped, 1, "successful atomic precache must allow activation");
    await upgrade.dispatch("activate");
    assert.strictEqual(upgrade.counts().claimed, 1, "new worker must claim existing clients");
    assert(!upgrade.stores.has("aziel-runtime-core-v5-storefront-performance"));
    assert(!upgrade.stores.has("aziel-runtime-code-v5-storefront-performance"));
    assert(upgrade.stores.has("unrelated-application-cache"), "migration must not delete unrelated caches");
    assert.deepStrictEqual(upgrade.navigations, ["https://aziel.test/home.html"], "legacy migration must refresh only safe public clients once");

    const liveChatResponse = await upgrade.dispatch("fetch", {
        request: new Request("https://aziel.test/js/live-chat.js?v=20260920-storefront-performance-v1")
    });
    assert.strictEqual(await liveChatResponse.text(), currentLiveChat, "upgraded worker must serve current guarded Live Chat");
    const newCoreName = [...upgrade.stores.keys()].find(name => name.includes(`core-${expectedRevision}`));
    assert(upgrade.stores.get(newCoreName).has("/home.html"), "offline Home shell must survive migration");

    const fresh = makeHarness({ legacy: false });
    await fresh.dispatch("install");
    await fresh.dispatch("activate");
    assert.deepStrictEqual(fresh.navigations, [], "fresh install must not reload a client");

    for (const url of [
        "https://aziel.test/api/auth/google?returnTo=%2Faccount",
        "https://aziel.test/api/auth/google/callback?code=x&state=y",
        "https://aziel.test/auth/google/success?token=x"
    ]) {
        const result = await fresh.dispatchFetch({ method: "GET", mode: "navigate", url });
        assert.strictEqual(result.respondWithCalls, 0, `${new URL(url).pathname} navigation must bypass Service Worker respondWith`);
        assert.strictEqual(result.response, null);
    }

    for (const url of [
        "https://aziel.test/api/auth/google",
        "https://aziel.test/api/catalog?region=TH"
    ]) {
        const result = await fresh.dispatchFetch({ method: "GET", mode: "cors", url });
        assert.strictEqual(result.respondWithCalls, 1, `${new URL(url).pathname} fetch must retain API network-only handling`);
        assert.strictEqual(await result.response.text(), "NETWORK");
    }

    for (const url of [
        "https://aziel.test/api/auth/login",
        "https://aziel.test/login",
        "https://aziel.test/products/afk-journey"
    ]) {
        const result = await fresh.dispatchFetch({ method: "GET", mode: "navigate", url });
        assert.strictEqual(result.respondWithCalls, 1, `${new URL(url).pathname} navigation must not receive the OAuth bypass`);
    }

    const storefrontNavigation = await fresh.dispatchFetch({ method: "GET", mode: "navigate", url: "https://aziel.test/" });
    assert.strictEqual(storefrontNavigation.respondWithCalls, 1, "ordinary storefront navigation must retain Service Worker handling");
    assert((await storefrontNavigation.response.text()).includes("<!DOCTYPE html>"));

    const offline = makeHarness({ legacy: false, failNetwork: true });
    await offline.dispatch("install");
    const offlineNavigation = await offline.dispatchFetch({ method: "GET", mode: "navigate", url: "https://aziel.test/explore" });
    assert.strictEqual(offlineNavigation.respondWithCalls, 1);
    assert((await offlineNavigation.response.text()).includes("You're offline"), "ordinary offline navigation must retain the offline shell");

    const failed = makeHarness({ legacy: true, failInstall: true });
    await assert.rejects(failed.dispatch("install"), /simulated precache failure/);
    assert(failed.stores.has("aziel-runtime-core-v5-storefront-performance"), "failed install must preserve the active shell");

    const pwaRuntime = read("frontend/js/pwa-fix.js");
    assert(pwaRuntime.includes("await registration.update().catch"), "installed apps must explicitly check for a new worker");
    assert(!pwaRuntime.includes("controllerchange"), "payment-safe client runtime must not introduce controller reload loops");
    assert(!read("frontend/js/home.js").includes("/api/catalog"), "Home startup must not restore full catalog loading");
    assert(currentLiveChat.includes('data?.settings?.liveChatEnabled === true'));
    assert(currentLiveChat.includes('cache: "no-store"'));

    console.log("PWA Live Chat migration verification passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
