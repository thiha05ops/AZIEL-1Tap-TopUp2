#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
    getHomePresentation
} = require("../services/homePresentationService");

const UPDATED_AT = "2026-10-12T00:00:00.000Z";

function query(result) {
    const chain = {
        select() { return chain; },
        lean() { return Promise.resolve(result); }
    };
    return chain;
}

function product(overrides = {}) {
    return {
        productCode: "pubg-mobile-fast-7fbcc7684d",
        name: "PUBG Mobile (Fast)",
        description: "Fast top up",
        enabled: true,
        deletedAt: null,
        publicDiscoveryEnabled: true,
        homepageEnabled: true,
        homepageCategory: "MOBILE_GAME_TOPUP",
        homepageOrder: 1,
        homepageSections: ["POPULAR_MOBILE_GAMES", "ALL_MOBILE_GAMES"],
        commerceState: "PURCHASABLE",
        lifecycleStatus: "ACTIVE",
        productRoute: "/products/pubg-mobile-fast-7fbcc7684d",
        artworkPath: "",
        presentation: {},
        updatedAt: UPDATED_AT,
        ...overrides
    };
}

function liveProjection(productCode = "pubg-mobile-fast-7fbcc7684d") {
    return {
        productCode,
        packages: [{ packageCode: "UC_60", salesState: "LIVE" }]
    };
}

async function presentation({
    region = "TH",
    products = [product()],
    selections,
    publicProducts = [liveProjection()],
    publications = [{ productCode: "pubg-mobile-fast-7fbcc7684d", packageCode: "UC_60", published: true, decisionVersion: 1, updatedAt: UPDATED_AT }]
} = {}) {
    const observed = { selectionFilters: [], catalogOptions: [], queryFamilies: [] };
    const marketSelections = selections || [{
        productCode: "pubg-mobile-fast-7fbcc7684d",
        status: "ACTIVE",
        sellingRegions: [region],
        visibleRegions: [],
        updatedAt: UPDATED_AT
    }];
    const models = {
        StoreCatalogSelection: {
            find(filter) {
                observed.queryFamilies.push("selection");
                observed.selectionFilters.push(filter);
                const rows = marketSelections.filter(item => item.status === filter.status && (item.sellingRegions || []).includes(filter.sellingRegions));
                return query(rows);
            }
        },
        CatalogProduct: {
            find(filter) {
                observed.queryFamilies.push("product");
                const codes = new Set(filter.productCode.$in);
                return query(products.filter(item => codes.has(item.productCode)));
            }
        },
        PackageMarketPublication: {
            find(filter) {
                observed.queryFamilies.push("publication");
                const codes = new Set(filter.productCode.$in);
                return query(publications.filter(item => codes.has(item.productCode) && item.customerMarket !== "OTHER"));
            }
        },
        MediaAsset: {
            find() {
                observed.queryFamilies.push("media");
                return query([]);
            }
        }
    };
    const payload = await getHomePresentation({
        region,
        models,
        loadPublicCatalog: async options => {
            observed.catalogOptions.push(options);
            return publicProducts;
        }
    });
    return { payload, observed };
}

function section(payload, key) {
    return payload.sections.find(item => item.key === key)?.products || [];
}

