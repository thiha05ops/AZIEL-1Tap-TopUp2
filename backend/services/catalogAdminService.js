const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const {
    REGION_CURRENCIES,
    normalizePackageCode,
    normalizeProductCode,
    normalizeRegion
} = require("../catalog/catalogProjection");
const { assertAssetCategory } = require("./mediaService");
const { CATALOG_CATEGORIES, HOMEPAGE_FLAGS, HOMEPAGE_SECTIONS, CATALOG_LIFECYCLE, COMMERCE_STATES } = require("../catalog/catalogTaxonomy");
const { getCanonicalProduct, resolveCanonicalProductRoute } = require("../catalog/canonicalOperationalCatalog");
const { normalizeProductKnowledge, normalizeCustomerNote, normalizeCustomerNoteLocales, ProductKnowledgeError } = require("../catalog/productKnowledge");
const { SUPPORTED_REGIONS: PRODUCT_COMPATIBILITY_MARKETS } = require("../catalog/productRegionAuthority");
const { SUPPLIER_CURRENCY } = require("../constants/commerce");

function normalizeAdminProductCode(value) {
    const requested = String(value || "").trim().toLowerCase();
    const normalized = getCanonicalProduct(requested)?.productCode || requested;
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(normalized)) {
        throw new CatalogAdminError("CATALOG_PRODUCT_UNSUPPORTED", "Product is not supported by the canonical catalog.", 409);
    }
    return normalized;
}

class CatalogAdminError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "CatalogAdminError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const MAX_PRICE = 100000000;
const MAX_SORT_ORDER = 1000000;
const MAX_PRODUCT_NAME = 120;
const MAX_PRODUCT_DESCRIPTION = 1200;
const MAX_SEO_TITLE = 90;
const MAX_SEO_DESCRIPTION = 180;
const MAX_SUPPLIER_NAME = 120;
const MAX_SUPPLIER_VERSION = 80;
const MAX_PRICING_NOTE = 240;
const MAX_OVERRIDE_REASON = 240;
const MAX_DISCOUNT_LABEL = 40;
const MAX_SUPPLIER_COST_HISTORY = 200;
const PUBLISHED_PRICE_MODES = Object.freeze(["POLICY_DERIVED", "MANUAL_OVERRIDE", "LEGACY_COMPATIBILITY_PRICE"]);

function assertNoImmutableFields(patch = {}, fields = []) {
    fields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
            throw new CatalogAdminError(
                "CATALOG_PATCH_INVALID",
                `${field} cannot be changed.`
            );
        }
    });
}

function normalizeExpectedUpdatedAt(value) {
    if (value instanceof Date) {
        return value;
    }

    const raw = String(value || "").trim();
    if (!raw) {
        throw new CatalogAdminError(
            "CATALOG_PATCH_INVALID",
            "expectedUpdatedAt is required."
        );
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
        throw new CatalogAdminError(
            "CATALOG_PATCH_INVALID",
            "expectedUpdatedAt is invalid."
        );
    }

    return date;
}

function assertFresh(document, expectedUpdatedAt) {
    const expected = normalizeExpectedUpdatedAt(expectedUpdatedAt);
    const current = new Date(document.updatedAt);

    if (current.getTime() !== expected.getTime()) {
        throw new CatalogAdminError(
            "CATALOG_CONFLICT",
            "Catalog changed since you opened it. Refresh and try again.",
            409
        );
    }
}

function parseBoolean(value, field) {
    if (typeof value !== "boolean") {
        throw new CatalogAdminError(
            "CATALOG_PATCH_INVALID",
            `${field} must be true or false.`
        );
    }

    return value;
}

function cleanEditableText(value = "", max = 120) {
    return String(value || "").trim().slice(0, max);
}

function normalizeProductName(value) {
    const name = cleanEditableText(value, MAX_PRODUCT_NAME);

    if (!name) {
        throw new CatalogAdminError(
            "CATALOG_PRODUCT_NAME_INVALID",
            "Product name is required."
        );
    }

    return name;
}

function normalizeSupportedRegions(value = []) {
    if (!Array.isArray(value)) {
        throw new CatalogAdminError("CATALOG_PATCH_INVALID", "supportedRegions must be an array.");
    }

    const supported = new Set(PRODUCT_COMPATIBILITY_MARKETS);
    const regions = Array.from(new Set(value.map(item => String(item || "").trim().toUpperCase()).filter(region => supported.has(region))));

    if (!regions.length) {
        throw new CatalogAdminError("CATALOG_REGION_PRICE_UNAVAILABLE", "At least one product compatibility market is required.");
    }

    return regions;
}

function normalizeManualAllowedRegions(value = []) {
    if (!Array.isArray(value)) {
        throw new CatalogAdminError("CATALOG_PATCH_INVALID", "manualAllowedRegions must be an array.");
    }

    const commerceRegions = new Set(Object.keys(REGION_CURRENCIES));
    const requested = value.map(item => normalizeRegion(item)).filter(Boolean);
    const invalidRegion = requested.find(region => !commerceRegions.has(region));
    if (invalidRegion) {
        throw new CatalogAdminError("CATALOG_FULFILLMENT_REGION_INVALID", "Manual fulfillment regions must be AZIEL commerce markets.");
    }

    return Array.from(new Set(requested));
}

function parsePrice(value) {
    if (value === "" || value === null || value === undefined) {
        throw new CatalogAdminError(
            "CATALOG_PRICE_INVALID",
            "Price amount is required."
        );
    }

    const amount = Number(value);

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PRICE) {
        throw new CatalogAdminError(
            "CATALOG_PRICE_INVALID",
            "Price amount must be a finite positive number."
        );
    }

    return amount;
}

function parseNullablePrice(value, field = "supplierCost") {
    if (value === "" || value === null || value === undefined) return null;

    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_PRICE) {
        throw new CatalogAdminError(
            "CATALOG_PRICE_INVALID",
            `${field} must be a finite non-negative number.`
        );
    }

    return amount;
}

