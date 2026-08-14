const StorefrontSection = require("../models/StorefrontSection");

class StorefrontSectionError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "StorefrontSectionError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const ALLOWED_STATUSES = new Set(["PUBLISHED", "COMING_SOON", "HIDDEN"]);
const MAX_SORT_ORDER = 1000000;

const SYSTEM_SECTIONS = Object.freeze([
    {
        key: "mobile-games",
        displayName: "Mobile Games",
        icon: "mobile",
        path: "/mobile-games.html",
        status: "PUBLISHED",
        showInGamesMenu: true,
        showOnHome: false,
        sortOrder: 1,
        isSystem: true
    },
    {
        key: "pc-games",
        displayName: "PC Games",
        icon: "desktop",
        path: "/pc-games.html",
        status: "COMING_SOON",
        showInGamesMenu: true,
        showOnHome: false,
        sortOrder: 2,
        isSystem: true
    },
    {
        key: "gift-cards",
        displayName: "Gift Cards",
        icon: "gift",
        path: "/gift-cards.html",
        status: "PUBLISHED",
        showInGamesMenu: true,
        showOnHome: false,
        sortOrder: 3,
        isSystem: true
    },
    {
        key: "social-topup",
        displayName: "Social Top Up",
        icon: "telegram",
        path: "/social-topup.html",
        status: "COMING_SOON",
        showInGamesMenu: true,
        showOnHome: false,
        sortOrder: 4,
        isSystem: true
    },
    {
        key: "coming-soon",
        displayName: "Coming Soon",
        icon: "clock",
        path: "/coming-soon.html",
        status: "HIDDEN",
        showInGamesMenu: false,
        showOnHome: false,
        sortOrder: 5,
        isSystem: true
    },
    {
        key: "popular-game-cards", displayName: "Popular Game Cards", icon: "gift", path: "/gift-cards.html",
        status: "PUBLISHED", showInGamesMenu: false, showOnHome: true, sortOrder: 10, isSystem: true
    },
    {
        key: "popular-game-topup", displayName: "Popular Game Top-Up", icon: "mobile", path: "/mobile-games.html",
        status: "PUBLISHED", showInGamesMenu: false, showOnHome: true, sortOrder: 11, isSystem: true
    },
    {
        key: "popular-pc-games", displayName: "Popular PC Games", icon: "desktop", path: "/pc-games.html",
        status: "PUBLISHED", showInGamesMenu: false, showOnHome: true, sortOrder: 12, isSystem: true
    },
    {
        key: "popular-gift-cards", displayName: "Popular Gift Cards", icon: "gift", path: "/gift-cards.html",
        status: "PUBLISHED", showInGamesMenu: false, showOnHome: true, sortOrder: 13, isSystem: true
    },
    {
        key: "new-game-cards", displayName: "New Game Cards", icon: "gift", path: "/gift-cards.html",
        status: "PUBLISHED", showInGamesMenu: false, showOnHome: true, sortOrder: 14, isSystem: true
    },
    {
        key: "new-game-topup", displayName: "New Game Top-Up", icon: "mobile", path: "/mobile-games.html",
        status: "PUBLISHED", showInGamesMenu: false, showOnHome: true, sortOrder: 15, isSystem: true
    },
    {
        key: "digital-services-home", displayName: "Digital Services", icon: "telegram", path: "/explore.html",
        status: "PUBLISHED", showInGamesMenu: false, showOnHome: true, sortOrder: 16, isSystem: true
    },
    {
        key: "news-promotions", displayName: "News & Promotions", icon: "gift", path: "/notifications.html?filter=promotions",
        status: "PUBLISHED", showInGamesMenu: false, showOnHome: true, sortOrder: 17, isSystem: true
    }
]);

const SYSTEM_BY_KEY = new Map(SYSTEM_SECTIONS.map(section => [section.key, section]));
const ALLOWED_KEYS = new Set(SYSTEM_SECTIONS.map(section => section.key));
const ALLOWED_ICONS = new Set(["mobile", "desktop", "gift", "telegram", "clock"]);

function normalizeKey(value = "") {
    return String(value || "").trim().toLowerCase();
}

function parseBoolean(value, field) {
    if (typeof value !== "boolean") {
        throw new StorefrontSectionError("STOREFRONT_SECTION_INVALID", `${field} must be true or false.`);
    }
    return value;
}

function parseSortOrder(value) {
    const order = Number(value ?? 0);
    if (!Number.isInteger(order) || Math.abs(order) > MAX_SORT_ORDER) {
        throw new StorefrontSectionError("STOREFRONT_SECTION_SORT_INVALID", "Sort order must be a finite integer.");
    }
    return order;
}

function assertAllowedKey(key) {
    const normalized = normalizeKey(key);
    if (!ALLOWED_KEYS.has(normalized)) {
        throw new StorefrontSectionError("STOREFRONT_SECTION_UNKNOWN", "Storefront section is not supported.", 404);
    }
    return normalized;
}

function normalizeStatus(value) {
    const status = String(value || "").trim().toUpperCase();
    if (!ALLOWED_STATUSES.has(status)) {
        throw new StorefrontSectionError("STOREFRONT_SECTION_STATUS_INVALID", "Storefront section status is invalid.");
    }
    return status;
}

