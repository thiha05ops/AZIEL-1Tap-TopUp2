"use strict";

const PromoCode = require("../../models/PromoCode");
const PromoRedemption = require("../../models/PromoRedemption");
const PromoUsageState = require("../../models/PromoUsageState");
const {
    DISCOUNT_TYPES,
    buildPromoSnapshot,
    normalizeOptionalCode,
    releaseExpiredReservationsForCode,
    releasePromoRedemption,
    reservePromoUse,
    resolvePromoDefinition,
    consumePromoRedemption
} = require("../promoCodeService");

function text(value) {
    return String(value || "").trim();
}

function upper(value) {
    return text(value).toUpperCase();
}

function userForPromo(user = {}, owner = {}) {
    return {
        _id: user._id || user.id || owner.userId || null,
        id: user.id || user._id || owner.userId || null,
        username: text(user.username || user.email || owner.userId)
    };
}

function catalogItemFrom(catalog = {}) {
    return {
        productCode: text(catalog.productCode || catalog.pkg?.productCode).toLowerCase(),
        packageCode: upper(catalog.packageCode || catalog.pkg?.packageCode),
        packageName: text(catalog.pkg?.name || catalog.packageName),
        region: upper(catalog.region),
        currency: upper(catalog.currency || catalog.price?.currency),
        amount: Number(catalog.price?.amount || catalog.amount || 0)
    };
}

async function usageFactsFor(promo, user, { readOnly = false } = {}) {
    const code = promo.code;
    const promoId = String(promo._id);
    if (!readOnly) {
        await PromoUsageState.updateOne(
            { code },
            { $setOnInsert: { code, consumedCount: 0, reservedCount: 0 } },
            { upsert: true }
        );
        await releaseExpiredReservationsForCode(code);
    }

    const [state, userUsed] = await Promise.all([
        PromoUsageState.findOne({ code }).lean(),
        user?.username
            ? PromoRedemption.countDocuments({
                code,
                username: user.username,
                status: { $in: ["RESERVED", "CONSUMED"] },
                $or: [
                    { status: "CONSUMED" },
                    { expiresAt: null },
                    { expiresAt: { $gt: new Date() } }
                ]
            })
            : Promise.resolve(0)
    ]);
    const totalUsed = Number(state?.consumedCount || 0) + Number(state?.reservedCount || 0);
    return {
        promotionUsageTotal: {
            [promoId]: totalUsed,
            [code]: totalUsed
        },
        userPromotionUsage: {
            [promoId]: Number(userUsed || 0),
            [code]: Number(userUsed || 0)
        }
    };
}

function promotionTypeFor(promo) {
    return promo.discountType === DISCOUNT_TYPES.PERCENTAGE
        ? "PERCENTAGE_DISCOUNT"
        : "FIXED_DISCOUNT";
}

function discountValueFor(promo, region) {
    if (promo.discountType === DISCOUNT_TYPES.PERCENTAGE) return Number(promo.percentageValue || 0);
    return Number(promo.fixedAmounts?.[region] || 0);
}

function eligiblePackagesFor(promo) {
    if (promo.eligibilityMode !== "PACKAGES") return [];
    return (promo.eligiblePackages || []).map(item => ({
        packageCode: upper(item.packageCode),
        packageRef: "",
        packageId: ""
    })).filter(item => item.packageCode);
}

function eligibleGamesFor(promo) {
    if (promo.eligibilityMode !== "PRODUCTS") return [];
    return (promo.eligibleProductCodes || []).map(value => text(value).toLowerCase()).filter(Boolean);
}

function buildResolverCandidate(promo, region, currency) {
    const code = promo.code;
    return {
        id: String(promo._id),
        code,
        name: promo.name || code,
        enabled: promo.enabled !== false,
        status: "ACTIVE",
        promotionType: promotionTypeFor(promo),
        discountValue: discountValueFor(promo, region),
        maximumDiscountAmount: Number(promo.maximumDiscountAmounts?.[region] || 0),
        minimumOrderAmount: Number(promo.minimumOrderAmounts?.[region] || 0),
        priority: 0,
        stackable: false,
        exclusive: true,
        requiresCoupon: true,
        couponCode: code,
        usageLimitTotal: Number(promo.usageLimit || 0),
        usageLimitPerUser: Number(promo.perUserLimit || 0),
        effectiveFrom: promo.startsAt || null,
        effectiveUntil: promo.endsAt || null,
        targeting: {
            regions: promo.regions || [],
            currencies: [currency],
            packages: eligiblePackagesFor(promo),
            gameIds: eligibleGamesFor(promo)
        },
        scopes: [{ scopeType: "REGION", scopeReference: region }],
        createdAt: promo.createdAt || null
    };
}

