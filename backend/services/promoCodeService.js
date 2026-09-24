const crypto = require("crypto");
const PromoCode = require("../models/PromoCode");
const PromoUsageState = require("../models/PromoUsageState");
const PromoRedemption = require("../models/PromoRedemption");
const PromoUserUsageState = require("../models/PromoUserUsageState");
const mongoose = require("mongoose");
const UserCoupon = require("../models/UserCoupon");
const CouponLifecycleEvent = require("../models/CouponLifecycleEvent");
const { CatalogError, normalizePackageCode, normalizeProductCode, normalizeRegion, resolveOrderCatalog } = require("./catalogService");

const DISCOUNT_TYPES = Object.freeze({
    PERCENTAGE: "PERCENTAGE",
    FIXED: "FIXED"
});

const ELIGIBILITY_MODES = Object.freeze({
    ALL: "ALL",
    PRODUCTS: "PRODUCTS",
    PACKAGES: "PACKAGES"
});

class PromoError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "PromoError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizeCode(value) {
    const code = String(value || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
        throw new PromoError(
            "PROMO_CODE_INVALID",
            "Promo code must be 3-32 characters using letters, numbers, hyphen, or underscore."
        );
    }
    return code;
}

function normalizeOptionalCode(value) {
    const raw = String(value || "").trim();
    return raw ? normalizeCode(raw) : "";
}

