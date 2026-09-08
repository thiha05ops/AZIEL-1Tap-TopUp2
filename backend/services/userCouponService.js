const crypto = require("crypto");
const mongoose = require("mongoose");
const PromoCode = require("../models/PromoCode");
const PromoUsageState = require("../models/PromoUsageState");
const UserCoupon = require("../models/UserCoupon");
const {
    DISCOUNT_TYPES,
    ELIGIBILITY_MODES,
    PromoError,
    buildPromoSnapshot,
    normalizeOptionalCode
} = require("./promoCodeService");
const { normalizePackageCode, normalizeProductCode, normalizeRegion } = require("./catalogService");

const USER_COUPON_STATUS = Object.freeze({
    AVAILABLE: "AVAILABLE",
    RESERVED: "RESERVED",
    USED: "USED",
    EXPIRED: "EXPIRED"
});

class UserCouponError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = "UserCouponError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = Object.freeze({ ...details });
    }
}

function text(value) {
    return String(value || "").trim();
}

function objectId(value, field = "id") {
    const raw = text(value);
    if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
        throw new UserCouponError("COUPON_INVALID_ID", "Coupon identifier is invalid.", 400, { field });
    }
    return new mongoose.Types.ObjectId(raw);
}

function normalizeUserId(user = {}) {
    const raw = text(user.id || user._id || user.userId);
    if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
        throw new UserCouponError("AUTHENTICATION_REQUIRED", "Please sign in to use coupons.", 401);
    }
    return new mongoose.Types.ObjectId(raw);
}

function nowDate(now = new Date()) {
    const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    return Number.isFinite(date.getTime()) ? date : new Date();
}

function campaignState(promo = {}, now = new Date()) {
    const at = nowDate(now);
    if (!promo || promo.archivedAt) return "ARCHIVED";
    if (promo.enabled !== true) return "DISABLED";
    if (promo.startsAt && new Date(promo.startsAt) > at) return "SCHEDULED";
    if (promo.endsAt && new Date(promo.endsAt) < at) return "EXPIRED";
    return "ACTIVE";
}

function assertCampaignClaimable(promo, now = new Date()) {
    const state = campaignState(promo, now);
    if (state !== "ACTIVE") {
        throw new UserCouponError(`CAMPAIGN_${state}`, "This coupon is not available to claim.", state === "EXPIRED" ? 410 : 409);
    }
}

function assertCampaignUsable(promo, now = new Date()) {
    const state = campaignState(promo, now);
    if (state !== "ACTIVE") {
        throw new UserCouponError(`CAMPAIGN_${state}`, "This coupon is not currently usable.", state === "EXPIRED" ? 410 : 409);
    }
}

function effectiveExpiry(promo = {}, now = new Date()) {
    const at = nowDate(now);
    const ends = promo.endsAt ? new Date(promo.endsAt) : null;
    if (ends && Number.isFinite(ends.getTime())) return ends;
    return null;
}

function entitlementExpired(coupon = {}, promo = null, now = new Date()) {
    const at = nowDate(now).getTime();
    const expiry = coupon.expiresAt ? new Date(coupon.expiresAt) : effectiveExpiry(promo, now);
    return Boolean(expiry && Number.isFinite(expiry.getTime()) && expiry.getTime() <= at);
}

function withSession(query, session) {
    return session && query && typeof query.session === "function" ? query.session(session) : query;
}

