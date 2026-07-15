const AdminAuditLog = require("../models/AdminAuditLog");
const {
    applyCursorFilter,
    escapeRegex,
    pageResult,
    parseLimit
} = require("./paginationService");

const ADMIN_AUDIT_ACTIONS = Object.freeze({
    ADMIN_LOGIN_SUCCESS: "ADMIN_LOGIN_SUCCESS",
    ADMIN_LOGIN_FAILED: "ADMIN_LOGIN_FAILED",
    ADMIN_2FA_CHALLENGE: "ADMIN_2FA_CHALLENGE",
    ADMIN_2FA_SUCCESS: "ADMIN_2FA_SUCCESS",
    ADMIN_2FA_FAILED: "ADMIN_2FA_FAILED",
    ADMIN_LOGOUT: "ADMIN_LOGOUT",
    ADMIN_SESSION_REVOKED: "ADMIN_SESSION_REVOKED",
    ADMIN_ACCOUNT_CREATED: "ADMIN_ACCOUNT_CREATED",
    ADMIN_ACCOUNT_ROLE_CHANGED: "ADMIN_ACCOUNT_ROLE_CHANGED",
    ADMIN_ACCOUNT_DISABLED: "ADMIN_ACCOUNT_DISABLED",
    ADMIN_ACCOUNT_ENABLED: "ADMIN_ACCOUNT_ENABLED",
    ADMIN_PASSWORD_CHANGED: "ADMIN_PASSWORD_CHANGED",
    ADMIN_2FA_ENABLED: "ADMIN_2FA_ENABLED",
    ADMIN_2FA_DISABLED: "ADMIN_2FA_DISABLED",
    ADMIN_2FA_RESET: "ADMIN_2FA_RESET",
    ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
    REFUND_APPROVED: "REFUND_APPROVED",
    REFUND_REJECTED: "REFUND_REJECTED",
    WALLET_TOPUP_APPROVED: "WALLET_TOPUP_APPROVED",
    WALLET_TOPUP_REJECTED: "WALLET_TOPUP_REJECTED",
    CATALOG_PRODUCT_UPDATED: "CATALOG_PRODUCT_UPDATED",
    CATALOG_PACKAGE_CREATED: "CATALOG_PACKAGE_CREATED",
    CATALOG_PACKAGE_UPDATED: "CATALOG_PACKAGE_UPDATED",
    GAME_BANNER_CREATED: "GAME_BANNER_CREATED",
    GAME_BANNER_UPDATED: "GAME_BANNER_UPDATED",
    GAME_BANNER_REMOVED: "GAME_BANNER_REMOVED",
    MEDIA_UPLOADED: "MEDIA_UPLOADED",
    MEDIA_REMOVED: "MEDIA_REMOVED",
    HOME_BANNER_CREATED: "HOME_BANNER_CREATED",
    HOME_BANNER_UPDATED: "HOME_BANNER_UPDATED",
    HOME_BANNER_REMOVED: "HOME_BANNER_REMOVED",
    SITE_PLACEMENT_UPDATED: "SITE_PLACEMENT_UPDATED",
    CAMPAIGN_CREATED: "CAMPAIGN_CREATED",
    CAMPAIGN_UPDATED: "CAMPAIGN_UPDATED",
    CAMPAIGN_REMOVED: "CAMPAIGN_REMOVED",
    PROMO_CREATED: "PROMO_CREATED",
    PROMO_UPDATED: "PROMO_UPDATED",
    PROMO_ARCHIVED: "PROMO_ARCHIVED",
    PAYMENT_METHOD_UPDATED: "PAYMENT_METHOD_UPDATED",
    SETTINGS_UPDATED: "SETTINGS_UPDATED",
    SUPPLIER_CREATED: "SUPPLIER_CREATED",
    SUPPLIER_UPDATED: "SUPPLIER_UPDATED",
    SUPPLIER_ENABLED: "SUPPLIER_ENABLED",
    SUPPLIER_DISABLED: "SUPPLIER_DISABLED",
    SUPPLIER_BALANCE_UPDATED: "SUPPLIER_BALANCE_UPDATED",
    SUPPLIER_MAPPING_CREATED: "SUPPLIER_MAPPING_CREATED",
    SUPPLIER_MAPPING_UPDATED: "SUPPLIER_MAPPING_UPDATED",
    SUPPLIER_MAPPING_DISABLED: "SUPPLIER_MAPPING_DISABLED",
    FULFILLMENT_STARTED: "FULFILLMENT_STARTED",
    FULFILLMENT_SUCCEEDED: "FULFILLMENT_SUCCEEDED",
    FULFILLMENT_FAILED: "FULFILLMENT_FAILED",
    FULFILLMENT_CANCELLED: "FULFILLMENT_CANCELLED"
});

