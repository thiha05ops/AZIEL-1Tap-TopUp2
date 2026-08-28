"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function response(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function runtime(fetchImpl) {
    const documentListeners = {};
    const windowListeners = {};
    const events = [];
    const delays = [];
    const document = {
        addEventListener(name, callback) { (documentListeners[name] ||= []).push(callback); },
        dispatchEvent(event) {
            events.push(event);
            (documentListeners[event.type] || []).forEach(callback => callback(event));
        },
        querySelector() { return null; },
        createElement() { return { append() {}, setAttribute() {}, className: "", textContent: "", href: "" }; }
    };
    const window = {
        document,
        addEventListener(name, callback) { (windowListeners[name] ||= []).push(callback); },
        dispatchEvent(event) {
            events.push(event);
            (windowListeners[event.type] || []).forEach(callback => callback(event));
        }
    };
    const sandbox = {
        window, document, fetch: fetchImpl,
        setTimeout(callback, delay) { delays.push(delay); callback(); return delays.length; },
        clearTimeout() {}, Date, Map, Promise, JSON, Number, String, Boolean, Array, Error,
        CustomEvent: function CustomEvent(type, options = {}) { return { type, detail: options.detail || {} }; }
    };
    window.fetch = fetchImpl;
    window.CustomEvent = sandbox.CustomEvent;
    const context = vm.createContext(sandbox);
    vm.runInContext(read("frontend/js/catalog-runtime.js"), context, { filename: "catalog-runtime.js" });
    vm.runInContext(read("frontend/js/storefront-sections.js"), context, { filename: "storefront-sections.js" });
    return { window, events, delays };
}

async function verifyStartupRecovery() {
    const calls = new Map();
    const fixtureProduct = { productCode: "fixture", enabled: true, packages: [] };
    const fixtureSection = {
        key: "mobile-games", displayName: "Mobile Games", path: "/mobile-games.html",
        status: "PUBLISHED", showInGamesMenu: true, sortOrder: 1
    };
    const app = runtime(async url => {
        const count = Number(calls.get(url) || 0) + 1;
        calls.set(url, count);
        if (count === 1) {
            return response(503, { success: false, code: "SERVICE_TEMPORARILY_UNAVAILABLE" });
        }
        if (url === "/api/catalog") return response(200, { success: true, products: [fixtureProduct] });
        return response(200, { success: true, sections: [fixtureSection] });
    });

    await Promise.all([
        app.window.AZIEL_CATALOG.load(),
        app.window.AZIEL_STOREFRONT_SECTIONS.load()
    ]);

    assert.strictEqual(calls.get("/api/catalog"), 2, "Home catalog should recover after one startup 503");
    assert.strictEqual(calls.get("/api/public/storefront-sections"), 2, "Storefront sections should recover after one startup 503");
    assert.strictEqual(app.window.AZIEL_CATALOG.getStatus(), "ready");
    assert.strictEqual(app.window.AZIEL_CATALOG.getProducts()[0].productCode, "fixture");
    assert.strictEqual(app.window.AZIEL_STOREFRONT_SECTIONS.getSection("mobile-games").displayName, "Mobile Games");
    assert(app.events.some(event => event.type === "aziel:catalog-updated" && event.detail.status === "ready"));
    assert(app.events.some(event => event.type === "aziel:storefront-sections-updated" && !event.detail.fallback));
    assert.deepStrictEqual(app.delays, [750, 750], "Both initial startup failures should use the bounded first delay");
}

async function verifyNoBusinessFailureRetry() {
    const calls = new Map();
    const app = runtime(async url => {
        calls.set(url, Number(calls.get(url) || 0) + 1);
        return response(400, { success: false, code: "INVALID_REQUEST", message: "Invalid request" });
    });
    await assert.rejects(app.window.AZIEL_CATALOG.load(), /Invalid request/);
    await app.window.AZIEL_STOREFRONT_SECTIONS.load();
    assert.strictEqual(calls.get("/api/catalog"), 1, "Catalog must not retry normal business 4xx responses");
    assert.strictEqual(calls.get("/api/public/storefront-sections"), 1, "Storefront sections must not retry normal business 4xx responses");
    assert.deepStrictEqual(app.delays, []);
}

async function verifyRetryBound() {
    const calls = new Map();
    const app = runtime(async url => {
        calls.set(url, Number(calls.get(url) || 0) + 1);
        return response(503, { success: false, code: "SERVICE_TEMPORARILY_UNAVAILABLE" });
    });
    await assert.rejects(app.window.AZIEL_CATALOG.load(), /Catalog unavailable/);
    await app.window.AZIEL_STOREFRONT_SECTIONS.load();
    assert.strictEqual(calls.get("/api/catalog"), 4, "Catalog startup recovery must remain bounded");
    assert.strictEqual(calls.get("/api/public/storefront-sections"), 4, "Storefront startup recovery must remain bounded");
}

function verifyMongoRetryDoesNotExhaust() {
    const server = read("backend/server.js");
    assert(server.includes("attemptMongoConnection(connectDatabase).catch(() => null)"));
    assert(server.includes("Math.min(MONGO_RETRY_MAX_MS"), "Mongo delay should cap without capping attempts");
    assert(!/MONGO_(?:MAX_RETRIES|RETRY_LIMIT)|attempts\s*[>=]{1,2}\s*\d+/.test(server), "Mongo retry must not have a fixed exhaustion limit");
}

async function main() {
    verifyMongoRetryDoesNotExhaust();
    await verifyStartupRecovery();
    await verifyNoBusinessFailureRetry();
    await verifyRetryBound();
    console.log("Home startup-readiness recovery verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
