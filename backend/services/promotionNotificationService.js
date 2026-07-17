const PromotionNotification = require("../models/PromotionNotification");
const Notification = require("../models/Notification");
const User = require("../models/User");
const realtime = require("./realtime");
const { getUnreadCount, normalizeNotification } = require("./notificationService");
const { parseCtaTarget, parseSchedule, parseSortOrder } = require("./gameBannerService");

const REGIONS = Object.freeze(["MM", "TH"]);
const AUDIENCES = Object.freeze(["ALL_VISITORS", "LOGGED_IN", "GUESTS"]);
const MAX_TEXT = Object.freeze({
    title: 120,
    summary: 180,
    body: 900,
    imageUrl: 500,
    ctaLabel: 40,
    promoCode: 32,
    campaignCode: 80
});

class PromotionNotificationError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "PromotionNotificationError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function cleanText(value = "", max = 120) {
    return String(value || "").trim().slice(0, max);
}

function requiredText(value, field, max) {
    const text = cleanText(value, max);
    if (!text || text.length < 2) {
        throw new PromotionNotificationError("PROMOTION_CONTENT_INVALID", `${field} is required.`);
    }
    return text;
}

function parseBoolean(value, field = "enabled") {
    if (typeof value !== "boolean") {
        throw new PromotionNotificationError("PROMOTION_PATCH_INVALID", `${field} must be true or false.`);
    }
    return value;
}

function parseRegions(value = []) {
    const raw = Array.isArray(value) ? value : [value];
    const normalized = Array.from(new Set(raw
        .map(item => String(item || "").trim().toUpperCase())
        .filter(Boolean)));

    if (normalized.includes("ALL")) return ["MM", "TH"];
    if (!normalized.length || normalized.some(item => !REGIONS.includes(item))) {
        throw new PromotionNotificationError("PROMOTION_REGION_INVALID", "Promotion region targeting is invalid.");
    }
    return normalized;
}

function parseAudience(value = "ALL_VISITORS") {
    const normalized = String(value || "").trim().toUpperCase();
    if (!AUDIENCES.includes(normalized)) {
        throw new PromotionNotificationError("PROMOTION_AUDIENCE_INVALID", "Promotion audience is invalid.");
    }
    return normalized;
}

function normalizeRegion(value = "MM") {
    return String(value || "").trim().toUpperCase() === "TH" ? "TH" : "MM";
}

function isSafeUrl(value = "") {
    const url = cleanText(value, MAX_TEXT.imageUrl);
    if (!url) return true;
    if (/^\s*(javascript|data|vbscript):/i.test(url)) return false;
    return url.startsWith("/") || /^[a-z0-9_-]+\.html/i.test(url) || /^https?:\/\//i.test(url);
}

function parseSafeOptionalUrl(value = "", field = "URL") {
    const url = cleanText(value, MAX_TEXT.imageUrl);
    if (!isSafeUrl(url)) {
        throw new PromotionNotificationError("PROMOTION_URL_INVALID", `${field} is not allowed.`);
    }
    return url;
}

function stateForPromotion(promotion = {}, now = new Date()) {
    if (promotion.enabled !== true) return "DISABLED";
    const nowMs = now.getTime();
    const start = promotion.startsAt ? new Date(promotion.startsAt).getTime() : null;
    const end = promotion.endsAt ? new Date(promotion.endsAt).getTime() : null;
    if (start && nowMs < start) return "SCHEDULED";
    if (end && nowMs >= end) return "EXPIRED";
    return "ACTIVE";
}

function isAudienceEligible(promotion = {}, user = null) {
    if (promotion.audience === "LOGGED_IN") return Boolean(user?.username || user?.id || user?._id);
    if (promotion.audience === "GUESTS") return !Boolean(user?.username || user?.id || user?._id);
    return true;
}

function isRegionEligible(promotion = {}, region = "MM") {
    const regions = Array.isArray(promotion.regions) ? promotion.regions : ["MM", "TH"];
    return regions.includes(normalizeRegion(region));
}

function isActiveEligible(promotion = {}, { user = null, region = "MM", now = new Date() } = {}) {
    return stateForPromotion(promotion, now) === "ACTIVE" &&
        isAudienceEligible(promotion, user) &&
        isRegionEligible(promotion, region);
}

