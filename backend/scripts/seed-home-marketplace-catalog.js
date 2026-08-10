require("dotenv").config();
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");

const LEGACY_PLACEHOLDER_ART = "assets/logo/aziel-icon.webp";
const SEED_VERSION = 3;
const CATEGORY_FALLBACKS = Object.freeze({
    POPULAR_GAME_CARDS: "assets/fallbacks/game-cards.svg",
    POPULAR_GAME_TOPUP: "assets/fallbacks/game-topup.svg",
    POPULAR_PC_GAMES: "assets/fallbacks/pc-games.svg",
    POPULAR_GIFT_CARDS: "assets/fallbacks/gift-cards.svg",
    NEW_GAME_CARDS: "assets/fallbacks/gift-cards.svg",
    NEW_GAME_TOPUP: "assets/fallbacks/game-topup.svg",
    DIGITAL_SERVICES: "assets/fallbacks/digital-services.svg"
});

const INVENTORY = Object.freeze([
    item("steam-wallet", "Steam Wallet", "Wallet credit", "GIFT_CARD", ["POPULAR_GAME_CARDS", "POPULAR_PC_GAMES", "POPULAR_GIFT_CARDS"], 1, "assets/games/steam.webp"),
    item("playstation-network", "PlayStation Network", "PlayStation Store credit", "GIFT_CARD", ["POPULAR_GAME_CARDS", "POPULAR_GIFT_CARDS"], 2),
    item("xbox-gift-card", "Xbox Gift Card", "Xbox and Microsoft credit", "GIFT_CARD", ["POPULAR_GAME_CARDS", "POPULAR_GIFT_CARDS"], 3),
    item("google-play", "Google Play", "Google Play credit", "GIFT_CARD", ["POPULAR_GAME_CARDS", "POPULAR_GIFT_CARDS"], 4, "assets/games/googleplay.webp"),
    item("apple-gift-card", "Apple Gift Card", "Apple account credit", "GIFT_CARD", ["POPULAR_GAME_CARDS", "POPULAR_GIFT_CARDS"], 5, "assets/games/apple.webp"),
    item("razer-gold", "Razer Gold", "Gaming wallet credit", "GIFT_CARD", ["POPULAR_GAME_CARDS", "NEW_GAME_CARDS"], 6),

    item("mlbb", "Mobile Legends", "Diamonds", "MOBILE_GAME_TOPUP", ["POPULAR_GAME_TOPUP"], 1, "assets/games/mlbb.webp", "mlbb.html"),
    item("pubg", "PUBG Mobile", "UC", "MOBILE_GAME_TOPUP", ["POPULAR_GAME_TOPUP"], 2, "assets/games/pubg.webp", "pubg.html"),
    item("freefire", "Free Fire", "Diamonds", "MOBILE_GAME_TOPUP", ["POPULAR_GAME_TOPUP"], 3, "assets/games/freefire.webp", "freefire.html"),
    item("hok", "Honor of Kings", "Tokens & Packages", "MOBILE_GAME_TOPUP", ["POPULAR_GAME_TOPUP"], 4, "assets/games/hok.webp", "hok.html"),
    item("marvel-rivals", "Marvel Rivals", "Top Up", "MOBILE_GAME_TOPUP", ["POPULAR_GAME_TOPUP"], 5),
    item("blood-strike", "Blood Strike", "Golds, Pass", "MOBILE_GAME_TOPUP", ["POPULAR_GAME_TOPUP"], 6),

    item("age-of-empires-mobile", "Age of Empires Mobile", "Top Up", "MOBILE_GAME_TOPUP", ["NEW_GAME_TOPUP"], 1),
    item("lineage-2m", "Lineage 2M", "Top Up", "MOBILE_GAME_TOPUP", ["NEW_GAME_TOPUP"], 2),
    item("overmortal", "OverMortal", "Voucher", "MOBILE_GAME_TOPUP", ["NEW_GAME_TOPUP"], 3),
    item("magic-chess-go-go", "Magic Chess: Go Go", "Top Up", "MOBILE_GAME_TOPUP", ["NEW_GAME_TOPUP"], 4),
    item("lifeafter", "LifeAfter", "Credits & Package", "MOBILE_GAME_TOPUP", ["NEW_GAME_TOPUP"], 5),
    item("mlbb-twilight-weekly-pass", "Mobile Legends Twilight Pass & Weekly Pass", "Twilight Pass & Weekly Pass", "MOBILE_GAME_TOPUP", ["NEW_GAME_TOPUP"], 6, "assets/games/mlbb.webp"),
    item("blood-strike-pass", "Blood Strike Pass", "Pass", "MOBILE_GAME_TOPUP", ["NEW_GAME_TOPUP"], 7),

    item("ea-sports-fc", "EA Sports FC", "FC Points and content", "PC_GAME", ["POPULAR_PC_GAMES"], 1),
    item("counter-strike-2", "Counter-Strike 2", "PC game content", "PC_GAME", ["POPULAR_PC_GAMES"], 2),
    item("battlefield", "Battlefield", "PC game content", "PC_GAME", ["POPULAR_PC_GAMES"], 3),
    item("valorant", "Valorant", "VP and game content", "PC_GAME", ["POPULAR_PC_GAMES"], 4, "assets/games/valorant.webp"),
    item("xbox-game-pass", "Xbox Game Pass", "Game subscription", "PC_GAME", ["POPULAR_PC_GAMES"], 6),

    item("netflix-gift-card", "Netflix Gift Card", "Streaming gift credit", "GIFT_CARD", ["POPULAR_GIFT_CARDS", "NEW_GAME_CARDS"], 6),
    item("ea-gift-card", "EA Gift Card", "EA account credit", "GIFT_CARD", ["NEW_GAME_CARDS"], 1),
    item("roblox-gift-card", "Roblox Gift Card", "Robux and membership credit", "GIFT_CARD", ["NEW_GAME_CARDS"], 2, "assets/games/roblox.webp"),
    item("garena-shells", "Garena Shells", "Garena wallet credit", "GIFT_CARD", ["NEW_GAME_CARDS"], 3),
    item("nintendo-eshop", "Nintendo eShop", "Nintendo account credit", "GIFT_CARD", ["NEW_GAME_CARDS"], 4),

    item("ragnarok", "Ragnarok", "Game top-up", "MOBILE_GAME_TOPUP", [], 30, "assets/games/ragnarok.webp"),
    item("once-human", "Once Human", "Game top-up", "PC_GAME", [], 31),
    item("where-winds-meet", "Where Winds Meet", "Game top-up", "PC_GAME", [], 32),
    item("sword-of-justice", "Sword of Justice", "Game top-up", "MOBILE_GAME_TOPUP", [], 33),

    item("telegram", "Telegram", "Stars and Premium", "DIGITAL_SERVICE", ["DIGITAL_SERVICES"], 1, "assets/giftcards/telegram.webp", "telegram.html"),
    item("discord-nitro", "Discord Nitro", "Community subscription", "DIGITAL_SERVICE", ["DIGITAL_SERVICES"], 2),
    item("spotify", "Spotify", "Music subscription", "DIGITAL_SERVICE", ["DIGITAL_SERVICES"], 3),
    item("youtube-premium", "YouTube Premium", "Video subscription", "DIGITAL_SERVICE", ["DIGITAL_SERVICES"], 4),
    item("netflix", "Netflix", "Streaming subscription", "ENTERTAINMENT", ["DIGITAL_SERVICES"], 5),
    item("app-store-credit", "App Store Credit", "Apple account credit", "DIGITAL_SERVICE", ["DIGITAL_SERVICES"], 6, "assets/games/apple.webp")
]);

