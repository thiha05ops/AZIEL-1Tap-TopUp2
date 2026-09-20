"use strict";

const crypto = require("crypto");

const CatalogProduct = require("../models/CatalogProduct");
const MediaAsset = require("../models/MediaAsset");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const { publicCategoryFor } = require("../catalog/catalogTaxonomy");
const { isSafeStorefrontProductRoute, resolveCanonicalProductRoute } = require("../catalog/canonicalOperationalCatalog");

const PRESENTATION_SECTIONS = Object.freeze([
    "POPULAR_MOBILE_GAMES",
    "ALL_MOBILE_GAMES",
    "SOCIAL_TOPUP"
]);
const SECTION_ALIASES = Object.freeze({
    POPULAR_MOBILE_GAMES: ["POPULAR_MOBILE_GAMES", "POPULAR_GAME_TOPUP"],
    ALL_MOBILE_GAMES: ["ALL_MOBILE_GAMES", "POPULAR_GAME_TOPUP", "NEW_GAME_TOPUP"],
    SOCIAL_TOPUP: ["SOCIAL_TOPUP", "DIGITAL_SERVICES"]
});

function normalizeRegion(value) {
    const region = String(value || "TH").trim().toUpperCase();
    return ["TH", "MM"].includes(region) ? region : "TH";
}

function normalizeCode(value) {
    return String(value || "").trim().toLowerCase();
}

function mediaUrl(asset = {}) {
    return String(asset?.secureUrl || asset?.url || "").trim();
}

function cloudinaryUrl(url, width) {
    const source = String(url || "").trim();
    if (!source.includes("res.cloudinary.com/") || !source.includes("/image/upload/")) return source;
    return source.replace("/image/upload/", `/image/upload/f_auto,q_auto,c_limit,w_${width}/`);
}

function projectArtwork(asset = {}, fallback = "") {
    const source = mediaUrl(asset) || String(fallback || "").trim();
    if (!source) return null;

    const width = Number(asset?.metadata?.width || 480);
    const height = Number(asset?.metadata?.height || 480);
    const candidates = [240, 480, 720];
    return {
        src: cloudinaryUrl(source, 480),
        srcset: source.includes("res.cloudinary.com/")
            ? candidates.map(size => `${cloudinaryUrl(source, size)} ${size}w`).join(", ")
            : "",
        sizes: "(max-width: 720px) 42vw, 180px",
        width: width > 0 ? width : 480,
        height: height > 0 ? height : 480,
        alt: String(asset?.altText || "").trim()
    };
}

