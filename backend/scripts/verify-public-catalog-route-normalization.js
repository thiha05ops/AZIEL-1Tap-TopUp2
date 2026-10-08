#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const listeners = {};
const document = {
    readyState: "loading",
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
    dispatchEvent() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
};
const products = [
    { productCode: "generic-live", name: "Generic Live", enabled: true, publicCategory: "mobile", productRoute: "/products/generic-live", packages: [{}] },
    { productCode: "disabled", name: "Disabled", enabled: false, publicCategory: "mobile", productRoute: "/products/disabled", packages: [{}] },
    { productCode: "unpublished", name: "Unpublished", enabled: true, publicCategory: "mobile", productRoute: "", packages: [] }
];
const sandbox = {
    console, setTimeout, clearTimeout, Date, Map, Set, Promise, JSON, Number, String, Boolean, Array, Error,
    document,
    CustomEvent: function CustomEvent(type, options = {}) { return { type, detail: options.detail || {} }; },
    Event: function Event(type) { return { type }; },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: async url => String(url).includes("/api/notifications/")
        ? ({ ok: true, json: async () => ({ success: true, promotions: [] }) })
        : ({ ok: true, json: async () => ({ success: true, products }) }),
    window: { document, location: { pathname: "/mobile-games" }, addEventListener() {}, dispatchEvent() {}, AZIEL: { getRegion: () => "TH" } }
};
sandbox.window.fetch = sandbox.fetch;
sandbox.window.CustomEvent = sandbox.CustomEvent;
sandbox.window.Event = sandbox.Event;
sandbox.window.localStorage = sandbox.localStorage;
const context = vm.createContext(sandbox);
for (const file of ["catalog-runtime.js", "catalog-discovery.js", "search.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "frontend/js", file), "utf8"), context, { filename: file });
}

(async () => {
    await sandbox.window.AZIEL_CATALOG.load();
    const runtimeProducts = sandbox.window.AZIEL_CATALOG.getProducts();
    const live = runtimeProducts.find(product => product.productCode === "generic-live");
    assert.strictEqual(live.route, "/products/generic-live", "productRoute must be normalized centrally to route.");
    assert.strictEqual(live.productRoute, "/products/generic-live", "The public productRoute contract must be preserved.");
    assert(!runtimeProducts.some(product => product.productCode === "disabled"), "Disabled products must remain excluded.");
    assert(!sandbox.window.AZIEL_CATALOG_DISCOVERY.activeProducts("mobile").some(product => product.productCode === "unpublished"), "Products without a projected route must remain excluded.");
    assert.deepStrictEqual(sandbox.window.AZIEL_CATALOG_DISCOVERY.activeProducts("mobile").map(product => product.productCode), ["generic-live"]);
    const searchIndex = await sandbox.window.AZIEL_SEARCH.refresh();
    const searchProduct = searchIndex.find(item => item.title === "Generic Live");
    assert.strictEqual(searchProduct?.url, "/products/generic-live", "Search must index the centrally normalized route.");
    assert(!searchIndex.some(item => ["Disabled", "Unpublished"].includes(item.title)), "Search must not expose ineligible products.");
    console.log(JSON.stringify({ result: "PASS", games: ["generic-live"], searchRoute: searchProduct.url, excluded: ["disabled", "unpublished"], homePlacementChanged: false, writes: 0 }, null, 2));
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
