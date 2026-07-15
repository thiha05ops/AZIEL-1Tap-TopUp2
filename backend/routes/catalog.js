const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const upload = require("../middleware/imageMemoryUpload");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const {
    CatalogAdminError,
    createPackage,
    updatePackage,
    updateProduct
} = require("../services/catalogAdminService");
const {
    GameBannerError,
    createBanner,
    deleteBanner,
    listAdminBanners,
    listPublicBanners,
    reorderBanners,
    updateBanner
} = require("../services/gameBannerService");
const {
    clearPackageIconAsset,
    clearProductPresentationAsset,
    setPackageIconAsset,
    setProductPresentationAsset
} = require("../services/catalogPresentationService");
const {
    getCatalogProductDetail,
    getCatalogSource,
    normalizeProductCode,
    toPublicCatalog
} = require("../services/catalogService");
const {
    MediaError,
    createAsset,
    deleteAsset,
    getAsset,
    listAssets,
    projectMediaAsset
} = require("../services/mediaService");
const { StorageError } = require("../services/storageService");

function sendAdminCatalogError(res, error) {
    if (error instanceof CatalogAdminError || error instanceof MediaError || error instanceof StorageError || error instanceof GameBannerError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.log("Admin catalog mutation error:", error?.code || error?.name || "CATALOG_MUTATION_FAILED");

    return res.status(500).json({
        success: false,
        code: "CATALOG_MUTATION_FAILED",
        message: "Catalog update failed"
    });
}

function projectSource() {
    return {
        source: getCatalogSource()
    };
}

function projectAdminSource() {
    return {
        source: "database",
        activeSource: getCatalogSource()
    };
}

router.get("/catalog", async (req, res) => {
    try {
        const products = await toPublicCatalog({ includeDisabled: false });

        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            ...projectSource(),
            products
        });
    } catch (error) {
        console.log("Public catalog error:", error?.code || error?.name || "CATALOG_ERROR");

        return res.status(500).json({
            success: false,
            message: "Catalog data unavailable"
        });
    }
});

router.get("/catalog/:productCode/banners", async (req, res) => {
    try {
        const result = await listPublicBanners(req.params.productCode);

        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.log("Public catalog banners error:", error?.code || error?.name || "BANNER_ERROR");

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode === 404 ? error.message : "Banner data unavailable"
        });
    }
});

router.get("/catalog/:productCode", async (req, res) => {
    try {
        const product = await getCatalogProductDetail(req.params.productCode, { includeDisabled: false });

        res.set("Cache-Control", "no-store");
        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        return res.json({
            success: true,
            ...projectSource(),
            product
        });
    } catch (error) {
        console.log("Public catalog detail error:", error?.code || error?.name || "CATALOG_ERROR");

        return res.status(500).json({
            success: false,
            message: "Catalog data unavailable"
        });
    }
});

router.get("/admin/catalog/products", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_READ), async (req, res) => {
    try {
        const products = await toPublicCatalog({
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            ...projectAdminSource(),
            products: products.map(product => ({
                productCode: product.productCode,
                name: product.name,
                enabled: product.enabled,
                supportedRegions: product.supportedRegions,
                packageCount: product.packageCount,
                sortOrder: product.sortOrder,
                imageUrl: product.imageUrl || "",
                bannerUrl: product.bannerUrl || "",
                mobilePackagePreviewUrl: product.mobilePackagePreviewUrl || "",
                imageAsset: product.imageAsset || null,
                bannerAsset: product.bannerAsset || null,
                mobilePackagePreviewAsset: product.mobilePackagePreviewAsset || null,
                updatedAt: product.updatedAt
            }))
        });
    } catch (error) {
        console.log("Admin catalog products error:", error?.code || error?.name || "CATALOG_ERROR");

        return res.status(500).json({
            success: false,
            message: "Catalog data unavailable"
        });
    }
});

router.get("/admin/catalog/products/:productCode", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_READ), async (req, res) => {
    try {
        const productCode = normalizeProductCode(req.params.productCode);
        const product = await getCatalogProductDetail(productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        return res.json({
            success: true,
            ...projectAdminSource(),
            product
        });
    } catch (error) {
        console.log("Admin catalog product error:", error?.code || error?.name || "CATALOG_ERROR");

        return res.status(500).json({
            success: false,
            message: "Catalog data unavailable"
        });
    }
});

