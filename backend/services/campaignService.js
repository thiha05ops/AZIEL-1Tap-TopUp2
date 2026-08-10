const Campaign = require("../models/Campaign");
const CampaignClaimState = require("../models/CampaignClaimState");
const CampaignImpression = require("../models/CampaignImpression");
const MediaAsset = require("../models/MediaAsset");
const { assertAssetCategory, projectMediaAsset } = require("./mediaService");
const { parseCtaTarget, parseSchedule, parseSortOrder } = require("./gameBannerService");
const { CANONICAL_OPERATIONAL_PRODUCTS, getCanonicalProduct, isCanonicalProductCode } = require("../catalog/canonicalOperationalCatalog");
const { CAMPAIGN_PLACEMENT_DEFINITIONS, CAMPAIGN_PLACEMENTS, getCampaignPlacementDefinition } = require("../catalog/campaignPlacements");
const { normalizeCampaignLocales } = require("../catalog/localizedContent");

const CAMPAIGN_TYPES = Object.freeze(["PROMOTION", "NEW_GAME", "ANNOUNCEMENT", "IMPORTANT_UPDATE"]);
const CAMPAIGN_MEDIA_CATEGORIES = Object.freeze(["campaign", "promotion", "announcement"]);
const CAMPAIGN_REGIONS = Object.freeze(["MM", "TH"]);
const CAMPAIGN_AUDIENCES = Object.freeze(["ALL_VISITORS", "LOGGED_IN", "GUESTS"]);
const CAMPAIGN_FREQUENCIES = Object.freeze([
    "ONCE_PER_SESSION",
    "ONCE_PER_DAY",
    "ONCE_EVERY_3_DAYS",
    "ONCE_PER_CAMPAIGN"
]);
const BANGKOK_TIMEZONE = "Asia/Bangkok";
const MAX_PRIORITY = 1000000;

class CampaignError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "CampaignError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function cleanText(value = "", max = 120) {
    return String(value || "").trim().slice(0, max);
}

function parseLocalizedCampaignContent(locales, english) {
    try {
        return normalizeCampaignLocales(locales, english);
    } catch (error) {
        throw new CampaignError(error.code || "CAMPAIGN_CONTENT_INVALID", error.message);
    }
}

function normalizeCampaignCode(value = "") {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
}

function parseEnum(value, allowed, code, label) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!allowed.includes(normalized)) {
        throw new CampaignError(code, `${label} is invalid.`);
    }
    return normalized;
}

function parseCampaignCode(value) {
    const code = normalizeCampaignCode(value);
    if (!code || code.length < 3) {
        throw new CampaignError("CAMPAIGN_CODE_INVALID", "Campaign code is required.");
    }
    return code;
}

function parseRequiredText(value, field, max) {
    const text = cleanText(value, max);
    if (!text || text.length < 2) {
        throw new CampaignError("CAMPAIGN_CONTENT_INVALID", `${field} is required.`);
    }
    return text;
}

function parseBoolean(value, field = "enabled") {
    if (typeof value !== "boolean") {
        throw new CampaignError("CAMPAIGN_PATCH_INVALID", `${field} must be true or false.`);
    }
    return value;
}

function parsePriority(value = 0) {
    const priority = parseSortOrder(value);
    if (Math.abs(priority) > MAX_PRIORITY) {
        throw new CampaignError("CAMPAIGN_PRIORITY_INVALID", "Priority is outside the allowed range.");
    }
    return priority;
}

function parseRegions(value = []) {
    const raw = Array.isArray(value) ? value : [value];
    const normalized = Array.from(new Set(raw.map(item => String(item || "").trim().toUpperCase()).filter(Boolean)));

    if (normalized.includes("ALL")) {
        return ["MM", "TH"];
    }

    if (!normalized.length || normalized.some(item => !CAMPAIGN_REGIONS.includes(item))) {
        throw new CampaignError("CAMPAIGN_REGION_INVALID", "Campaign region targeting is invalid.");
    }

    return normalized;
}

