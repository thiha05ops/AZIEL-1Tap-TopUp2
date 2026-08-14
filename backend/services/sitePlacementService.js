const SitePlacement = require("../models/SitePlacement");
const CatalogProduct = require("../models/CatalogProduct");
const PromoCode = require("../models/PromoCode");
const { normalizeRegion, toPublicCatalog } = require("./catalogService");
const { publicCategoryFor } = require("../catalog/catalogTaxonomy");
const { isCanonicalProductCode } = require("../catalog/canonicalOperationalCatalog");

const SUPPORTED_PLACEMENTS = Object.freeze({
    HOME_POPULAR_GAMES: {
        placementCode: "HOME_POPULAR_GAMES",
        label: "Popular Games",
        itemType: "product"
    },
    HOME_TOPUP_SHORTCUTS: {
        placementCode: "HOME_TOPUP_SHORTCUTS",
        label: "Top Up Shortcuts",
        itemType: "product"
    },
    HOME_LATEST_PROMOTIONS: {
        placementCode: "HOME_LATEST_PROMOTIONS",
        label: "Latest Promotions",
        itemType: "promo"
    }
});

class SitePlacementError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "SitePlacementError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizePlacementCode(value) {
    const placementCode = String(value || "").trim().toUpperCase();

    if (!SUPPORTED_PLACEMENTS[placementCode]) {
        throw new SitePlacementError(
            "SITE_PLACEMENT_UNSUPPORTED",
            "Site placement is not supported.",
            404
        );
    }

    return placementCode;
}

function normalizePromoCode(value) {
    const promoCode = String(value || "").trim().toUpperCase();

    if (!/^[A-Z0-9_-]{3,32}$/.test(promoCode)) {
        throw new SitePlacementError(
            "SITE_PLACEMENT_PROMO_INVALID",
            "Promo code is invalid."
        );
    }

    return promoCode;
}

function normalizePlacementProductCode(value) {
    const productCode = String(value || "").trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,79}$/.test(productCode) ? productCode : "";
}

function projectPlacementDocument(placementCode, doc = null) {
    const definition = SUPPORTED_PLACEMENTS[placementCode];
    const items = Array.isArray(doc?.items) ? doc.items : [];

    return {
        placementCode,
        label: definition.label,
        itemType: definition.itemType,
        managed: Boolean(doc?.managed),
        items: items
            .slice()
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
            .map(item => ({
                itemType: item.itemType,
                productCode: item.productCode || "",
                promoCode: item.promoCode || "",
                sortOrder: Number(item.sortOrder || 0)
            })),
        updatedAt: doc?.updatedAt || null
    };
}

function normalizeItems(placementCode, items = []) {
    const definition = SUPPORTED_PLACEMENTS[placementCode];
    const seen = new Set();

    return (Array.isArray(items) ? items : []).map((item, index) => {
        if (definition.itemType === "product") {
            const productCode = normalizePlacementProductCode(item.productCode || item.code);
            if (!productCode) {
                throw new SitePlacementError(
                    "SITE_PLACEMENT_PRODUCT_REQUIRED",
                    "Product is required."
                );
            }
            if (seen.has(productCode)) {
                throw new SitePlacementError(
                    "SITE_PLACEMENT_DUPLICATE_PRODUCT",
                    "A product can only appear once in a placement."
                );
            }
            seen.add(productCode);
            return {
                itemType: "product",
                productCode,
                promoCode: "",
                sortOrder: index + 1
            };
        }

        const promoCode = normalizePromoCode(item.promoCode || item.code);
        if (seen.has(promoCode)) {
            throw new SitePlacementError(
                "SITE_PLACEMENT_DUPLICATE_PROMO",
                "A promo code can only appear once in a placement."
            );
        }
        seen.add(promoCode);
        return {
            itemType: "promo",
            productCode: "",
            promoCode,
            sortOrder: index + 1
        };
    });
}

