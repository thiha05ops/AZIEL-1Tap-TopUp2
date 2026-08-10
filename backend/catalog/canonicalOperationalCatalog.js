const CANONICAL_OPERATIONAL_PRODUCTS = Object.freeze([
    product("mlbb", "Mobile Legends Diamonds", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 10, "mlbb.html", "Mobile Games", "Mobile Legends"),
    product("mlbb-twilight-weekly-pass", "Mobile Legends Twilight Pass & Weekly Pass", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 20, "product.html?product=mlbb-twilight-weekly-pass", "Mobile Games", "Mobile Legends"),
    product("pubg", "PUBG Mobile UC", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 30, "pubg.html", "Mobile Games", "PUBG Mobile"),
    product("pubgrp", "PUBG Mobile Royale Pass Pack", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 40, "pubg-rp.html", "Mobile Games", "PUBG Mobile"),
    product("freefire", "Free Fire Diamonds", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 50, "freefire.html", "Mobile Games", "Free Fire"),
    product("marvel-rivals", "Marvel Rivals Top Up", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 60, "product.html?product=marvel-rivals", "Mobile Games", "Marvel Rivals"),
    product("blood-strike", "Blood Strike Golds", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 70, "product.html?product=blood-strike", "Mobile Games", "Blood Strike"),
    product("blood-strike-pass", "Blood Strike Pass", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 80, "product.html?product=blood-strike-pass", "Mobile Games", "Blood Strike"),
    product("age-of-empires-mobile", "Age of Empires Mobile Top Up", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 90, "product.html?product=age-of-empires-mobile", "Mobile Games", "Age of Empires Mobile"),
    product("lineage-2m", "Lineage 2M Top Up", "games", "mobile", "southeast_asia", "MOBILE_GAME_TOPUP", 100, "product.html?product=lineage-2m", "Mobile Games", "Lineage 2M"),
    product("overmortal", "OverMortal Voucher", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 110, "product.html?product=overmortal", "Mobile Games", "OverMortal"),
    product("magic-chess-go-go", "Magic Chess: Go Go Top Up", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 120, "product.html?product=magic-chess-go-go", "Mobile Games", "Magic Chess: Go Go"),
    product("lifeafter", "LifeAfter Credits & Packages", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 130, "product.html?product=lifeafter", "Mobile Games", "LifeAfter"),
    product("hok", "Honor of Kings Tokens & Packages", "games", "mobile", "global", "MOBILE_GAME_TOPUP", 140, "hok.html", "Mobile Games", "Honor of Kings"),
    product("telegram", "Telegram Top Up", "social_topup", "service", "global", "DIGITAL_SERVICE", 150, "telegram.html", "Social Top Up", "Telegram"),
    product("capcut", "CapCut Top Up", "social_topup", "service", "global", "DIGITAL_SERVICE", 160, "product.html?product=capcut", "Social Top Up", "CapCut")
]);

const CANONICAL_PRODUCT_CODES = Object.freeze(CANONICAL_OPERATIONAL_PRODUCTS.map(item => item.productCode));
const CANONICAL_PRODUCT_CODE_SET = new Set(CANONICAL_PRODUCT_CODES);
const CANONICAL_PRODUCT_MAP = new Map(CANONICAL_OPERATIONAL_PRODUCTS.map(item => [item.productCode, item]));

function product(productCode, name, category, platform, market, catalogCategory, sortOrder, productRoute = "", adminCategory = "", family = "") {
    return Object.freeze({
        productCode,
        name,
        category,
        platform,
        market,
        catalogCategory,
        sortOrder,
        productRoute,
        adminCategory,
        family,
        supportedRegions: Object.freeze(["MM", "TH"])
    });
}

function isCanonicalProductCode(productCode = "") {
    return CANONICAL_PRODUCT_CODE_SET.has(String(productCode || "").trim().toLowerCase());
}

function getCanonicalProduct(productCode = "") {
    return CANONICAL_PRODUCT_MAP.get(String(productCode || "").trim().toLowerCase()) || null;
}

function resolveCanonicalProductRoute(productCode = "", fallbackRoute = "") {
    const route = getCanonicalProduct(productCode)?.productRoute || "";
    return route || String(fallbackRoute || "").trim();
}

module.exports = Object.freeze({
    CANONICAL_OPERATIONAL_PRODUCTS,
    CANONICAL_PRODUCT_CODES,
    CANONICAL_PRODUCT_CODE_SET,
    CANONICAL_PRODUCT_MAP,
    getCanonicalProduct,
    isCanonicalProductCode,
    resolveCanonicalProductRoute
});
