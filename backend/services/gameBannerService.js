const GameBanner = require("../models/GameBanner");
const CatalogProduct = require("../models/CatalogProduct");
const MediaAsset = require("../models/MediaAsset");
const { normalizeProductCode } = require("../catalog/catalogProjection");
const { CatalogAdminError } = require("./catalogAdminService");
const { assertAssetCategory, projectMediaAsset } = require("./mediaService");

const MAX_SORT_ORDER = 1000000;

class GameBannerError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "GameBannerError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function cleanText(value = "", max = 120) {
    return String(value || "").trim().slice(0, max);
}

function parseBoolean(value, field = "enabled") {
    if (typeof value !== "boolean") {
        throw new GameBannerError("BANNER_PATCH_INVALID", `${field} must be true or false.`);
    }

    return value;
}

function parseSortOrder(value = 0) {
    const order = Number(value ?? 0);

    if (!Number.isInteger(order) || Math.abs(order) > MAX_SORT_ORDER) {
        throw new GameBannerError("BANNER_SORT_ORDER_INVALID", "Sort order must be a finite integer.");
    }

    return order;
}

function parseDate(value, field) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const date = new Date(raw);

    if (Number.isNaN(date.getTime())) {
        throw new GameBannerError("BANNER_SCHEDULE_INVALID", `${field} is invalid.`);
    }

    return date;
}

function parseSchedule(startsAt, endsAt) {
    const start = parseDate(startsAt, "startsAt");
    const end = parseDate(endsAt, "endsAt");

    if (start && end && start.getTime() >= end.getTime()) {
        throw new GameBannerError("BANNER_SCHEDULE_INVALID", "Start date must be before end date.");
    }

    return { startsAt: start, endsAt: end };
}

function parseCtaTarget(value = "") {
    const target = cleanText(value, 300);
    if (!target) return "";

    if (/^\s*(javascript|data|vbscript):/i.test(target)) {
        throw new GameBannerError("BANNER_CTA_INVALID", "CTA target is not allowed.");
    }

    return target;
}

function assertBannerName(value) {
    const name = cleanText(value, 120);

    if (!name || name.length < 2) {
        throw new GameBannerError("BANNER_NAME_INVALID", "Banner name is required.");
    }

    return name;
}

async function assertProduct(productCode) {
    const normalizedProductCode = normalizeProductCode(productCode);
    const product = await CatalogProduct.findOne({ productCode: normalizedProductCode }).lean();

    if (!product) {
        throw new CatalogAdminError("CATALOG_PRODUCT_NOT_FOUND", "Product not found.", 404);
    }

    return product;
}

async function loadMediaMap(banners = []) {
    const ids = Array.from(new Set(banners.map(item => item.mediaAssetId).filter(Boolean)));
    if (!ids.length) return new Map();
    const assets = await MediaAsset.find({ assetId: { $in: ids }, status: "active" }).lean();
    return new Map(assets.map(asset => [asset.assetId, asset]));
}

function isEligibleBanner(banner, now = new Date()) {
    if (banner.deletedAt) return false;
    if (banner.enabled !== true) return false;
    const nowMs = now.getTime();
    const start = banner.startsAt ? new Date(banner.startsAt).getTime() : null;
    const end = banner.endsAt ? new Date(banner.endsAt).getTime() : null;

    if (start && nowMs < start) return false;
    if (end && nowMs >= end) return false;
    return true;
}

function projectPublicBanner(banner = {}, mediaMap = new Map()) {
    const asset = mediaMap.get(banner.mediaAssetId);
    if (!asset) return null;

    return {
        id: String(banner._id || ""),
        productCode: banner.productCode,
        name: banner.name,
        imageUrl: asset.secureUrl || asset.url || "",
        imageAltText: asset.altText || banner.name || "",
        sortOrder: Number(banner.sortOrder || 0),
        ctaLabel: banner.ctaLabel || "",
        ctaTarget: banner.ctaTarget || ""
    };
}

function projectAdminBanner(banner = {}, mediaMap = new Map()) {
    const asset = mediaMap.get(banner.mediaAssetId);

    return {
        id: String(banner._id || ""),
        productCode: banner.productCode,
        name: banner.name,
        mediaAssetId: banner.mediaAssetId,
        mediaAsset: projectMediaAsset(asset),
        enabled: banner.enabled === true,
        deleted: Boolean(banner.deletedAt),
        deletedAt: banner.deletedAt || null,
        sortOrder: Number(banner.sortOrder || 0),
        ctaLabel: banner.ctaLabel || "",
        ctaTarget: banner.ctaTarget || "",
        startsAt: banner.startsAt || null,
        endsAt: banner.endsAt || null,
        createdAt: banner.createdAt || null,
        updatedAt: banner.updatedAt || null
    };
}

function buildBannerPayload(patch = {}, existing = null) {
    const source = existing || {};
    const schedule = parseSchedule(
        Object.prototype.hasOwnProperty.call(patch, "startsAt") ? patch.startsAt : source.startsAt,
        Object.prototype.hasOwnProperty.call(patch, "endsAt") ? patch.endsAt : source.endsAt
    );

    return {
        name: Object.prototype.hasOwnProperty.call(patch, "name")
            ? assertBannerName(patch.name)
            : source.name,
        mediaAssetId: Object.prototype.hasOwnProperty.call(patch, "mediaAssetId")
            ? cleanText(patch.mediaAssetId, 96)
            : source.mediaAssetId,
        enabled: Object.prototype.hasOwnProperty.call(patch, "enabled")
            ? parseBoolean(patch.enabled)
            : source.enabled === true,
        sortOrder: Object.prototype.hasOwnProperty.call(patch, "sortOrder")
            ? parseSortOrder(patch.sortOrder)
            : Number(source.sortOrder || 0),
        ctaLabel: Object.prototype.hasOwnProperty.call(patch, "ctaLabel")
            ? cleanText(patch.ctaLabel, 40)
            : source.ctaLabel || "",
        ctaTarget: Object.prototype.hasOwnProperty.call(patch, "ctaTarget")
            ? parseCtaTarget(patch.ctaTarget)
            : source.ctaTarget || "",
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt
    };
}