router.get("/admin/catalog/products/:productCode/packages", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_READ), async (req, res) => {
    try {
        const productCode = normalizeProductCode(req.params.productCode);
        const product = await getCatalogProductDetail(productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        return res.json({
            success: true,
            ...projectAdminSource(),
            productCode: product.productCode,
            packages: product.packages
        });
    } catch (error) {
        console.log("Admin catalog packages error:", error?.code || error?.name || "CATALOG_ERROR");

        return res.status(500).json({
            success: false,
            message: "Catalog data unavailable"
        });
    }
});

router.patch("/admin/catalog/products/:productCode", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        const result = await updateProduct({
            productCode: req.params.productCode,
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.product.productCode, {
            source: "database",
            includeDisabled: true
        });
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.CATALOG_PRODUCT_UPDATED,
            resourceType: "CatalogProduct",
            resourceId: result.product.productCode,
            metadata: { changedFields: result.changedFields || [] }
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.patch("/admin/catalog/products/:productCode/packages/:packageCode", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        const result = await updatePackage({
            productCode: req.params.productCode,
            packageCode: req.params.packageCode,
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.package.productCode, {
            source: "database",
            includeDisabled: true
        });
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.CATALOG_PACKAGE_UPDATED,
            resourceType: "CatalogPackage",
            resourceId: `${result.package.productCode}:${result.package.packageCode}`,
            metadata: { changedFields: result.changedFields || [] }
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product,
            package: product?.packages?.find(item => item.packageCode === result.package.packageCode) || null
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.post("/admin/catalog/products/:productCode/packages", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        const result = await createPackage({
            productCode: req.params.productCode,
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.package.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.CATALOG_PACKAGE_CREATED,
            resourceType: "CatalogPackage",
            resourceId: `${result.package.productCode}:${result.package.packageCode}`,
            metadata: { productCode: result.package.productCode }
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.status(201).json({
            success: true,
            changed: result.changed,
            ...projectAdminSource(),
            product,
            package: product?.packages?.find(item => item.packageCode === result.package.packageCode) || null
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.get("/admin/catalog/products/:productCode/banners", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_READ), async (req, res) => {
    try {
        const result = await listAdminBanners(req.params.productCode);
        return res.json({ success: true, ...projectAdminSource(), ...result });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.post("/admin/catalog/products/:productCode/banners", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        const result = await createBanner({
            productCode: req.params.productCode,
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const banners = await listAdminBanners(req.params.productCode);
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.GAME_BANNER_CREATED,
            resourceType: "GameBanner",
            resourceId: String(result.banner?._id || result.banner?.id || ""),
            metadata: { productCode: req.params.productCode }
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.status(201).json({
            success: true,
            changed: result.changed,
            ...projectAdminSource(),
            ...banners
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.patch("/admin/catalog/products/:productCode/banners/:bannerId", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        await updateBanner({
            productCode: req.params.productCode,
            bannerId: req.params.bannerId,
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const banners = await listAdminBanners(req.params.productCode);
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.GAME_BANNER_UPDATED,
            resourceType: "GameBanner",
            resourceId: req.params.bannerId,
            metadata: { productCode: req.params.productCode }
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({ success: true, changed: true, ...projectAdminSource(), ...banners });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.delete("/admin/catalog/products/:productCode/banners/:bannerId", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        const result = await deleteBanner({
            productCode: req.params.productCode,
            bannerId: req.params.bannerId
        });
        const banners = await listAdminBanners(req.params.productCode);
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.GAME_BANNER_REMOVED,
            resourceType: "GameBanner",
            resourceId: req.params.bannerId,
            metadata: { productCode: req.params.productCode }
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({ success: true, ...result, ...projectAdminSource(), ...banners });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.put("/admin/catalog/products/:productCode/banners/order", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        const result = await reorderBanners({
            productCode: req.params.productCode,
            orderedIds: req.body?.orderedIds || [],
            actor: req.admin?.username || "admin"
        });
        return res.json({ success: true, changed: true, ...projectAdminSource(), ...result });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.get("/admin/media", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_READ), async (req, res) => {
    try {
        const result = await listAssets({
            category: req.query.category,
            q: req.query.q,
            page: req.query.page,
            limit: req.query.limit
        });

        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.post("/admin/media", adminMiddleware, upload.single("file"), requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const asset = await createAsset({
            file: req.file,
            name: req.body?.name,
            category: req.body?.category,
            altText: req.body?.altText,
            actor: req.admin?.username || "admin"
        });
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.MEDIA_UPLOADED,
            resourceType: "MediaAsset",
            resourceId: asset.assetId || asset.id || "",
            metadata: { category: asset.category }
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.status(201).json({
            success: true,
            asset
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.get("/admin/media/:assetId", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_READ), async (req, res) => {
    try {
        const asset = await getAsset(req.params.assetId);

        return res.json({
            success: true,
            asset: projectMediaAsset(asset)
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.delete("/admin/media/:assetId", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await deleteAsset(req.params.assetId, {
            actor: req.admin?.username || "admin"
        });
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.MEDIA_REMOVED,
            resourceType: "MediaAsset",
            resourceId: req.params.assetId
        }).catch(error => console.log("Admin audit failed:", error.message));

        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.patch("/admin/catalog/products/:productCode/presentation/image", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await setProductPresentationAsset({
            productCode: req.params.productCode,
            assetId: req.body?.assetId,
            expectedUpdatedAt: req.body?.expectedUpdatedAt,
            slot: "image",
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.product.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.delete("/admin/catalog/products/:productCode/presentation/image", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await clearProductPresentationAsset({
            productCode: req.params.productCode,
            expectedUpdatedAt: req.body?.expectedUpdatedAt || req.query.expectedUpdatedAt,
            slot: "image",
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.product.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.patch("/admin/catalog/products/:productCode/presentation/banner", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await setProductPresentationAsset({
            productCode: req.params.productCode,
            assetId: req.body?.assetId,
            expectedUpdatedAt: req.body?.expectedUpdatedAt,
            slot: "banner",
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.product.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.delete("/admin/catalog/products/:productCode/presentation/banner", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await clearProductPresentationAsset({
            productCode: req.params.productCode,
            expectedUpdatedAt: req.body?.expectedUpdatedAt || req.query.expectedUpdatedAt,
            slot: "banner",
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.product.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.patch("/admin/catalog/products/:productCode/presentation/mobile-package-preview", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await setProductPresentationAsset({
            productCode: req.params.productCode,
            assetId: req.body?.assetId,
            expectedUpdatedAt: req.body?.expectedUpdatedAt,
            slot: "mobilePackagePreview",
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.product.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.delete("/admin/catalog/products/:productCode/presentation/mobile-package-preview", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await clearProductPresentationAsset({
            productCode: req.params.productCode,
            expectedUpdatedAt: req.body?.expectedUpdatedAt || req.query.expectedUpdatedAt,
            slot: "mobilePackagePreview",
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.product.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.patch("/admin/catalog/products/:productCode/packages/:packageCode/presentation/icon", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await setPackageIconAsset({
            productCode: req.params.productCode,
            packageCode: req.params.packageCode,
            assetId: req.body?.assetId,
            expectedUpdatedAt: req.body?.expectedUpdatedAt,
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.package.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product,
            package: product?.packages?.find(item => item.packageCode === result.package.packageCode) || null
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.delete("/admin/catalog/products/:productCode/packages/:packageCode/presentation/icon", adminMiddleware, requireAdminPermission(PERMISSIONS.MEDIA_MANAGE), async (req, res) => {
    try {
        const result = await clearPackageIconAsset({
            productCode: req.params.productCode,
            packageCode: req.params.packageCode,
            expectedUpdatedAt: req.body?.expectedUpdatedAt || req.query.expectedUpdatedAt,
            actor: req.admin?.username || "admin"
        });
        const product = await getCatalogProductDetail(result.package.productCode, {
            source: "database",
            includeDisabled: true,
            includeAssetProjection: true
        });

        return res.json({
            success: true,
            changed: result.changed,
            unchanged: !result.changed,
            ...projectAdminSource(),
            product,
            package: product?.packages?.find(item => item.packageCode === result.package.packageCode) || null
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

module.exports = router;