async function loadCommercePromotionContext({ couponCode, catalog, user, owner, packageContext, readOnly = false } = {}) {
    const code = normalizeOptionalCode(couponCode);
    if (!code) {
        return {
            promotions: [],
            campaigns: [],
            context: {},
            strategy: { mode: "BEST_PRICE" }
        };
    }

    const promoUser = userForPromo(user, owner);
    const catalogItem = catalogItemFrom(catalog);
    const promo = await resolvePromoDefinition({
        promoCode: code,
        catalogItem,
        user: promoUser,
        verifyUserLimit: true
    });
    const usage = await usageFactsFor(promo, promoUser, { readOnly });

    return {
        promotions: [buildResolverCandidate(promo, catalogItem.region, catalogItem.currency)],
        campaigns: [],
        context: {
            usage,
            region: catalogItem.region,
            currency: catalogItem.currency,
            couponCode: code,
            packageId: text(packageContext?.packageId || packageContext?.packageSnapshot?.packageId),
            packageCode: upper(packageContext?.packageCode || catalogItem.packageCode),
            packageRef: text(packageContext?.packageRef || packageContext?.packageSnapshot?.packageRef),
            gameId: text(packageContext?.gameId || catalogItem.productCode),
            gameCode: text(packageContext?.gameCode || catalogItem.productCode),
            categoryId: text(packageContext?.categoryId || "game"),
            legacyPromoCodeId: String(promo._id)
        },
        strategy: { mode: "BEST_PRICE" }
    };
}

function selectedPromotionCode(source = {}) {
    return upper(
        source.promotionSnapshot?.selectedPromotion?.code ||
        source.promotion?.code ||
        source.quoteSnapshot?.promotionSnapshot?.selectedPromotion?.code
    );
}

function redemptionSnapshot(redemption) {
    if (!redemption) return null;
    return {
        redemptionId: String(redemption._id || redemption.id || ""),
        promoCodeId: redemption.promoCodeId ? String(redemption.promoCodeId) : "",
        code: redemption.code || "",
        status: redemption.status || "",
        orderId: redemption.orderId || "",
        manualPaymentAttemptId: redemption.manualPaymentAttemptId || "",
        originalAmount: Number(redemption.originalAmount || 0),
        discountAmount: Number(redemption.discountAmount || 0),
        finalAmount: Number(redemption.finalAmount || 0),
        currency: redemption.currency || "",
        region: redemption.region || "",
        expiresAt: redemption.expiresAt || null,
        consumedAt: redemption.consumedAt || null,
        releasedAt: redemption.releasedAt || null,
        snapshot: redemption.snapshot || null
    };
}

async function findExistingRedemption(orderId, code) {
    if (!orderId || !code) return null;
    return PromoRedemption.findOne({
        orderId,
        code,
        status: { $in: ["RESERVED", "CONSUMED"] }
    }).sort({ createdAt: -1 });
}

async function reserveCommercePromotion({ order, user, expiresAt = null } = {}) {
    const code = selectedPromotionCode(order);
    if (!code) return null;
    const existing = await findExistingRedemption(order.orderId, code);
    if (existing) return redemptionSnapshot(existing);

    const promo = await PromoCode.findOne({ code, archivedAt: null });
    if (!promo) return null;
    const commercial = order.commercial || {};
    const pricing = {
        promo,
        region: commercial.region,
        currency: commercial.currency,
        originalAmount: Number(commercial.originalUnitPrice || 0) * Number(commercial.quantity || 1),
        discountAmount: Number(commercial.discountAmount || 0),
        finalAmount: Number(commercial.totalAmount || 0)
    };
    pricing.promoSnapshot = buildPromoSnapshot(promo, pricing);
    const redemption = await reservePromoUse({
        pricing,
        user,
        orderId: order.orderId,
        expiresAt
    });
    return redemptionSnapshot(redemption);
}

async function consumeCommercePromotion(order) {
    const redemptionId = text(order?.promotionRedemptionSnapshot?.redemptionId);
    if (!redemptionId) return null;
    const redemption = await consumePromoRedemption(redemptionId, order.orderId || "");
    return redemptionSnapshot(redemption) || order.promotionRedemptionSnapshot || null;
}

async function releaseCommercePromotion(order) {
    const redemptionId = text(order?.promotionRedemptionSnapshot?.redemptionId);
    if (!redemptionId) return null;
    const redemption = await releasePromoRedemption(redemptionId);
    return redemptionSnapshot(redemption) || order.promotionRedemptionSnapshot || null;
}

module.exports = Object.freeze({
    loadCommercePromotionContext,
    reserveCommercePromotion,
    consumeCommercePromotion,
    releaseCommercePromotion,
    redemptionSnapshot
});
