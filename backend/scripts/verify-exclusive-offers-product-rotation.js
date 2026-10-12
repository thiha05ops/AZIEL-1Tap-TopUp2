#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const catalogSource = fs.readFileSync(
    path.join(ROOT, "backend/services/catalogService.js"),
    "utf8"
);
const frontendSource = fs.readFileSync(
    path.join(ROOT, "frontend/js/home-promotion-preview.js"),
    "utf8"
);

function loadFrontendRuntime() {
    const context = {
        console,
        URLSearchParams,
        window: { location: { pathname: "/home.html", search: "" } },
        document: {
            readyState: "loading",
            addEventListener() {},
            getElementById() { return null; }
        },
        localStorage: { getItem: () => null },
        fetch: async () => { throw new Error("Network access is forbidden"); }
    };

    // Instrument only the isolated test copy; production source exports no test API.
    const instrumented = frontendSource.replace(
        /\n\s*ready\(\(\) => \{[\s\S]*?\n\s*\}\);\s*\n\}\)\(\);\s*$/,
        "\nwindow.__exclusiveOfferTest = { offerVariantForVisit, selectOfferVariants, renderOffer };\n})();"
    );
    vm.runInNewContext(instrumented, context, {
        filename: "home-promotion-preview.js"
    });
    return context.window.__exclusiveOfferTest;
}

function variant(productCode, packageCode, amount, currency = "THB") {
    return {
        productCode,
        productName: productCode.toUpperCase(),
        productRoute: `/products/${productCode}`,
        productImage: `/${productCode}.webp`,
        packageCode,
        packageName: packageCode,
        packageIcon: `/${packageCode}.webp`,
        amount,
        referencePrice: amount + 10,
        saveAmount: 10,
        discountPercent: 10,
        currency,
        showOriginalPrice: true
    };
}

function main() {
    const exclusiveBody = catalogSource.slice(
        catalogSource.indexOf("async function listPublicExclusiveOffers"),
        catalogSource.indexOf("module.exports")
    );

    assert(exclusiveBody.includes('sellingRegions: customerMarket,\n            productCode:'), "Exclusive Offers must retain sellingRegions authority");
    assert(!exclusiveBody.includes("visibleRegions: customerMarket"), "Exclusive Offers must not use obsolete visibleRegions authority");
    assert(exclusiveBody.includes("applySelectedPublicPurchasability("), "Canonical LIVE and GLOBAL supplier readiness projection must remain authoritative");
    assert(exclusiveBody.includes('pkg.salesState === "LIVE"'), "Non-LIVE packages must remain excluded");
    assert(exclusiveBody.includes("Number(price.referencePrice || 0) >"), "Regional discount pricing must remain required");
    assert(exclusiveBody.includes("variantsPerProductLimit = 12"), "Variant payload must remain bounded");
    assert(exclusiveBody.includes("...variants[0],\n            variants"), "Backend must preserve top-level compatibility and expose variants");
    assert(!exclusiveBody.includes("winners.push(candidates[0])"), "Backend must not discard same-product package variants");
    assert(exclusiveBody.includes("return winners.slice(0, limit)"), "Limit must apply after grouping into product entries");

    const runtime = loadFrontendRuntime();
    assert(runtime, "Isolated frontend selection runtime must load");

    const mlbbVariants = [
        variant("mlbb", "ML_1", 10),
        variant("mlbb", "ML_2", 20),
        variant("mlbb", "ML_3", 30)
    ];
    const pubgVariant = variant("pubg", "PUBG_1", 40);
    const offers = [
        { ...mlbbVariants[0], variants: mlbbVariants },
        { ...pubgVariant, variants: [pubgVariant] }
    ];

    assert.deepStrictEqual(
        [1, 2, 3, 4].map(cursor =>
            runtime.selectOfferVariants(offers, cursor)[0].packageCode
        ),
        ["ML_1", "ML_2", "ML_3", "ML_1"],
        "Package rotation must be deterministic and wrap per Home visit"
    );

    const secondVisit = runtime.selectOfferVariants(offers, 2);
    assert.strictEqual(secondVisit.length, 2, "Different products must remain visible simultaneously");
    assert.deepStrictEqual(
        Array.from(secondVisit, item => item.productCode),
        ["mlbb", "pubg"],
        "Product ordering must remain stable"
    );
    assert.strictEqual(secondVisit[1].packageCode, "PUBG_1", "One-package products must remain stable");

    const duplicateLegacyProduct = runtime.selectOfferVariants([
        offers[0],
        { ...mlbbVariants[1], variants: [mlbbVariants[1]] },
        offers[1]
    ], 1);
    assert.strictEqual(duplicateLegacyProduct.length, 2, "Frontend must render exactly one card per product defensively");

    const selected = secondVisit[0];
    const html = runtime.renderOffer(selected);
    assert(html.includes("ML_2.webp"), "Artwork must match the selected package");
    assert(html.includes("package=ML_2"), "View Package link must match the selected package");
    assert(html.includes("฿20"), "Price and currency must match the selected package");

    const mm = variant("mlbb", "ML_MM", 1200, "MMK");
    const mmHtml = runtime.renderOffer(runtime.selectOfferVariants([
        { ...mm, variants: [mm] }
    ], 1)[0]);
    assert(mmHtml.includes("1,200 Ks"), "MMK rendering must remain market-specific");

    assert(frontendSource.includes("homeRotationCursor"), "Rotation must reuse the existing once-per-visit cursor");
    assert(!frontendSource.includes("setInterval("), "Rotation must not use a timer");

    console.log(JSON.stringify({
        result: "PASS",
        assertions: 20,
        productCards: 2,
        mlbbSequence: ["ML_1", "ML_2", "ML_3", "ML_1"],
        marketCurrencies: ["THB", "MMK"],
        databaseWrites: 0,
        externalCalls: 0
    }, null, 2));
}

main();
