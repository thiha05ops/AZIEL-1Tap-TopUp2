const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const {
    CampaignError,
    claimEntryPopup,
    createCampaign,
    listAdminCampaigns,
    removeCampaign,
    updateCampaign
} = require("../services/campaignService");
const { GameBannerError } = require("../services/gameBannerService");
const { MediaError } = require("../services/mediaService");

function sendCampaignError(res, error) {
    if (error instanceof CampaignError || error instanceof MediaError || error instanceof GameBannerError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.log("Campaign error:", error?.code || error?.name || "CAMPAIGN_ERROR");

    return res.status(500).json({
        success: false,
        code: "CAMPAIGN_ERROR",
        message: "Campaign operation failed"
    });
}

router.get("/admin/campaigns", adminMiddleware, requireAdminPermission(PERMISSIONS.CAMPAIGNS_READ), async (req, res) => {
    try {
        const result = await listAdminCampaigns();
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendCampaignError(res, error);
    }
});

router.post("/admin/campaigns", adminMiddleware, requireAdminPermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (req, res) => {
    try {
        const result = await createCampaign({
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const campaigns = await listAdminCampaigns();
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.CAMPAIGN_CREATED,
            resourceType: "Campaign",
            metadata: { changed: result.changed }
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.status(201).json({ success: true, changed: result.changed, ...campaigns });
    } catch (error) {
        return sendCampaignError(res, error);
    }
});

router.patch("/admin/campaigns/:campaignId", adminMiddleware, requireAdminPermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (req, res) => {
    try {
        await updateCampaign({
            campaignId: req.params.campaignId,
            patch: req.body || {},
            actor: req.admin?.username || "admin"
        });
        const campaigns = await listAdminCampaigns();
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.CAMPAIGN_UPDATED,
            resourceType: "Campaign",
            resourceId: req.params.campaignId
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({ success: true, changed: true, ...campaigns });
    } catch (error) {
        return sendCampaignError(res, error);
    }
});

router.delete("/admin/campaigns/:campaignId", adminMiddleware, requireAdminPermission(PERMISSIONS.CAMPAIGNS_MANAGE), async (req, res) => {
    try {
        const result = await removeCampaign({
            campaignId: req.params.campaignId,
            actor: req.admin?.username || "admin"
        });
        const campaigns = await listAdminCampaigns();
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.CAMPAIGN_REMOVED,
            resourceType: "Campaign",
            resourceId: req.params.campaignId
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({ success: true, ...result, ...campaigns });
    } catch (error) {
        return sendCampaignError(res, error);
    }
});

router.post("/campaigns/entry-popup/claim", optionalAuthMiddleware, async (req, res) => {
    try {
        const result = await claimEntryPopup({
            region: req.body?.region,
            user: req.user || null,
            sessionKey: req.body?.sessionKey
        });

        res.set("Cache-Control", "no-store");
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendCampaignError(res, error);
    }
});

module.exports = router;