async function assertProductsExist(items = [], placementCode = "") {
    const productCodes = items.map(item => item.productCode).filter(Boolean);
    if (!productCodes.length) return;

    const products = await CatalogProduct.find({ productCode: { $in: productCodes } })
        .select("productCode catalogCategory")
        .lean();
    const existing = new Set(products.map(product => product.productCode));
    const missing = productCodes.find(productCode => !existing.has(productCode));

    if (missing) {
        throw new SitePlacementError(
            "SITE_PLACEMENT_PRODUCT_UNKNOWN",
            `Unknown catalog product: ${missing}`
        );
    }

    const unsupported = productCodes.find(productCode => !isCanonicalProductCode(productCode));
    if (unsupported) {
        throw new SitePlacementError(
            "SITE_PLACEMENT_PRODUCT_UNSUPPORTED",
            `Unsupported catalog product: ${unsupported}`
        );
    }

    if (placementCode === "HOME_POPULAR_GAMES") {
        const categoryMismatch = products.find(product => publicCategoryFor(product.catalogCategory) !== "mobile");
        if (categoryMismatch) {
            throw new SitePlacementError(
                "SITE_PLACEMENT_CATEGORY_MISMATCH",
                "Popular Games only accepts Mobile Game products."
            );
        }
    }
}

async function assertPromosExist(items = []) {
    const promoCodes = items.map(item => item.promoCode).filter(Boolean);
    if (!promoCodes.length) return;

    const promos = await PromoCode.find({
        code: { $in: promoCodes },
        archivedAt: null
    }).select("code").lean();
    const existing = new Set(promos.map(promo => promo.code));
    const missing = promoCodes.find(promoCode => !existing.has(promoCode));

    if (missing) {
        throw new SitePlacementError(
            "SITE_PLACEMENT_PROMO_UNKNOWN",
            `Unknown or archived promo code: ${missing}`
        );
    }
}

async function listAdminPlacements() {
    const docs = await SitePlacement.find({
        placementCode: { $in: Object.keys(SUPPORTED_PLACEMENTS) }
    }).lean();
    const byCode = new Map(docs.map(doc => [doc.placementCode, doc]));

    return Object.keys(SUPPORTED_PLACEMENTS).map(placementCode => (
        projectPlacementDocument(placementCode, byCode.get(placementCode))
    ));
}

async function getAvailableProducts() {
    const products = await toPublicCatalog({
        source: "database",
        includeDisabled: true,
        includeAssetProjection: true
    });

    return products
        .filter(product => isCanonicalProductCode(product.productCode))
        .map(product => ({
            productCode: product.productCode,
            name: product.name,
            enabled: product.enabled !== false,
            publicCategory: product.publicCategory || "",
            homepageEnabled: product.homepageEnabled === true,
            supportedRegions: product.supportedRegions || [],
            imageUrl: product.imageUrl || "",
            sortOrder: Number(product.sortOrder || 0)
        }))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.productCode.localeCompare(b.productCode));
}

async function getAvailablePromos() {
    const promos = await PromoCode.find({ archivedAt: null })
        .sort({ updatedAt: -1, code: 1 })
        .lean();

    return promos.map(promo => ({
        promoCode: promo.code,
        name: promo.name,
        enabled: Boolean(promo.enabled),
        regions: promo.regions || [],
        discountType: promo.discountType,
        percentageValue: Number(promo.percentageValue || 0),
        fixedAmounts: {
            MM: Number(promo.fixedAmounts?.MM || 0),
            TH: Number(promo.fixedAmounts?.TH || 0)
        },
        startsAt: promo.startsAt || null,
        endsAt: promo.endsAt || null,
        state: getPromoWindowState(promo)
    }));
}

async function getAdminPlacement(placementCodeInput) {
    const placementCode = normalizePlacementCode(placementCodeInput);
    const doc = await SitePlacement.findOne({ placementCode }).lean();
    const placement = projectPlacementDocument(placementCode, doc);

    let availableItems = placement.itemType === "product"
        ? await getAvailableProducts()
        : await getAvailablePromos();

    if (placementCode === "HOME_POPULAR_GAMES") {
        availableItems = availableItems.filter(item => item.publicCategory === "mobile");
    }

    return {
        placement,
        availableItems
    };
}

async function updateAdminPlacement(placementCodeInput, payload = {}, actor = "admin") {
    const placementCode = normalizePlacementCode(placementCodeInput);
    const items = normalizeItems(placementCode, payload.items);
    const definition = SUPPORTED_PLACEMENTS[placementCode];

    if (definition.itemType === "product") {
        await assertProductsExist(items, placementCode);
    } else {
        await assertPromosExist(items);
    }

    const doc = await SitePlacement.findOneAndUpdate(
        { placementCode },
        {
            $set: {
                managed: payload.managed !== false,
                items,
                updatedBy: actor
            },
            $setOnInsert: {
                placementCode,
                createdBy: actor
            }
        },
        {
            upsert: true,
            new: true,
            runValidators: true
        }
    ).lean();

    return getAdminPlacement(doc.placementCode);
}