function parseSupplierCurrency(value, fallback = "") {
    const currency = String(value || fallback || "").trim().toUpperCase();
    if (!currency) return "";
    if (!SUPPLIER_CURRENCY.includes(currency)) {
        throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Supplier currency is not supported.");
    }
    return currency;
}

function parseNullableDate(value, field = "supplierCostTimestamp") {
    if (value === "" || value === null || value === undefined) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new CatalogAdminError("CATALOG_PATCH_INVALID", `${field} must be a valid date.`);
    }
    return date;
}

function parsePublishedPriceMode(value) {
    const mode = String(value || "LEGACY_COMPATIBILITY_PRICE").trim().toUpperCase();
    if (!PUBLISHED_PRICE_MODES.includes(mode)) {
        throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Published price mode is not supported.");
    }
    return mode;
}

function parseSortOrder(value) {
    const order = Number(value ?? 0);

    if (!Number.isInteger(order) || Math.abs(order) > MAX_SORT_ORDER) {
        throw new CatalogAdminError(
            "CATALOG_SORT_ORDER_INVALID",
            "Sort order must be a finite integer within the supported range."
        );
    }

    return order;
}

function parseEnum(value, allowed, field, { optional = false } = {}) {
    const normalized = String(value || "").trim().toUpperCase();
    if (optional && !normalized) return undefined;
    if (!allowed.includes(normalized)) {
        throw new CatalogAdminError("CATALOG_PATCH_INVALID", `${field} is not supported.`);
    }
    return normalized;
}

function normalizeHomepageFlags(value) {
    if (!Array.isArray(value)) throw new CatalogAdminError("CATALOG_PATCH_INVALID", "homepageFlags must be an array.");
    return [...new Set(value.map(flag => parseEnum(flag, HOMEPAGE_FLAGS, "homepageFlags")))];
}

function normalizeHomepageSections(value) {
    if (!Array.isArray(value)) throw new CatalogAdminError("CATALOG_PATCH_INVALID", "homepageSections must be an array.");
    return [...new Set(value.map(section => parseEnum(section, HOMEPAGE_SECTIONS, "homepageSections")))];
}

function normalizePreviewPrice(value) {
    if (value === null) return { amount: null, currency: undefined, label: "PREVIEW_PRICE" };
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CatalogAdminError("CATALOG_PATCH_INVALID", "previewPrice must be an object or null.");
    const amount = parseNullablePrice(value.amount, "previewPrice.amount");
    if (amount === null) return { amount: null, currency: undefined, label: "PREVIEW_PRICE" };
    const currency = parseEnum(value.currency, ["MMK", "THB"], "previewPrice.currency");
    const label = parseEnum(value.label || "PREVIEW_PRICE", ["PREVIEW_PRICE", "ESTIMATED", "FROM", "NONE"], "previewPrice.label");
    return { amount, currency, label };
}

function normalizePackageName(value) {
    const name = String(value || "").trim();

    if (!name || name.length > 120) {
        throw new CatalogAdminError(
            "CATALOG_PACKAGE_NAME_INVALID",
            "Package name is required."
        );
    }

    return name;
}

function buildCreateRegionalPrice(region, patch = {}) {
    const currency = REGION_CURRENCIES[region];
    const enabled = Boolean(patch?.enabled);

    if (!enabled) return undefined;

    const amount = parsePrice(patch.amount);
    const referencePrice = parseNullablePrice(patch.referencePrice, `${region}.referencePrice`);
    const showDiscount = Object.prototype.hasOwnProperty.call(patch, "showDiscount")
        ? parseBoolean(patch.showDiscount, `${region}.showDiscount`)
        : false;

    if (referencePrice !== null && referencePrice <= amount) {
        throw new CatalogAdminError(
            "CATALOG_REFERENCE_PRICE_INVALID",
            "Reference price must be greater than the selling price."
        );
    }

    if (showDiscount && referencePrice === null) {
        throw new CatalogAdminError(
            "CATALOG_REFERENCE_PRICE_INVALID",
            "A valid reference price is required when discount display is enabled."
        );
    }

    return {
        amount,
        currency,
        referencePrice,
        showDiscount,
        showSaveAmount: Object.prototype.hasOwnProperty.call(patch, "showSaveAmount")
            ? parseBoolean(patch.showSaveAmount, `${region}.showSaveAmount`)
            : true,
        showOriginalPrice: Object.prototype.hasOwnProperty.call(patch, "showOriginalPrice")
            ? parseBoolean(patch.showOriginalPrice, `${region}.showOriginalPrice`)
            : true,
        discountLabel: cleanEditableText(patch.discountLabel, MAX_DISCOUNT_LABEL),
        enabled: true
    };
}

async function buildCreatePackagePayload(product, patch = {}) {
    const packageCode = normalizePackageCode(patch.packageCode);

    if (!packageCode) {
        throw new CatalogAdminError(
            "CATALOG_PACKAGE_CODE_INVALID",
            "Package code is required."
        );
    }

    const prices = {
        MM: buildCreateRegionalPrice("MM", patch.prices?.MM),
        TH: buildCreateRegionalPrice("TH", patch.prices?.TH)
    };

    if (!prices.MM && !prices.TH) {
        throw new CatalogAdminError(
            "CATALOG_REGION_PRICE_UNAVAILABLE",
            "At least one regional price must be available."
        );
    }

    const iconAssetId = String(patch.iconAssetId || "").trim();
    if (iconAssetId) {
        await assertAssetCategory(iconAssetId, "package_icon");
    }

    return {
        productCode: product.productCode,
        packageCode,
        name: normalizePackageName(patch.name),
        enabled: Object.prototype.hasOwnProperty.call(patch, "enabled")
            ? parseBoolean(patch.enabled, "enabled")
            : true,
        prices,
        sortOrder: parseSortOrder(patch.sortOrder),
        iconAssetId,
        customerNote: normalizeCustomerNote(patch.customerNote),
        source: "admin"
    };
}

