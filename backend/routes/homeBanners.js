const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const {
    GameBannerError
} = require("../services/gameBannerService");
const {
    HomeBannerError,
    createHomeBanner,
    deleteHomeBanner,
    listAdminHomeBanners,
    listPublicHomeBanners,
    reorderHomeBanners,
    updateHomeBanner
} = require("../services/homeBannerService");
const { MediaError } = require("../services/mediaService");

function sendHomeBannerError(res, error) {
    if (error instanceof HomeBannerError || error instanceof GameBannerError || error instanceof MediaError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.log("Home banner error:", error?.code || error?.name || "HOME_BANNER_ERROR");

    return res.status(500).json({
        success: false,
        code: "HOME_BANNER_ERROR",
        message: "Home banner update failed"
    });
}

router.get("/home/banners", async (req, res) => {
    try {
        const result = await listPublicHomeBanners();

        res.set("Cache-Control", "no-store");
        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.log("Public home banners error:", error?.code || error?.name || "HOME_BANNER_ERROR");

        return res.status(500).json({
            success: false,
            message: "Home banner data unavailable"
        });
    }
});

router.get("/admin/home-banners", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const result = await listAdminHomeBanners();
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendHomeBannerError(res, error);
    }
});

router.post("/admin/home-banners", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_MANAGE), async (req, res) => {
    try {
        const result = await createHomeBanner({
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const banners = await listAdminHomeBanners();
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.HOME_BANNER_CREATED,
            resourceType: "HomeBanner",
            resourceId: String(result.banner?.id || result.banner?._id || "")
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.status(201).json({ success: true, changed: result.changed, ...banners });
    } catch (error) {
        return sendHomeBannerError(res, error);
    }
});

router.patch("/admin/home-banners/:bannerId", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_MANAGE), async (req, res) => {
    try {
        await updateHomeBanner({
            bannerId: req.params.bannerId,
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const banners = await listAdminHomeBanners();
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.HOME_BANNER_UPDATED,
            resourceType: "HomeBanner",
            resourceId: req.params.bannerId
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({ success: true, changed: true, ...banners });
    } catch (error) {
        return sendHomeBannerError(res, error);
    }
});

router.delete("/admin/home-banners/:bannerId", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_MANAGE), async (req, res) => {
    try {
        const result = await deleteHomeBanner({
            bannerId: req.params.bannerId,
            actor: req.admin?.username || "admin"
        });
        const banners = await listAdminHomeBanners();
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.HOME_BANNER_REMOVED,
            resourceType: "HomeBanner",
            resourceId: req.params.bannerId
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({ success: true, ...result, ...banners });
    } catch (error) {
        return sendHomeBannerError(res, error);
    }
});

router.put("/admin/home-banners/order", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_MANAGE), async (req, res) => {
    try {
        const result = await reorderHomeBanners({
            orderedIds: req.body?.orderedIds || [],
            actor: req.admin?.username || "admin"
        });
        return res.json({ success: true, changed: true, ...result });
    } catch (error) {
        return sendHomeBannerError(res, error);
    }
});

module.exports = router;
