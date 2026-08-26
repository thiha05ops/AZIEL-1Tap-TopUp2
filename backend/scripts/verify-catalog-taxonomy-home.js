const assert = require("assert");
const { CATALOG_CATEGORIES, HOMEPAGE_FLAGS, HOMEPAGE_SECTIONS, COMMERCE_STATES } = require("../catalog/catalogTaxonomy");
const CatalogProduct = require("../models/CatalogProduct");
const { projectCommerceReadiness } = require("../services/catalogService");
const { buildTaxonomyMigrationPlan } = require("./migrate-catalog-taxonomy");
const { INVENTORY } = require("./seed-home-marketplace-catalog");
const fs = require("fs");

assert.deepStrictEqual(CATALOG_CATEGORIES, ["MOBILE_GAME_TOPUP", "PC_GAME", "GIFT_CARD", "DIGITAL_SERVICE", "MOBILE_RECHARGE", "ENTERTAINMENT"]);
assert.deepStrictEqual(HOMEPAGE_FLAGS, ["POPULAR", "NEW", "TRENDING", "FEATURED"]);
assert.deepStrictEqual(HOMEPAGE_SECTIONS.slice(0, 3), ["POPULAR_MOBILE_GAMES", "ALL_MOBILE_GAMES", "SOCIAL_TOPUP"]);
assert(HOMEPAGE_SECTIONS.includes("POPULAR_GAME_TOPUP") && HOMEPAGE_SECTIONS.includes("NEW_GAME_TOPUP") && HOMEPAGE_SECTIONS.includes("DIGITAL_SERVICES"), "Legacy Home section values must remain schema-compatible");
assert.deepStrictEqual(COMMERCE_STATES, ["PURCHASABLE", "COMING_SOON", "TEMPORARILY_UNAVAILABLE", "HIDDEN"]);
["catalogCategory", "homepageEnabled", "homepageCategory", "homepageOrder", "homepageFlags", "homepageSections", "lifecycleStatus", "commerceState", "publicDiscoveryEnabled", "productRoute", "artworkPath"]
    .forEach(path => assert(CatalogProduct.schema.path(path), `CatalogProduct.${path} must exist`));
["presentation.previewPrice.amount", "presentation.previewPrice.currency", "presentation.previewPrice.label", "presentation.marketScope", "presentation.displayMarketLabel"]
    .forEach(path => assert(CatalogProduct.schema.path(path), `CatalogProduct.${path} must exist`));

const ready = projectCommerceReadiness(
    { productCode: "mlbb", enabled: true, supportedRegions: ["MM"], fulfillment: { manualAllowedRegions: ["MM"] }, artworkPath: "assets/games/mlbb.webp" },
    [{ _id: "pkg-1", packageCode: "PACK", enabled: true, prices: { MM: { amount: 1000, enabled: true } } }],
    [{ enabled: true, region: "MM" }],
    [{ packageRef: "pkg-1", availabilityState: "AVAILABLE" }]
);
assert.strictEqual(ready.ready, true);
assert.strictEqual(projectCommerceReadiness({ enabled: true, supportedRegions: ["MM"] }, [], [], []).ready, false);

const plan = buildTaxonomyMigrationPlan([
    { productCode: "mlbb", name: "Mobile Legends", enabled: true, sortOrder: 1 },
    { productCode: "telegram", name: "Telegram Top Up", enabled: true, sortOrder: 2 },
    { productCode: "mystery", name: "Ambiguous Product", enabled: true }
]);
assert.strictEqual(plan.updates.find(item => item.productCode === "telegram").patch.catalogCategory, "DIGITAL_SERVICE");
assert.strictEqual(plan.updates.find(item => item.productCode === "telegram").patch.commerceState, "COMING_SOON");
assert.strictEqual(plan.updates.find(item => item.productCode === "telegram").patch["presentation.displayMarketLabel"], "");
const labelPlan = buildTaxonomyMigrationPlan([
    { productCode: "pubg", name: "PUBG Mobile", enabled: true },
    { productCode: "hok", name: "Honor of Kings", enabled: true },
    { productCode: "aovid", name: "Arena of Valor (ID)", enabled: true }
]);
assert.deepStrictEqual(labelPlan.updates.map(item => item.patch["presentation.displayMarketLabel"]), ["Global", "Global", "Indonesia"]);
const readyPlan = buildTaxonomyMigrationPlan([{ productCode: "mlbb", name: "Mobile Legends", enabled: true }], new Map([["mlbb", true]]));
assert.strictEqual(readyPlan.updates[0].patch.commerceState, "PURCHASABLE");
assert.strictEqual(plan.ambiguous.length, 1);
assert.strictEqual(plan.ambiguous[0].productCode, "mystery");

const adminSource = fs.readFileSync("frontend/js/admin-catalog.js", "utf8");
["catalogProductCategory", "catalogProductHomeEnabled", "catalogProductHomeOrder", "data-home-flag", "catalogProductCommerceState", "catalogProductDiscoveryEnabled", "catalogProductReadiness"]
    .forEach(control => assert(adminSource.includes(control), `Admin catalog must expose ${control}`));
assert(adminSource.includes("data-home-section"), "Admin catalog must expose Home section membership");
["catalogProductPreviewAmount", "catalogProductPreviewCurrency", "catalogProductPreviewLabel", "catalogProductMarketScope", "catalogProductDisplayMarketLabel", "catalogProductAuthoritativeRegions"]
    .forEach(control => assert(adminSource.includes(control), `Admin catalog must expose ${control}`));