function getPromoWindowState(promo = {}, now = new Date()) {
    if (promo.archivedAt) return "ARCHIVED";
    if (!promo.enabled) return "DISABLED";
    if (promo.startsAt && promo.startsAt > now) return "SCHEDULED";
    if (promo.endsAt && promo.endsAt < now) return "EXPIRED";
    return "ACTIVE";
}

function discountLabel(promo = {}, region = "MM") {
    if (promo.discountType === "PERCENTAGE") {
        return `${Number(promo.percentageValue || 0)}% OFF`;
    }

    const amount = Number(promo.fixedAmounts?.[region] || 0);
    const currency = region === "TH" ? "THB" : "MMK";
    return amount > 0 ? `${amount.toLocaleString("en-US")} ${currency} OFF` : "Promo";
}

function isPromoEligibleForRegion(promo = {}, region = "MM", now = new Date()) {
    return (
        !promo.archivedAt &&
        promo.enabled === true &&
        (!promo.startsAt || promo.startsAt <= now) &&
        (!promo.endsAt || promo.endsAt >= now) &&
        Array.isArray(promo.regions) &&
        promo.regions.includes(region)
    );
}

function projectPublicPlacement(placementCode, doc = null, items = []) {
    return {
        placementCode,
        label: SUPPORTED_PLACEMENTS[placementCode].label,
        itemType: SUPPORTED_PLACEMENTS[placementCode].itemType,
        managed: Boolean(doc?.managed),
        items
    };
}

async function resolveProductPlacement(placementCode, doc) {
    if (!doc?.managed) {
        return projectPublicPlacement(placementCode, doc, []);
    }

    const selectedCodes = (doc.items || []).map(item => item.productCode).filter(Boolean);
    if (!selectedCodes.length) {
        return projectPublicPlacement(placementCode, doc, []);
    }

    const products = await toPublicCatalog({
        source: "database",
        includeDisabled: false
    });
    const byCode = new Map(products.map(product => [product.productCode, product]));

    const items = selectedCodes
        .map(productCode => byCode.get(productCode))
        .filter(Boolean)
        .filter(product => placementCode !== "HOME_POPULAR_GAMES" || product.publicCategory === "mobile")
        .map(product => ({ ...product, itemType: "product" }));

    return projectPublicPlacement(placementCode, doc, items);
}

async function resolvePromoPlacement(placementCode, doc, region) {
    if (!doc?.managed) {
        return projectPublicPlacement(placementCode, doc, []);
    }

    const selectedCodes = (doc.items || []).map(item => item.promoCode).filter(Boolean);
    if (!selectedCodes.length) {
        return projectPublicPlacement(placementCode, doc, []);
    }

    const promos = await PromoCode.find({
        code: { $in: selectedCodes },
        archivedAt: null
    }).lean();
    const byCode = new Map(promos.map(promo => [promo.code, promo]));
    const now = new Date();

    const items = selectedCodes
        .map(promoCode => byCode.get(promoCode))
        .filter(promo => promo && isPromoEligibleForRegion(promo, region, now))
        .map(promo => ({
            itemType: "promo",
            promoCode: promo.code,
            name: promo.name,
            regions: promo.regions || [],
            discountType: promo.discountType,
            discountLabel: discountLabel(promo, region),
            startsAt: promo.startsAt || null,
            endsAt: promo.endsAt || null
        }));

    return projectPublicPlacement(placementCode, doc, items);
}

async function resolveHomePlacements(options = {}) {
    const region = normalizeRegion(options.region || "MM");
    const docs = await SitePlacement.find({
        placementCode: { $in: Object.keys(SUPPORTED_PLACEMENTS) }
    }).lean();
    const byCode = new Map(docs.map(doc => [doc.placementCode, doc]));
    const placements = {};

    for (const placementCode of Object.keys(SUPPORTED_PLACEMENTS)) {
        const definition = SUPPORTED_PLACEMENTS[placementCode];
        const doc = byCode.get(placementCode) || null;
        placements[placementCode] = definition.itemType === "product"
            ? await resolveProductPlacement(placementCode, doc)
            : await resolvePromoPlacement(placementCode, doc, region);
    }

    return {
        region,
        placements
    };
}

module.exports = {
    SUPPORTED_PLACEMENTS,
    SitePlacementError,
    getAdminPlacement,
    listAdminPlacements,
    normalizePlacementCode,
    resolveHomePlacements,
    updateAdminPlacement
};