function item(productCode, name, description, catalogCategory, homepageSections, homepageOrder, artworkPath = "", productRoute = "") {
    const resolvedArtwork = artworkPath || CATEGORY_FALLBACKS[homepageSections[0]] || CATEGORY_FALLBACKS.DIGITAL_SERVICES;
    return {
        productCode,
        name,
        description,
        catalogCategory,
        homepageSections,
        homepageOrder,
        artworkPath: resolvedArtwork,
        productRoute: productRoute || `coming-soon.html?product=${encodeURIComponent(productCode)}`,
        artworkPlaceholder: !artworkPath
    };
}

async function buildPlan() {
    const existing = await CatalogProduct.find({ productCode: { $in: INVENTORY.map(entry => entry.productCode) } }).lean();
    const byCode = new Map(existing.map(product => [product.productCode, product]));
    return INVENTORY.map(entry => {
        const current = byCode.get(entry.productCode);
        const currentHasAuthoritativeArtwork = Boolean(
            current?.artworkPath &&
            current.artworkPath !== LEGACY_PLACEHOLDER_ART &&
            !String(current.artworkPath).includes("assets/fallbacks/")
        );
        const base = {
            description: entry.description,
            catalogCategory: entry.catalogCategory,
            homepageCategory: entry.catalogCategory,
            homepageSections: entry.homepageSections,
            homepageOrder: entry.homepageOrder,
            artworkPath: entry.artworkPath,
            productRoute: entry.productRoute,
            homepageFlags: entry.homepageSections.some(section => section.startsWith("POPULAR_")) ? ["POPULAR"] : ["NEW"],
            metadata: {
                ...(current?.metadata || {}),
                slug: entry.productCode,
                seededMarketplace: true,
                marketplaceSeedVersion: SEED_VERSION,
                artworkPlaceholder: entry.artworkPlaceholder && !currentHasAuthoritativeArtwork
            }
        };
        if (!current) {
            return {
                action: "insert",
                productCode: entry.productCode,
                document: {
                    productCode: entry.productCode,
                    name: entry.name,
                    ...base,
                    enabled: true,
                    homepageEnabled: true,
                    publicDiscoveryEnabled: true,
                    lifecycleStatus: "COMING_SOON",
                    commerceState: "COMING_SOON",
                    supportedRegions: [],
                    source: "seeded"
                }
            };
        }
        if (Array.isArray(current.homepageSections) && current.homepageSections.length && current.metadata?.marketplaceSeedVersion === SEED_VERSION) {
            return { action: "preserve-admin", productCode: entry.productCode, document: null };
        }
        if (Array.isArray(current.homepageSections) && current.homepageSections.length && current.metadata?.seededMarketplace === true) {
            const replaceLegacyArtwork = current.artworkPath === LEGACY_PLACEHOLDER_ART || !current.artworkPath;
            return {
                action: "complete-initial-seed",
                productCode: entry.productCode,
                document: {
                    enabled: true,
                    homepageEnabled: true,
                    publicDiscoveryEnabled: true,
                    lifecycleStatus: "COMING_SOON",
                    commerceState: "COMING_SOON",
                    supportedRegions: [],
                    ...(replaceLegacyArtwork ? { artworkPath: entry.artworkPath } : {}),
                    metadata: base.metadata
                }
            };
        }
        return {
            action: "classify-existing",
            productCode: entry.productCode,
            document: {
                ...base,
                enabled: true,
                homepageEnabled: true,
                publicDiscoveryEnabled: true,
                lifecycleStatus: "COMING_SOON",
                commerceState: "COMING_SOON",
                supportedRegions: []
            }
        };
    });
}

async function run() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error("MONGODB_URI is required.");
    await mongoose.connect(uri);
    const plan = await buildPlan();
    if (process.argv.includes("--apply")) {
        for (const entry of plan) {
            if (!entry.document) continue;
            if (entry.action === "insert") await CatalogProduct.create(entry.document);
            else await CatalogProduct.updateOne({ productCode: entry.productCode }, { $set: entry.document });
        }
    }
    console.log(JSON.stringify({
        mode: process.argv.includes("--apply") ? "applied" : "dry-run",
        counts: plan.reduce((result, entry) => ({ ...result, [entry.action]: (result[entry.action] || 0) + 1 }), {}),
        inventory: INVENTORY.map(entry => ({
            productCode: entry.productCode,
            title: entry.name,
            category: entry.catalogCategory,
            homeSections: entry.homepageSections,
            order: entry.homepageOrder,
            artwork: entry.artworkPath,
            artworkPlaceholder: entry.artworkPlaceholder,
            requiresArtworkReview: entry.artworkPlaceholder,
            previewPrice: null,
            seededCommerceState: "COMING_SOON"
        }))
    }, null, 2));
    await mongoose.disconnect();
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { INVENTORY, buildPlan };