function buildProductPatch(patch = {}) {
    assertNoImmutableFields(patch, ["_id", "id", "productCode", "source", "createdAt", "updatedAt", "__v"]);

    const updates = {};
    const allowed = new Set([
        "name",
        "description",
        "enabled",
        "featured",
        "catalogCategory",
        "lifecycleStatus",
        "commerceState",
        "publicDiscoveryEnabled",
        "homepageEnabled",
        "homepageCategory",
        "homepageOrder",
        "homepageFlags",
        "homepageSections",
        "manualAllowedRegions",
        "previewPrice",
        "marketScope",
        "displayMarketLabel",
        "supportedRegions",
        "seo",
        "productKnowledge",
        "expectedUpdatedAt"
    ]);

    Object.keys(patch).forEach(key => {
        if (!allowed.has(key)) {
            throw new CatalogAdminError("CATALOG_PATCH_INVALID", `${key} is not editable.`);
        }
    });

    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
        updates.name = normalizeProductName(patch.name);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "description")) {
        updates.description = cleanEditableText(patch.description, MAX_PRODUCT_DESCRIPTION);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
        updates.enabled = parseBoolean(patch.enabled, "enabled");
    }

    if (Object.prototype.hasOwnProperty.call(patch, "featured")) {
        updates.featured = parseBoolean(patch.featured, "featured");
    }

    if (Object.prototype.hasOwnProperty.call(patch, "catalogCategory")) updates.catalogCategory = parseEnum(patch.catalogCategory, CATALOG_CATEGORIES, "catalogCategory", { optional: true });
    if (Object.prototype.hasOwnProperty.call(patch, "lifecycleStatus")) updates.lifecycleStatus = parseEnum(patch.lifecycleStatus, CATALOG_LIFECYCLE, "lifecycleStatus");
    if (Object.prototype.hasOwnProperty.call(patch, "commerceState")) updates.commerceState = parseEnum(patch.commerceState, COMMERCE_STATES, "commerceState");
    if (Object.prototype.hasOwnProperty.call(patch, "publicDiscoveryEnabled")) updates.publicDiscoveryEnabled = parseBoolean(patch.publicDiscoveryEnabled, "publicDiscoveryEnabled");
    if (Object.prototype.hasOwnProperty.call(patch, "homepageEnabled")) updates.homepageEnabled = parseBoolean(patch.homepageEnabled, "homepageEnabled");
    if (Object.prototype.hasOwnProperty.call(patch, "homepageCategory")) updates.homepageCategory = parseEnum(patch.homepageCategory, CATALOG_CATEGORIES, "homepageCategory", { optional: true });
    if (Object.prototype.hasOwnProperty.call(patch, "homepageOrder")) updates.homepageOrder = parseSortOrder(patch.homepageOrder);
    if (Object.prototype.hasOwnProperty.call(patch, "homepageFlags")) updates.homepageFlags = normalizeHomepageFlags(patch.homepageFlags);
    if (Object.prototype.hasOwnProperty.call(patch, "homepageSections")) updates.homepageSections = normalizeHomepageSections(patch.homepageSections);
    if (Object.prototype.hasOwnProperty.call(patch, "manualAllowedRegions")) updates["fulfillment.manualAllowedRegions"] = normalizeManualAllowedRegions(patch.manualAllowedRegions);
    if (Object.prototype.hasOwnProperty.call(patch, "previewPrice")) updates["presentation.previewPrice"] = normalizePreviewPrice(patch.previewPrice);
    if (Object.prototype.hasOwnProperty.call(patch, "marketScope")) updates["presentation.marketScope"] = parseEnum(patch.marketScope, ["GLOBAL", "REGION", "MULTI_REGION"], "marketScope");
    if (Object.prototype.hasOwnProperty.call(patch, "displayMarketLabel")) updates["presentation.displayMarketLabel"] = cleanEditableText(patch.displayMarketLabel, 60);

    if (Object.prototype.hasOwnProperty.call(patch, "supportedRegions")) {
        updates.supportedRegions = normalizeSupportedRegions(patch.supportedRegions);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "seo")) {
        if (!patch.seo || typeof patch.seo !== "object" || Array.isArray(patch.seo)) {
            throw new CatalogAdminError("CATALOG_PATCH_INVALID", "seo must be an object.");
        }
        updates["seo.title"] = cleanEditableText(patch.seo.title, MAX_SEO_TITLE);
        updates["seo.description"] = cleanEditableText(patch.seo.description, MAX_SEO_DESCRIPTION);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "productKnowledge")) {
        try {
            updates.productKnowledge = normalizeProductKnowledge(patch.productKnowledge);
        } catch (error) {
            if (error instanceof ProductKnowledgeError) throw new CatalogAdminError(error.code, error.message);
            throw error;
        }
    }

    return updates;
}

