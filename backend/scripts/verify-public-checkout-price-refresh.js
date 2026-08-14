"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../..");
const flowSource = fs.readFileSync(path.join(ROOT, "frontend/js/game-flow.js"), "utf8");
const pricesSource = fs.readFileSync(path.join(ROOT, "frontend/js/prices.js"), "utf8");
const runtimeSource = fs.readFileSync(path.join(ROOT, "frontend/js/catalog-runtime.js"), "utf8");

function loadFlow() {
    const document = {
        readyState: "complete",
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById() { return null; }
    };
    const sandbox = {
        console,
        document,
        Element: class Element {},
        CustomEvent: class CustomEvent {},
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        sessionStorage: { setItem() {} },
        window: {
            document,
            location: { pathname: "/mlbb.html", href: "http://localhost/mlbb.html" },
            addEventListener() {}
        }
    };
    sandbox.window.window = sandbox.window;
    vm.runInNewContext(flowSource, sandbox, { filename: "game-flow.js" });
    return sandbox.window;
}

async function reconcile(window, { staleAmount, latestAmount, packageAvailable = true, renderReady = true }) {
    const identity = { productCode: "mlbb", packageCode: "MLBB_13_1", region: "TH" };
    const latest = { ...identity, code: identity.packageCode, amount: latestAmount, price: latestAmount };
    window.AZIEL_CATALOG = {
        async ensureFreshForPurchase() { return true; },
        getPackage() { return packageAvailable ? latest : null; }
    };
    window.renderGamePrices = async options => ({
        ready: renderReady,
        unavailable: !renderReady,
        selectedPackage: renderReady ? { ...latest } : null,
        options
    });
    return window.AZIEL_GAME_FLOW.refreshPackageForCheckout(
        { config: { productCode: identity.productCode, gameKey: identity.productCode } },
        { ...identity, amount: staleAmount }
    );
}

async function main() {
    const window = loadFlow();

    const unchanged = await reconcile(window, { staleAmount: 10, latestAmount: 10 });
    assert.strictEqual(unchanged.ready, true, "unchanged checkout must remain ready");
    assert.strictEqual(unchanged.priceChanged, false, "unchanged price must not request review");

    const changed = await reconcile(window, { staleAmount: 10, latestAmount: 12 });
    assert.strictEqual(changed.ready, true, "changed package must be re-resolved");
    assert.strictEqual(changed.priceChanged, true, "changed price must request one review");
    assert.strictEqual(changed.selectedPackage.packageCode, "MLBB_13_1", "selection must survive refresh by identity");
    assert.strictEqual(changed.selectedPackage.amount, 12, "latest authoritative preview must replace stale amount");

    const confirmed = await reconcile(window, { staleAmount: changed.selectedPackage.amount, latestAmount: 12 });
    assert.strictEqual(confirmed.priceChanged, false, "review requirement must clear after accepting latest amount");
    assert.strictEqual(confirmed.ready, true, "second checkout confirmation must be allowed");

    const removed = await reconcile(window, { staleAmount: 10, latestAmount: 12, packageAvailable: false });
    assert.strictEqual(removed.unavailable, true, "removed package must produce explicit unavailable state");
    assert.strictEqual(removed.selectedPackage, null, "removed package must not retain a stale selection");

    const renderFailure = await reconcile(window, { staleAmount: 10, latestAmount: 12, renderReady: false });
    assert.strictEqual(renderFailure.ready, false, "failed catalog render must block checkout safely");

    assert(runtimeSource.includes('load({ force: true, source: "purchase" })'), "purchase refresh must bypass catalog TTL");
    assert(pricesSource.includes('event.detail?.source === "purchase"'), "purchase refresh must not trigger competing automatic render");
    assert(pricesSource.includes("finishPackageLoading(packageContainer)"), "render terminal states must clear package loading");
    assert(flowSource.includes("orderData = buildOrderData(flow)"), "checkout must rebuild its draft from refreshed selection");

    console.log("Public checkout unchanged-price regression passed.");
    console.log("Public checkout changed-price/reselection/review regression passed.");
    console.log("Public checkout unavailable/error-state regression passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
