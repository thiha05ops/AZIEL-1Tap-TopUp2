const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const optionalAuthMiddleware = require("../middleware/optionalAuthMiddleware");
const { CatalogError } = require("../services/catalogService");
const {
    UserCouponError,
    claimCoupon,
    listAvailableCoupons,
    listUserCoupons
} = require("../services/userCouponService");

function sendCouponError(res, error) {
    if (error instanceof UserCouponError || error instanceof CatalogError) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code,
            message: error.message,
            details: error.details || {}
        });
    }
    console.log("Coupon route error:", error);
    return res.status(500).json({
        success: false,
        code: "COUPON_SERVER_ERROR",
        message: "Coupon request failed."
    });
}

function couponContextFrom(req) {
    return {
        region: req.query.region || req.body?.region || "MM",
        currency: req.query.currency || req.body?.currency || "",
        productCode: req.query.productCode || req.query.gameKey || req.body?.productCode || req.body?.gameKey || "",
        packageCode: req.query.packageCode || req.body?.packageCode || "",
        amount: req.query.amount || req.body?.amount || req.body?.originalAmount || 0
    };
}

router.get("/coupons/available", optionalAuthMiddleware, async (req, res) => {
    try {
        const result = await listAvailableCoupons({
            user: req.user || null,
            region: req.query.region || "MM"
        });
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendCouponError(res, error);
    }
});

router.post("/coupons/:campaignId/claim", authMiddleware, async (req, res) => {
    try {
        const result = await claimCoupon({
            campaignId: req.params.campaignId,
            user: req.user
        });
        return res.status(201).json({ success: true, ...result });
    } catch (error) {
        return sendCouponError(res, error);
    }
});

router.get("/coupons/mine", authMiddleware, async (req, res) => {
    try {
        const result = await listUserCoupons({
            user: req.user,
            context: couponContextFrom(req)
        });
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendCouponError(res, error);
    }
});

module.exports = router;
