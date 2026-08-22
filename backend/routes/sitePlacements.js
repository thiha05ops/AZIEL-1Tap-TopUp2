const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const {
    SitePlacementError,
    getAdminPlacement,
    listAdminPlacements,
    updateAdminPlacement
} = require("../services/sitePlacementService");

function sendSitePlacementError(res, error) {
    if (error instanceof SitePlacementError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.log("Site placement error:", error?.code || error?.name || "SITE_PLACEMENT_FAILED");
    return res.status(500).json({
        success: false,
        code: "SITE_PLACEMENT_FAILED",
        message: "Site placement data unavailable."
    });
}

router.get("/admin/site-placements", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const placements = await listAdminPlacements();
        return res.json({
            success: true,
            placements
        });
    } catch (error) {
        return sendSitePlacementError(res, error);
    }
});

router.get("/admin/site-placements/:placementCode", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_READ), async (req, res) => {
    try {
        const result = await getAdminPlacement(req.params.placementCode);
        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return sendSitePlacementError(res, error);
    }
});

router.put("/admin/site-placements/:placementCode", adminMiddleware, requireAdminPermission(PERMISSIONS.SITE_CONTENT_MANAGE), async (req, res) => {
    try {
        const result = await updateAdminPlacement(
            req.params.placementCode,
            req.body || {},
            req.admin?.username || req.user?.username || "admin"
        );
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.SITE_PLACEMENT_UPDATED,
            resourceType: "SitePlacement",
            resourceId: result.placement?.placementCode || req.params.placementCode,
            metadata: {
                placementCode: result.placement?.placementCode || req.params.placementCode,
                nextItemCount: result.placement?.items?.length || 0
            }
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({
            success: true,
            ...result
        });
    } catch (error) {
        return sendSitePlacementError(res, error);
    }
});

module.exports = router;
