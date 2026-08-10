require("dotenv").config();
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");

const DECISIONS = Object.freeze({
    mlbb: { catalogCategory: "MOBILE_GAME_TOPUP", productRoute: "mlbb.html", artworkPath: "assets/games/mlbb.webp", homepageFlags: ["POPULAR"], displayMarketLabel: "" },
    pubg: { catalogCategory: "MOBILE_GAME_TOPUP", productRoute: "pubg.html", artworkPath: "assets/games/pubg.webp", homepageFlags: ["POPULAR"], displayMarketLabel: "Global" },
    freefire: { catalogCategory: "MOBILE_GAME_TOPUP", productRoute: "freefire.html", artworkPath: "assets/games/freefire.webp", homepageFlags: ["POPULAR"], displayMarketLabel: "" },
    hok: { catalogCategory: "MOBILE_GAME_TOPUP", productRoute: "hok.html", artworkPath: "assets/games/hok.webp", homepageFlags: ["POPULAR"], displayMarketLabel: "Global" },
    aovid: { catalogCategory: "MOBILE_GAME_TOPUP", productRoute: "aov-id.html", artworkPath: "assets/games/aov-id.webp", homepageFlags: ["POPULAR"], displayMarketLabel: "Indonesia" },
    pubgrp: { catalogCategory: "MOBILE_GAME_TOPUP", productRoute: "pubg-rp.html", artworkPath: "assets/games/pubg-rp.webp", homepageFlags: [], displayMarketLabel: "" },
    telegram: { catalogCategory: "DIGITAL_SERVICE", productRoute: "telegram.html", artworkPath: "assets/giftcards/telegram.webp", homepageFlags: [], displayMarketLabel: "" }
});
const MARKET_LABEL_REVIEW = Object.freeze({
    mlbb: "Global",
    pubg: "Global",
    freefire: "Global",
    hok: "Global",
    aovid: "Indonesia",
    pubgrp: "Global",
    telegram: "Global"
});
const REVIEW_SUGGESTIONS = Object.freeze({
    genshin: { suggestedCategory: "MOBILE_GAME_TOPUP", currentRoute: "genshin.html", artworkPath: "assets/games/genshin.webp" },
    roblox: { suggestedCategory: "MOBILE_GAME_TOPUP", currentRoute: "roblox.html", artworkPath: "assets/games/roblox.webp" },
    valorant: { suggestedCategory: "PC_GAME", currentRoute: "", artworkPath: "assets/games/valorant.webp" }
});

function buildTaxonomyMigrationPlan(products = [], readinessByCode = new Map()) {
    const updates = [];
    const ambiguous = [];
    products.forEach(product => {
        const decision = DECISIONS[product.productCode];
        if (!decision) {
            if (!product.catalogCategory) ambiguous.push({ productCode: product.productCode, name: product.name, reason: "No authoritative category mapping" });
            return;
        }
        const ready = readinessByCode.get(product.productCode) === true;
        const discoverable = product.enabled !== false && Boolean(product.name && decision.productRoute && decision.artworkPath);
        const { displayMarketLabel, ...taxonomyDecision } = decision;
        updates.push({
            productCode: product.productCode,
            patch: {
                ...taxonomyDecision,
                homepageCategory: decision.catalogCategory,
                homepageOrder: Number(product.sortOrder || 0),
                homepageEnabled: product.enabled !== false,
                lifecycleStatus: ready ? "ACTIVE" : "COMING_SOON",
                commerceState: ready ? "PURCHASABLE" : (discoverable ? "COMING_SOON" : "HIDDEN"),
                publicDiscoveryEnabled: discoverable,
                "presentation.marketScope": Array.isArray(product.supportedRegions) && product.supportedRegions.length === 1 ? "REGION" : "MULTI_REGION",
                "presentation.displayMarketLabel": displayMarketLabel
            }
        });
    });
    return { updates, ambiguous };
}

async function run() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error("MONGODB_URI is required.");
    await mongoose.connect(uri);
    const products = await CatalogProduct.find().sort({ productCode: 1 }).lean();
    const { toPublicCatalog } = require("../services/catalogService");
    const projected = await toPublicCatalog({ source: "database", includeDisabled: true });
    const readiness = new Map(projected.map(item => [item.productCode, item.commerceReadiness?.ready === true]));
    const plan = buildTaxonomyMigrationPlan(products, readiness);
    plan.presentationReview = projected
        .filter(product => DECISIONS[product.productCode])
        .map(product => ({
            productCode: product.productCode,
            name: product.name,
            commerceState: product.commerceState,
            authoritativeRegions: product.supportedRegions || [],
            currentDisplayMarketLabel: product.displayMarketLabel || "",
            appliedDisplayMarketLabel: DECISIONS[product.productCode].displayMarketLabel,
            suggestedDisplayMarketLabel: MARKET_LABEL_REVIEW[product.productCode] || "",
            suggestionRequiresAdminReview: !DECISIONS[product.productCode].displayMarketLabel,
            previewPriceConfigured: Boolean(product.previewPrice?.amount > 0),
            authoritativePrices: (product.packages || []).map(pkg => ({
                packageCode: pkg.packageCode,
                prices: Object.fromEntries(Object.entries(pkg.prices || {})
                    .filter(([, price]) => price?.enabled !== false && Number(price?.amount) > 0)
                    .map(([region, price]) => [region, { amount: Number(price.amount), currency: price.currency }]))
            })).filter(pkg => Object.keys(pkg.prices).length),
            missingCommerceRequirements: product.commerceReadiness?.missing || []
        }));
    const ambiguousCodes = plan.ambiguous.map(item => item.productCode);
    const [reviewPackages, reviewMappings] = await Promise.all([
        CatalogPackage.find({ productCode: { $in: ambiguousCodes } }).lean(),
        SupplierProductMapping.find({ productCode: { $in: ambiguousCodes } }).lean()
    ]);
    plan.ambiguous = plan.ambiguous.map(item => {
        const suggestion = REVIEW_SUGGESTIONS[item.productCode] || {};
        const packages = reviewPackages.filter(pkg => pkg.productCode === item.productCode);
        const mappings = reviewMappings.filter(mapping => mapping.productCode === item.productCode);
        const priceConfigured = packages.some(pkg => Object.values(pkg.prices || {}).some(price => price?.enabled !== false && Number(price?.amount) > 0));
        return {
            ...item,
            currentRoute: suggestion.currentRoute || "",
            packageCount: packages.length,
            supplierMappingCount: mappings.length,
            priceConfigured,
            fulfillmentConfigured: mappings.some(mapping => mapping.enabled !== false),
            suggestedCategory: suggestion.suggestedCategory || "",
            safeToExposeAsComingSoon: false,
            reviewReason: "Category is not authoritative; suggestion was not applied."
        };
    });
    if (process.argv.includes("--apply")) {
        for (const item of plan.updates) await CatalogProduct.updateOne({ productCode: item.productCode }, { $set: item.patch });
    }
    console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "applied" : "dry-run", ...plan }, null, 2));
    await mongoose.disconnect();
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { DECISIONS, MARKET_LABEL_REVIEW, buildTaxonomyMigrationPlan };
