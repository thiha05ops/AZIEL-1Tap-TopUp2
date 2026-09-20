const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const liveChatSource = read("frontend/js/live-chat.js");

function makeElement(tagName = "div") {
    return {
        tagName,
        className: "",
        innerHTML: "",
        children: [],
        style: {},
        classList: { contains: () => false, toggle() {}, remove() {} },
        appendChild(child) { this.children.push(child); },
        addEventListener() {},
        querySelector() { return makeElement("button"); },
        remove() { this.removed = true; }
    };
}

function startScenario(responseFactory) {
    const nodes = new Map();
    const body = makeElement("body");
    body.appendChild = node => {
        node.remove = () => nodes.delete(node.className);
        nodes.set(node.className, node);
    };
    const listeners = {};
    const intervals = [];
    const context = {
        console,
        location: { port: "", protocol: "https:", hostname: "aziel.test" },
        localStorage: { getItem: () => null },
        fetch: responseFactory,
        setTimeout: fn => fn(),
        clearInterval() {},
        setInterval: fn => { intervals.push(fn); return intervals.length; },
        requestAnimationFrame: fn => fn(),
        document: {
            readyState: "complete",
            visibilityState: "visible",
            body,
            addEventListener(type, fn) { listeners[type] = fn; },
            createElement: makeElement,
            querySelector(selector) { return nodes.get(selector.slice(1)) || null; },
            getElementById() { return null; }
        },
        window: { AZIEL: {} }
    };
    context.window.window = context.window;
    vm.runInNewContext(liveChatSource, context, { filename: "live-chat.js" });
    return { context, nodes, intervals, listeners };
}

async function runScenario(responseFactory) {
    const scenario = startScenario(responseFactory);
    await new Promise(resolve => setImmediate(resolve));
    return scenario;
}

function jsonResponse(payload, ok = true) {
    return Promise.resolve({ ok, json: async () => payload });
}

(async () => {
    const on = await runScenario(() => jsonResponse({ success: true, settings: { liveChatEnabled: true } }));
    assert(on.nodes.has("aziel-support-tab"), "ON must create the launcher after authority resolves");
    assert.strictEqual([...on.nodes.keys()].filter(key => key === "aziel-support-tab").length, 1);

    const off = await runScenario(() => jsonResponse({ success: true, settings: { liveChatEnabled: false } }));
    assert(!off.nodes.has("aziel-support-tab"), "OFF must not create the launcher");

    let resolveDelayed;
    const delayed = startScenario(() => new Promise(resolve => { resolveDelayed = resolve; }));
    assert(!delayed.nodes.has("aziel-support-tab"), "Delayed authority must not flash a launcher before resolution");
    resolveDelayed({ ok: true, json: async () => ({ success: true, settings: { liveChatEnabled: true } }) });
    await new Promise(resolve => setImmediate(resolve));
    assert(delayed.nodes.has("aziel-support-tab"), "Delayed ON must eventually create the launcher");

    for (const payload of [
        { success: true, settings: {} },
        { success: true, settings: { liveChatEnabled: "true" } },
        { success: false, settings: { liveChatEnabled: true } }
    ]) {
        const malformed = await runScenario(() => jsonResponse(payload));
        assert(!malformed.nodes.has("aziel-support-tab"), "Unknown or malformed authority must fail closed");
    }

    const failed = await runScenario(() => Promise.reject(new Error("offline")));
    assert(!failed.nodes.has("aziel-support-tab"), "API failure must fail closed");

    let enabled = true;
    const transition = await runScenario(() => jsonResponse({ success: true, settings: { liveChatEnabled: enabled } }));
    assert(transition.nodes.has("aziel-support-tab"));
    enabled = false;
    await transition.intervals[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert(!transition.nodes.has("aziel-support-tab"), "ON to OFF refresh must remove the launcher");

    await transition.context.refreshLiveChatAuthority();
    assert(!transition.nodes.has("aziel-support-tab"), "Duplicate disabled bootstrap must remain absent");

    const pending = [];
    const stale = await runScenario(() => new Promise(resolve => pending.push(resolve)));
    stale.context.refreshLiveChatAuthority();
    pending[1]({ ok: true, json: async () => ({ success: true, settings: { liveChatEnabled: false } }) });
    await new Promise(resolve => setImmediate(resolve));
    pending[0]({ ok: true, json: async () => ({ success: true, settings: { liveChatEnabled: true } }) });
    await new Promise(resolve => setImmediate(resolve));
    assert(!stale.nodes.has("aziel-support-tab"), "A stale ON response must not override a newer authoritative OFF");

    assert(liveChatSource.indexOf("await loadLiveChatAuthority()") < liveChatSource.indexOf("createLiveChatUI();"));
    assert(liveChatSource.includes('cache: "no-store"'), "Authority request must bypass browser HTTP cache");

    const deferred = read("frontend/js/home-deferred-runtime.js");
    assert(deferred.includes("__AZIEL_HOME_DEFERRED_RUNTIME_INITIALIZED__"), "Deferred runtime must execute once");
    assert(deferred.includes("requestIdleCallback") && deferred.includes("live-chat.js"), "Live Chat must stay deferred");
    const home = read("frontend/js/home.js");
    assert(!home.includes('/api/catalog"') && !home.includes("/api/catalog'"), "Home startup must not call /api/catalog");

    const settingsRoute = read("backend/routes/settings.js");
    assert(settingsRoute.includes('"liveChatEnabled"'), "Admin write allowlist must preserve the authority field");
    assert(settingsRoute.includes("no-store, no-cache, must-revalidate"), "Public authority response must not be cached");

    console.log("Live Chat authority verification passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