function sanitizeAuditMetadata(value, depth = 0) {
    if (depth > 4) return "[omitted]";
    if (value == null) return value;

    if (Array.isArray(value)) {
        return value.slice(0, 50).map(item => sanitizeAuditMetadata(item, depth + 1));
    }

    if (typeof value === "object") {
        const safe = {};
        Object.entries(value).forEach(([key, item]) => {
            if (/password|hash|secret|totp|otp|codeInput|authorization|jwt|token|session/i.test(key)) return;
            safe[key] = sanitizeAuditMetadata(item, depth + 1);
        });
        return safe;
    }

    if (typeof value === "string") {
        return value.length > 500 ? `${value.slice(0, 500)}...` : value;
    }

    return value;
}

function actorSnapshot(admin = {}) {
    return {
        actorAdminId: admin.id || admin.adminId || admin._id || null,
        actorUsernameSnapshot: admin.username || "",
        actorRoleSnapshot: admin.role || ""
    };
}

async function writeAdminAudit({
    actor = null,
    req = null,
    action,
    resourceType = "",
    resourceId = "",
    targetAdminId = null,
    metadata = {}
} = {}) {
    if (!action) return null;

    return AdminAuditLog.create({
        ...actorSnapshot(actor || req?.admin || {}),
        action,
        resourceType,
        resourceId: String(resourceId || ""),
        targetAdminId,
        requestId: req?.id || req?.headers?.["x-request-id"] || "",
        route: req?.originalUrl || "",
        method: req?.method || "",
        metadata: sanitizeAuditMetadata(metadata)
    });
}

async function listAdminAuditLogs(query = {}) {
    const limit = parseLimit(query.limit, { defaultLimit: 25, maxLimit: 100 });
    const filter = {};

    if (query.action) filter.action = String(query.action);
    if (query.resourceType) filter.resourceType = String(query.resourceType);
    if (query.actor) {
        filter.actorUsernameSnapshot = new RegExp(`^${escapeRegex(String(query.actor).slice(0, 80))}`, "i");
    }
    if (query.from || query.to) {
        filter.createdAt = {};
        if (query.from) filter.createdAt.$gte = new Date(query.from);
        if (query.to) filter.createdAt.$lte = new Date(query.to);
    }

    const raw = await AdminAuditLog.find(applyCursorFilter(filter, query.cursor))
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();
    const { page, pagination } = pageResult(raw, limit);
    const events = page.map(event => ({
        id: String(event._id),
        actorUsernameSnapshot: event.actorUsernameSnapshot,
        actorRoleSnapshot: event.actorRoleSnapshot,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        targetAdminId: event.targetAdminId ? String(event.targetAdminId) : null,
        route: event.route,
        method: event.method,
        metadata: sanitizeAuditMetadata(event.metadata || {}),
        createdAt: event.createdAt
    }));

    return {
        events,
        items: events,
        limit,
        pagination
    };
}

module.exports = {
    ADMIN_AUDIT_ACTIONS,
    listAdminAuditLogs,
    sanitizeAuditMetadata,
    writeAdminAudit
};
