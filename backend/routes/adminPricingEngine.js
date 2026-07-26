"use strict";

const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const {
    AdminPricingEngineError,
    getPricingConsoleState,
    publishPricing,
    saveDraftPricing
} = require("../services/commerce/adminPricingEngineService");

function sendPricingError(res, error) {
    if (error instanceof AdminPricingEngineError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.log("Admin pricing engine error:", error?.code || error?.name || "PRICING_ENGINE_FAILED");
    return res.status(500).json({
        success: false,
        code: "PRICING_ENGINE_FAILED",
        message: "Pricing Engine request failed"
    });
}

function requireOwner(req, res, next) {
    if (String(req.admin?.role || "").toUpperCase() === "OWNER") return next();
    return res.status(403).json({
        success: false,
        code: "OWNER_REQUIRED",
        message: "Only the OWNER can publish production pricing."
    });
}

router.get("/admin/pricing-engine", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_READ), async (req, res) => {
    try {
        const state = await getPricingConsoleState();
        return res.json({ success: true, ...state });
    } catch (error) {
        return sendPricingError(res, error);
    }
});

router.put("/admin/pricing-engine/draft", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), async (req, res) => {
    try {
        const result = await saveDraftPricing(req.body || {}, req.admin || {});
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PRICING_DRAFT_SAVED,
            resourceType: "PricingPolicy",
            resourceId: "production-draft",
            metadata: {
                policies: result.saved.map(policy => ({
                    region: policy.region,
                    currency: policy.currency,
                    policyId: policy.id
                }))
            }
        });
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendPricingError(res, error);
    }
});

router.post("/admin/pricing-engine/publish", adminMiddleware, requireAdminPermission(PERMISSIONS.CATALOG_MANAGE), requireOwner, async (req, res) => {
    try {
        const result = await publishPricing(req.admin || {});
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PRICING_PUBLISHED,
            resourceType: "PriceVersion",
            resourceId: result.version.versionId,
            metadata: {
                pricingVersion: result.version.versionNumber,
                publishedAt: result.version.publishedAt,
                publishedBy: result.version.publishedBy,
                oldValues: result.oldValues,
                newValues: result.newValues
            }
        });
        return res.json({
            success: true,
            version: {
                versionId: result.version.versionId,
                versionNumber: result.version.versionNumber,
                status: result.version.status,
                publishedAt: result.version.publishedAt,
                publishedBy: result.version.publishedBy
            },
            state: result.state
        });
    } catch (error) {
        return sendPricingError(res, error);
    }
});

module.exports = router;