function parseCtaPair(labelValue = "", targetValue = "") {
    const ctaLabel = cleanText(labelValue, 40);
    const ctaTarget = parseCtaTarget(targetValue);

    if ((ctaLabel && !ctaTarget) || (!ctaLabel && ctaTarget)) {
        throw new CampaignError("CAMPAIGN_CTA_INVALID", "CTA label and target must be configured together.");
    }
    if (ctaTarget && (/^\/\//.test(ctaTarget) || (!ctaTarget.startsWith("/") && !/^https:\/\//i.test(ctaTarget)))) {
        throw new CampaignError("CAMPAIGN_CTA_INVALID", "CTA target must be an internal AZIEL path or an HTTPS URL.");
    }

    return { ctaLabel, ctaTarget };
}

async function assertCampaignMedia(mediaAssetId = "") {
    const id = cleanText(mediaAssetId, 96);
    if (!id) return "";

    let lastError = null;
    for (const category of CAMPAIGN_MEDIA_CATEGORIES) {
        try {
            await assertAssetCategory(id, category);
            return id;
        } catch (error) {
            lastError = error;
            if (error.statusCode === 404) throw error;
        }
    }

    throw new CampaignError(
        "CAMPAIGN_MEDIA_CATEGORY_INVALID",
        "Campaign image must be a campaign, promotion, or announcement asset.",
        lastError?.statusCode === 404 ? 404 : 400
    );
}

function buildCampaignPayload(patch = {}, existing = null) {
    const source = existing || {};
    const schedule = parseSchedule(
        Object.prototype.hasOwnProperty.call(patch, "startsAt") ? patch.startsAt : source.startsAt,
        Object.prototype.hasOwnProperty.call(patch, "endsAt") ? patch.endsAt : source.endsAt
    );
    const cta = parseCtaPair(
        Object.prototype.hasOwnProperty.call(patch, "ctaLabel") ? patch.ctaLabel : source.ctaLabel,
        Object.prototype.hasOwnProperty.call(patch, "ctaTarget") ? patch.ctaTarget : source.ctaTarget
    );
    const locales = parseLocalizedCampaignContent(
        Object.prototype.hasOwnProperty.call(patch, "locales") ? patch.locales : source.locales,
        {
            title: Object.prototype.hasOwnProperty.call(patch, "title") ? patch.title : source.title,
            body: Object.prototype.hasOwnProperty.call(patch, "body") ? patch.body : source.body,
            ctaLabel: cta.ctaLabel
        }
    );

    const placement = Object.prototype.hasOwnProperty.call(patch, "placement")
        ? parseEnum(patch.placement, CAMPAIGN_PLACEMENTS, "CAMPAIGN_PLACEMENT_INVALID", "Campaign placement")
        : source.placement || "ENTRY_POPUP";
    const requestedProductCode = cleanText(Object.prototype.hasOwnProperty.call(patch, "targetProductCode") ? patch.targetProductCode : source.targetProductCode, 80).toLowerCase();
    if (getCampaignPlacementDefinition(placement).requiresProductTarget && !isCanonicalProductCode(requestedProductCode)) {
        throw new CampaignError("CAMPAIGN_PRODUCT_TARGET_INVALID", "Product Notice requires a canonical AZIEL product target.");
    }

    return {
        campaignCode: existing
            ? source.campaignCode
            : parseCampaignCode(patch.campaignCode),
        name: Object.prototype.hasOwnProperty.call(patch, "name")
            ? parseRequiredText(patch.name, "Campaign name", 120)
            : source.name,
        type: Object.prototype.hasOwnProperty.call(patch, "type")
            ? parseEnum(patch.type, CAMPAIGN_TYPES, "CAMPAIGN_TYPE_INVALID", "Campaign type")
            : source.type,
        placement,
        targetProductCode: placement === "PRODUCT_NOTICE" ? requestedProductCode : "",
        title: Object.prototype.hasOwnProperty.call(patch, "title")
            ? parseRequiredText(patch.title, "Title", 120)
            : source.title,
        body: Object.prototype.hasOwnProperty.call(patch, "body")
            ? parseRequiredText(patch.body, "Body", 700)
            : source.body,
        mediaAssetId: Object.prototype.hasOwnProperty.call(patch, "mediaAssetId")
            ? cleanText(patch.mediaAssetId, 96)
            : source.mediaAssetId || "",
        ...cta,
        locales,
        regions: Object.prototype.hasOwnProperty.call(patch, "regions")
            ? parseRegions(patch.regions)
            : source.regions || ["MM", "TH"],
        audience: Object.prototype.hasOwnProperty.call(patch, "audience")
            ? parseEnum(patch.audience, CAMPAIGN_AUDIENCES, "CAMPAIGN_AUDIENCE_INVALID", "Campaign audience")
            : source.audience || "ALL_VISITORS",
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        frequencyPolicy: Object.prototype.hasOwnProperty.call(patch, "frequencyPolicy")
            ? parseEnum(patch.frequencyPolicy, CAMPAIGN_FREQUENCIES, "CAMPAIGN_FREQUENCY_INVALID", "Campaign frequency")
            : source.frequencyPolicy || "ONCE_PER_SESSION",
        priority: Object.prototype.hasOwnProperty.call(patch, "priority")
            ? parsePriority(patch.priority)
            : Number(source.priority || 0),
        enabled: Object.prototype.hasOwnProperty.call(patch, "enabled")
            ? parseBoolean(patch.enabled)
            : source.enabled === true
    };
}

async function loadMediaMap(campaigns = []) {
    const ids = Array.from(new Set(campaigns.map(item => item.mediaAssetId).filter(Boolean)));
    if (!ids.length) return new Map();
    const assets = await MediaAsset.find({ assetId: { $in: ids }, status: "active" }).lean();
    return new Map(assets.map(asset => [asset.assetId, asset]));
}

function getProjectedState(campaign = {}, now = new Date()) {
    if (campaign.enabled !== true) return campaign.hasBeenEnabled === true ? "DISABLED" : "DRAFT";
    const nowMs = now.getTime();
    const start = campaign.startsAt ? new Date(campaign.startsAt).getTime() : null;
    const end = campaign.endsAt ? new Date(campaign.endsAt).getTime() : null;

    if (start && nowMs < start) return "SCHEDULED";
    if (end && nowMs >= end) return "EXPIRED";
    return "ACTIVE";
}

function projectAdminCampaign(campaign = {}, mediaMap = new Map()) {
    const asset = mediaMap.get(campaign.mediaAssetId);

    return {
        id: String(campaign._id || ""),
        campaignCode: campaign.campaignCode,
        name: campaign.name,
        type: campaign.type,
        placement: campaign.placement,
        placementDefinition: CAMPAIGN_PLACEMENT_DEFINITIONS[campaign.placement],
        targetProductCode: campaign.targetProductCode || "",
        targetProductName: getCanonicalProduct(campaign.targetProductCode)?.name || "",
        title: campaign.title,
        body: campaign.body,
        mediaAssetId: campaign.mediaAssetId || "",
        mediaAsset: projectMediaAsset(asset),
        ctaLabel: campaign.ctaLabel || "",
        locales: normalizeCampaignLocales(campaign.locales, campaign),
        ctaTarget: campaign.ctaTarget || "",
        regions: Array.isArray(campaign.regions) ? campaign.regions : ["MM", "TH"],
        audience: campaign.audience || "ALL_VISITORS",
        startsAt: campaign.startsAt || null,
        endsAt: campaign.endsAt || null,
        frequencyPolicy: campaign.frequencyPolicy || "ONCE_PER_SESSION",
        priority: Number(campaign.priority || 0),
        enabled: campaign.enabled === true,
        hasBeenEnabled: campaign.hasBeenEnabled === true || campaign.enabled === true,
        state: getProjectedState(campaign),
        createdAt: campaign.createdAt || null,
        updatedAt: campaign.updatedAt || null
    };
}

function projectPublicCampaign(campaign = {}, mediaMap = new Map()) {
    const asset = mediaMap.get(campaign.mediaAssetId);

    return {
        campaignCode: campaign.campaignCode,
        campaignVersion: campaign.updatedAt ? new Date(campaign.updatedAt).getTime().toString(36) : "v1",
        type: campaign.type,
        placement: campaign.placement,
        targetProductCode: campaign.targetProductCode || "",
        title: campaign.title,
        body: campaign.body,
        imageUrl: asset ? asset.secureUrl || asset.url || "" : "",
        imageAltText: asset ? asset.altText || campaign.title || "" : "",
        ctaLabel: campaign.ctaLabel || "",
        locales: normalizeCampaignLocales(campaign.locales, campaign),
        ctaTarget: campaign.ctaTarget || "",
        frequencyPolicy: campaign.frequencyPolicy || "ONCE_PER_SESSION",
        priority: Number(campaign.priority || 0)
    };
}

async function listAdminCampaigns() {
    const campaigns = await Campaign.find({ archivedAt: null })
        .sort({ priority: -1, startsAt: 1, createdAt: 1, campaignCode: 1 })
        .lean();
    const mediaMap = await loadMediaMap(campaigns);

    return {
        campaigns: campaigns.map(item => projectAdminCampaign(item, mediaMap)),
        placements: Object.values(CAMPAIGN_PLACEMENT_DEFINITIONS),
        canonicalProducts: CANONICAL_OPERATIONAL_PRODUCTS.map(product => ({ productCode: product.productCode, name: product.name, family: product.family, category: product.adminCategory }))
    };
}

async function createCampaign({ patch = {}, actor = "admin" } = {}) {
    const payload = buildCampaignPayload(patch);
    payload.mediaAssetId = await assertCampaignMedia(payload.mediaAssetId);

    const existing = await Campaign.findOne({ campaignCode: payload.campaignCode }).lean();
    if (existing) {
        throw new CampaignError("CAMPAIGN_ALREADY_EXISTS", "Campaign code already exists.", 409);
    }

    try {
        const campaign = await Campaign.create({
            ...payload,
            hasBeenEnabled: payload.enabled === true,
            createdBy: actor,
            updatedBy: actor
        });
        return { changed: true, campaign: campaign.toObject() };
    } catch (error) {
        if (error?.code === 11000) {
            throw new CampaignError("CAMPAIGN_ALREADY_EXISTS", "Campaign code already exists.", 409);
        }
        throw error;
    }
}

async function updateCampaign({ campaignId, patch = {}, actor = "admin" } = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, "campaignCode")) {
        throw new CampaignError("CAMPAIGN_CODE_IMMUTABLE", "Campaign code cannot be changed.");
    }

    const campaign = await Campaign.findOne({ _id: campaignId, archivedAt: null });
    if (!campaign) {
        throw new CampaignError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    }

    const existing = campaign.toObject();
    const payload = buildCampaignPayload(patch, existing);
    payload.mediaAssetId = await assertCampaignMedia(payload.mediaAssetId);
    const deliveryFields = ["type", "placement", "targetProductCode", "title", "body", "locales", "mediaAssetId", "ctaLabel", "ctaTarget", "regions", "audience", "startsAt", "endsAt", "frequencyPolicy"];
    const deliveryChanged = deliveryFields.some(key => JSON.stringify(existing[key] ?? null) !== JSON.stringify(payload[key] ?? null));

    Object.entries(payload).forEach(([key, value]) => {
        if (key !== "campaignCode") campaign.set(key, value);
    });
    if (payload.enabled === true) campaign.hasBeenEnabled = true;
    campaign.updatedBy = actor;
    await campaign.save();
    if (deliveryChanged) {
        await CampaignClaimState.deleteMany({ campaignCode: campaign.campaignCode });
    }

    return { changed: true, campaign: campaign.toObject() };
}

