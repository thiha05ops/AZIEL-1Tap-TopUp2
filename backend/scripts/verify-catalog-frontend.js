const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");
const vm = require("vm");

require("dotenv").config({
    path: path.join(__dirname, "../..", ".env")
});

const Order = require("../models/Order");
const User = require("../models/User");
const WalletTopup = require("../models/WalletTopup");
const WalletTransaction = require("../models/WalletTransaction");
const ManualPaymentAttempt = require("../models/ManualPaymentAttempt");
const { toPublicCatalog } = require("../services/catalogService");

const ROOT = path.join(__dirname, "../..");
const FRONTEND = path.join(ROOT, "frontend");
const PRESENTATION_FILE = path.join(FRONTEND, "js/catalog-presentation.js");
const RUNTIME_FILE = path.join(FRONTEND, "js/catalog-runtime.js");
const PRICES_FILE = path.join(FRONTEND, "js/prices.js");
const GAME_FLOW_FILE = path.join(FRONTEND, "js/game-flow.js");
const DISCOVERY_FILE = path.join(FRONTEND, "js/catalog-discovery.js");
const SEARCH_FILE = path.join(FRONTEND, "js/search.js");

const ENABLED_PRODUCTS = ["mlbb", "pubg", "freefire", "hok", "aovid", "pubgrp", "telegram"];
const DISABLED_PRODUCTS = ["genshin", "roblox", "valorant"];
const GAME_PAGES = {
    mlbb: "mlbb.html",
    pubg: "pubg.html",
    freefire: "freefire.html",
    hok: "hok.html",
    aovid: "aov-id.html",
    pubgrp: "pubg-rp.html",
    telegram: "telegram.html",
    genshin: "genshin.html",
    roblox: "roblox.html"
};

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function createDocument() {
    const listeners = {};

    return {
        readyState: "complete",
        addEventListener(name, callback) {
            listeners[name] = listeners[name] || [];
            listeners[name].push(callback);
        },
        dispatchEvent(event) {
            (listeners[event.type || event.name] || []).forEach(callback => callback(event));
        },
        getElementById() {
            return null;
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
}

function createSandbox(publicCatalog) {
    const document = createDocument();
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        Date,
        Map,
        JSON,
        Number,
        String,
        Boolean,
        Array,
        Error,
        Promise,
        window: {
            location: { pathname: "/mlbb.html" },
            ASSET: new Proxy({}, {
                get(_target, key) {
                    return file => `assets/${String(key)}/${file}`;
                }
            }),
            addEventListener() {},
            AZIEL: {
                getShopRegion() {
                    return "MM";
                },
                getShopCurrency() {
                    return "MMK";
                },
                getShopSymbol() {
                    return "Ks";
                }
            }
        },
        document,
        CustomEvent: function CustomEvent(type, options = {}) {
            return { type, detail: options.detail || {} };
        },
        Event: function Event(type) {
            return { type };
        },
        fetch: async () => ({
            ok: true,
            json: async () => publicCatalog
        })
    };

    sandbox.window.document = document;
    sandbox.window.fetch = sandbox.fetch;
    sandbox.window.CustomEvent = sandbox.CustomEvent;
    sandbox.window.Event = sandbox.Event;
    return sandbox;
}

async function countOperationalCollections() {
    const [orders, walletTransactions, walletTopups, users, manualPaymentAttempts] = await Promise.all([
        Order.countDocuments(),
        WalletTransaction.countDocuments(),
        WalletTopup.countDocuments(),
        User.countDocuments(),
        ManualPaymentAttempt.countDocuments()
    ]);

    return {
        Order: orders,
        WalletTransaction: walletTransactions,
        WalletTopup: walletTopups,
        User: users,
        ManualPaymentAttempt: manualPaymentAttempts
    };
}

function assertCountsUnchanged(before, after) {
    Object.keys(before).forEach(key => {
        assert.strictEqual(after[key], before[key], `${key} count changed`);
    });
}

function runFrontendModules(publicCatalog) {
    const sandbox = createSandbox(publicCatalog);
    const context = vm.createContext(sandbox);

    [PRESENTATION_FILE, RUNTIME_FILE].forEach(file => {
        vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
    });

    return sandbox;
}

async function verifyRuntimeProjection(publicCatalog) {
    const sandbox = runFrontendModules(publicCatalog);
    const catalog = sandbox.window.AZIEL_CATALOG;

    assert(catalog, "AZIEL_CATALOG missing");
    assert.strictEqual(typeof catalog.load, "function");
    assert.strictEqual(typeof catalog.refresh, "function");
    assert.strictEqual(typeof catalog.getProducts, "function");
    assert.strictEqual(typeof catalog.getPackages, "function");
    assert.strictEqual(typeof catalog.getPackage, "function");

    await catalog.load();
    assert(catalog.isReady(), "catalog did not become ready");

    const products = catalog.getProducts();
    ENABLED_PRODUCTS.forEach(productCode => {
        const product = products.find(item => item.productCode === productCode);
        assert(product, `${productCode} missing from customer projection`);
        assert(product.route, `${productCode} missing route`);
        assert(product.image, `${productCode} missing image`);
    });

    DISABLED_PRODUCTS.forEach(productCode => {
        assert(!products.some(item => item.productCode === productCode), `${productCode} should be excluded`);
    });

    const mmPackage = catalog.getPackage("mlbb", "MLBB_WEEKLY_1X", "MM");
    const thPackage = catalog.getPackage("mlbb", "MLBB_WEEKLY_1X", "TH");
    const sourceProduct = publicCatalog.products.find(product => product.productCode === "mlbb");
    const sourcePackage = sourceProduct?.packages?.find(item => item.packageCode === "MLBB_WEEKLY_1X");
    const expectedMmAmount = Number(sourcePackage?.prices?.MM?.amount);
    const expectedThAmount = Number(sourcePackage?.prices?.TH?.amount);

    assert.strictEqual(mmPackage.currency, "MMK");
    assert.strictEqual(mmPackage.amount, expectedMmAmount);
    assert.strictEqual(thPackage.currency, "THB");
    assert.strictEqual(thPackage.amount, expectedThAmount);
    assert.strictEqual(mmPackage.productCode, "mlbb");
    assert.strictEqual(mmPackage.packageCode, "MLBB_WEEKLY_1X");
    assert(mmPackage.icon, "package icon missing");

    const unknownIcon = sandbox.window.AZIEL_CATALOG_PRESENTATION.getPackageIcon("mlbb", "UNKNOWN_PACKAGE");
    assert(unknownIcon, "unknown package fallback icon missing");

    const mobileProducts = catalog.getProducts({ category: "mobile" });
    assert(mobileProducts.some(item => item.productCode === "mlbb"), "mobile projection missing MLBB");
    assert(!mobileProducts.some(item => item.productCode === "telegram"), "mobile projection should not include Telegram");

    return sandbox;
}

async function verifyStaleRefreshContracts(publicCatalog) {
    const first = JSON.parse(JSON.stringify(publicCatalog));
    const second = JSON.parse(JSON.stringify(publicCatalog));
    const mlbbPackage = second.products
        .find(product => product.productCode === "mlbb")
        .packages.find(item => item.packageCode === "MLBB_WEEKLY_1X");
    const originalAmount = Number(mlbbPackage.prices.MM.amount);
    const changedAmount = originalAmount + 777;

    mlbbPackage.prices.MM.amount = changedAmount;

    let callCount = 0;
    const sandbox = runFrontendModules(first);
    sandbox.fetch = async () => ({
        ok: true,
        json: async () => {
            callCount += 1;
            return callCount === 1 ? first : second;
        }
    });
    sandbox.window.fetch = sandbox.fetch;

    await sandbox.window.AZIEL_CATALOG.load({ force: true });
    const original = sandbox.window.AZIEL_CATALOG.getPackage("mlbb", "MLBB_WEEKLY_1X", "MM");
    assert.strictEqual(original.amount, originalAmount);

    await sandbox.window.AZIEL_CATALOG.refresh();
    const changed = sandbox.window.AZIEL_CATALOG.getPackage("mlbb", "MLBB_WEEKLY_1X", "MM");
    assert.strictEqual(changed.amount, changedAmount);

    const disabled = JSON.parse(JSON.stringify(publicCatalog));
    disabled.products = disabled.products.filter(product => product.productCode !== "mlbb");
    sandbox.fetch = async () => ({
        ok: true,
        json: async () => disabled
    });
    sandbox.window.fetch = sandbox.fetch;

    await sandbox.window.AZIEL_CATALOG.refresh();
    assert.strictEqual(sandbox.window.AZIEL_CATALOG.getPackage("mlbb", "MLBB_WEEKLY_1X", "MM"), null);
}

function verifyStaticSourceContracts() {
    const pricesSource = fs.readFileSync(PRICES_FILE, "utf8");
    const runtimeSource = fs.readFileSync(RUNTIME_FILE, "utf8");
    const gameFlowSource = fs.readFileSync(GAME_FLOW_FILE, "utf8");
    const discoverySource = fs.readFileSync(DISCOVERY_FILE, "utf8");
    const searchSource = fs.readFileSync(SEARCH_FILE, "utf8");

    assert(!/GAME_PRICES/.test(pricesSource), "prices.js still exposes GAME_PRICES");
    assert(!/\bmmk\s*:/.test(pricesSource), "prices.js still owns MMK values");
    assert(!/\bthb\s*:/.test(pricesSource), "prices.js still owns THB values");
    assert(/window\.AZIEL_CATALOG/.test(pricesSource), "prices.js does not depend on AZIEL_CATALOG");
    assert(/catalog\.getPackages/.test(pricesSource), "prices.js does not render from catalog packages");
    assert(/productCode/.test(pricesSource) && /packageCode/.test(pricesSource), "selected package identity missing");
    assert(/ensureFreshForPurchase/.test(gameFlowSource), "game-flow missing purchase freshness");
    assert(/AZIEL_CATALOG\.getPackage/.test(gameFlowSource), "game-flow missing fresh package resolution");
    assert(/Price updated to the latest catalog price/.test(gameFlowSource), "game-flow missing price-review notice");
    assert(/This package is no longer available/.test(gameFlowSource), "game-flow missing package-disable notice");
    assert(/getProducts/.test(discoverySource), "discovery does not use catalog products");
    assert(/getProducts/.test(searchSource), "search does not use catalog products");
    assert(/cache:\s*"no-store"/.test(runtimeSource), "catalog fetch must not use stale browser cache");
}

function verifyHtmlScriptOrder() {
    Object.entries(GAME_PAGES).forEach(([productCode, page]) => {
        const html = read(`frontend/${page}`);
        const presentationIndex = html.indexOf("/js/catalog-presentation.js");
        const runtimeIndex = html.indexOf("/js/catalog-runtime.js");
        const pricesIndex = html.indexOf("/js/prices.js");
        const flowIndex = html.indexOf("/js/game-flow.js");

        assert(presentationIndex > -1, `${page} missing catalog-presentation.js`);
        assert(runtimeIndex > presentationIndex, `${page} catalog-runtime order invalid`);
        assert(pricesIndex > runtimeIndex, `${page} prices order invalid`);
        assert(flowIndex > pricesIndex, `${page} game-flow order invalid`);
        assert(html.includes(`data-game="${productCode}"`), `${page} data-game mismatch`);
    });

    ["home.html", "mobile-games.html", "pc-games.html", "gift-cards.html"].forEach(page => {
        const html = read(`frontend/${page}`);
        assert(html.includes("/js/catalog-presentation.js"), `${page} missing presentation script`);
        assert(html.includes("/js/catalog-runtime.js"), `${page} missing runtime script`);
        assert(html.includes("/js/catalog-discovery.js"), `${page} missing discovery script`);
    });
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });

    try {
        const before = await countOperationalCollections();
        const publicCatalog = {
            success: true,
            source: "database",
            products: await toPublicCatalog({ source: "database", includeDisabled: false })
        };

        await verifyRuntimeProjection(publicCatalog);
        await verifyStaleRefreshContracts(publicCatalog);
        verifyStaticSourceContracts();
        verifyHtmlScriptOrder();

        const after = await countOperationalCollections();
        assertCountsUnchanged(before, after);

        console.log("Catalog frontend projection checks passed.");
        console.log("Catalog frontend stale refresh checks passed.");
        console.log("Catalog frontend static ownership checks passed.");
        console.log("Catalog frontend operational counts unchanged:", after);
    } finally {
        await mongoose.connection.close(false);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