const homeSource = fs.readFileSync("frontend/js/home-placement-runtime.js", "utf8");
assert(homeSource.includes("product.discoverable === true"));
assert(homeSource.includes("selectPopularProducts"), "Home must use persisted Popular placement membership and order");
assert(homeSource.includes("selectAllMobileProducts"), "All Mobile Games must derive from projected Home/category authority");
assert(homeSource.includes("selectSocialProducts"), "Social Top Up must derive from projected Home/category authority");
assert(!homeSource.includes("canonicalHomeCodes"), "Static code lists must not own runtime Home membership");
assert(homeSource.includes("resolveProductRoute"), "Home items must consume the backend-projected canonical route");
assert(!homeSource.includes("renderCatalogTile"), "Home must not render wallet/service catalog tiles");
assert(!homeSource.includes("displayMarketLabel"), "Home cards must not render catalog market labels");
assert(!homeSource.includes("stateBadge(product)"), "Home cards must not render commerce-state badges");
assert(homeSource.includes("renderPanels"), "Home must render grouped product panels");
assert(!homeSource.includes("MM • TH") && !homeSource.includes("TH • MM"));
const homeHtml = fs.readFileSync("frontend/home.html", "utf8");
assert(homeHtml.includes('/core/settings/theme.js'), "Home must load the canonical AZIEL theme runtime");
assert(homeHtml.includes("home-product-accent.js"), "Home must load the artwork-accent runtime");
assert(!homeHtml.includes("MM • TH") && !homeHtml.includes("TH • MM"));
assert(!homeHtml.includes("home-mobile-category-carousel"), "Rejected mobile category carousel must not load");
assert(homeHtml.includes("marketplace-reference.css"), "Reference marketplace stylesheet must load");
assert(homeHtml.includes('id="allMobileGames"'), "Home must expose the All Mobile Games section");
assert(!homeHtml.includes('id="popularGiftCards"') && !homeHtml.includes('id="digitalServices"'), "Home must not render wallet/service sections");
const accentSource = fs.readFileSync("frontend/js/home-product-accent.js", "utf8");
assert(accentSource.includes("sessionStorage"), "Artwork accents must be cached once per session");
assert(accentSource.includes("getImageData"), "Artwork accents must derive from image pixels");
const heroSource = fs.readFileSync("frontend/js/home-banner-runtime.js", "utf8");
assert(heroSource.includes('card.style.opacity = index === current ? "1" : "0"'), "Hero must use fade-only banner transitions");
const heroCss = fs.readFileSync("frontend/css/home/hero.css", "utf8");
const marketplaceCss = fs.readFileSync("frontend/css/home/marketplace-reference.css", "utf8");
assert(marketplaceCss.includes("aspect-ratio: 16 / 5"), "Home Hero must use the requested 16:5 banner ratio");
assert(marketplaceCss.includes(".az-home-hero .az-banner-arrow") && marketplaceCss.includes("display: none !important"), "Hero arrows must remain hidden");
const storefrontCss = fs.readFileSync("frontend/css/home/home-product-system.css", "utf8");
assert(storefrontCss.includes("width: min(1220px"), "Home products must align to the compact storefront container");
const commerceFiles = fs.readdirSync("backend/services/commerce").filter(name => name.endsWith(".js"));
commerceFiles.forEach(name => {
    const source = fs.readFileSync(`backend/services/commerce/${name}`, "utf8");
    assert(!source.includes("previewPrice"), `${name} must not consume presentation-only preview pricing`);
    assert(!source.includes("displayMarketLabel"), `${name} must not consume presentation-only market labels`);
});

assert(INVENTORY.length >= 30, "Marketplace seed must provide complete catalog breadth");
HOMEPAGE_SECTIONS.filter(section => !["POPULAR_MOBILE_GAMES", "ALL_MOBILE_GAMES", "SOCIAL_TOPUP", "NEW_GAME_TOPUP"].includes(section)).forEach(section => {
    const members = INVENTORY.filter(product => product.homepageSections.includes(section));
    assert(members.length >= 4 && members.length <= 6, `${section} must contain four to six curated records`);
});
assert.deepStrictEqual(
    INVENTORY.filter(product => product.homepageSections.includes("POPULAR_GAME_TOPUP")).map(product => product.productCode),
    ["mlbb", "pubg", "freefire", "hok", "marvel-rivals", "blood-strike"],
    "Popular Mobile Games seed must match the approved assortment"
);
assert.deepStrictEqual(
    INVENTORY.filter(product => product.homepageSections.includes("NEW_GAME_TOPUP")).map(product => product.productCode),
    ["age-of-empires-mobile", "lineage-2m", "overmortal", "magic-chess-go-go", "lifeafter", "mlbb-twilight-weekly-pass", "blood-strike-pass"],
    "All Mobile Games seed supplement must match the approved assortment"
);
assert(INVENTORY.every(product => product.previewPrice === undefined), "Marketplace seed must not invent preview prices");
assert(!INVENTORY.some(product => product.artworkPath === "/assets/brand/aziel-icon.svg"), "The universal AZIEL placeholder must not remain");
[
    "game-cards.svg",
    "game-topup.svg",
    "pc-games.svg",
    "gift-cards.svg",
    "digital-services.svg"
].forEach(asset => assert(fs.existsSync(`frontend/assets/fallbacks/${asset}`), `${asset} must exist`));

console.log("Catalog taxonomy and Home eligibility verification passed.");