async function removeCampaign({ campaignId, actor = "admin" } = {}) {
    const campaign = await Campaign.findOne({ _id: campaignId, archivedAt: null });
    if (!campaign) {
        throw new CampaignError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    }

    campaign.enabled = false;
    campaign.archivedAt = new Date();
    campaign.updatedBy = actor;
    await campaign.save();

    return { removed: true, campaignId };
}

function isScheduleEligible(campaign, now = new Date()) {
    if (campaign.enabled !== true) return false;
    if (campaign.archivedAt) return false;
    const nowMs = now.getTime();
    const start = campaign.startsAt ? new Date(campaign.startsAt).getTime() : null;
    const end = campaign.endsAt ? new Date(campaign.endsAt).getTime() : null;

    if (start && nowMs < start) return false;
    if (end && nowMs >= end) return false;
    return true;
}

function isRegionEligible(campaign, region) {
    const normalized = region === "TH" ? "TH" : "MM";
    const regions = Array.isArray(campaign.regions) ? campaign.regions : [];
    return regions.includes(normalized);
}

function isAudienceEligible(campaign, isAuthenticated) {
    if (campaign.audience === "LOGGED_IN") return isAuthenticated;
    if (campaign.audience === "GUESTS") return !isAuthenticated;
    return true;
}