function stableRevision(value) {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildPresentationPayload({ region, products = [], selections = [], publications = [], media = [] } = {}) {
    const normalizedRegion = normalizeRegion(region);
    const selectedCodes = new Set(selections.map(item => normalizeCode(item.productCode)).filter(Boolean));
    const mediaMap = new Map(media.map(item => [String(item.assetId || ""), item]));

    const projectedProducts = products
        .filter(product => selectedCodes.has(normalizeCode(product.productCode)))
        .filter(product => product.enabled !== false && !product.deletedAt)
        .filter(product => product.publicDiscoveryEnabled === true && product.homepageEnabled === true)
        .filter(product => String(product.commerceState || "HIDDEN").toUpperCase() !== "HIDDEN")
        .map(product => {
            const productCode = normalizeCode(product.productCode);
            const imageAsset = mediaMap.get(String(product.presentation?.imageAssetId || ""));
            const persistedSections = (product.homepageSections || []).map(section => String(section).toUpperCase());
            const sections = PRESENTATION_SECTIONS.filter(section => SECTION_ALIASES[section].some(alias => persistedSections.includes(alias)));
            return {
                productCode,
                displayName: String(product.name || productCode).trim(),
                subtitle: String(product.productKnowledge?.shortDescription || product.description || "").trim(),
                route: isSafeStorefrontProductRoute(product.productRoute)
                    ? product.productRoute
                    : resolveCanonicalProductRoute(productCode),
                category: publicCategoryFor(product.homepageCategory || product.catalogCategory),
                artwork: projectArtwork(imageAsset, product.artworkPath),
                placement: {
                    order: Number(product.homepageOrder || 0),
                    sections
                },
                state: product.lifecycleStatus === "COMING_SOON" || product.commerceState === "COMING_SOON"
                    ? "COMING_SOON"
                    : "PRESENTED"
            };
        })
        .filter(product => product.route && product.placement.sections.length)
        .sort((a, b) => a.placement.order - b.placement.order || a.productCode.localeCompare(b.productCode));

    const sections = PRESENTATION_SECTIONS.map(key => ({
        key,
        products: projectedProducts.filter(product => product.placement.sections.includes(key))
    }));
    const revisionInput = {
        region: normalizedRegion,
        products: [...products].sort((a, b) => normalizeCode(a.productCode).localeCompare(normalizeCode(b.productCode))).map(product => ({
            productCode: product.productCode,
            name: product.name,
            description: product.description,
            shortDescription: product.productKnowledge?.shortDescription,
            enabled: product.enabled,
            deletedAt: product.deletedAt,
            publicDiscoveryEnabled: product.publicDiscoveryEnabled,
            homepageEnabled: product.homepageEnabled,
            homepageCategory: product.homepageCategory,
            homepageOrder: product.homepageOrder,
            homepageSections: product.homepageSections,
            catalogCategory: product.catalogCategory,
            commerceState: product.commerceState,
            lifecycleStatus: product.lifecycleStatus,
            productRoute: product.productRoute,
            artworkPath: product.artworkPath,
            imageAssetId: product.presentation?.imageAssetId,
            updatedAt: product.updatedAt
        })),
        selections: [...selections].sort((a, b) => normalizeCode(a.productCode).localeCompare(normalizeCode(b.productCode))).map(item => ({ productCode: item.productCode, updatedAt: item.updatedAt })),
        publications: [...publications].sort((a, b) => `${normalizeCode(a.productCode)}:${a.packageCode}`.localeCompare(`${normalizeCode(b.productCode)}:${b.packageCode}`)).map(item => ({
            productCode: item.productCode,
            packageCode: item.packageCode,
            published: item.published,
            decisionVersion: item.decisionVersion,
            updatedAt: item.updatedAt
        })),
        media: [...media].sort((a, b) => String(a.assetId).localeCompare(String(b.assetId))).map(item => ({ assetId: item.assetId, status: item.status, updatedAt: item.updatedAt }))
    };

    return {
        region: normalizedRegion,
        revision: stableRevision(revisionInput),
        sections
    };
}

async function getHomePresentation({ region = "TH", models = {} } = {}) {
    const customerMarket = normalizeRegion(region);
    const ProductModel = models.CatalogProduct || CatalogProduct;
    const SelectionModel = models.StoreCatalogSelection || StoreCatalogSelection;
    const PublicationModel = models.PackageMarketPublication || PackageMarketPublication;
    const MediaModel = models.MediaAsset || MediaAsset;

    const selections = await SelectionModel.find({
        status: "ACTIVE",
        sellingRegions: customerMarket,
        visibleRegions: customerMarket
    }).select("productCode updatedAt").lean();
    const productCodes = [...new Set(selections.map(item => normalizeCode(item.productCode)).filter(Boolean))];

    if (!productCodes.length) {
        return buildPresentationPayload({ region: customerMarket });
    }

    const [products, publications] = await Promise.all([
        ProductModel.find({
            productCode: { $in: productCodes },
            enabled: { $ne: false },
            deletedAt: null,
            publicDiscoveryEnabled: true,
            homepageEnabled: true,
            commerceState: { $ne: "HIDDEN" }
        }).select("productCode name description productKnowledge.shortDescription enabled deletedAt publicDiscoveryEnabled homepageEnabled homepageCategory homepageOrder homepageSections catalogCategory commerceState lifecycleStatus productRoute artworkPath presentation.imageAssetId updatedAt").lean(),
        PublicationModel.find({
            productCode: { $in: productCodes },
            customerMarket
        }).select("productCode packageCode published decisionVersion updatedAt").lean()
    ]);
    const assetIds = [...new Set(products.map(item => String(item.presentation?.imageAssetId || "").trim()).filter(Boolean))];
    const media = assetIds.length
        ? await MediaModel.find({ assetId: { $in: assetIds }, status: "active" })
            .select("assetId altText url secureUrl status metadata.width metadata.height updatedAt")
            .lean()
        : [];

    return buildPresentationPayload({
        region: customerMarket,
        products,
        selections,
        publications,
        media
    });
}

async function isProductPresentationVisible(productCode, { region = "TH", models = {} } = {}) {
    const normalizedCode = normalizeCode(productCode);
    if (!normalizedCode) return false;
    const customerMarket = normalizeRegion(region);
    const ProductModel = models.CatalogProduct || CatalogProduct;
    const SelectionModel = models.StoreCatalogSelection || StoreCatalogSelection;

    const [product, selection] = await Promise.all([
        ProductModel.findOne({
            productCode: normalizedCode,
            enabled: { $ne: false },
            deletedAt: null,
            publicDiscoveryEnabled: true,
            commerceState: { $ne: "HIDDEN" }
        }).select("_id").lean(),
        SelectionModel.findOne({
            productCode: normalizedCode,
            status: "ACTIVE",
            sellingRegions: customerMarket,
            visibleRegions: customerMarket
        }).select("_id").lean()
    ]);

    return Boolean(product && selection);
}

module.exports = {
    PRESENTATION_SECTIONS,
    buildPresentationPayload,
    getHomePresentation,
    isProductPresentationVisible,
    normalizeRegion,
    stableRevision
};
