const CATALOG_CATEGORIES = Object.freeze([
    "MOBILE_GAME_TOPUP",
    "PC_GAME",
    "GIFT_CARD",
    "DIGITAL_SERVICE",
    "MOBILE_RECHARGE",
    "ENTERTAINMENT"
]);

const HOMEPAGE_FLAGS = Object.freeze(["POPULAR", "NEW", "TRENDING", "FEATURED"]);
const HOMEPAGE_SECTIONS = Object.freeze([
    "POPULAR_GAME_CARDS",
    "POPULAR_GAME_TOPUP",
    "POPULAR_PC_GAMES",
    "POPULAR_GIFT_CARDS",
    "NEW_GAME_CARDS",
    "NEW_GAME_TOPUP",
    "DIGITAL_SERVICES"
]);
const CATALOG_LIFECYCLE = Object.freeze(["ACTIVE", "COMING_SOON"]);
const COMMERCE_STATES = Object.freeze(["PURCHASABLE", "COMING_SOON", "TEMPORARILY_UNAVAILABLE", "HIDDEN"]);

const PUBLIC_CATEGORY_BY_CATALOG_CATEGORY = Object.freeze({
    MOBILE_GAME_TOPUP: "mobile",
    PC_GAME: "pc",
    GIFT_CARD: "gift-card",
    DIGITAL_SERVICE: "social",
    MOBILE_RECHARGE: "mobile-recharge",
    ENTERTAINMENT: "entertainment"
});
const PUBLIC_CATEGORY_KEYS = Object.freeze([...new Set(Object.values(PUBLIC_CATEGORY_BY_CATALOG_CATEGORY))]);
const PUBLIC_GAME_CATEGORY_KEYS = Object.freeze(["mobile", "pc"]);

function publicCategoryFor(catalogCategory = "") {
    return PUBLIC_CATEGORY_BY_CATALOG_CATEGORY[String(catalogCategory || "").trim().toUpperCase()] || "";
}

module.exports = {
    CATALOG_CATEGORIES,
    HOMEPAGE_FLAGS,
    HOMEPAGE_SECTIONS,
    CATALOG_LIFECYCLE,
    COMMERCE_STATES,
    PUBLIC_CATEGORY_BY_CATALOG_CATEGORY,
    PUBLIC_CATEGORY_KEYS,
    PUBLIC_GAME_CATEGORY_KEYS,
    publicCategoryFor
};
