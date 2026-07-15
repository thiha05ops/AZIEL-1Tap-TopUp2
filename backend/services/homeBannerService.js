const HomeBanner = require("../models/HomeBanner");
const HomeBannerState = require("../models/HomeBannerState");
const MediaAsset = require("../models/MediaAsset");
const {
    isEligibleBanner,
    parseCtaTarget,
    parseSchedule,
    parseSortOrder
} = require("./gameBannerService");
const { assertAssetCategory, projectMediaAsset } = require("./mediaService");

const HOME_BANNER_STATE_KEY = "home_banners";

class HomeBannerError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "HomeBannerError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function cleanText(value = "", max = 120) {
    return String(value || "").trim().slice(0, max);
}

function parseBoolean(value, field = "enabled") {
    if (typeof value !== "boolean") {
        throw new HomeBannerError("HOME_BANNER_PATCH_INVALID", `${field} must be true or false.`);
    }

    return value;
}

function assertBannerName(value) {
    const name = cleanText(value, 120);

    if (!name || name.length < 2) {
        throw new HomeBannerError("HOME_BANNER_NAME_INVALID", "Banner name is required.");
    }

    return name;
}

async function markHomeBannersManaged(actor = "admin") {
    const now = new Date();

    await HomeBannerState.updateOne(
        { key: HOME_BANNER_STATE_KEY },
        {
            $set: {
                managed: true,
                managedAt: now,
                updatedBy: cleanText(actor, "admin")
            },
            $setOnInsert: {
                key: HOME_BANNER_STATE_KEY
            }
        },
        { upsert: true }
    );
}

async function getManagedState() {
    const state = await HomeBannerState.findOne({ key: HOME_BANNER_STATE_KEY }).lean();
    return state?.managed === true;
}

async function loadMediaMap(banners = []) {
    const ids = Array.from(new Set(banners.map(item => item.mediaAssetId).filter(Boolean)));
    if (!ids.length) return new Map();
    const assets = await MediaAsset.find({ assetId: { $in: ids }, status: "active" }).lean();
    return new Map(assets.map(asset => [asset.assetId, asset]));
}

function projectPublicHomeBanner(banner = {}, mediaMap = new Map()) {
    const asset = mediaMap.get(banner.mediaAssetId);
    if (!asset) return null;

    return {
        id: String(banner._id || ""),
        name: banner.name,
        imageUrl: asset.secureUrl || asset.url || "",
        imageAltText: asset.altText || banner.name || "AZIEL home banner",
        sortOrder: Number(banner.sortOrder || 0),
        ctaLabel: banner.ctaLabel || "",
        ctaTarget: banner.ctaTarget || ""
    };
}

function projectAdminHomeBanner(banner = {}, mediaMap = new Map()) {
    const asset = mediaMap.get(banner.mediaAssetId);

    return {
        id: String(banner._id || ""),
        name: banner.name,
        mediaAssetId: banner.mediaAssetId,
        mediaAsset: projectMediaAsset(asset),
        enabled: banner.enabled === true,
        sortOrder: Number(banner.sortOrder || 0),
        ctaLabel: banner.ctaLabel || "",
        ctaTarget: banner.ctaTarget || "",
        startsAt: banner.startsAt || null,
        endsAt: banner.endsAt || null,
        createdAt: banner.createdAt || null,
        updatedAt: banner.updatedAt || null
    };
}

function buildHomeBannerPayload(patch = {}, existing = null) {
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

async function listAdminHomeBanners() {
    const banners = await HomeBanner.find({})
        .sort({ sortOrder: 1, _id: 1 })
        .lean();
    const mediaMap = await loadMediaMap(banners);
    const managed = await getManagedState();

    return {
        managed: managed || banners.length > 0,
        banners: banners.map(item => projectAdminHomeBanner(item, mediaMap))
    };
}

async function listPublicHomeBanners({ now = new Date() } = {}) {
    const banners = await HomeBanner.find({})
        .sort({ sortOrder: 1, _id: 1 })
        .lean();
    const managed = await getManagedState();

    if (!managed && banners.length === 0) {
        return {
            managed: false,
            banners: []
        };
    }

    const eligible = banners.filter(item => isEligibleBanner(item, now));
    const mediaMap = await loadMediaMap(eligible);

    return {
        managed: true,
        banners: eligible
            .map(item => projectPublicHomeBanner(item, mediaMap))
            .filter(Boolean)
    };
}

async function createHomeBanner({ patch = {}, actor = "admin" } = {}) {
    const payload = buildHomeBannerPayload(patch);

    if (!payload.mediaAssetId) {
        throw new HomeBannerError("HOME_BANNER_MEDIA_REQUIRED", "Banner image is required.");
    }

    await assertAssetCategory(payload.mediaAssetId, "home_banner");

    const banner = await HomeBanner.create({
        ...payload,
        createdBy: actor,
        updatedBy: actor
    });
    await markHomeBannersManaged(actor);

    return { changed: true, banner: banner.toObject() };
}

async function updateHomeBanner({ bannerId, patch = {}, actor = "admin" } = {}) {
    const banner = await HomeBanner.findOne({ _id: bannerId });

    if (!banner) {
        throw new HomeBannerError("HOME_BANNER_NOT_FOUND", "Banner not found.", 404);
    }

    const payload = buildHomeBannerPayload(patch, banner.toObject());

    if (!payload.mediaAssetId) {
        throw new HomeBannerError("HOME_BANNER_MEDIA_REQUIRED", "Banner image is required.");
    }

    await assertAssetCategory(payload.mediaAssetId, "home_banner");

    Object.entries(payload).forEach(([key, value]) => {
        banner.set(key, value);
    });
    banner.updatedBy = actor;
    await banner.save();
    await markHomeBannersManaged(actor);

    return { changed: true, banner: banner.toObject() };
}

async function deleteHomeBanner({ bannerId, actor = "admin" } = {}) {
    const result = await HomeBanner.deleteOne({ _id: bannerId });

    if (!result.deletedCount) {
        throw new HomeBannerError("HOME_BANNER_NOT_FOUND", "Banner not found.", 404);
    }

    await markHomeBannersManaged(actor);

    return { deleted: true, bannerId };
}

async function reorderHomeBanners({ orderedIds = [], actor = "admin" } = {}) {
    const ids = orderedIds.map(id => String(id || "").trim()).filter(Boolean);
    const unique = new Set(ids);

    if (!ids.length || unique.size !== ids.length) {
        throw new HomeBannerError("HOME_BANNER_REORDER_INVALID", "Banner order contains duplicates or is empty.");
    }

    const banners = await HomeBanner.find({ _id: { $in: ids } });

    if (banners.length !== ids.length) {
        throw new HomeBannerError("HOME_BANNER_REORDER_INVALID", "Banner order includes unknown banners.");
    }

    await Promise.all(ids.map((id, index) => HomeBanner.updateOne(
        { _id: id },
        { $set: { sortOrder: index + 1, updatedBy: actor } }
    )));
    await markHomeBannersManaged(actor);

    return listAdminHomeBanners();
}

module.exports = {
    HomeBannerError,
    createHomeBanner,
    deleteHomeBanner,
    listAdminHomeBanners,
    listPublicHomeBanners,
    reorderHomeBanners,
    updateHomeBanner
};