function buildPackagePatch(document, patch = {}) {
    assertNoImmutableFields(patch, ["_id", "id", "productCode", "packageCode", "source", "createdAt", "updatedAt", "__v"]);

    const updates = {};
    const allowed = new Set(["name", "enabled", "prices", "canonicalSupplierCost", "iconAssetId", "customerNote", "customerNoteLocales", "packageFamily", "expectedUpdatedAt", "pricingPublicationEvidence"]);

    Object.keys(patch).forEach(key => {
        if (!allowed.has(key)) {
            throw new CatalogAdminError("CATALOG_PATCH_INVALID", `${key} is not editable.`);
        }
    });

    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
        updates.enabled = parseBoolean(patch.enabled, "enabled");
    }

    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
        updates.name = normalizePackageName(patch.name);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "packageFamily")) {
        const { validateFamily } = require("../catalog/canonicalPackageFamilies");
        const family = validateFamily(document.productCode, patch.packageFamily);
        updates.packageFamily = { ...family, authority: "ADMIN_CANONICAL_PACKAGE_FAMILY" };
    }

    if (Object.prototype.hasOwnProperty.call(patch, "customerNote")) {
        try {
            updates.customerNote = normalizeCustomerNote(patch.customerNote);
        } catch (error) {
            if (error instanceof ProductKnowledgeError) throw new CatalogAdminError(error.code, error.message);
            throw error;
        }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "customerNoteLocales")) {
        try {
            updates.customerNoteLocales = normalizeCustomerNoteLocales(patch.customerNoteLocales, document.customerNote || "");
        } catch (error) {
            if (error instanceof ProductKnowledgeError) throw new CatalogAdminError(error.code, error.message);
            throw error;
        }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "iconAssetId")) {
        updates.iconAssetId = cleanEditableText(patch.iconAssetId, 96);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "pricingPublicationEvidence")) {
        if (!Array.isArray(patch.pricingPublicationEvidence) || patch.pricingPublicationEvidence.length > 2) {
            throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Pricing publication evidence must contain at most one entry per region.");
        }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "canonicalSupplierCost")) {
        const snapshot = patch.canonicalSupplierCost;
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new CatalogAdminError("CATALOG_PATCH_INVALID", "canonicalSupplierCost must be an object.");
        updates["canonicalSupplierCost.supplierId"] = snapshot.supplierId || null;
        updates["canonicalSupplierCost.supplierCode"] = cleanEditableText(snapshot.supplierCode, MAX_SUPPLIER_NAME).toUpperCase();
        updates["canonicalSupplierCost.supplierName"] = cleanEditableText(snapshot.supplierName, MAX_SUPPLIER_NAME);
        updates["canonicalSupplierCost.amount"] = parseNullablePrice(snapshot.amount, "canonicalSupplierCost.amount");
        updates["canonicalSupplierCost.currency"] = parseSupplierCurrency(snapshot.currency, "");
        updates["canonicalSupplierCost.capturedAt"] = parseNullableDate(snapshot.capturedAt, "canonicalSupplierCost.capturedAt");
        ["rawSupplierCost", "fxRate", "fxRateMaxAgeSeconds", "fxConvertedCost", "fundingCost", "otherAcquisitionCost", "landedCost"].forEach(key => {
            if (Object.prototype.hasOwnProperty.call(snapshot, key)) updates[`canonicalSupplierCost.${key}`] = parseNullablePrice(snapshot[key], `canonicalSupplierCost.${key}`);
        });
        ["rawSupplierCurrency"].forEach(key => {
            if (Object.prototype.hasOwnProperty.call(snapshot, key)) updates[`canonicalSupplierCost.${key}`] = parseSupplierCurrency(snapshot[key], "");
        });
        ["landedCurrency"].forEach(key => {
            if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
                const value = String(snapshot[key] || "").trim().toUpperCase();
                if (!["MMK", "THB"].includes(value)) throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Landed currency is not a storefront currency.");
                updates[`canonicalSupplierCost.${key}`] = value;
            }
        });
        ["supplierCostSource", "providerProductCode", "providerOfferCode", "fxRateSource"].forEach(key => {
            if (Object.prototype.hasOwnProperty.call(snapshot, key)) updates[`canonicalSupplierCost.${key}`] = cleanEditableText(snapshot[key], MAX_SUPPLIER_VERSION);
        });
        ["fxRateCapturedAt", "fxRateEffectiveAt", "fxRateExpiresAt"].forEach(key => {
            if (Object.prototype.hasOwnProperty.call(snapshot, key)) updates[`canonicalSupplierCost.${key}`] = parseNullableDate(snapshot[key], `canonicalSupplierCost.${key}`);
        });
    }

    if (patch.prices !== undefined) {
        if (!patch.prices || typeof patch.prices !== "object" || Array.isArray(patch.prices)) {
            throw new CatalogAdminError("CATALOG_PATCH_INVALID", "prices must be an object.");
        }

        Object.entries(patch.prices).forEach(([regionKey, pricePatch]) => {
            const region = normalizeRegion(regionKey);
            const currency = REGION_CURRENCIES[region];

            if (!currency) {
                throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Unsupported price region.");
            }

            if (!pricePatch || typeof pricePatch !== "object" || Array.isArray(pricePatch)) {
                throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Regional price patch must be an object.");
            }

            const regionalAllowed = new Set([
                "amount",
                "referencePrice",
                "showDiscount",
                "showSaveAmount",
                "showOriginalPrice",
                "discountLabel",
                "enabled",
                "publishedPriceMode",
                "manualOverrideReason",
                "supplierCost",
                "supplierCurrency",
                "supplierId",
                "supplierCode",
                "supplierName",
                "supplierVersion",
                "supplierCostTimestamp",
                "rawSupplierCost",
                "rawSupplierCurrency",
                "supplierCostSource",
                "providerProductCode",
                "providerOfferCode",
                "fxRate",
                "fxRateSource",
                "fxRateCapturedAt",
                "fxRateEffectiveAt",
                "fxRateExpiresAt",
                "fxRateMaxAgeSeconds",
                "fxConvertedCost",
                "fundingCost",
                "otherAcquisitionCost",
                "landedCost",
                "landedCurrency",
                "pricingNote"
            ]);
            Object.keys(pricePatch).forEach(key => {
                if (!regionalAllowed.has(key)) {
                    throw new CatalogAdminError("CATALOG_PATCH_INVALID", `${key} is not editable.`);
                }
            });

            if (Object.prototype.hasOwnProperty.call(pricePatch, "enabled")) {
                const nextEnabled = parseBoolean(pricePatch.enabled, `${region}.enabled`);
                if (nextEnabled || document.prices?.[region]) {
                    updates[`prices.${region}.enabled`] = nextEnabled;
                    updates[`prices.${region}.currency`] = currency;
                }
            }

            if (Object.prototype.hasOwnProperty.call(pricePatch, "amount")) {
                updates[`prices.${region}.amount`] = parsePrice(pricePatch.amount);
                updates[`prices.${region}.currency`] = currency;
                if (!Object.prototype.hasOwnProperty.call(pricePatch, "enabled") && !document.prices?.[region]) {
                    updates[`prices.${region}.enabled`] = true;
                }
            } else if (pricePatch.enabled === true && !document.prices?.[region]) {
                throw new CatalogAdminError(
                    "CATALOG_PRICE_INVALID",
                    "Price amount is required."
                );
            }

            if (Object.prototype.hasOwnProperty.call(pricePatch, "referencePrice")) {
                updates[`prices.${region}.referencePrice`] = parseNullablePrice(
                    pricePatch.referencePrice,
                    `${region}.referencePrice`
                );
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "showDiscount")) {
                updates[`prices.${region}.showDiscount`] = parseBoolean(
                    pricePatch.showDiscount,
                    `${region}.showDiscount`
                );
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "showSaveAmount")) {
                updates[`prices.${region}.showSaveAmount`] = parseBoolean(
                    pricePatch.showSaveAmount,
                    `${region}.showSaveAmount`
                );
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "showOriginalPrice")) {
                updates[`prices.${region}.showOriginalPrice`] = parseBoolean(
                    pricePatch.showOriginalPrice,
                    `${region}.showOriginalPrice`
                );
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "discountLabel")) {
                updates[`prices.${region}.discountLabel`] = cleanEditableText(
                    pricePatch.discountLabel,
                    MAX_DISCOUNT_LABEL
                );
            }

            const nextAmount = Object.prototype.hasOwnProperty.call(updates, `prices.${region}.amount`)
                ? updates[`prices.${region}.amount`]
                : document.prices?.[region]?.amount;
            const nextReferencePrice = Object.prototype.hasOwnProperty.call(updates, `prices.${region}.referencePrice`)
                ? updates[`prices.${region}.referencePrice`]
                : (document.prices?.[region]?.referencePrice ?? null);
            const nextShowDiscount = Object.prototype.hasOwnProperty.call(updates, `prices.${region}.showDiscount`)
                ? updates[`prices.${region}.showDiscount`]
                : Boolean(document.prices?.[region]?.showDiscount);

            if (nextReferencePrice !== null && nextReferencePrice !== undefined) {
                if (!Number.isFinite(Number(nextAmount)) || nextReferencePrice <= Number(nextAmount)) {
                    throw new CatalogAdminError(
                        "CATALOG_REFERENCE_PRICE_INVALID",
                        "Reference price must be greater than the selling price."
                    );
                }
            }

            if (nextShowDiscount && (nextReferencePrice === null || nextReferencePrice === undefined)) {
                throw new CatalogAdminError(
                    "CATALOG_REFERENCE_PRICE_INVALID",
                    "A valid reference price is required when discount display is enabled."
                );
            }

            if (Object.prototype.hasOwnProperty.call(pricePatch, "publishedPriceMode")) {
                updates[`prices.${region}.publishedPriceMode`] = parsePublishedPriceMode(pricePatch.publishedPriceMode);
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "manualOverrideReason")) {
                updates[`prices.${region}.manualOverrideReason`] = cleanEditableText(pricePatch.manualOverrideReason, MAX_OVERRIDE_REASON);
            }
            const nextMode = updates[`prices.${region}.publishedPriceMode`] || document.prices?.[region]?.publishedPriceMode || "LEGACY_COMPATIBILITY_PRICE";
            const nextReason = updates[`prices.${region}.manualOverrideReason`] ?? document.prices?.[region]?.manualOverrideReason ?? "";
            if (nextMode === "MANUAL_OVERRIDE" && !nextReason) {
                throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Manual published-price override requires a reason.");
            }

            if (Object.prototype.hasOwnProperty.call(pricePatch, "supplierCost")) {
                updates[`prices.${region}.supplierCost`] = parseNullablePrice(pricePatch.supplierCost, `${region}.supplierCost`);
                updates[`prices.${region}.supplierCurrency`] = parseSupplierCurrency(pricePatch.supplierCurrency, document.prices?.[region]?.supplierCurrency || currency);
                if (!updates[`prices.${region}.supplierCurrency`]) {
                    updates[`prices.${region}.supplierCurrency`] = currency;
                }
                if (!document.prices?.[region] && !Object.prototype.hasOwnProperty.call(updates, `prices.${region}.amount`)) {
                    throw new CatalogAdminError("CATALOG_PRICE_INVALID", "Selling price is required before supplier cost can be configured.");
                }
            } else if (Object.prototype.hasOwnProperty.call(pricePatch, "supplierCurrency")) {
                updates[`prices.${region}.supplierCurrency`] = parseSupplierCurrency(pricePatch.supplierCurrency, document.prices?.[region]?.supplierCurrency || currency);
            }

            if (Object.prototype.hasOwnProperty.call(pricePatch, "supplierName")) {
                updates[`prices.${region}.supplierName`] = cleanEditableText(pricePatch.supplierName, MAX_SUPPLIER_NAME);
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "supplierId")) {
                updates[`prices.${region}.supplierId`] = pricePatch.supplierId || null;
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "supplierCode")) {
                updates[`prices.${region}.supplierCode`] = cleanEditableText(pricePatch.supplierCode, MAX_SUPPLIER_NAME).toUpperCase();
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "supplierVersion")) {
                updates[`prices.${region}.supplierVersion`] = cleanEditableText(pricePatch.supplierVersion, MAX_SUPPLIER_VERSION);
            }
            if (Object.prototype.hasOwnProperty.call(pricePatch, "supplierCostTimestamp")) {
                updates[`prices.${region}.supplierCostTimestamp`] = parseNullableDate(pricePatch.supplierCostTimestamp, `${region}.supplierCostTimestamp`);
            }
            ["rawSupplierCost", "fxRate", "fxRateMaxAgeSeconds", "fxConvertedCost", "fundingCost", "otherAcquisitionCost", "landedCost"].forEach(key => {
                if (Object.prototype.hasOwnProperty.call(pricePatch, key)) updates[`prices.${region}.${key}`] = parseNullablePrice(pricePatch[key], `${region}.${key}`);
            });
            if (Object.prototype.hasOwnProperty.call(pricePatch, "rawSupplierCurrency")) updates[`prices.${region}.rawSupplierCurrency`] = parseSupplierCurrency(pricePatch.rawSupplierCurrency, "");
            if (Object.prototype.hasOwnProperty.call(pricePatch, "landedCurrency")) {
                const landedCurrency = String(pricePatch.landedCurrency || "").trim().toUpperCase();
                if (!["MMK", "THB"].includes(landedCurrency)) throw new CatalogAdminError("CATALOG_PATCH_INVALID", "Landed currency is not a storefront currency.");
                updates[`prices.${region}.landedCurrency`] = landedCurrency;
            }
            ["supplierCostSource", "providerProductCode", "providerOfferCode", "fxRateSource"].forEach(key => {
                if (Object.prototype.hasOwnProperty.call(pricePatch, key)) updates[`prices.${region}.${key}`] = cleanEditableText(pricePatch[key], MAX_SUPPLIER_VERSION);
            });
            ["fxRateCapturedAt", "fxRateEffectiveAt", "fxRateExpiresAt"].forEach(key => {
                if (Object.prototype.hasOwnProperty.call(pricePatch, key)) updates[`prices.${region}.${key}`] = parseNullableDate(pricePatch[key], `${region}.${key}`);
            });
            if (Object.prototype.hasOwnProperty.call(pricePatch, "pricingNote")) {
                updates[`prices.${region}.pricingNote`] = cleanEditableText(pricePatch.pricingNote, MAX_PRICING_NOTE);
            }
        });
    }

    return updates;
}