async function withCouponTransaction(callback, options = {}) {
    if (options.mongoSession || options.session) return callback(options.mongoSession || options.session);
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await callback(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

async function ensureUsageState(promo, session) {
    await PromoUsageState.updateOne(
        { code: promo.code },
        { $setOnInsert: { code: promo.code, consumedCount: 0, reservedCount: 0 } },
        { upsert: true, session: session || undefined }
    );
}

async function incrementReservedWithinCapacity(promo, session) {
    await ensureUsageState(promo, session);
    const usageLimit = Number(promo.usageLimit || 0);
    const query = { code: promo.code };
    if (usageLimit > 0) {
        query.$expr = { $lt: [{ $add: ["$consumedCount", "$reservedCount"] }, usageLimit] };
    }
    const updated = await PromoUsageState.findOneAndUpdate(
        query,
        { $inc: { reservedCount: 1 } },
        { returnDocument: "after", session: session || undefined }
    );
    if (!updated) {
        throw new UserCouponError("COUPON_USAGE_LIMIT_REACHED", "This coupon campaign has reached its usage limit.", 409);
    }
    return updated;
}

async function decrementReservedUsage(code, session) {
    const updated = await PromoUsageState.updateOne(
        { code, reservedCount: { $gt: 0 } },
        { $inc: { reservedCount: -1 } },
        { session: session || undefined }
    );
    if (!updated.modifiedCount) {
        throw new UserCouponError("COUPON_USAGE_COUNTER_CONFLICT", "Coupon reservation counter could not be reconciled.", 409);
    }
    return updated;
}

async function moveReservedToConsumedUsage(code, session) {
    const updated = await PromoUsageState.updateOne(
        { code, reservedCount: { $gt: 0 } },
        { $inc: { reservedCount: -1, consumedCount: 1 } },
        { session: session || undefined }
    );
    if (!updated.modifiedCount) {
        throw new UserCouponError("COUPON_USAGE_COUNTER_CONFLICT", "Coupon usage counter could not be reconciled.", 409);
    }
    return updated;
}

function buildCampaignSnapshot(promo = {}) {
    return {
        promoCodeId: String(promo._id || ""),
        code: promo.code || "",
        name: promo.name || "",
        discountType: promo.discountType || "",
        percentageValue: Number(promo.percentageValue || 0),
        fixedAmounts: {
            MM: Number(promo.fixedAmounts?.MM || 0),
            TH: Number(promo.fixedAmounts?.TH || 0)
        },
        maximumDiscountAmounts: {
            MM: Number(promo.maximumDiscountAmounts?.MM || 0),
            TH: Number(promo.maximumDiscountAmounts?.TH || 0)
        },
        minimumOrderAmounts: {
            MM: Number(promo.minimumOrderAmounts?.MM || 0),
            TH: Number(promo.minimumOrderAmounts?.TH || 0)
        },
        regions: Array.isArray(promo.regions) ? [...promo.regions] : [],
        eligibilityMode: promo.eligibilityMode || ELIGIBILITY_MODES.ALL,
        eligibleProductCodes: Array.isArray(promo.eligibleProductCodes) ? [...promo.eligibleProductCodes] : [],
        eligiblePackages: Array.isArray(promo.eligiblePackages) ? promo.eligiblePackages.map(item => ({
            productCode: item.productCode || "",
            packageCode: item.packageCode || ""
        })) : [],
        startsAt: promo.startsAt || null,
        endsAt: promo.endsAt || null
    };
}

function benefitLabel(promo = {}, region = "") {
    if (promo.discountType === DISCOUNT_TYPES.PERCENTAGE) {
        return `${Number(promo.percentageValue || 0)}% OFF`;
    }
    const selectedRegion = normalizeRegion(region || "MM");
    const amount = Number(promo.fixedAmounts?.[selectedRegion] || 0);
    const currency = selectedRegion === "TH" ? "THB" : "MMK";
    return amount > 0 ? `${amount.toLocaleString("en-US")} ${currency} OFF` : "Coupon";
}

function projectCampaign(promo = {}, { coupon = null, region = "", now = new Date(), includeCode = false } = {}) {
    const state = campaignState(promo, now);
    const couponStatus = coupon ? projectedCouponStatus(coupon, promo, now) : "";
    return {
        campaignId: String(promo._id || ""),
        name: promo.name || "",
        identifier: includeCode ? promo.code || "" : "",
        discountType: promo.discountType || "",
        benefitLabel: benefitLabel(promo, region),
        minimumOrderAmount: Number(promo.minimumOrderAmounts?.[normalizeRegion(region || "MM")] || 0),
        maximumDiscountAmount: Number(promo.maximumDiscountAmounts?.[normalizeRegion(region || "MM")] || 0),
        regions: Array.isArray(promo.regions) ? promo.regions : [],
        eligibilityMode: promo.eligibilityMode || "ALL",
        eligibleProductCodes: promo.eligibleProductCodes || [],
        eligiblePackages: promo.eligiblePackages || [],
        startsAt: promo.startsAt || null,
        expiresAt: promo.endsAt || null,
        state,
        claimState: couponStatus
            ? (couponStatus === USER_COUPON_STATUS.AVAILABLE ? "CLAIMED" : couponStatus)
            : (state === "ACTIVE" ? "CLAIM" : state),
        userCouponId: coupon ? String(coupon._id || "") : ""
    };
}

function projectedCouponStatus(coupon = {}, promo = null, now = new Date()) {
    const status = text(coupon.status).toUpperCase();
    if (status === USER_COUPON_STATUS.USED) return USER_COUPON_STATUS.USED;
    if (status === USER_COUPON_STATUS.EXPIRED || entitlementExpired(coupon, promo, now)) return USER_COUPON_STATUS.EXPIRED;
    if (status === USER_COUPON_STATUS.RESERVED) return USER_COUPON_STATUS.RESERVED;
    return USER_COUPON_STATUS.AVAILABLE;
}

function assertPromoAppliesToContext(promo = {}, context = {}) {
    const region = normalizeRegion(context.region);
    if (!Array.isArray(promo.regions) || !promo.regions.includes(region)) {
        throw new UserCouponError("REGION_NOT_ELIGIBLE", "This coupon is not available for this region.");
    }
    const productCode = normalizeProductCode(context.productCode || context.gameCode || context.gameId);
    const packageCode = normalizePackageCode(context.packageCode);
    if (promo.eligibilityMode === ELIGIBILITY_MODES.PRODUCTS && !promo.eligibleProductCodes?.includes(productCode)) {
        throw new UserCouponError("PRODUCT_NOT_ELIGIBLE", "This coupon is not available for this product.");
    }
    if (promo.eligibilityMode === ELIGIBILITY_MODES.PACKAGES) {
        const matches = (promo.eligiblePackages || []).some(item => (
            normalizeProductCode(item.productCode) === productCode &&
            normalizePackageCode(item.packageCode) === packageCode
        ));
        if (!matches) throw new UserCouponError("PACKAGE_NOT_ELIGIBLE", "This coupon is not available for this package.");
    }
    const minimum = Number(promo.minimumOrderAmounts?.[region] || 0);
    const amount = Number(context.amount ?? context.originalAmount ?? context.subtotal ?? 0);
    if (minimum > 0 && amount < minimum) {
        throw new UserCouponError("MINIMUM_SPEND_NOT_MET", "Minimum spend is not met for this coupon.");
    }
}

function buildResolverCandidate(promo, region, currency) {
    const code = promo.code;
    return {
        id: String(promo._id),
        code,
        name: promo.name || code,
        enabled: promo.enabled !== false,
        status: "ACTIVE",
        promotionType: promo.discountType === DISCOUNT_TYPES.PERCENTAGE ? "PERCENTAGE_DISCOUNT" : "FIXED_DISCOUNT",
        discountValue: promo.discountType === DISCOUNT_TYPES.PERCENTAGE
            ? Number(promo.percentageValue || 0)
            : Number(promo.fixedAmounts?.[region] || 0),
        maximumDiscountAmount: Number(promo.maximumDiscountAmounts?.[region] || 0),
        minimumOrderAmount: Number(promo.minimumOrderAmounts?.[region] || 0),
        priority: 0,
        stackable: false,
        exclusive: true,
        requiresCoupon: false,
        couponCode: "",
        usageLimitTotal: Number(promo.usageLimit || 0),
        usageLimitPerUser: 0,
        effectiveFrom: promo.startsAt || null,
        effectiveUntil: promo.endsAt || null,
        targeting: {
            regions: Array.from(
                promo.regions || [],
                value => String(value || "").trim().toUpperCase()
            ).filter(Boolean),
            currencies: [String(currency || "").trim().toUpperCase()],
            packages: promo.eligibilityMode === ELIGIBILITY_MODES.PACKAGES
                ? Array.from(promo.eligiblePackages || [], item => ({
                    packageCode: String(item?.packageCode || "").trim().toUpperCase()
                })).filter(item => item.packageCode)
                : [],
            gameIds: promo.eligibilityMode === ELIGIBILITY_MODES.PRODUCTS
                ? Array.from(
                    promo.eligibleProductCodes || [],
                    value => String(value || "").trim().toLowerCase()
                ).filter(Boolean)
                : []
        },
        scopes: [{ scopeType: "REGION", scopeReference: region }],
        createdAt: promo.createdAt || null
    };
}

function couponSummary(coupon = {}, promo = null, options = {}) {
    const region = options.region || promo?.regions?.[0] || "MM";
    return {
        userCouponId: String(coupon._id || ""),
        campaignId: String(coupon.promoCodeId || promo?._id || ""),
        name: promo?.name || coupon.snapshot?.name || "",
        benefitLabel: promo ? benefitLabel(promo, region) : "",
        status: projectedCouponStatus(coupon, promo, options.now),
        expiresAt: coupon.expiresAt || promo?.endsAt || null,
        reservedOrderId: coupon.reservedOrderId || "",
        usedOrderId: coupon.usedOrderId || ""
    };
}

async function loadCampaignById(campaignId) {
    const promo = await PromoCode.findOne({ _id: objectId(campaignId, "campaignId"), archivedAt: null });
    if (!promo) throw new UserCouponError("CAMPAIGN_NOT_FOUND", "Coupon campaign was not found.", 404);
    return promo;
}

async function loadCouponForUser(userCouponId, user, { includePromo = true } = {}) {
    const userId = normalizeUserId(user);
    const coupon = await UserCoupon.findOne({ _id: objectId(userCouponId, "userCouponId"), userId });
    if (!coupon) throw new UserCouponError("COUPON_NOT_FOUND", "Coupon was not found.", 404);
    if (!includePromo) return { coupon, promo: null };
    const promo = await PromoCode.findOne({ _id: coupon.promoCodeId, archivedAt: null });
    if (!promo) throw new UserCouponError("CAMPAIGN_NOT_FOUND", "Coupon campaign was not found.", 404);
    return { coupon, promo };
}

async function claimCoupon({ campaignId, user, now = new Date() } = {}) {
    const userId = normalizeUserId(user);
    const at = nowDate(now);
    const promo = await loadCampaignById(campaignId);
    assertCampaignClaimable(promo, at);
    const expiresAt = effectiveExpiry(promo, at);
    const snapshot = buildCampaignSnapshot(promo);
    try {
        const coupon = await UserCoupon.findOneAndUpdate(
            { userId, promoCodeId: promo._id },
            {
                $setOnInsert: {
                    userId,
                    promoCodeId: promo._id,
                    promoCode: promo.code,
                    status: USER_COUPON_STATUS.AVAILABLE,
                    claimedAt: at,
                    expiresAt,
                    snapshot
                }
            },
            { upsert: true, returnDocument: "after", runValidators: true }
        );
        return { coupon: couponSummary(coupon, promo, { now: at }), campaign: projectCampaign(promo, { coupon, now: at }) };
    } catch (error) {
        if (error?.code !== 11000) throw error;
        const coupon = await UserCoupon.findOne({ userId, promoCodeId: promo._id });
        return { coupon: couponSummary(coupon, promo, { now: at }), campaign: projectCampaign(promo, { coupon, now: at }) };
    }
}

async function listAvailableCoupons({ user = null, region = "MM", now = new Date() } = {}) {
    const at = nowDate(now);
    const normalizedRegion = normalizeRegion(region || "MM");
    const promos = await PromoCode.find({ archivedAt: null, regions: normalizedRegion }).sort({ updatedAt: -1, code: 1 }).lean();
    const userIdRaw = text(user?.id || user?._id || user?.userId);
    let couponsByPromo = new Map();
    if (userIdRaw && mongoose.Types.ObjectId.isValid(userIdRaw)) {
        const coupons = await UserCoupon.find({ userId: new mongoose.Types.ObjectId(userIdRaw), promoCodeId: { $in: promos.map(p => p._id) } }).lean();
        couponsByPromo = new Map(coupons.map(coupon => [String(coupon.promoCodeId), coupon]));
    }
    return {
        authenticated: Boolean(userIdRaw),
        region: normalizedRegion,
        coupons: promos.map(promo => projectCampaign(promo, {
            coupon: couponsByPromo.get(String(promo._id)),
            region: normalizedRegion,
            now: at
        }))
    };
}

function eligibilityForCoupon(coupon, promo, context = {}, now = new Date()) {
    const status = projectedCouponStatus(coupon, promo, now);
    if (status !== USER_COUPON_STATUS.AVAILABLE) return { eligible: false, reasonCode: status === USER_COUPON_STATUS.EXPIRED ? "COUPON_EXPIRED" : `COUPON_${status}` };
    try {
        assertCampaignUsable(promo, now);
        assertPromoAppliesToContext(promo, context);
        return { eligible: true, reasonCode: "ELIGIBLE" };
    } catch (error) {
        return { eligible: false, reasonCode: error.code || "COUPON_NOT_ELIGIBLE" };
    }
}

async function listUserCoupons({ user, context = {}, now = new Date() } = {}) {
    const userId = normalizeUserId(user);
    const at = nowDate(now);
    const coupons = await UserCoupon.find({ userId }).sort({ createdAt: -1 }).lean();
    const promos = await PromoCode.find({ _id: { $in: coupons.map(c => c.promoCodeId) } }).lean();
    const byId = new Map(promos.map(promo => [String(promo._id), promo]));
    return {
        coupons: coupons.map(coupon => {
            const promo = byId.get(String(coupon.promoCodeId));
            const eligibility = promo ? eligibilityForCoupon(coupon, promo, context, at) : { eligible: false, reasonCode: "CAMPAIGN_NOT_FOUND" };
            return {
                ...couponSummary(coupon, promo, { region: context.region, now: at }),
                eligible: eligibility.eligible,
                reasonCode: eligibility.reasonCode,
                campaign: promo ? projectCampaign(promo, { coupon, region: context.region, now: at }) : null
            };
        })
    };
}

async function loadPromotionContextForUserCoupon({ userCouponId, user, catalog, owner = {}, packageContext = {}, issuedAt = new Date() } = {}) {
    if (!text(userCouponId)) return null;
    const { coupon, promo } = await loadCouponForUser(userCouponId, user || { id: owner.userId });
    const region = normalizeRegion(catalog.region);
    const currency = String(catalog.currency || "").trim().toUpperCase();
    const context = {
        productCode: catalog.productCode,
        packageCode: catalog.packageCode,
        region,
        currency,
        amount: Number(catalog.price?.amount || catalog.amount || 0)
    };
    const eligibility = eligibilityForCoupon(coupon, promo, context, issuedAt);
    if (!eligibility.eligible) {
        throw new UserCouponError(eligibility.reasonCode, "Selected coupon is not available for this purchase.", 409);
    }
    const promoUser = { id: String(coupon.userId), _id: coupon.userId, username: text(user?.username || owner.userId) };
    return {
        promotions: [buildResolverCandidate(promo, region, currency)],
        campaigns: [],
        context: {
            usage: { promotionUsageTotal: {}, userPromotionUsage: {} },
            region,
            currency,
            couponCode: "",
            userCouponId: String(coupon._id),
            packageId: text(packageContext?.packageId || packageContext?.packageSnapshot?.packageId),
            packageCode: normalizePackageCode(packageContext?.packageCode || catalog.packageCode),
            packageRef: text(packageContext?.packageRef || packageContext?.packageSnapshot?.packageRef),
            gameId: text(packageContext?.gameId || catalog.productCode),
            gameCode: text(packageContext?.gameCode || catalog.productCode),
            categoryId: text(packageContext?.categoryId || "game"),
            userId: String(coupon.userId)
        },
        strategy: { mode: "BEST_PRICE" },
        userCoupon: couponSummary(coupon, promo, { region, now: issuedAt }),
        userCouponSnapshot: {
            userCouponId: String(coupon._id),
            campaignId: String(promo._id),
            promoCodeId: String(promo._id),
            name: promo.name,
            benefitLabel: benefitLabel(promo, region),
            expiresAt: coupon.expiresAt || promo.endsAt || null
        },
        promoUser
    };
}

async function reserveUserCoupon({ userCouponId, user, quote, orderId = "", reservationToken = "", expiresAt = null, now = new Date(), mongoSession = null, session = null } = {}) {
    const at = nowDate(now);
    const { coupon, promo } = await loadCouponForUser(userCouponId, user);
    assertCampaignUsable(promo, at);
    const expiry = coupon.expiresAt || effectiveExpiry(promo, at);
    if (entitlementExpired(coupon, promo, at)) {
        await UserCoupon.updateOne({ _id: coupon._id, status: { $ne: USER_COUPON_STATUS.USED } }, { $set: { status: USER_COUPON_STATUS.EXPIRED } });
        throw new UserCouponError("COUPON_EXPIRED", "Selected coupon has expired.", 410);
    }
    const commercial = quote?.commercialSnapshot || {};
    const packageSnapshot = quote?.packageSnapshot || {};
    const context = {
        productCode: packageSnapshot.gameCode || packageSnapshot.gameId,
        packageCode: packageSnapshot.packageCode,
        region: commercial.region,
        currency: commercial.currency,
        amount: commercial.originalPrice
    };
    assertPromoAppliesToContext(promo, context);
    const token = text(reservationToken || orderId || quote?.quoteId);
    if (!token) throw new UserCouponError("COUPON_RESERVATION_ID_REQUIRED", "Coupon reservation identity is required.");
    const reservationExpiry = expiresAt ? nowDate(expiresAt) : (quote?.lifecycle?.expiresAt ? nowDate(quote.lifecycle.expiresAt) : expiry);
    const idempotent = await withSession(UserCoupon.findOne({
        _id: coupon._id,
        userId: coupon.userId,
        status: USER_COUPON_STATUS.RESERVED,
        reservationToken: token
    }), mongoSession || session);
    if (idempotent) return { coupon: couponSummary(idempotent, promo, { region: context.region, now: at }), idempotent: true };
    return withCouponTransaction(async txSession => {
        await incrementReservedWithinCapacity(promo, txSession);
        const reserved = await UserCoupon.findOneAndUpdate(
            {
                _id: coupon._id,
                userId: coupon.userId,
                status: USER_COUPON_STATUS.AVAILABLE,
                $or: [{ expiresAt: null }, { expiresAt: { $gt: at } }]
            },
            {
                $set: {
                    status: USER_COUPON_STATUS.RESERVED,
                    reservedQuoteId: quote?.quoteId || "",
                    reservedOrderId: orderId || "",
                    reservationToken: token,
                    reservedAt: at,
                    reservationExpiresAt: reservationExpiry || null
                }
            },
            { returnDocument: "after", runValidators: true, session: txSession || undefined }
        );
        if (!reserved) throw new UserCouponError("COUPON_RESERVATION_UNAVAILABLE", "Selected coupon is already reserved or unavailable.", 409);
        return { coupon: couponSummary(reserved, promo, { region: context.region, now: at }), idempotent: false };
    }, { mongoSession: mongoSession || session });
}

async function releaseUserCoupon({ userCouponId, user = null, reservationToken = "", orderId = "", now = new Date(), mongoSession = null, session = null } = {}) {
    const at = nowDate(now);
    const couponId = objectId(userCouponId, "userCouponId");
    const token = text(reservationToken || orderId);
    if (!token) throw new UserCouponError("COUPON_RELEASE_ID_REQUIRED", "Coupon release identity is required.");
    const query = { _id: couponId, status: USER_COUPON_STATUS.RESERVED };
    if (user) query.userId = normalizeUserId(user);
    if (token) query.reservationToken = token;
    if (text(orderId)) query.reservedOrderId = text(orderId);

    return withCouponTransaction(async txSession => {
        const existing = await withSession(UserCoupon.findOne(query), txSession).lean();
        if (!existing) return { released: false, idempotent: true };
        const promo = await withSession(PromoCode.findOne({ _id: existing.promoCodeId }), txSession);
        const nextStatus = entitlementExpired(existing, promo, at) ? USER_COUPON_STATUS.EXPIRED : USER_COUPON_STATUS.AVAILABLE;
        const released = await UserCoupon.findOneAndUpdate(
            query,
            {
                $set: {
                    status: nextStatus,
                    reservedQuoteId: "",
                    reservedOrderId: "",
                    reservationToken: "",
                    reservedAt: null,
                    reservationExpiresAt: null,
                    lastReleasedAt: at
                }
            },
            { returnDocument: "after", runValidators: true, session: txSession || undefined }
        );
        if (!released) return { released: false, idempotent: true };
        await decrementReservedUsage(released.promoCode, txSession);
        return { released: true, status: nextStatus, coupon: couponSummary(released, promo, { now: at }) };
    }, { mongoSession: mongoSession || session });
}

async function consumeUserCoupon({ userCouponId, orderId = "", reservationToken = "", now = new Date(), mongoSession = null, session = null } = {}) {
    const at = nowDate(now);
    const couponId = objectId(userCouponId, "userCouponId");
    const token = text(reservationToken || orderId);
    const order = text(orderId);
    if (!order || !token) throw new UserCouponError("COUPON_CONSUMPTION_ID_REQUIRED", "Coupon consumption identity is required.");
    const existingUsed = await withSession(UserCoupon.findOne({ _id: couponId, status: USER_COUPON_STATUS.USED, usedOrderId: order }), mongoSession || session);
    if (existingUsed) return { consumed: true, idempotent: true, coupon: couponSummary(existingUsed, null, { now: at }) };
    return withCouponTransaction(async txSession => {
        const coupon = await UserCoupon.findOneAndUpdate(
            { _id: couponId, status: USER_COUPON_STATUS.RESERVED, reservationToken: token, reservedOrderId: order },
            {
                $set: {
                    status: USER_COUPON_STATUS.USED,
                    usedOrderId: order,
                    usedAt: at,
                    reservationExpiresAt: null
                }
            },
            { returnDocument: "after", runValidators: true, session: txSession || undefined }
        );
        if (!coupon) throw new UserCouponError("COUPON_CONSUMPTION_UNAVAILABLE", "Coupon cannot be consumed for this order.", 409);
        await moveReservedToConsumedUsage(coupon.promoCode, txSession);
        return { consumed: true, idempotent: false, coupon: couponSummary(coupon, null, { now: at }) };
    }, { mongoSession: mongoSession || session });
}

async function cleanupExpiredUserCoupons({ now = new Date() } = {}) {
    const at = nowDate(now);
    const available = await UserCoupon.updateMany(
        { status: USER_COUPON_STATUS.AVAILABLE, expiresAt: { $ne: null, $lte: at } },
        { $set: { status: USER_COUPON_STATUS.EXPIRED } }
    );
    const staleReserved = await UserCoupon.find({ status: USER_COUPON_STATUS.RESERVED, reservationExpiresAt: { $ne: null, $lte: at } });
    let released = 0;
    for (const coupon of staleReserved) {
        const promo = await PromoCode.findOne({ _id: coupon.promoCodeId });
        const nextStatus = entitlementExpired(coupon, promo, at) ? USER_COUPON_STATUS.EXPIRED : USER_COUPON_STATUS.AVAILABLE;
        const wonCleanup = await withCouponTransaction(async txSession => {
            const transition = await UserCoupon.updateOne(
                { _id: coupon._id, status: USER_COUPON_STATUS.RESERVED },
                { $set: { status: nextStatus, reservationToken: "", reservedOrderId: "", reservedQuoteId: "", reservedAt: null, reservationExpiresAt: null, lastReleasedAt: at } },
                { session: txSession || undefined }
            );
            if (transition.modifiedCount <= 0) return false;
            await decrementReservedUsage(coupon.promoCode, txSession);
            return true;
        });
        if (wonCleanup) {
            released += 1;
        }
    }
    return { expiredAvailable: available.modifiedCount || 0, releasedReservations: released };
}

function generateCouponCode() {
    return `AZC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function generateUniqueCouponCode() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = generateCouponCode();
        // eslint-disable-next-line no-await-in-loop
        const exists = await PromoCode.exists({ code });
        if (!exists) return code;
    }
    throw new PromoError("PROMO_CODE_GENERATION_FAILED", "Could not generate a coupon identifier.");
}

module.exports = Object.freeze({
    USER_COUPON_STATUS,
    UserCouponError,
    benefitLabel,
    campaignState,
    claimCoupon,
    cleanupExpiredUserCoupons,
    consumeUserCoupon,
    couponSummary,
    generateUniqueCouponCode,
    listAvailableCoupons,
    listUserCoupons,
    loadPromotionContextForUserCoupon,
    releaseUserCoupon,
    reserveUserCoupon
});
