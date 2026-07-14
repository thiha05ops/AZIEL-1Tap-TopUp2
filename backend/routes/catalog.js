const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const upload = require("../middleware/imageMemoryUpload");
const {
    CatalogAdminError,
    updatePackage,
    updateProduct
} = require("../services/catalogAdminService");
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
    if (error instanceof CatalogAdminError || error instanceof MediaError || error instanceof StorageError) {
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

router.get("/admin/catalog/products", adminMiddleware, async (req, res) => {
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
                imageAsset: product.imageAsset || null,
                bannerAsset: product.bannerAsset || null,
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

router.get("/admin/catalog/products/:productCode", adminMiddleware, async (req, res) => {
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

router.get("/admin/catalog/products/:productCode/packages", adminMiddleware, async (req, res) => {
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

router.patch("/admin/catalog/products/:productCode", adminMiddleware, async (req, res) => {
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

router.patch("/admin/catalog/products/:productCode/packages/:packageCode", adminMiddleware, async (req, res) => {
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

router.get("/admin/media", adminMiddleware, async (req, res) => {
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

router.post("/admin/media", adminMiddleware, upload.single("file"), async (req, res) => {
    try {
        const asset = await createAsset({
            file: req.file,
            name: req.body?.name,
            category: req.body?.category,
            altText: req.body?.altText,
            actor: req.admin?.username || "admin"
        });

        return res.status(201).json({
            success: true,
            asset
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.get("/admin/media/:assetId", adminMiddleware, async (req, res) => {
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

router.delete("/admin/media/:assetId", adminMiddleware, async (req, res) => {
    try {
        const result = await deleteAsset(req.params.assetId, {
            actor: req.admin?.username || "admin"
        });

        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return sendAdminCatalogError(res, error);
    }
});

router.patch("/admin/catalog/products/:productCode/presentation/image", adminMiddleware, async (req, res) => {
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

router.delete("/admin/catalog/products/:productCode/presentation/image", adminMiddleware, async (req, res) => {
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

router.patch("/admin/catalog/products/:productCode/presentation/banner", adminMiddleware, async (req, res) => {
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

router.delete("/admin/catalog/products/:productCode/presentation/banner", adminMiddleware, async (req, res) => {
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

router.patch("/admin/catalog/products/:productCode/packages/:packageCode/presentation/icon", adminMiddleware, async (req, res) => {
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

router.delete("/admin/catalog/products/:productCode/packages/:packageCode/presentation/icon", adminMiddleware, async (req, res) => {
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