function hasChanges(document, updates = {}) {
    return Object.entries(updates).some(([path, value]) => {
        const current = path.split(".").reduce((row, key) => row?.[key], document);
        return current !== value;
    });
}

function normalizeComparable(value) {
    if (value instanceof Date) return value.toISOString();
    if (value === undefined) return null;
    return value;
}

function buildSupplierCostHistoryEntries(document, updates = {}, actor = "admin") {
    const entries = [];
    ["MM", "TH"].forEach(region => {
        const changed = [
            "supplierCost",
            "supplierCurrency",
            "supplierName",
            "supplierVersion",
            "supplierCostTimestamp",
            "pricingNote"
        ].some(key => {
            const path = `prices.${region}.${key}`;
            return Object.prototype.hasOwnProperty.call(updates, path) &&
                normalizeComparable(updates[path]) !== normalizeComparable(document.prices?.[region]?.[key]);
        });

        if (!changed) return;

        const previous = document.prices?.[region] || {};
        entries.push({
            region,
            previousSupplierCost: previous.supplierCost == null ? null : Number(previous.supplierCost),
            newSupplierCost: Object.prototype.hasOwnProperty.call(updates, `prices.${region}.supplierCost`)
                ? updates[`prices.${region}.supplierCost`]
                : (previous.supplierCost == null ? null : Number(previous.supplierCost)),
            previousSupplierCurrency: previous.supplierCurrency || "",
            newSupplierCurrency: updates[`prices.${region}.supplierCurrency`] || previous.supplierCurrency || "",
            supplierName: updates[`prices.${region}.supplierName`] ?? previous.supplierName ?? "",
            supplierVersion: updates[`prices.${region}.supplierVersion`] ?? previous.supplierVersion ?? "",
            supplierCostTimestamp: updates[`prices.${region}.supplierCostTimestamp`] ?? previous.supplierCostTimestamp ?? null,
            pricingNote: updates[`prices.${region}.pricingNote`] ?? previous.pricingNote ?? "",
            changedBy: actor || "admin",
            changedAt: new Date()
        });
    });
    return entries;
}

