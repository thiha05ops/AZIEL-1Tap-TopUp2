"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function policy() {
    const document = { readyState: "loading", addEventListener() {}, dispatchEvent() {}, getElementById() { return null; } };
    const sandbox = {
        console, setTimeout, clearTimeout, Promise, JSON, Number, String, Boolean, Array, Set, Intl,
        document, localStorage: { getItem() { return null; } },
        CustomEvent: function CustomEvent(type, options = {}) { return { type, detail: options.detail }; },
        window: { document, addEventListener() {} }
    };
    vm.runInContext(read("frontend/js/home-placement-runtime.js"), vm.createContext(sandbox));
    return sandbox.window.AZIEL_HOME_PLACEMENT_POLICY;
}
function product(code, sections, overrides = {}) {
    return {
        productCode: code,
        name: code,
        route: `product.html?product=${code}`,
        enabled: true,
        homepageEnabled: true,
        homepageSections: sections,
        homepageOrder: 0,
        discoverable: true,
        publicState: "AVAILABLE",
        publicCategory: "mobile",
        ...overrides
    };
}

function run() {
    const home = read("frontend/home.html");
    const runtime = read("frontend/js/home-placement-runtime.js");
    const admin = read("frontend/js/admin-catalog.js");
    const p = policy();
    assert(!home.includes('href="mlbb.html" class="popular-game-card"'));
    assert(home.includes('id="popularGamesList"'));

    const popular = product("popular", ["POPULAR_MOBILE_GAMES"]);
    const all = product("all", ["ALL_MOBILE_GAMES"]);
    const social = product("social", ["SOCIAL_TOPUP"], { publicCategory: "social" });
    assert.deepStrictEqual(p.selectPopularProducts([popular]).map(item => item.productCode), ["popular"]);
    assert.deepStrictEqual(p.selectAllMobileProducts([all, popular]).map(item => item.productCode), ["all"]);
    assert.deepStrictEqual(p.selectSocialProducts([social, all]).map(item => item.productCode), ["social"]);
    assert.strictEqual(p.selectAllMobileProducts([product("category-only", [])]).length, 0);
    assert.strictEqual(p.selectPopularProducts([product("home-off", ["POPULAR_MOBILE_GAMES"], { homepageEnabled: false })]).length, 0);
    assert.strictEqual(p.selectPopularProducts([product("undiscoverable", ["POPULAR_MOBILE_GAMES"], { discoverable: false })]).length, 0);
    assert.strictEqual(p.selectPopularProducts([product("hidden", ["POPULAR_MOBILE_GAMES"], { publicState: "HIDDEN" })]).length, 0);
    assert.deepStrictEqual(p.selectPopularProducts([
        product("later", ["POPULAR_MOBILE_GAMES"], { homepageOrder: 2 }),
        product("first", ["POPULAR_MOBILE_GAMES"], { homepageOrder: 1 })
    ]).map(item => item.productCode), ["first", "later"]);
    assert.deepStrictEqual(p.selectPopularProducts([product("legacy-popular", ["POPULAR_GAME_TOPUP"])]).map(item => item.productCode), ["legacy-popular"]);
    assert.deepStrictEqual(p.selectAllMobileProducts([product("legacy-popular", ["POPULAR_GAME_TOPUP"])]).map(item => item.productCode), ["legacy-popular"]);
    assert.deepStrictEqual(p.selectAllMobileProducts([product("legacy-all", ["NEW_GAME_TOPUP"])]).map(item => item.productCode), ["legacy-all"]);
    assert.deepStrictEqual(p.selectSocialProducts([product("legacy-social", ["DIGITAL_SERVICES"])]).map(item => item.productCode), ["legacy-social"]);
    const ordered = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen"].map(code => product(code, ["ALL_MOBILE_GAMES"]));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.chunkProducts(ordered.slice(0, 7), 6).map(chunk => chunk.map(item => item.productCode)))), [["one", "two", "three", "four", "five", "six"], ["seven"]]);
    assert(runtime.includes('const MOBILE_GROUP_RAIL_ID = "homeMobileGroupRail"'));
    assert(runtime.includes('rail.className = "home-mobile-group-rail"'));
    assert(runtime.includes("isMobileViewport() ? selected.length : DESKTOP_PANEL_SIZE"));
    assert(runtime.indexOf('id: "popularGames"') < runtime.indexOf('id: "allMobileGames"'));
    assert(runtime.indexOf('id: "allMobileGames"') < runtime.indexOf('id: "socialTopUp"'));
    assert(!runtime.includes('publicCategory === "mobile"'));
    assert(!runtime.includes('publicCategory === "social"'));
    assert(runtime.includes("aziel:shopRegionChanged"));
    assert(admin.includes('["POPULAR_MOBILE_GAMES", "Popular Mobile Games"]'));
    assert(admin.includes('["ALL_MOBILE_GAMES", "All Mobile Games"]'));
    assert(admin.includes('["SOCIAL_TOPUP", "Social Top Up"]'));
    assert(admin.includes('homepageSections: [...modal.querySelectorAll("[data-home-section]:checked")]'));
    return { authority: "catalog homepageSections", assertions: 26, mobileGroupCarousel: true, groupOrder: ["POPULAR_MOBILE_GAMES", "ALL_MOBILE_GAMES", "SOCIAL_TOPUP"], legacyAliases: true, regionRefresh: true };
}

if (require.main === module) {
    try { console.log(JSON.stringify(run(), null, 2)); }
    catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
module.exports = { run };