function normalizeDisplayName(value) {
    const displayName = String(value || "").trim();
    if (!displayName || displayName.length > 60) {
        throw new StorefrontSectionError("STOREFRONT_SECTION_NAME_INVALID", "Display name is required.");
    }
    return displayName;
}

function normalizeIcon(value) {
    const icon = String(value || "").trim().toLowerCase();
    if (!ALLOWED_ICONS.has(icon)) {
        throw new StorefrontSectionError("STOREFRONT_SECTION_ICON_INVALID", "Section icon is invalid.");
    }
    return icon;
}

function projectSection(section = {}, { publicOnly = false } = {}) {
    const projection = {
        key: section.key,
        displayName: section.displayName,
        icon: section.icon,
        path: section.path,
        status: section.status,
        showInGamesMenu: section.showInGamesMenu === true,
        sortOrder: Number(section.sortOrder || 0)
    };

    if (!publicOnly) {
        projection.showOnHome = section.showOnHome === true;
        projection.isSystem = section.isSystem !== false;
        projection.updatedAt = section.updatedAt || null;
    }

    return projection;
}

async function ensureStorefrontSections() {
    await Promise.all(SYSTEM_SECTIONS.map(section => StorefrontSection.updateOne(
        { key: section.key },
        { $setOnInsert: section },
        { upsert: true }
    )));
}

async function listStorefrontSections({ publicOnly = false, includeHidden = true } = {}) {
    await ensureStorefrontSections();
    const filter = {};
    if (!includeHidden) filter.status = { $ne: "HIDDEN" };

    const sections = await StorefrontSection.find(filter)
        .sort({ sortOrder: 1, key: 1 })
        .lean();

    return sections.map(section => projectSection(section, { publicOnly }));
}

async function getStorefrontSection(key, options = {}) {
    await ensureStorefrontSections();
    const normalized = assertAllowedKey(key);
    const section = await StorefrontSection.findOne({ key: normalized }).lean();
    return section ? projectSection(section, options) : null;
}

function buildSectionPatch(key, patch = {}) {
    const system = SYSTEM_BY_KEY.get(key);
    const updates = {};
    const allowed = new Set(["displayName", "icon", "status", "showInGamesMenu", "showOnHome", "sortOrder"]);

    Object.keys(patch).forEach(field => {
        if (!allowed.has(field)) {
            throw new StorefrontSectionError("STOREFRONT_SECTION_PATCH_INVALID", `${field} is not editable.`);
        }
    });

    if (Object.prototype.hasOwnProperty.call(patch, "displayName")) {
        updates.displayName = normalizeDisplayName(patch.displayName);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "icon")) {
        updates.icon = normalizeIcon(patch.icon);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
        updates.status = normalizeStatus(patch.status);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "showInGamesMenu")) {
        updates.showInGamesMenu = parseBoolean(patch.showInGamesMenu, "showInGamesMenu");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "showOnHome")) {
        updates.showOnHome = parseBoolean(patch.showOnHome, "showOnHome");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "sortOrder")) {
        updates.sortOrder = parseSortOrder(patch.sortOrder);
    }

    if (system?.path && Object.prototype.hasOwnProperty.call(patch, "path")) {
        throw new StorefrontSectionError("STOREFRONT_SECTION_PATCH_INVALID", "Section path cannot be changed.");
    }

    return updates;
}

async function updateStorefrontSection({ key, patch = {}, actor = "admin" } = {}) {
    await ensureStorefrontSections();
    const normalized = assertAllowedKey(key);
    const updates = buildSectionPatch(normalized, patch);

    if (!Object.keys(updates).length) {
        const current = await StorefrontSection.findOne({ key: normalized }).lean();
        return { changed: false, section: projectSection(current) };
    }

    updates.updatedBy = actor;
    const section = await StorefrontSection.findOneAndUpdate(
        { key: normalized },
        { $set: updates },
        { returnDocument: "after", runValidators: true }
    ).lean();

    return {
        changed: true,
        section: projectSection(section),
        changedFields: Object.keys(updates).filter(field => field !== "updatedBy")
    };
}

async function reorderStorefrontSections({ orderedKeys = [], actor = "admin" } = {}) {
    await ensureStorefrontSections();
    const keys = orderedKeys.map(normalizeKey).filter(Boolean);
    const unique = new Set(keys);

    if (keys.length !== SYSTEM_SECTIONS.length || unique.size !== keys.length) {
        throw new StorefrontSectionError("STOREFRONT_SECTION_REORDER_INVALID", "Section order must include every system section exactly once.");
    }

    keys.forEach(assertAllowedKey);

    await Promise.all(keys.map((key, index) => StorefrontSection.updateOne(
        { key },
        { $set: { sortOrder: index + 1, updatedBy: actor } }
    )));

    return {
        sections: await listStorefrontSections()
    };
}

module.exports = {
    StorefrontSectionError,
    SYSTEM_SECTIONS,
    getStorefrontSection,
    listStorefrontSections,
    reorderStorefrontSections,
    updateStorefrontSection
};