function classifyProductEnabledTransition(previousEnabled, nextEnabled) {
    if (previousEnabled && !nextEnabled) return "WITHDRAWAL";
    if (!previousEnabled && nextEnabled) return "ACTIVATION";
    return nextEnabled ? "ACTIVE_EDIT" : "INACTIVE_EDIT";
}

function shouldValidateProductReadiness({ transition, previousCommerceState, nextCommerceState, changedFields = [] } = {}) {
    if (["WITHDRAWAL", "INACTIVE_EDIT"].includes(transition)) return false;
    if (nextCommerceState !== "PURCHASABLE") return false;
    if (transition === "ACTIVATION") return true;
    if (previousCommerceState !== "PURCHASABLE") return true;
    return changedFields.includes("supportedRegions");
}

async function updateProduct({ productCode, patch = {}, actor = "admin" }) {
    const normalizedProductCode = normalizeAdminProductCode(productCode);
    let product = await CatalogProduct.findOne({ productCode: normalizedProductCode });
    let initializedFromCanonical = false;

    if (!product) {
        const canonical = getCanonicalProduct(normalizedProductCode);
        if (!canonical) {
            throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
        }
        product = await CatalogProduct.findOneAndUpdate(
            { productCode: normalizedProductCode },
            {
                $setOnInsert: {
                    productCode: canonical.productCode,
                    name: canonical.name,
                    enabled: true,
                    catalogCategory: canonical.catalogCategory,
                    supportedRegions: canonical.supportedRegions,
                    sortOrder: canonical.sortOrder,
                    productRoute: canonical.productRoute,
                    commerceState: "HIDDEN",
                    publicDiscoveryEnabled: false,
                    source: "admin",
                    metadata: { initializedFromCanonical: true }
                }
            },
            { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
        initializedFromCanonical = true;
    }

    if (!initializedFromCanonical) assertFresh(product, patch.expectedUpdatedAt);
    const updates = buildProductPatch(patch);
    const previousEnabled = product.enabled !== false;
    const previousCommerceState = product.commerceState || "HIDDEN";

    if (!Object.keys(updates).length || !hasChanges(product, updates)) {
        return { changed: false, product: product.toObject(), changedFields: [] };
    }

    Object.entries(updates).forEach(([path, value]) => {
        product.set(path, value);
    });
    const commerceRegions = new Set(Object.keys(REGION_CURRENCIES));
    const unsupportedManualRegion = (product.fulfillment?.manualAllowedRegions || [])
        .find(region => !commerceRegions.has(normalizeRegion(region)));
    if (unsupportedManualRegion) {
        throw new CatalogAdminError("CATALOG_FULFILLMENT_REGION_INVALID", "Manual fulfillment regions must be AZIEL commerce markets.");
    }
    const transition = classifyProductEnabledTransition(previousEnabled, product.enabled !== false);
    const validateReadiness = shouldValidateProductReadiness({
        transition,
        previousCommerceState,
        nextCommerceState: product.commerceState || "HIDDEN",
        changedFields: Object.keys(updates)
    });
    if (validateReadiness) {
        const SupplierProductMapping = require("../models/SupplierProductMapping");
        const Supplier = require("../models/Supplier");
        const PackageInventoryState = require("../models/PackageInventoryState");
        const { projectCommerceReadiness } = require("./catalogService");
        const [packages, mappings, inventoryStates, suppliers] = await Promise.all([
            CatalogPackage.find({ productCode: normalizedProductCode }).lean(),
            SupplierProductMapping.find({ productCode: normalizedProductCode, enabled: true }).lean(),
            PackageInventoryState.find().lean(),
            Supplier.find({ enabled: true }).lean()
        ]);
        const packageIds = new Set(packages.map(item => String(item._id)));
        const relevantInventory = inventoryStates.filter(item => packageIds.has(String(item.packageRef)) || packages.some(pkg => pkg.packageCode === item.packageCode));
        const readiness = projectCommerceReadiness(product.toObject(), packages, mappings, relevantInventory, suppliers);
        if (!readiness.ready) {
            throw new CatalogAdminError(
                "CATALOG_COMMERCE_CONFIGURATION_INCOMPLETE",
                `Product cannot be published on Home. Missing: ${readiness.missing.join(", ")}.`
            );
        }
    }
    if (product.enabled !== false && product.publicDiscoveryEnabled && product.commerceState !== "HIDDEN") {
        const identityMissing = [
            !product.name && "name",
            !product.catalogCategory && "category",
            !resolveCanonicalProductRoute(product.productCode) && "route",
            !(product.artworkPath || product.presentation?.imageAssetId) && "artwork"
        ].filter(Boolean);
        if (identityMissing.length) {
            throw new CatalogAdminError("CATALOG_DISCOVERY_CONFIGURATION_INCOMPLETE", `Product cannot be discoverable. Missing: ${identityMissing.join(", ")}.`);
        }
    }
    await product.save();
    console.log("Catalog product updated:", {
        action: "catalog.product.update",
        productCode: normalizedProductCode,
        changedFields: Object.keys(updates),
        actor,
        timestamp: new Date().toISOString()
    });

    return { changed: true, product: product.toObject(), changedFields: Object.keys(updates) };
}

async function softDeleteProduct({ productCode, expectedUpdatedAt, actor = "admin" } = {}) {
    const normalizedProductCode = normalizeAdminProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode });

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    assertFresh(product, expectedUpdatedAt);

    if (product.deletedAt) {
        return { changed: false, product: product.toObject(), changedFields: [] };
    }

    product.set("metadata.preDeleteEnabled", product.enabled !== false);
    product.enabled = false;
    product.deletedAt = new Date();
    product.deletedBy = actor;
    await product.save();

    return { changed: true, product: product.toObject(), changedFields: ["deletedAt", "enabled"] };
}