function isProductEligible(campaign, productCode = "") {
    if (campaign.placement !== "PRODUCT_NOTICE") return true;
    return cleanText(campaign.targetProductCode, 80).toLowerCase() === cleanText(productCode, 80).toLowerCase();
}

function rankCampaignCandidates(campaigns = []) {
    return [...campaigns].sort((left, right) =>
        Number(right.priority || 0) - Number(left.priority || 0) ||
        Number(new Date(left.startsAt || 0)) - Number(new Date(right.startsAt || 0)) ||
        Number(new Date(left.createdAt || 0)) - Number(new Date(right.createdAt || 0)) ||
        String(left.campaignCode || "").localeCompare(String(right.campaignCode || ""))
    );
}

async function resolveCampaignCandidates({ placement = "ENTRY_POPUP", productCode = "", region = "MM", isAuthenticated = false, now = new Date() } = {}) {
    const definition = getCampaignPlacementDefinition(placement);
    if (!definition) throw new CampaignError("CAMPAIGN_PLACEMENT_INVALID", "Campaign placement is invalid.");
    const normalizedProductCode = cleanText(productCode, 80).toLowerCase();
    if (definition.requiresProductTarget && !isCanonicalProductCode(normalizedProductCode)) {
        throw new CampaignError("CAMPAIGN_PRODUCT_TARGET_INVALID", "A canonical product is required for this placement.");
    }
    const campaigns = await Campaign.find({
        placement: definition.code,
        ...(definition.requiresProductTarget ? { targetProductCode: normalizedProductCode } : {}),
        archivedAt: null,
        enabled: true
    })
        .sort({ priority: -1, startsAt: 1, createdAt: 1, campaignCode: 1 })
        .lean();

    return rankCampaignCandidates(campaigns.filter(campaign => (
        isScheduleEligible(campaign, now) &&
        isRegionEligible(campaign, region) &&
        isAudienceEligible(campaign, isAuthenticated) &&
        isProductEligible(campaign, normalizedProductCode)
    )));
}

