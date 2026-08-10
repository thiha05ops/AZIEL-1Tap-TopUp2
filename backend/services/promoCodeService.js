const PromoCode = require("../models/PromoCode");
const PromoUsageState = require("../models/PromoUsageState");
const PromoRedemption = require("../models/PromoRedemption");
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
    if (!promo.enabled) return "DISABLED";
    if (promo.startsAt && promo.startsAt > now) return "SCHEDULED";
    if (promo.endsAt && promo.endsAt < now) return "EXPIRED";
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
        perUserLimit: Number(promo.perUserLimit || 0),
        startsAt: promo.startsAt,
        endsAt: promo.endsAt,
        enabled: Boolean(promo.enabled),
        archivedAt: promo.archivedAt,
        state: activeWindowState(promo),
        consumedCount: Number(usage.consumedCount || 0),
        reservedCount: Number(usage.reservedCount || 0),
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
        perUserLimit: Math.floor(positiveNumber(payload.perUserLimit)),
        startsAt,
        endsAt,
        enabled: Boolean(payload.enabled),
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

async function createPromo(payload = {}, actor = "admin") {
    const code = normalizeCode(payload.code);
    const clean = sanitizePromoPayload(payload, null, actor);
    if (!clean.name) {
        throw new PromoError("PROMO_NAME_REQUIRED", "Promo name is required.");
    }

    const promo = await PromoCode.create({
        ...clean,
        code,
        createdBy: actor
    });

    await PromoUsageState.updateOne(
        { code },
        { $setOnInsert: { code, consumedCount: 0, reservedCount: 0 } },
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

    Object.assign(promo, clean);
    await promo.save();
    const usage = await PromoUsageState.findOne({ code: promo.code }).lean();
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
    }).select("_id");

    if (!expired.length) return 0;

    const ids = expired.map(item => item._id);
    await PromoRedemption.updateMany(
        { _id: { $in: ids }, status: "RESERVED" },
        {
            $set: {
                status: "RELEASED",
                releasedAt: new Date()
            }
        }
    );
    await PromoUsageState.updateOne(
        { code },
        { $inc: { reservedCount: -expired.length } }
    );
    return expired.length;
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

    if (promo.perUserLimit > 0 && user?.username) {
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

    const filter = { code };
    if (promo.usageLimit > 0) {
        filter.$expr = {
            $lt: [
                { $add: ["$consumedCount", "$reservedCount"] },
                Number(promo.usageLimit)
            ]
        };
    }

    const state = await PromoUsageState.findOneAndUpdate(
        filter,
        { $inc: { reservedCount: 1 } },
        { new: true }
    );

    if (!state) {
        throw new PromoError("PROMO_USAGE_LIMIT_REACHED", "This promo code has reached its usage limit.");
    }

    try {
        return await PromoRedemption.create({
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
        });
    } catch (error) {
        await PromoUsageState.updateOne({ code }, { $inc: { reservedCount: -1 } });
        throw error;
    }
}

async function consumePromoRedemption(redemptionId, orderId = "") {
    if (!redemptionId) return null;

    const redemption = await PromoRedemption.findOneAndUpdate(
        { _id: redemptionId, status: "RESERVED" },
        {
            $set: {
                status: "CONSUMED",
                consumedAt: new Date(),
                orderId: orderId || undefined
            }
        },
        { new: true }
    );

    if (!redemption) return null;
    await PromoUsageState.updateOne(
        { code: redemption.code },
        { $inc: { reservedCount: -1, consumedCount: 1 } }
    );
    return redemption;
}

async function releasePromoRedemption(redemptionId) {
    if (!redemptionId) return null;

    const redemption = await PromoRedemption.findOneAndUpdate(
        { _id: redemptionId, status: "RESERVED" },
        {
            $set: {
                status: "RELEASED",
                releasedAt: new Date()
            }
        },
        { new: true }
    );

    if (!redemption) return null;
    await PromoUsageState.updateOne(
        { code: redemption.code },
        { $inc: { reservedCount: -1 } }
    );
    return redemption;
}

module.exports = {
    DISCOUNT_TYPES,
    ELIGIBILITY_MODES,
    PromoError,
    archivePromo,
    buildPromoSnapshot,
    consumePromoRedemption,
    createPromo,
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