function generatedCouponCode() {
    return `AZC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function generateUniquePromoCode() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = generatedCouponCode();
        // eslint-disable-next-line no-await-in-loop
        const exists = await PromoCode.exists({ code });
        if (!exists) return code;
    }
    throw new PromoError("PROMO_CODE_GENERATION_FAILED", "Could not generate a coupon identifier.");
}

function positiveNumber(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return fallback;
    return number;
}

function amountMap(input = {}) {
    return {
        MM: positiveNumber(input.MM),
        TH: positiveNumber(input.TH)
    };
}

function activeWindowState(promo, now = new Date()) {
    if (promo.archivedAt) return "ARCHIVED";
    const operationalStatus = String(promo.operationalStatus || "").trim().toUpperCase();
    if (operationalStatus === "DRAFT") return "DRAFT";
    if (operationalStatus === "PAUSED") return "PAUSED";
    if (operationalStatus === "ENDED") return "ENDED";
    if (!promo.enabled) return "DISABLED";
    if (promo.startsAt && promo.startsAt > now) return "SCHEDULED";
    if (promo.endsAt && promo.endsAt <= now) return "ENDED";
    return "ACTIVE";
}

function buildPromoSnapshot(promo, pricing) {
    if (!promo) return null;
    return {
        promoCodeId: String(promo._id),
        code: promo.code,
        name: promo.name,
        discountType: promo.discountType,
        percentageValue: promo.percentageValue,
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
        regions: promo.regions || [],
        eligibilityMode: promo.eligibilityMode || ELIGIBILITY_MODES.ALL,
        eligibleProductCodes: promo.eligibleProductCodes || [],
        eligiblePackages: promo.eligiblePackages || [],
        originalAmount: Number(pricing.originalAmount || 0),
        discountAmount: Number(pricing.discountAmount || 0),
        finalAmount: Number(pricing.finalAmount || 0),
        currency: pricing.currency,
        region: pricing.region,
        quotedAt: new Date()
    };
}

function projectPromo(promo, usageState = null) {
    const usage = usageState || {};
    return {
        id: String(promo._id),
        code: promo.code,
        name: promo.name,
        discountType: promo.discountType,
        percentageValue: Number(promo.percentageValue || 0),
        fixedAmounts: amountMap(promo.fixedAmounts),
        maximumDiscountAmounts: amountMap(promo.maximumDiscountAmounts),
        minimumOrderAmounts: amountMap(promo.minimumOrderAmounts),
        regions: promo.regions || [],
        eligibilityMode: promo.eligibilityMode || ELIGIBILITY_MODES.ALL,
        eligibleProductCodes: promo.eligibleProductCodes || [],
        eligiblePackages: promo.eligiblePackages || [],
        usageLimit: Number(promo.usageLimit || 0),
        claimLimit: Number(promo.claimLimit || 0),
        perUserLimit: Number(promo.perUserLimit || 0),
        startsAt: promo.startsAt,
        endsAt: promo.endsAt,
        enabled: Boolean(promo.enabled),
        operationalStatus: promo.operationalStatus || "",
        stackingPolicy: promo.stackingPolicy || "SAFE_STACKING",
        archivedAt: promo.archivedAt,
        state: activeWindowState(promo),
        consumedCount: Number(usage.consumedCount || 0),
        reservedCount: Number(usage.reservedCount || 0),
        claimedCount: Number(usage.claimedCount || 0),
        expiredCount: Number(usage.expiredCount || 0),
        availableCount: Math.max(0, Number(usage.claimedCount || 0) - Number(usage.reservedCount || 0) - Number(usage.consumedCount || 0) - Number(usage.expiredCount || 0)),
        createdAt: promo.createdAt,
        updatedAt: promo.updatedAt
    };
}

function sanitizePromoPayload(payload = {}, existing = null, actor = "admin") {
    const discountType = String(payload.discountType || existing?.discountType || "").toUpperCase();
    if (!Object.values(DISCOUNT_TYPES).includes(discountType)) {
        throw new PromoError("PROMO_DISCOUNT_TYPE_INVALID", "Select a valid promo discount type.");
    }

    const regions = Array.from(new Set((Array.isArray(payload.regions) ? payload.regions : [])
        .map(region => normalizeRegion(region))
        .filter(Boolean)));

    if (!regions.length) {
        throw new PromoError("PROMO_REGIONS_REQUIRED", "Select at least one promo region.");
    }

    const eligibilityMode = String(payload.eligibilityMode || ELIGIBILITY_MODES.ALL).toUpperCase();
    if (!Object.values(ELIGIBILITY_MODES).includes(eligibilityMode)) {
        throw new PromoError("PROMO_ELIGIBILITY_INVALID", "Select a valid promo eligibility mode.");
    }

    const eligibleProductCodes = Array.from(new Set((Array.isArray(payload.eligibleProductCodes) ? payload.eligibleProductCodes : [])
        .map(normalizeProductCode)
        .filter(Boolean)));

    const eligiblePackages = (Array.isArray(payload.eligiblePackages) ? payload.eligiblePackages : [])
        .map(item => ({
            productCode: normalizeProductCode(item.productCode),
            packageCode: normalizePackageCode(item.packageCode)
        }))
        .filter(item => item.productCode && item.packageCode);

    if (eligibilityMode === ELIGIBILITY_MODES.PRODUCTS && !eligibleProductCodes.length) {
        throw new PromoError("PROMO_PRODUCTS_REQUIRED", "Select at least one eligible product.");
    }

    if (eligibilityMode === ELIGIBILITY_MODES.PACKAGES && !eligiblePackages.length) {
        throw new PromoError("PROMO_PACKAGES_REQUIRED", "Select at least one eligible package.");
    }

    const percentageValue = positiveNumber(payload.percentageValue);
    if (discountType === DISCOUNT_TYPES.PERCENTAGE && (percentageValue <= 0 || percentageValue > 100)) {
        throw new PromoError("PROMO_PERCENTAGE_INVALID", "Percentage discount must be greater than 0 and no more than 100.");
    }

    const fixedAmounts = amountMap(payload.fixedAmounts);
    if (discountType === DISCOUNT_TYPES.FIXED && !regions.some(region => fixedAmounts[region] > 0)) {
        throw new PromoError("PROMO_FIXED_AMOUNT_INVALID", "Set a fixed discount amount for at least one selected region.");
    }

    const startsAt = payload.startsAt ? new Date(payload.startsAt) : null;
    const endsAt = payload.endsAt ? new Date(payload.endsAt) : null;
    if (startsAt && Number.isNaN(startsAt.getTime())) {
        throw new PromoError("PROMO_START_INVALID", "Promo start date is invalid.");
    }
    if (endsAt && Number.isNaN(endsAt.getTime())) {
        throw new PromoError("PROMO_END_INVALID", "Promo end date is invalid.");
    }
    if (startsAt && endsAt && startsAt >= endsAt) {
        throw new PromoError("PROMO_WINDOW_INVALID", "Promo end date must be after the start date.");
    }

    return {
        name: String(payload.name || "").trim(),
        discountType,
        percentageValue: discountType === DISCOUNT_TYPES.PERCENTAGE ? percentageValue : 0,
        fixedAmounts: discountType === DISCOUNT_TYPES.FIXED ? fixedAmounts : { MM: 0, TH: 0 },
        maximumDiscountAmounts: discountType === DISCOUNT_TYPES.PERCENTAGE ? amountMap(payload.maximumDiscountAmounts) : { MM: 0, TH: 0 },
        minimumOrderAmounts: amountMap(payload.minimumOrderAmounts),
        regions,
        eligibilityMode,
        eligibleProductCodes: eligibilityMode === ELIGIBILITY_MODES.PRODUCTS ? eligibleProductCodes : [],
        eligiblePackages: eligibilityMode === ELIGIBILITY_MODES.PACKAGES ? eligiblePackages : [],
        usageLimit: Math.floor(positiveNumber(payload.usageLimit)),
        claimLimit: Math.floor(positiveNumber(payload.claimLimit)),
        perUserLimit: Math.floor(positiveNumber(payload.perUserLimit)),
        startsAt,
        endsAt,
        enabled: Boolean(payload.enabled),
        operationalStatus: ["DRAFT", "ACTIVE", "PAUSED", "ENDED"].includes(String(payload.operationalStatus || "").toUpperCase())
            ? String(payload.operationalStatus).toUpperCase()
            : (existing?.operationalStatus || (payload.enabled ? "ACTIVE" : "DRAFT")),
        stackingPolicy: "SAFE_STACKING",
        updatedBy: actor
    };
}

async function listAdminPromos() {
    const [promos, states] = await Promise.all([
        PromoCode.find({ archivedAt: null }).sort({ updatedAt: -1, code: 1 }).lean(),
        PromoUsageState.find({}).lean()
    ]);
    const usageByCode = new Map(states.map(state => [state.code, state]));
    return promos.map(promo => projectPromo(promo, usageByCode.get(promo.code)));
}

async function getAdminPromoDetail(id) {
    const promo = await PromoCode.findOne({ _id: id });
    if (!promo) throw new PromoError("PROMO_NOT_FOUND", "Coupon campaign not found.", 404);
    const [usage, statusCounts, events] = await Promise.all([
        PromoUsageState.findOne({ code: promo.code }).lean(),
        UserCoupon.aggregate([
            { $match: { promoCodeId: promo._id } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]),
        CouponLifecycleEvent.find({ promoCodeId: promo._id }).sort({ occurredAt: -1 }).limit(100).lean()
    ]);
    return {
        promo: projectPromo(promo, usage),
        couponCounts: Object.fromEntries(statusCounts.map(item => [item._id, item.count])),
        events: events.map(event => ({
            id: String(event._id), eventType: event.eventType, userCouponId: String(event.userCouponId), userId: String(event.userId),
            quoteId: event.quoteId, orderId: event.orderId, paymentAttemptId: event.paymentAttemptId,
            originalAmount: event.originalAmount, discountAmount: event.discountAmount, finalAmount: event.finalAmount,
            currency: event.currency, source: event.source, reason: event.reason, occurredAt: event.occurredAt
        }))
    };
}

async function createPromo(payload = {}, actor = "admin") {
    const clean = sanitizePromoPayload(payload, null, actor);
    if (!clean.name) {
        throw new PromoError("PROMO_NAME_REQUIRED", "Promo name is required.");
    }
    let promo = null;
    let code = "";
    for (let attempt = 0; attempt < 8; attempt += 1) {
        code = payload.code ? normalizeCode(payload.code) : await generateUniquePromoCode();
        try {
            // eslint-disable-next-line no-await-in-loop
            promo = await PromoCode.create({
                ...clean,
                code,
                createdBy: actor
            });
            break;
        } catch (error) {
            if (error?.code !== 11000 || payload.code) throw error;
        }
    }
    if (!promo) throw new PromoError("PROMO_CODE_GENERATION_FAILED", "Could not generate a coupon identifier.");

    await PromoUsageState.updateOne(
        { code },
        { $setOnInsert: { code, consumedCount: 0, reservedCount: 0, claimedCount: 0, expiredCount: 0 } },
        { upsert: true }
    );

    return projectPromo(promo, await PromoUsageState.findOne({ code }).lean());
}

async function updatePromo(id, payload = {}, actor = "admin") {
    const promo = await PromoCode.findOne({ _id: id, archivedAt: null });
    if (!promo) {
        throw new PromoError("PROMO_NOT_FOUND", "Promo code not found.", 404);
    }

    const clean = sanitizePromoPayload(payload, promo, actor);
    if (!clean.name) {
        throw new PromoError("PROMO_NAME_REQUIRED", "Promo name is required.");
    }

    const usage = await PromoUsageState.findOne({ code: promo.code }).lean();
    if (Number(usage?.claimedCount || 0) > 0) {
        const locked = ["discountType", "percentageValue", "fixedAmounts", "maximumDiscountAmounts", "minimumOrderAmounts", "regions", "eligibilityMode", "eligibleProductCodes", "eligiblePackages", "claimLimit", "usageLimit", "perUserLimit"];
        const changed = locked.some(field => JSON.stringify(promo[field] ?? null) !== JSON.stringify(clean[field] ?? null));
        if (changed) throw new PromoError("PROMO_TERMS_LOCKED_AFTER_CLAIM", "Coupon financial and eligibility terms cannot change after the first claim.", 409);
    }
    Object.assign(promo, clean);
    await promo.save();
    return projectPromo(promo, usage);
}

async function archivePromo(id, actor = "admin") {
    const promo = await PromoCode.findOne({ _id: id, archivedAt: null });
    if (!promo) {
        throw new PromoError("PROMO_NOT_FOUND", "Promo code not found.", 404);
    }

    promo.enabled = false;
    promo.archivedAt = new Date();
    promo.updatedBy = actor;
    await promo.save();
    return { success: true };
}

function assertPromoAppliesToCatalog(promo, catalogItem) {
    const region = normalizeRegion(catalogItem.region);
    if (!promo.regions.includes(region)) {
        throw new PromoError("PROMO_REGION_INELIGIBLE", "This promo code is not available in your region.");
    }

    const productCode = normalizeProductCode(catalogItem.productCode);
    const packageCode = normalizePackageCode(catalogItem.packageCode);

    if (promo.eligibilityMode === ELIGIBILITY_MODES.PRODUCTS && !promo.eligibleProductCodes.includes(productCode)) {
        throw new PromoError("PROMO_PRODUCT_INELIGIBLE", "This promo code is not available for the selected product.");
    }

    if (promo.eligibilityMode === ELIGIBILITY_MODES.PACKAGES) {
        const matches = promo.eligiblePackages.some(item => (
            item.productCode === productCode &&
            item.packageCode === packageCode
        ));
        if (!matches) {
            throw new PromoError("PROMO_PACKAGE_INELIGIBLE", "This promo code is not available for the selected package.");
        }
    }
}

function calculateDiscount(promo, catalogItem) {
    const originalAmount = Number(catalogItem.amount || 0);
    const region = normalizeRegion(catalogItem.region);
    const currency = catalogItem.currency;
    const minimum = Number(promo.minimumOrderAmounts?.[region] || 0);

    if (minimum > 0 && originalAmount < minimum) {
        throw new PromoError("PROMO_MINIMUM_NOT_MET", `Minimum order amount for this promo is ${minimum.toLocaleString()} ${currency}.`);
    }

    let discountAmount = 0;
    if (promo.discountType === DISCOUNT_TYPES.PERCENTAGE) {
        discountAmount = Number((originalAmount * (Number(promo.percentageValue || 0) / 100)).toFixed(6));
        const maximum = Number(promo.maximumDiscountAmounts?.[region] || 0);
        if (maximum > 0) discountAmount = Math.min(discountAmount, maximum);
    } else {
        discountAmount = Number(promo.fixedAmounts?.[region] || 0);
    }

    discountAmount = Math.min(Math.max(0, Number(Number(discountAmount).toFixed(6))), originalAmount);
    return {
        originalAmount,
        discountAmount,
        finalAmount: Math.max(0, originalAmount - discountAmount),
        currency,
        region
    };
}

async function resolvePromoDefinition({ promoCode, catalogItem, user = null, verifyUserLimit = false } = {}) {
    const code = normalizeOptionalCode(promoCode);
    if (!code) return null;
    const promo = await PromoCode.findOne({ code, archivedAt: null });
    if (!promo) throw new PromoError("PROMO_NOT_FOUND", "Promo code not found.", 404);
    const state = activeWindowState(promo);
    if (state !== "ACTIVE") throw new PromoError(`PROMO_${state}`, "This promo code is not currently active.");
    assertPromoAppliesToCatalog(promo, catalogItem);
    if (verifyUserLimit && promo.perUserLimit > 0 && user?.username) {
        const usedByUser = await PromoRedemption.countDocuments({
            code,
            username: user.username,
            status: { $in: ["RESERVED", "CONSUMED"] },
            $or: [{ status: "CONSUMED" }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }]
        });
        if (usedByUser >= promo.perUserLimit) throw new PromoError("PROMO_USER_LIMIT_REACHED", "You have already used this promo code.");
    }
    return promo;
}

async function resolvePromoPricing({ promoCode, catalogItem, user = null, verifyUserLimit = false } = {}) {
    const code = normalizeOptionalCode(promoCode);
    const originalAmount = Number(catalogItem.amount || 0);

    if (!code) {
        return {
            promo: null,
            promoCode: "",
            originalAmount,
            discountAmount: 0,
            finalAmount: originalAmount,
            currency: catalogItem.currency,
            region: catalogItem.region,
            promoSnapshot: null
        };
    }

    const promo = await PromoCode.findOne({ code, archivedAt: null });
    if (!promo) {
        throw new PromoError("PROMO_NOT_FOUND", "Promo code not found.", 404);
    }

    const state = activeWindowState(promo);
    if (state !== "ACTIVE") {
        throw new PromoError(`PROMO_${state}`, "This promo code is not currently active.");
    }

    assertPromoAppliesToCatalog(promo, catalogItem);
    const pricing = calculateDiscount(promo, catalogItem);

    if (verifyUserLimit && promo.perUserLimit > 0 && user?.username) {
        const usedByUser = await PromoRedemption.countDocuments({
            code,
            username: user.username,
            status: { $in: ["RESERVED", "CONSUMED"] },
            $or: [
                { status: "CONSUMED" },
                { expiresAt: null },
                { expiresAt: { $gt: new Date() } }
            ]
        });
        if (usedByUser >= promo.perUserLimit) {
            throw new PromoError("PROMO_USER_LIMIT_REACHED", "You have already used this promo code.");
        }
    }

    const snapshot = buildPromoSnapshot(promo, pricing);
    return {
        promo,
        promoCode: code,
        ...pricing,
        promoSnapshot: snapshot
    };
}

async function releaseExpiredReservationsForCode(code) {
    const expired = await PromoRedemption.find({
        code,
        status: "RESERVED",
        expiresAt: { $ne: null, $lte: new Date() }
    }).select("_id userId username");

    if (!expired.length) return 0;

    let releasedCount = 0;
    for (const candidate of expired) {
        // Reuse the same atomic lifecycle boundary as explicit cancellation.
        // eslint-disable-next-line no-await-in-loop
        const released = await releasePromoRedemption(candidate._id);
        if (released?.status === "RELEASED" && released.$locals?.lifecycleIdempotent !== true) releasedCount += 1;
    }
    return releasedCount;
}

async function resolvePurchasePricing({ payload = {}, user = null, verifyUserLimit = false } = {}) {
    const catalogItem = await resolveOrderCatalog(payload);
    const promoPricing = await resolvePromoPricing({
        promoCode: payload.promoCode,
        catalogItem,
        user,
        verifyUserLimit
    });

    return {
        catalogItem,
        ...promoPricing
    };
}

function publicQuote(pricing) {
    return {
        promoCode: pricing.promoCode || "",
        productCode: pricing.catalogItem?.productCode || "",
        packageCode: pricing.catalogItem?.packageCode || "",
        packageName: pricing.catalogItem?.packageName || "",
        region: pricing.region,
        currency: pricing.currency,
        originalAmount: Number(pricing.originalAmount || 0),
        discountAmount: Number(pricing.discountAmount || 0),
        finalAmount: Number(pricing.finalAmount || 0),
        promoSnapshot: pricing.promoSnapshot ? {
            code: pricing.promoSnapshot.code,
            name: pricing.promoSnapshot.name,
            discountType: pricing.promoSnapshot.discountType,
            percentageValue: pricing.promoSnapshot.percentageValue
        } : null
    };
}

async function reservePromoUse({ pricing, user, orderId = "", manualPaymentAttemptId = "", expiresAt = null } = {}) {
    if (!pricing?.promo) return null;
    const promo = pricing.promo;
    const code = promo.code;

    await PromoUsageState.updateOne(
        { code },
        { $setOnInsert: { code, consumedCount: 0, reservedCount: 0 } },
        { upsert: true }
    );
    await releaseExpiredReservationsForCode(code);

    const session = await mongoose.startSession();
    try {
        let redemption;
        await session.withTransaction(async () => {
            const userKey = String(user?._id || user?.id || user?.username || "").trim();
            if (promo.perUserLimit > 0 && userKey) {
                await PromoUserUsageState.updateOne({ code, userKey }, { $setOnInsert: { code, userKey, reservedCount: 0, consumedCount: 0 } }, { upsert: true, session });
                const userState = await PromoUserUsageState.findOneAndUpdate(
                    { code, userKey, $expr: { $lt: [{ $add: ["$consumedCount", "$reservedCount"] }, Number(promo.perUserLimit)] } },
                    { $inc: { reservedCount: 1 } }, { returnDocument: "after", session }
                );
                if (!userState) throw new PromoError("PROMO_USER_LIMIT_REACHED", "You have already used this promo code.");
            }
            const filter = { code };
            if (promo.usageLimit > 0) filter.$expr = { $lt: [{ $add: ["$consumedCount", "$reservedCount"] }, Number(promo.usageLimit)] };
            const state = await PromoUsageState.findOneAndUpdate(filter, { $inc: { reservedCount: 1 } }, { returnDocument: "after", session });
            if (!state) throw new PromoError("PROMO_USAGE_LIMIT_REACHED", "This promo code has reached its usage limit.");
            const created = await PromoRedemption.create([{
            promoCodeId: promo._id,
            code,
            userId: user?._id || user?.id || null,
            username: user?.username || "",
            orderId,
            manualPaymentAttemptId,
            region: pricing.region,
            currency: pricing.currency,
            originalAmount: pricing.originalAmount,
            discountAmount: pricing.discountAmount,
            finalAmount: pricing.finalAmount,
            expiresAt,
            snapshot: pricing.promoSnapshot
            }], { session });
            redemption = created[0];
        });
        return redemption;
    } finally {
        await session.endSession();
    }
}

async function withPromoRedemptionTransaction(callback, suppliedSession = null) {
    if (suppliedSession) return callback(suppliedSession);
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => { result = await callback(session); });
        return result;
    } finally {
        await session.endSession();
    }
}

async function updateLegacyUserUsage(redemption, update, session) {
    const userKey = String(redemption.userId || redemption.username || "").trim();
    if (!userKey) return;
    const exists = await PromoUserUsageState.findOne({ code: redemption.code, userKey }).session(session);
    if (!exists) return;
    const updated = await PromoUserUsageState.updateOne(
        { code: redemption.code, userKey, reservedCount: { $gt: 0 } },
        update,
        { session }
    );
    if (!updated.modifiedCount) throw new PromoError("PROMO_USER_USAGE_COUNTER_CONFLICT", "Promo user usage counter could not be reconciled.", 409);
}

async function consumePromoRedemption(redemptionId, orderId = "", options = {}) {
    if (!redemptionId) return null;
    return withPromoRedemptionTransaction(async session => {
        const consumedQuery = { _id: redemptionId, status: "CONSUMED" };
        if (orderId) consumedQuery.orderId = orderId;
        const alreadyConsumed = await PromoRedemption.findOne(consumedQuery).session(session);
        if (alreadyConsumed) {
            alreadyConsumed.$locals.lifecycleIdempotent = true;
            return alreadyConsumed;
        }
        const redemption = await PromoRedemption.findOneAndUpdate(
            { _id: redemptionId, status: "RESERVED" },
            { $set: { status: "CONSUMED", consumedAt: new Date(), orderId: orderId || undefined } },
            { returnDocument: "after", session }
        );
        if (!redemption) return null;
        redemption.$locals.lifecycleIdempotent = false;
        const global = await PromoUsageState.updateOne(
            { code: redemption.code, reservedCount: { $gt: 0 } },
            { $inc: { reservedCount: -1, consumedCount: 1 } },
            { session }
        );
        if (!global.modifiedCount) throw new PromoError("PROMO_USAGE_COUNTER_CONFLICT", "Promo usage counter could not be reconciled.", 409);
        await updateLegacyUserUsage(redemption, { $inc: { reservedCount: -1, consumedCount: 1 } }, session);
        return redemption;
    }, options.session || null);
}

async function releasePromoRedemption(redemptionId, options = {}) {
    if (!redemptionId) return null;
    return withPromoRedemptionTransaction(async session => {
        const alreadyReleased = await PromoRedemption.findOne({ _id: redemptionId, status: "RELEASED" }).session(session);
        if (alreadyReleased) {
            alreadyReleased.$locals.lifecycleIdempotent = true;
            return alreadyReleased;
        }
        const redemption = await PromoRedemption.findOneAndUpdate(
            { _id: redemptionId, status: "RESERVED" },
            { $set: { status: "RELEASED", releasedAt: new Date() } },
            { returnDocument: "after", session }
        );
        if (!redemption) return null;
        redemption.$locals.lifecycleIdempotent = false;
        const global = await PromoUsageState.updateOne(
            { code: redemption.code, reservedCount: { $gt: 0 } },
            { $inc: { reservedCount: -1 } },
            { session }
        );
        if (!global.modifiedCount) throw new PromoError("PROMO_USAGE_COUNTER_CONFLICT", "Promo usage counter could not be reconciled.", 409);
        await updateLegacyUserUsage(redemption, { $inc: { reservedCount: -1 } }, session);
        return redemption;
    }, options.session || null);
}

module.exports = {
    DISCOUNT_TYPES,
    ELIGIBILITY_MODES,
    PromoError,
    archivePromo,
    buildPromoSnapshot,
    consumePromoRedemption,
    createPromo,
    getAdminPromoDetail,
    listAdminPromos,
    normalizeCode,
    normalizeOptionalCode,
    publicQuote,
    releasePromoRedemption,
    releaseExpiredReservationsForCode,
    reservePromoUse,
    resolvePromoPricing,
    resolvePromoDefinition,
    resolvePurchasePricing,
    updatePromo
};