const resolveEntryPopupCandidates = options => resolveCampaignCandidates({ ...options, placement: "ENTRY_POPUP" });

function bangkokDayKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BANGKOK_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function cleanSessionKey(value = "") {
    return String(value || "")
        .replace(/[^a-zA-Z0-9._:-]/g, "")
        .slice(0, 96);
}

function claimFilterForPolicy({ campaign, userId, now, sessionKey }) {
    const base = {
        campaignCode: campaign.campaignCode,
        userId,
        placement: campaign.placement
    };

    if (campaign.frequencyPolicy === "ONCE_PER_CAMPAIGN") {
        return {
            ...base,
            $or: [
                { lastShownAt: { $exists: false } },
                { lastShownAt: null }
            ]
        };
    }

    if (campaign.frequencyPolicy === "ONCE_PER_DAY") {
        return {
            ...base,
            $or: [
                { lastDayKey: { $exists: false } },
                { lastDayKey: { $ne: bangkokDayKey(now) } }
            ]
        };
    }

    if (campaign.frequencyPolicy === "ONCE_EVERY_3_DAYS") {
        return {
            ...base,
            $or: [
                { lastShownAt: { $exists: false } },
                { lastShownAt: null },
                { lastShownAt: { $lt: new Date(now.getTime() - 72 * 60 * 60 * 1000) } }
            ]
        };
    }

    return {
        ...base,
        sessionKeys: { $ne: sessionKey }
    };
}