function buildPayload(patch = {}, existing = null) {
    const source = existing || {};
    const schedule = parseSchedule(
        Object.prototype.hasOwnProperty.call(patch, "startsAt") ? patch.startsAt : source.startsAt,
        Object.prototype.hasOwnProperty.call(patch, "endsAt") ? patch.endsAt : source.endsAt
    );
    const ctaUrl = Object.prototype.hasOwnProperty.call(patch, "ctaUrl")
        ? parseCtaTarget(patch.ctaUrl)
        : source.ctaUrl || "";
    const ctaLabel = Object.prototype.hasOwnProperty.call(patch, "ctaLabel")
        ? cleanText(patch.ctaLabel, MAX_TEXT.ctaLabel)
        : source.ctaLabel || "";

    if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) {
        throw new PromotionNotificationError("PROMOTION_CTA_INVALID", "CTA label and URL must be configured together.");
    }

    return {
        title: Object.prototype.hasOwnProperty.call(patch, "title")
            ? requiredText(patch.title, "Title", MAX_TEXT.title)
            : source.title,
        summary: Object.prototype.hasOwnProperty.call(patch, "summary")
            ? requiredText(patch.summary, "Summary", MAX_TEXT.summary)
            : source.summary,
        body: Object.prototype.hasOwnProperty.call(patch, "body")
            ? cleanText(patch.body, MAX_TEXT.body)
            : source.body || "",
        imageUrl: Object.prototype.hasOwnProperty.call(patch, "imageUrl")
            ? parseSafeOptionalUrl(patch.imageUrl, "Image URL")
            : source.imageUrl || "",
        icon: Object.prototype.hasOwnProperty.call(patch, "icon")
            ? cleanText(patch.icon, 40) || "gift"
            : source.icon || "gift",
        ctaLabel,
        ctaUrl,
        promoCode: Object.prototype.hasOwnProperty.call(patch, "promoCode")
            ? cleanText(patch.promoCode, MAX_TEXT.promoCode).toUpperCase()
            : source.promoCode || "",
        campaignCode: Object.prototype.hasOwnProperty.call(patch, "campaignCode")
            ? cleanText(patch.campaignCode, MAX_TEXT.campaignCode).toUpperCase()
            : source.campaignCode || "",
        regions: Object.prototype.hasOwnProperty.call(patch, "regions")
            ? parseRegions(patch.regions)
            : source.regions || ["MM", "TH"],
        audience: Object.prototype.hasOwnProperty.call(patch, "audience")
            ? parseAudience(patch.audience)
            : source.audience || "ALL_VISITORS",
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        priority: Object.prototype.hasOwnProperty.call(patch, "priority")
            ? parseSortOrder(patch.priority)
            : Number(source.priority || 0),
        enabled: Object.prototype.hasOwnProperty.call(patch, "enabled")
            ? parseBoolean(patch.enabled)
            : source.enabled === true
    };
}

function projectPromotion(promotion = {}, { forPublic = false } = {}) {
    const id = String(promotion._id || promotion.id || "");
    const projected = {
        id,
        type: "promo",
        category: "promotions",
        title: promotion.title || "",
        summary: promotion.summary || "",
        message: promotion.summary || "",
        body: promotion.body || "",
        imageUrl: promotion.imageUrl || "",
        icon: promotion.icon || "gift",
        ctaLabel: promotion.ctaLabel || "",
        ctaUrl: promotion.ctaUrl || "",
        action: promotion.ctaUrl
            ? { type: "navigate", label: promotion.ctaLabel || "View", url: promotion.ctaUrl }
            : null,
        promoCode: promotion.promoCode || "",
        campaignCode: promotion.campaignCode || "",
        regions: Array.isArray(promotion.regions) ? promotion.regions : ["MM", "TH"],
        audience: promotion.audience || "ALL_VISITORS",
        startsAt: promotion.startsAt || null,
        endsAt: promotion.endsAt || null,
        priority: Number(promotion.priority || 0),
        enabled: promotion.enabled === true,
        state: stateForPromotion(promotion),
        publishedAt: promotion.publishedAt || null,
        createdAt: promotion.createdAt || null,
        updatedAt: promotion.updatedAt || null
    };

    if (forPublic) {
        delete projected.enabled;
        delete projected.audience;
    }

    return projected;
}

async function listAdminPromotionNotifications() {
    const promotions = await PromotionNotification.find({})
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

    return {
        promotions: promotions.map(item => projectPromotion(item))
    };
}

async function createPromotionNotification({ patch = {}, actor = "admin" } = {}) {
    const payload = buildPayload(patch);
    const promotion = await PromotionNotification.create({
        ...payload,
        enabled: payload.enabled === true,
        publishedAt: payload.enabled === true ? new Date() : null,
        createdBy: actor,
        updatedBy: actor
    });

    return projectPromotion(promotion);
}