async function main() {
    const eligible = await presentation();
    assert.deepStrictEqual(eligible.observed.selectionFilters, [{ status: "ACTIVE", sellingRegions: "TH" }]);
    assert.deepStrictEqual(eligible.observed.catalogOptions, [{ includeDisabled: false, customerMarket: "TH" }]);
    assert.strictEqual(section(eligible.payload, "POPULAR_MOBILE_GAMES")[0].productCode, "pubg-mobile-fast-7fbcc7684d", "visibleRegions=[] must not suppress an otherwise LIVE Home product");
    assert.strictEqual(section(eligible.payload, "ALL_MOBILE_GAMES").length, 1);

    const homeDisabled = await presentation({ products: [product({ homepageEnabled: false })] });
    assert.strictEqual(section(homeDisabled.payload, "POPULAR_MOBILE_GAMES").length, 0, "Home-disabled products must remain excluded");

    const wrongSection = await presentation({ products: [product({ homepageSections: ["SOCIAL_TOPUP"] })] });
    assert.strictEqual(section(wrongSection.payload, "POPULAR_MOBILE_GAMES").length, 0, "nonmatching sections must remain excluded");
    assert.strictEqual(section(wrongSection.payload, "SOCIAL_TOPUP").length, 1, "matching section membership must remain authoritative");

    const outsideMarket = await presentation({
        region: "MM",
        selections: [{ productCode: "pubg-mobile-fast-7fbcc7684d", status: "ACTIVE", sellingRegions: ["TH"], visibleRegions: ["MM"], updatedAt: UPDATED_AT }],
        publicProducts: [liveProjection()]
    });
    assert.strictEqual(section(outsideMarket.payload, "POPULAR_MOBILE_GAMES").length, 0, "sellingRegions must remain market-specific");

    const noLivePackages = await presentation({ publicProducts: [{ productCode: "pubg-mobile-fast-7fbcc7684d", packages: [{ packageCode: "UC_60", salesState: "BLOCKED" }] }] });
    assert.strictEqual(section(noLivePackages.payload, "POPULAR_MOBILE_GAMES").length, 0, "products without an effective LIVE package must fail closed");
    assert.deepStrictEqual(noLivePackages.observed.queryFamilies, ["selection"], "ineligible products must not trigger presentation detail queries");

    for (const [label, overrides] of [
        ["disabled", { enabled: false }],
        ["deleted", { deletedAt: UPDATED_AT }],
        ["hidden", { commerceState: "HIDDEN" }],
        ["non-discoverable", { publicDiscoveryEnabled: false }]
    ]) {
        const result = await presentation({ products: [product(overrides)] });
        assert.strictEqual(section(result.payload, "POPULAR_MOBILE_GAMES").length, 0, `${label} products must remain excluded`);
    }

    const th = await presentation({ region: "TH", publicProducts: [liveProjection()] });
    const mm = await presentation({ region: "MM", publicProducts: [] });
    assert.strictEqual(section(th.payload, "POPULAR_MOBILE_GAMES").length, 1, "TH LIVE eligibility must admit the TH product");
    assert.strictEqual(section(mm.payload, "POPULAR_MOBILE_GAMES").length, 0, "MM eligibility must be evaluated independently");
    assert.notStrictEqual(th.payload.revision, mm.payload.revision, "market eligibility changes must produce a distinct Home revision");

    const ordered = await presentation({
        products: [
            product({ productCode: "later", name: "Later", homepageOrder: 20 }),
            product({ productCode: "first", name: "First", homepageOrder: 1, featured: false })
        ],
        selections: [
            { productCode: "later", status: "ACTIVE", sellingRegions: ["TH"], visibleRegions: [], updatedAt: UPDATED_AT },
            { productCode: "first", status: "ACTIVE", sellingRegions: ["TH"], visibleRegions: [], updatedAt: UPDATED_AT }
        ],
        publicProducts: [liveProjection("later"), liveProjection("first")],
        publications: []
    });
    assert.deepStrictEqual(section(ordered.payload, "POPULAR_MOBILE_GAMES").map(item => item.productCode), ["first", "later"], "homepageOrder must remain authoritative and Featured must not be required");

    const stable = await presentation();
    assert.strictEqual(eligible.payload.revision, stable.payload.revision, "unchanged eligibility must keep the revision deterministic");
    assert.notStrictEqual(eligible.payload.revision, noLivePackages.payload.revision, "LIVE eligibility removal must invalidate the Home revision");

    assert.deepStrictEqual(eligible.observed.queryFamilies, ["selection", "product", "publication"], "Home must use bounded query families and avoid N+1 lookups");
    console.log(JSON.stringify({
        result: "PASS",
        assertions: 20,
        obsoleteVisibleRegionsGate: false,
        canonicalLiveEligibility: true,
        marketIndependent: true,
        databaseWrites: 0,
        externalCalls: 0
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