async function restoreProduct({ productCode, expectedUpdatedAt, actor = "admin" } = {}) {
    const normalizedProductCode = normalizeAdminProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode });

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    assertFresh(product, expectedUpdatedAt);

    if (!product.deletedAt) {
        return { changed: false, product: product.toObject(), changedFields: [] };
    }

    product.enabled = product.metadata?.preDeleteEnabled !== false;
    product.deletedAt = null;
    product.deletedBy = "";
    product.set("metadata.restoredBy", actor);
    product.set("metadata.restoredAt", new Date().toISOString());
    await product.save();

    return { changed: true, product: product.toObject(), changedFields: ["deletedAt", "enabled"] };
}

async function updatePackage({ productCode, packageCode, patch = {}, actor = "admin" }) {
    const normalizedProductCode = normalizeAdminProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);
    const item = await CatalogPackage.findOne({
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode
    });

    if (!item) {
        throw new CatalogAdminError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    }

    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode }).lean();
    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    assertFresh(item, patch.expectedUpdatedAt);
    const updates = buildPackagePatch(item, patch);

    if (updates.iconAssetId) {
        await assertAssetCategory(updates.iconAssetId, "package_icon");
    }

    Object.entries(patch.prices || {}).forEach(([regionKey, pricePatch]) => {
        const region = normalizeRegion(regionKey);
        if (!Object.prototype.hasOwnProperty.call(REGION_CURRENCIES, region)) {
            throw new CatalogAdminError("CATALOG_REGION_PRICE_UNAVAILABLE", "Unsupported AZIEL commerce market.");
        }
    });

    if (!Object.keys(updates).length || !hasChanges(item, updates)) {
        return { changed: false, package: item.toObject(), changedFields: [] };
    }

    const supplierCostHistoryEntries = buildSupplierCostHistoryEntries(item, updates, actor);
    const previousPublishedPrices = Object.fromEntries(["TH", "MM"].map(region => [
        region,
        item.prices?.[region]?.amount == null ? null : Number(item.prices[region].amount)
    ]));

    Object.entries(updates).forEach(([path, value]) => {
        item.set(path, value);
    });
    if (!Array.isArray(item.supplierCostHistory)) {
        item.supplierCostHistory = [];
    }
    if (supplierCostHistoryEntries.length) {
        item.supplierCostHistory = item.supplierCostHistory
            .concat(supplierCostHistoryEntries)
            .slice(-MAX_SUPPLIER_COST_HISTORY);
    }
    if (Array.isArray(patch.pricingPublicationEvidence) && patch.pricingPublicationEvidence.length) {
        const publishedAt = new Date();
        const entries = patch.pricingPublicationEvidence.map(evidence => {
            const region = normalizeRegion(evidence.region);
            const nextAmount = updates[`prices.${region}.amount`];
            return {
                region,
                previousPublishedPrice: previousPublishedPrices[region],
                newPublishedPrice: nextAmount == null ? null : Number(nextAmount),
                currency: REGION_CURRENCIES[region],
                supplierBasis: evidence.supplierBasis || {},
                fxBasis: evidence.fxBasis || {},
                appliedProfit: evidence.appliedProfit == null ? null : Number(evidence.appliedProfit),
                pricingPolicy: evidence.pricingPolicy || {},
                packageProfitOverride: evidence.packageProfitOverride || { mode: "INHERIT", value: null },
                publishedBy: actor || "admin",
                publishedAt
            };
        });
        item.pricingPublicationHistory = (Array.isArray(item.pricingPublicationHistory) ? item.pricingPublicationHistory : [])
            .concat(entries)
            .slice(-100);
    }
    await item.save();
    console.log("Catalog package updated:", {
        action: "catalog.package.update",
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode,
        changedFields: Object.keys(updates),
        actor,
        timestamp: new Date().toISOString()
    });

    return { changed: true, package: item.toObject(), changedFields: Object.keys(updates) };
}

