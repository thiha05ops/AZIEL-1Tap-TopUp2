const express = require("express");
const router = express.Router();

const adminMiddleware = require("../middleware/adminMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const { PERMISSIONS, requireAdminPermission } = require("../services/adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("../services/adminAuditService");
const {
    PromoError,
    archivePromo,
    createPromo,
    listAdminPromos,
    publicQuote,
    resolvePurchasePricing,
    updatePromo
} = require("../services/promoCodeService");
const { CatalogError } = require("../services/catalogService");

function sendPromoError(res, error) {
    if (error instanceof PromoError || error instanceof CatalogError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.log("Promo route error:", error);
    return res.status(500).json({
        success: false,
        code: "PROMO_SERVER_ERROR",
        message: "Promo code request failed."
    });
}

router.get("/admin/promos", adminMiddleware, requireAdminPermission(PERMISSIONS.PROMOS_READ), async (req, res) => {
    try {
        const promos = await listAdminPromos();
        return res.json({ success: true, promos });
    } catch (error) {
        return sendPromoError(res, error);
    }
});

router.post("/admin/promos", adminMiddleware, requireAdminPermission(PERMISSIONS.PROMOS_MANAGE), async (req, res) => {
    try {
        const promo = await createPromo(req.body, req.admin?.username || req.user?.username || "admin");
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PROMO_CREATED,
            resourceType: "PromoCode",
            resourceId: promo.code,
            metadata: { promoCode: promo.code }
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.status(201).json({ success: true, promo });
    } catch (error) {
        return sendPromoError(res, error);
    }
});

router.put("/admin/promos/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.PROMOS_MANAGE), async (req, res) => {
    try {
        const promo = await updatePromo(req.params.id, req.body, req.admin?.username || req.user?.username || "admin");
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PROMO_UPDATED,
            resourceType: "PromoCode",
            resourceId: promo.code,
            metadata: { promoCode: promo.code }
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({ success: true, promo });
    } catch (error) {
        return sendPromoError(res, error);
    }
});

router.delete("/admin/promos/:id", adminMiddleware, requireAdminPermission(PERMISSIONS.PROMOS_MANAGE), async (req, res) => {
    try {
        await archivePromo(req.params.id, req.admin?.username || req.user?.username || "admin");
        await writeAdminAudit({
            actor: req.admin,
            req,
            action: ADMIN_AUDIT_ACTIONS.PROMO_ARCHIVED,
            resourceType: "PromoCode",
            resourceId: req.params.id
        }).catch(error => console.log("Admin audit failed:", error.message));
        return res.json({ success: true });
    } catch (error) {
        return sendPromoError(res, error);
    }
});

router.post("/promos/quote", optionalAuthMiddleware, async (req, res) => {
    try {
        const pricing = await resolvePurchasePricing({
            payload: req.body,
            user: req.user || null,
            verifyUserLimit: Boolean(req.user?.username)
        });

        return res.json({
            success: true,
            quote: publicQuote(pricing),
            userLimitVerified: Boolean(req.user?.username)
        });
    } catch (error) {
        return sendPromoError(res, error);
    }
});

module.exports = router;
