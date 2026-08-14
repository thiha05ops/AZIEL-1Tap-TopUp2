const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { CANONICAL_OPERATIONAL_PRODUCTS } = require("../catalog/canonicalOperationalCatalog");

const ROOT = path.join(__dirname, "../..");
const FRONTEND = path.join(ROOT, "frontend");

function payload(amount = 55, includeProduct = true) {
    const canonical = CANONICAL_OPERATIONAL_PRODUCTS[0];
    return {
        success: true,
        source: "verifier-fixture",
        products: includeProduct ? [{
            productCode: canonical.productCode,
            name: canonical.name,
            enabled: true,
            supportedRegions: ["MM", "TH"],
            publicCategory: canonical.platform,
            productRoute: canonical.productRoute,
            artworkPath: "assets/verifier.webp",
            availabilityCode: "AVAILABLE",
            packages: [{
                productCode: canonical.productCode,
                packageCode: "VERIFIER_FRONTEND_1",
                name: "Verifier Frontend Package",
                enabled: true,
                prices: {
                    MM: { amount: 6800, currency: "MMK", enabled: true },
                    TH: { amount, currency: "THB", enabled: true }
                }
            }, {
                productCode: canonical.productCode,
                packageCode: "VERIFIER_DISABLED",
                name: "Disabled Fixture",
                enabled: false,
                prices: { TH: { amount: 1, currency: "THB", enabled: true } }
            }]
        }] : []
    };
}

function documentStub() {
    const listeners = {};
    return {
        readyState: "complete",
        addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
        dispatchEvent(event) { (listeners[event.type] || []).forEach(callback => callback(event)); },
        getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }
    };
}

function sandboxWith(responses) {
    const document = documentStub();
    let call = 0;
    const fetch = async () => ({ ok: true, json: async () => responses[Math.min(call++, responses.length - 1)] });
    const sandbox = {
        console, setTimeout, clearTimeout, Date, Map, JSON, Number, String, Boolean, Array, Error, Promise, URL,
        document, fetch,
        CustomEvent: function (type, options = {}) { return { type, detail: options.detail || {} }; },
        Event: function (type) { return { type }; },
        window: {
            location: { pathname: "/mlbb.html" }, document, fetch,
            addEventListener() {},
            ASSET: new Proxy({}, { get: (_target, key) => file => `assets/${String(key)}/${file}` }),
            AZIEL: { getShopRegion: () => "TH", getShopCurrency: () => "THB", getShopSymbol: () => "฿" }
        }
    };
    sandbox.window.CustomEvent = sandbox.CustomEvent;
    sandbox.window.Event = sandbox.Event;
    sandbox.fetchCount = () => call;
    const context = vm.createContext(sandbox);
    ["catalog-presentation.js", "catalog-runtime.js"].forEach(file => {
        vm.runInContext(fs.readFileSync(path.join(FRONTEND, "js", file), "utf8"), context, { filename: file });
    });
    return sandbox;
}

async function verifyProjectionAndRefresh() {
    const sandbox = sandboxWith([payload(55), payload(77), payload(77, false)]);
    const catalog = sandbox.window.AZIEL_CATALOG;
    await catalog.load({ force: true });
    const product = catalog.getProducts()[0];
    assert.strictEqual(product.productCode, CANONICAL_OPERATIONAL_PRODUCTS[0].productCode);
    assert.strictEqual(product.route, CANONICAL_OPERATIONAL_PRODUCTS[0].productRoute);
    assert.strictEqual(product.category, "mobile");
    assert.strictEqual(product.availabilityCode, "AVAILABLE");
    assert.strictEqual(catalog.getPackage(product.productCode, "VERIFIER_FRONTEND_1", "TH").amount, 55);
    assert.strictEqual(catalog.getPackage(product.productCode, "VERIFIER_DISABLED", "TH"), null);
    await catalog.refresh();
    assert.strictEqual(catalog.getPackage(product.productCode, "VERIFIER_FRONTEND_1", "TH").amount, 77);
    await catalog.refresh();
    assert.strictEqual(catalog.getPackage(product.productCode, "VERIFIER_FRONTEND_1", "TH"), null);
}

async function verifyForcedLoadSharesInFlightRequest() {
    const sandbox = sandboxWith([payload(55)]);
    const catalog = sandbox.window.AZIEL_CATALOG;
    await Promise.all([catalog.load(), catalog.load({ force: true }), catalog.ensureFresh()]);
    assert.strictEqual(sandbox.fetchCount(), 1, "concurrent forced and normal catalog loads must share one request");
}

function verifyOwnershipContracts() {
    const read = file => fs.readFileSync(path.join(FRONTEND, "js", file), "utf8");
    const runtime = read("catalog-runtime.js");
    const prices = read("prices.js");
    const flow = read("game-flow.js");
    assert(/cache:\s*"no-store"/.test(runtime));
    assert(!/GAME_PRICES/.test(prices));
    assert(/AZIEL_CATALOG/.test(prices) && /getPackages/.test(prices));
    assert(/ensureFreshForPurchase/.test(flow) && /AZIEL_CATALOG\.getPackage/.test(flow));
    assert(/Price updated to the latest catalog price/.test(flow));
    assert(/This package is no longer available/.test(flow));
}

verifyProjectionAndRefresh()
    .then(verifyForcedLoadSharesInFlightRequest)
    .then(() => { verifyOwnershipContracts(); console.log("Catalog frontend projection, refresh, and ownership checks passed."); })
    .catch(error => { console.error(error); process.exit(1); });