async function tryClaimForAuthenticatedUser({ campaign, userId, sessionKey = "", now = new Date() } = {}) {
    const cleanKey = cleanSessionKey(sessionKey) || "default-session";
    const dayKey = bangkokDayKey(now);
    const filter = claimFilterForPolicy({ campaign, userId, now, sessionKey: cleanKey });
    const update = {
        $set: {
            campaignCode: campaign.campaignCode,
            userId,
            placement: campaign.placement,
            lastShownAt: now,
            lastDayKey: dayKey
        },
        $setOnInsert: {
            sessionKeys: []
        }
    };

    if (campaign.frequencyPolicy === "ONCE_PER_SESSION") {
        update.$addToSet = { sessionKeys: cleanKey };
    }

    try {
        const result = await CampaignClaimState.updateOne(filter, update, { upsert: true });
        const claimed = Boolean(result.upsertedCount || result.modifiedCount);
        if (!claimed) return false;

        await CampaignImpression.create({
            campaignId: campaign._id,
            campaignCode: campaign.campaignCode,
            userId,
            placement: campaign.placement,
            frequencyPolicy: campaign.frequencyPolicy,
            dayKey,
            sessionKey: campaign.frequencyPolicy === "ONCE_PER_SESSION" ? cleanKey : "",
            shownAt: now
        });

        return true;
    } catch (error) {
        if (error?.code === 11000) return false;
        throw error;
    }
}

async function claimCampaignPlacement({ placement = "ENTRY_POPUP", productCode = "", region = "MM", user = null, sessionKey = "", now = new Date() } = {}) {
    const isAuthenticated = Boolean(user?.id);
    const candidates = await resolveCampaignCandidates({ placement, productCode, region, isAuthenticated, now });
    const mediaMap = await loadMediaMap(candidates);

    if (!isAuthenticated) {
        return {
            authenticated: false,
            timezone: BANGKOK_TIMEZONE,
            campaigns: candidates.map(item => projectPublicCampaign(item, mediaMap))
        };
    }

    for (const campaign of candidates) {
        const claimed = await tryClaimForAuthenticatedUser({
            campaign,
            userId: user.id,
            sessionKey,
            now
        });

        if (claimed) {
            return {
                authenticated: true,
                timezone: BANGKOK_TIMEZONE,
                campaign: projectPublicCampaign(campaign, mediaMap)
            };
        }
    }

    return {
        authenticated: true,
        timezone: BANGKOK_TIMEZONE,
        campaign: null
    };
}

const claimEntryPopup = options => claimCampaignPlacement({ ...options, placement: "ENTRY_POPUP" });

module.exports = {
    BANGKOK_TIMEZONE,
    CAMPAIGN_AUDIENCES,
    CAMPAIGN_FREQUENCIES,
    CAMPAIGN_MEDIA_CATEGORIES,
    CAMPAIGN_PLACEMENTS,
    CAMPAIGN_REGIONS,
    CAMPAIGN_TYPES,
    CampaignError,
    bangkokDayKey,
    buildCampaignPayload,
    claimEntryPopup,
    claimCampaignPlacement,
    createCampaign,
    listAdminCampaigns,
    normalizeCampaignCode,
    removeCampaign,
    resolveEntryPopupCandidates,
    resolveCampaignCandidates,
    getProjectedState,
    isAudienceEligible,
    isRegionEligible,
    isScheduleEligible,
    isProductEligible,
    projectPublicCampaign,
    rankCampaignCandidates,
    updateCampaign
};