async function updatePromotionNotification({ promotionId, patch = {}, actor = "admin" } = {}) {
    const promotion = await PromotionNotification.findById(promotionId);
    if (!promotion) {
        throw new PromotionNotificationError("PROMOTION_NOT_FOUND", "Promotion notification not found.", 404);
    }

    const wasEnabled = promotion.enabled === true;
    const payload = buildPayload(patch, promotion.toObject());
    Object.entries(payload).forEach(([key, value]) => promotion.set(key, value));
    if (!wasEnabled && payload.enabled === true && !promotion.publishedAt) {
        promotion.publishedAt = new Date();
    }
    if (wasEnabled && payload.enabled === false) {
        promotion.disabledAt = new Date();
    }
    promotion.updatedBy = actor;
    await promotion.save();

    return projectPromotion(promotion);
}

async function publishPromotionNotification({ promotionId, actor = "admin" } = {}) {
    const promotion = await PromotionNotification.findById(promotionId);
    if (!promotion) {
        throw new PromotionNotificationError("PROMOTION_NOT_FOUND", "Promotion notification not found.", 404);
    }

    promotion.enabled = true;
    promotion.publishedAt = promotion.publishedAt || new Date();
    promotion.disabledAt = null;
    promotion.updatedBy = actor;
    await promotion.save();

    const delivered = await materializePromotionForEligibleUsers(promotion);
    return {
        promotion: projectPromotion(promotion),
        delivered
    };
}

async function disablePromotionNotification({ promotionId, actor = "admin" } = {}) {
    const promotion = await PromotionNotification.findById(promotionId);
    if (!promotion) {
        throw new PromotionNotificationError("PROMOTION_NOT_FOUND", "Promotion notification not found.", 404);
    }

    promotion.enabled = false;
    promotion.disabledAt = new Date();
    promotion.updatedBy = actor;
    await promotion.save();

    return projectPromotion(promotion);
}

function userMatchesPromotion(user = {}, promotion = {}) {
    return isRegionEligible(promotion, user.region || "MM") &&
        (promotion.audience === "GUESTS" ? false : true);
}

async function materializePromotionForEligibleUsers(promotion = {}) {
    const users = await User.find({})
        .select("_id username region")
        .lean();
    let created = 0;

    for (const user of users) {
        if (!user?.username || !userMatchesPromotion(user, promotion)) continue;

        const existing = await Notification.findOne({
            userId: user._id,
            type: "promo",
            category: "promotions",
            "metadata.promotionNotificationId": String(promotion._id)
        }).select("_id").lean();

        if (existing) continue;

        const notification = await Notification.create({
            userId: user._id,
            username: user.username,
            title: promotion.title,
            message: promotion.summary,
            type: "promo",
            category: "promotions",
            action: promotion.ctaUrl
                ? { type: "navigate", label: promotion.ctaLabel || "View", url: promotion.ctaUrl }
                : null,
            metadata: {
                promotionNotificationId: String(promotion._id),
                promoCode: promotion.promoCode || "",
                campaignCode: promotion.campaignCode || "",
                startsAt: promotion.startsAt || null,
                endsAt: promotion.endsAt || null,
                imageUrl: promotion.imageUrl || ""
            },
            source: "admin_promotion",
            deletedByUser: false,
            isRead: false
        });

        created += 1;

        const normalized = normalizeNotification(notification);
        const unreadCount = await getUnreadCount(user);
        await realtime.emitNotification(user.username, normalized, { unreadCount });
    }

    return { count: created };
}

async function listActivePromotionPreview({
    user = null,
    region = "MM",
    limit = 3,
    now = new Date()
} = {}) {
    const max = Math.min(Math.max(Number(limit) || 3, 1), 6);
    const normalizedRegion = normalizeRegion(user?.region || region);
    const authenticated = Boolean(user?.username || user?.id || user?._id);
    const audience = authenticated
        ? ["ALL_VISITORS", "LOGGED_IN"]
        : ["ALL_VISITORS", "GUESTS"];

    const candidates = await PromotionNotification.find({
        enabled: true,
        regions: normalizedRegion,
        audience: { $in: audience },
        $and: [
            { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
            { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }
        ]
    })
        .sort({ priority: -1, publishedAt: -1, createdAt: -1, _id: -1 })
        .lean();

    const eligible = candidates.filter(item => isActiveEligible(item, { user, region: normalizedRegion, now }));

    return {
        count: eligible.length,
        countLabel: eligible.length > 9 ? "9+" : String(eligible.length),
        promotions: eligible.slice(0, max).map(item => projectPromotion(item, { forPublic: true }))
    };
}

module.exports = {
    AUDIENCES,
    PromotionNotificationError,
    REGIONS,
    createPromotionNotification,
    disablePromotionNotification,
    listActivePromotionPreview,
    listAdminPromotionNotifications,
    projectPromotion,
    publishPromotionNotification,
    updatePromotionNotification
};