async function listAdminBanners(productCode) {
    const product = await assertProduct(productCode);
    const banners = await GameBanner.find({ productCode: product.productCode })
        .sort({ sortOrder: 1, _id: 1 })
        .lean();
    const mediaMap = await loadMediaMap(banners);

    return {
        productCode: product.productCode,
        managed: banners.length > 0,
        banners: banners.map(item => projectAdminBanner(item, mediaMap))
    };
}

async function listPublicBanners(productCode, { now = new Date() } = {}) {
    const product = await assertProduct(productCode);
    const banners = await GameBanner.find({ productCode: product.productCode })
        .sort({ sortOrder: 1, _id: 1 })
        .lean();
    const managed = banners.length > 0;
    const eligible = banners.filter(item => isEligibleBanner(item, now));
    const mediaMap = await loadMediaMap(eligible);

    return {
        productCode: product.productCode,
        managed,
        banners: eligible
            .map(item => projectPublicBanner(item, mediaMap))
            .filter(Boolean)
    };
}

async function createBanner({ productCode, patch = {}, actor = "admin" } = {}) {
    const product = await assertProduct(productCode);
    const payload = buildBannerPayload(patch);

    if (!payload.mediaAssetId) {
        throw new GameBannerError("BANNER_MEDIA_REQUIRED", "Banner image is required.");
    }

    await assertAssetCategory(payload.mediaAssetId, "product_banner");

    const banner = await GameBanner.create({
        productCode: product.productCode,
        ...payload,
        createdBy: actor,
        updatedBy: actor
    });

    return { changed: true, banner: banner.toObject() };
}

async function updateBanner({ productCode, bannerId, patch = {}, actor = "admin" } = {}) {
    const product = await assertProduct(productCode);
    const banner = await GameBanner.findOne({ _id: bannerId, productCode: product.productCode });

    if (!banner) {
        throw new GameBannerError("BANNER_NOT_FOUND", "Banner not found.", 404);
    }

    const payload = buildBannerPayload(patch, banner.toObject());

    if (!payload.mediaAssetId) {
        throw new GameBannerError("BANNER_MEDIA_REQUIRED", "Banner image is required.");
    }

    await assertAssetCategory(payload.mediaAssetId, "product_banner");

    Object.entries(payload).forEach(([key, value]) => {
        banner.set(key, value);
    });
    banner.updatedBy = actor;
    await banner.save();

    return { changed: true, banner: banner.toObject() };
}

async function deleteBanner({ productCode, bannerId, actor = "admin" } = {}) {
    const product = await assertProduct(productCode);
    const banner = await GameBanner.findOne({ _id: bannerId, productCode: product.productCode });

    if (!banner) {
        throw new GameBannerError("BANNER_NOT_FOUND", "Banner not found.", 404);
    }

    if (banner.deletedAt) {
        return { deleted: true, changed: false, bannerId };
    }

    banner.set("metadata.preDeleteEnabled", banner.enabled === true);
    banner.enabled = false;
    banner.deletedAt = new Date();
    banner.deletedBy = actor;
    banner.updatedBy = actor;
    await banner.save();

    return { deleted: true, changed: true, bannerId };
}

async function restoreBanner({ productCode, bannerId, actor = "admin" } = {}) {
    const product = await assertProduct(productCode);
    const banner = await GameBanner.findOne({ _id: bannerId, productCode: product.productCode });

    if (!banner) {
        throw new GameBannerError("BANNER_NOT_FOUND", "Banner not found.", 404);
    }

    if (!banner.deletedAt) {
        return { restored: true, changed: false, bannerId, banner: banner.toObject() };
    }

    banner.enabled = banner.metadata?.preDeleteEnabled !== false;
    banner.deletedAt = null;
    banner.deletedBy = "";
    banner.updatedBy = actor;
    await banner.save();

    return { restored: true, changed: true, bannerId, banner: banner.toObject() };
}

async function reorderBanners({ productCode, orderedIds = [], actor = "admin" } = {}) {
    const product = await assertProduct(productCode);
    const ids = orderedIds.map(id => String(id || "").trim()).filter(Boolean);
    const unique = new Set(ids);

    if (!ids.length || unique.size !== ids.length) {
        throw new GameBannerError("BANNER_REORDER_INVALID", "Banner order contains duplicates or is empty.");
    }

    const banners = await GameBanner.find({ productCode: product.productCode, _id: { $in: ids }, deletedAt: null });

    if (banners.length !== ids.length) {
        throw new GameBannerError("BANNER_REORDER_INVALID", "Banner order includes unknown or foreign banners.");
    }

    await Promise.all(ids.map((id, index) => GameBanner.updateOne(
        { _id: id, productCode: product.productCode },
        { $set: { sortOrder: index + 1, updatedBy: actor } }
    )));

    return listAdminBanners(product.productCode);
}

module.exports = {
    GameBannerError,
    createBanner,
    deleteBanner,
    isEligibleBanner,
    listAdminBanners,
    listPublicBanners,
    parseCtaTarget,
    parseSchedule,
    parseSortOrder,
    reorderBanners,
    restoreBanner,
    updateBanner
};