async function softDeletePackage({ productCode, packageCode, expectedUpdatedAt, actor = "admin" } = {}) {
    const normalizedProductCode = normalizeAdminProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);
    const item = await CatalogPackage.findOne({
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode
    });

    if (!item) {
        throw new CatalogAdminError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    }

    assertFresh(item, expectedUpdatedAt);

    if (item.deletedAt) {
        return { changed: false, package: item.toObject(), changedFields: [] };
    }

    item.set("metadata.preDeleteEnabled", item.enabled !== false);
    item.enabled = false;
    item.deletedAt = new Date();
    item.deletedBy = actor;
    await item.save();

    return { changed: true, package: item.toObject(), changedFields: ["deletedAt", "enabled"] };
}

async function restorePackage({ productCode, packageCode, expectedUpdatedAt, actor = "admin" } = {}) {
    const normalizedProductCode = normalizeAdminProductCode(productCode);
    const normalizedPackageCode = normalizePackageCode(packageCode);
    const item = await CatalogPackage.findOne({
        productCode: normalizedProductCode,
        packageCode: normalizedPackageCode
    });

    if (!item) {
        throw new CatalogAdminError("CATALOG_PACKAGE_NOT_FOUND", "Package not found.", 404);
    }

    assertFresh(item, expectedUpdatedAt);

    if (!item.deletedAt) {
        return { changed: false, package: item.toObject(), changedFields: [] };
    }

    item.enabled = item.metadata?.preDeleteEnabled !== false;
    item.deletedAt = null;
    item.deletedBy = "";
    item.set("metadata.restoredBy", actor);
    item.set("metadata.restoredAt", new Date().toISOString());
    await item.save();

    return { changed: true, package: item.toObject(), changedFields: ["deletedAt", "enabled"] };
}

async function createPackage({ productCode, patch = {}, actor = "admin" } = {}) {
    const normalizedProductCode = normalizeAdminProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode }).lean();

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    const payload = await buildCreatePackagePayload(product, patch);
    const exists = await CatalogPackage.findOne({
        productCode: payload.productCode,
        packageCode: payload.packageCode
    }).lean();

    if (exists) {
        throw new CatalogAdminError(
            "PACKAGE_ALREADY_EXISTS",
            "Package already exists for this product.",
            409
        );
    }

    try {
        const item = await CatalogPackage.create(payload);
        console.log("Catalog package created:", {
            action: "catalog.package.create",
            productCode: payload.productCode,
            packageCode: payload.packageCode,
            actor,
            timestamp: new Date().toISOString()
        });

        return { changed: true, package: item.toObject() };
    } catch (error) {
        if (error?.code === 11000) {
            throw new CatalogAdminError(
                "PACKAGE_ALREADY_EXISTS",
                "Package already exists for this product.",
                409
            );
        }

        throw error;
    }
}

async function reorderPackages({ productCode, orderedPackageCodes = [], actor = "admin" } = {}) {
    const normalizedProductCode = normalizeAdminProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode }).lean();

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    const codes = orderedPackageCodes.map(normalizePackageCode).filter(Boolean);
    const unique = new Set(codes);

    if (!codes.length || unique.size !== codes.length) {
        throw new CatalogAdminError("CATALOG_PACKAGE_REORDER_INVALID", "Package order contains duplicates or is empty.");
    }

    const packages = await CatalogPackage.find({ productCode: normalizedProductCode }).lean();
    const existingCodes = packages.map(item => item.packageCode);

    if (codes.length !== existingCodes.length) {
        throw new CatalogAdminError("CATALOG_PACKAGE_REORDER_INVALID", "Package order must include every package for this product.");
    }

    const existingSet = new Set(existingCodes);
    if (codes.some(code => !existingSet.has(code))) {
        throw new CatalogAdminError("CATALOG_PACKAGE_REORDER_INVALID", "Package order includes unknown or foreign packages.");
    }

    await Promise.all(codes.map((packageCode, index) => CatalogPackage.updateOne(
        { productCode: normalizedProductCode, packageCode },
        { $set: { sortOrder: index + 1 } }
    )));

    console.log("Catalog package order updated:", {
        action: "catalog.package.reorder",
        productCode: normalizedProductCode,
        count: codes.length,
        actor,
        timestamp: new Date().toISOString()
    });

    return {
        changed: true,
        orderedPackageCodes: codes
    };
}

module.exports = {
    CatalogAdminError,
    classifyProductEnabledTransition,
    createPackage,
    reorderPackages,
    restorePackage,
    restoreProduct,
    softDeletePackage,
    softDeleteProduct,
    updatePackage,
    updateProduct,
    shouldValidateProductReadiness
};
