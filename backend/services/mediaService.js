const crypto = require("crypto");

const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const MediaAsset = require("../models/MediaAsset");
const {
    cleanupAfterFailedPersistence,
    deleteFile,
    toReference,
    uploadFile
} = require("./storageService");

const MEDIA_CATEGORIES = Object.freeze([
    "product_image",
    "product_banner",
    "package_icon",
    "campaign",
    "promotion",
    "announcement",
    "other"
]);

const PUBLIC_PRESENTATION_CATEGORIES = new Set([
    "product_image",
    "product_banner",
    "package_icon"
]);

class MediaError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "MediaError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizeCategory(category) {
    const value = String(category || "").trim().toLowerCase();

    if (!MEDIA_CATEGORIES.includes(value)) {
        throw new MediaError("MEDIA_CATEGORY_INVALID", "Media category is invalid.");
    }

    return value;
}

function cleanText(value, fallback = "") {
    const text = String(value || "").trim();
    return text || fallback;
}

function createAssetId() {
    return `media_${crypto.randomBytes(12).toString("hex")}`;
}

function projectMediaAsset(asset = {}) {
    if (!asset) return null;

    return {
        assetId: asset.assetId,
        name: asset.name,
        category: asset.category,
        altText: asset.altText || "",
        url: asset.secureUrl || asset.url || "",
        secureUrl: asset.secureUrl || asset.url || "",
        mimeType: asset.mimeType || "",
        sizeBytes: Number(asset.sizeBytes || 0),
        originalName: asset.originalName || "",
        status: asset.status || "active",
        createdAt: asset.createdAt || null,
        updatedAt: asset.updatedAt || null
    };
}

function projectPublicMediaAsset(asset = {}) {
    if (!asset || asset.status === "deleted") return null;
    if (!PUBLIC_PRESENTATION_CATEGORIES.has(asset.category)) return null;

    return {
        assetId: asset.assetId,
        url: asset.secureUrl || asset.url || "",
        altText: asset.altText || "",
        category: asset.category
    };
}

async function createAsset({
    file,
    name,
    category,
    altText = "",
    actor = "admin",
    deps = {}
} = {}) {
    const normalizedCategory = normalizeCategory(category);
    const uploader = deps.uploadFile || uploadFile;
    const creator = deps.createMediaAsset || (payload => MediaAsset.create(payload));
    const cleaner = deps.cleanupAfterFailedPersistence || cleanupAfterFailedPersistence;
    const reference = await uploader({
        file,
        category: "mediaAsset",
        ownerReference: normalizedCategory
    });

    try {
        const asset = await creator({
            assetId: createAssetId(),
            name: cleanText(name, reference.originalName || "Media asset"),
            category: normalizedCategory,
            altText: cleanText(altText),
            storageProvider: reference.provider || "",
            storageKey: reference.key || "",
            publicId: reference.key || "",
            url: reference.url || "",
            secureUrl: reference.url || "",
            mimeType: reference.mimeType || "",
            sizeBytes: Number(reference.size || 0),
            originalName: reference.originalName || "",
            uploadedBy: cleanText(actor, "admin"),
            status: "active"
        });

        return projectMediaAsset(asset.toObject ? asset.toObject() : asset);
    } catch (error) {
        await cleaner(reference);
        throw error;
    }
}

async function listAssets({ category = "", q = "", page = 1, limit = 50 } = {}) {
    const query = { status: "active" };
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const normalizedPage = Math.max(1, Number(page) || 1);

    if (category) query.category = normalizeCategory(category);

    const search = cleanText(q);
    if (search) {
        query.$or = [
            { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
            { altText: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
            { originalName: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }
        ];
    }

    const [items, total] = await Promise.all([
        MediaAsset.find(query)
            .sort({ createdAt: -1 })
            .skip((normalizedPage - 1) * normalizedLimit)
            .limit(normalizedLimit)
            .lean(),
        MediaAsset.countDocuments(query)
    ]);

    return {
        assets: items.map(projectMediaAsset),
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        pages: Math.max(1, Math.ceil(total / normalizedLimit))
    };
}

async function getAsset(assetId, { requireActive = true } = {}) {
    const id = cleanText(assetId);
    if (!id) throw new MediaError("MEDIA_ASSET_REQUIRED", "Media asset is required.");

    const asset = await MediaAsset.findOne({ assetId: id }).lean();

    if (!asset || (requireActive && asset.status !== "active")) {
        throw new MediaError("MEDIA_ASSET_NOT_FOUND", "Media asset not found.", 404);
    }

    return asset;
}

async function assertAssetCategory(assetId, expectedCategory) {
    const asset = await getAsset(assetId);
    const category = normalizeCategory(expectedCategory);

    if (asset.category !== category) {
        throw new MediaError(
            "MEDIA_CATEGORY_MISMATCH",
            `Selected media must be ${category.replace(/_/g, " ")}.`
        );
    }

    return asset;
}

async function getAssetReferenceCounts(assetId) {
    const [productImages, productBanners, packageIcons] = await Promise.all([
        CatalogProduct.countDocuments({ "presentation.imageAssetId": assetId }),
        CatalogProduct.countDocuments({ "presentation.bannerAssetId": assetId }),
        CatalogPackage.countDocuments({ iconAssetId: assetId })
    ]);

    return {
        productImages,
        productBanners,
        packageIcons,
        total: productImages + productBanners + packageIcons
    };
}

async function deleteAsset(assetId, { actor = "admin" } = {}) {
    const asset = await getAsset(assetId);
    const references = await getAssetReferenceCounts(asset.assetId);

    if (references.total > 0) {
        throw new MediaError(
            "MEDIA_ASSET_IN_USE",
            "This media asset is attached to catalog content and cannot be deleted.",
            409
        );
    }

    await deleteFile(toReference({
        provider: asset.storageProvider,
        key: asset.storageKey,
        url: asset.secureUrl || asset.url,
        mimeType: asset.mimeType,
        size: asset.sizeBytes,
        originalName: asset.originalName
    }));

    await MediaAsset.updateOne(
        { assetId: asset.assetId },
        {
            $set: {
                status: "deleted",
                "metadata.deletedBy": cleanText(actor, "admin"),
                "metadata.deletedAt": new Date()
            }
        }
    );

    return { deleted: true, assetId: asset.assetId };
}

module.exports = {
    MEDIA_CATEGORIES,
    MediaError,
    assertAssetCategory,
    createAsset,
    deleteAsset,
    getAsset,
    listAssets,
    projectMediaAsset,
    projectPublicMediaAsset
};
