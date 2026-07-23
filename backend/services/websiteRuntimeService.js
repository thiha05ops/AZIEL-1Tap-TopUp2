const CatalogProduct = require("../models/CatalogProduct");
const Campaign = require("../models/Campaign");
const HomeBanner = require("../models/HomeBanner");
const SitePlacement = require("../models/SitePlacement");
const StorefrontSection = require("../models/StorefrontSection");
const { getConfigurationRegistry } = require("../configuration/configurationRegistry");
const { getConfigurationSessionManager } = require("../configuration/configurationSessionManager");
const { getHomePlacementDraftManager } = require("../configuration/homePlacementDraftManager");

const SOURCE_TYPES = Object.freeze([
    "DATABASE",
    "API",
    "ADMIN_MANAGED",
    "STATIC_HTML",
    "STATIC_JAVASCRIPT",
    "STATIC_CSS",
    "CONFIG_FILE",
    "ENVIRONMENT",
    "FALLBACK",
    "MIXED",
    "UNKNOWN"
]);

const MANAGEMENT_STATES = Object.freeze([
    "FULLY_MANAGED",
    "PARTIALLY_MANAGED",
    "OBSERVED_ONLY",
    "HARDCODED",
    "LEGACY",
    "UNKNOWN"
]);

const ALLOWED_DOMAINS = Object.freeze([
    "Home",
    "Navigation",
    "Games",
    "Campaigns",
    "Regions",
    "Localization",
    "Footer",
    "SEO",
    "Legal",
    "Runtime",
    "System"
]);

const READINESS_STATES = Object.freeze([
    "READY",
    "PARTIAL",
    "BLOCKED",
    "UNKNOWN"
]);

const PUBLIC_ROUTES = Object.freeze([
    { id: "home", label: "Home", path: "/home.html", domain: "Home" },
    { id: "explore", label: "Explore", path: "/explore.html", domain: "Games" },
    { id: "mobile-games", label: "Mobile Games", path: "/mobile-games.html", domain: "Games" },
    { id: "pc-games", label: "PC Games", path: "/pc-games.html", domain: "Games" },
    { id: "gift-cards", label: "Gift Cards", path: "/gift-cards.html", domain: "Games" },
    { id: "social-topup", label: "Social Top Up", path: "/social-topup.html", domain: "Games" },
    { id: "mlbb", label: "MLBB", path: "/mlbb.html", domain: "Games" },
    { id: "pubg", label: "PUBG", path: "/pubg.html", domain: "Games" },
    { id: "freefire", label: "Free Fire", path: "/freefire.html", domain: "Games" },
    { id: "hok", label: "HOK", path: "/hok.html", domain: "Games" },
    { id: "aov-id", label: "AOV ID", path: "/aov-id.html", domain: "Games" },
    { id: "pubg-rp", label: "PUBG Royale Pass", path: "/pubg-rp.html", domain: "Games" },
    { id: "telegram", label: "Telegram", path: "/telegram.html", domain: "Games" },
    { id: "genshin", label: "Genshin", path: "/genshin.html", domain: "Games" },
    { id: "roblox", label: "Roblox", path: "/roblox.html", domain: "Games" },
    { id: "support", label: "Support", path: "/support.html", domain: "System" },
    { id: "faq", label: "FAQ", path: "/faq.html", domain: "Legal" },
    { id: "privacy", label: "Privacy", path: "/privacy.html", domain: "Legal" },
    { id: "refund", label: "Refund", path: "/refund.html", domain: "Legal" },
    { id: "contact", label: "Contact", path: "/contact.html", domain: "Legal" },
    { id: "login", label: "Login", path: "/login.html", domain: "System" },
    { id: "register", label: "Register", path: "/register.html", domain: "System" },
    { id: "wallet", label: "Wallet", path: "/wallet.html", domain: "System" },
    { id: "tracking", label: "Tracking", path: "/tracking.html", domain: "System" }
]);

const OWNER_APPS = Object.freeze({
    catalog: "catalog",
    campaigns: "campaigns",
    homeBanners: "site-content",
    paymentInfrastructure: "payments",
    settings: "settings"
});

function safeNow() {
    return new Date().toISOString();
}

function calculateConfigurationReadiness(entry = {}) {
    if (!entry || !entry.sourceType || !entry.managementState) {
        return { state: "UNKNOWN", explanation: "Observation did not collect enough ownership data." };
    }

    if (
        entry.managementState === "UNKNOWN" ||
        entry.sourceType === "UNKNOWN" ||
        !entry.sourceOwner ||
        entry.conflicts?.length
    ) {
        return { state: "BLOCKED", explanation: "Ownership is unknown or conflicting and needs migration review." };
    }

    if (entry.managementState === "HARDCODED") {
        return { state: "BLOCKED", explanation: "This surface is still hardcoded and cannot be configured safely yet." };
    }

    if (
        entry.sourceType === "MIXED" ||
        entry.managementState === "PARTIALLY_MANAGED" ||
        entry.managementState === "OBSERVED_ONLY" ||
        entry.fallbackBehavior
    ) {
        return { state: "PARTIAL", explanation: "Configuration exists, but mixed ownership or fallback behavior remains." };
    }

    if (entry.managementState === "FULLY_MANAGED" && entry.sourceOwner) {
        return { state: "READY", explanation: "Single managed owner observed with no fallback or ownership conflict." };
    }

    return { state: "UNKNOWN", explanation: "Observation is incomplete for this surface." };
}

function buildRuntimeHealth(summary, failures = []) {
    const blocked = summary.blockedReadinessCount || 0;
    const partial = summary.partialReadinessCount || 0;
    const unknown = summary.unknownReadinessCount || 0;
    const hasFailures = failures.length > 0;

    const health = {
        inventoryCoverage: statusWithReason(summary.total >= 10 && !unknown, "Healthy", "Warning", "Core public surfaces are represented in the inventory."),
        ownershipAccuracy: statusWithReason(blocked === 0, "Healthy", blocked > 2 ? "Attention" : "Warning", "Hardcoded or unknown owners still require migration review."),
        previewAvailability: statusWithReason(PUBLIC_ROUTES.length > 0, "Healthy", "Attention", "Same-origin public routes are available for read-only preview."),
        apiReachability: statusWithReason(!hasFailures, "Healthy", "Attention", "Admin runtime observation APIs must be reachable."),
        regionAwareness: statusWithReason(true, "Healthy", "Warning", "Myanmar and Thailand route context is observed."),
        localizationCoverage: statusWithReason(false, "Warning", "Warning", "Static dictionaries are observed; centralized runtime configuration is not implemented in this phase."),
        configurationReadiness: statusWithReason(blocked === 0 && partial === 0, "Healthy", blocked ? "Attention" : "Warning", "Readiness is derived from ownership, fallback, and conflict signals.")
    };

    const values = Object.values(health).map(item => item.status);
    const overall = values.includes("Attention") ? "Attention" : values.includes("Warning") ? "Warning" : "Healthy";
    return {
        ...health,
        overallHealth: {
            status: overall,
            reason: "Overall health is the most severe current runtime health signal."
        }
    };
}

function statusWithReason(condition, passStatus, failStatus, reason) {
    return { status: condition ? passStatus : failStatus, reason };
}

function item(input) {
    const base = {
        id: input.id,
        displayName: input.displayName,
        domain: input.domain,
        route: input.route || "",
        placement: input.placement || "",
        sourceType: input.sourceType,
        sourceOwner: input.sourceOwner,
        sourceReference: input.sourceReference || "",
        regionScope: input.regionScope || ["MM", "TH"],
        languageScope: input.languageScope || ["en", "my", "th"],
        status: input.status || "OBSERVED",
        visibility: input.visibility || "public",
        managementState: input.managementState,
        previewSupport: input.previewSupport !== false,
        lastUpdated: input.lastUpdated || null,
        fallbackBehavior: input.fallbackBehavior || "",
        diagnostics: input.diagnostics || [],
        observationMethod: input.observationMethod || "STATIC_AND_RUNTIME_OBSERVATION",
        runtimeStatus: input.runtimeStatus || input.status || "OBSERVED",
        conflicts: input.conflicts || [],
        ownerAppId: input.ownerAppId || "",
        configurationId: input.configurationId || "",
        metadata: input.metadata || {}
    };
    const readiness = calculateConfigurationReadiness(base);
    return {
        ...base,
        configurationReadiness: readiness.state,
        readinessExplanation: readiness.explanation,
        migrationPriority: input.migrationPriority || null
    };
}

function buildMigrationQueue(inventory) {
    const priorityMap = new Map([
        ["home.placements", { priority: 1, reason: "Mixed home placement ownership and source-code fallback remain." }],
        ["navigation.header", { priority: 2, reason: "Header navigation combines runtime data with static defaults." }],
        ["footer.global", { priority: 3, reason: "Footer is shared static markup and not yet admin managed." }],
        ["localization.public", { priority: 4, reason: "Localization is observed through static dictionaries only." }]
    ]);

    return inventory
        .filter(entry => priorityMap.has(entry.id) || ["PARTIAL", "BLOCKED", "UNKNOWN"].includes(entry.configurationReadiness))
        .map(entry => {
            const explicit = priorityMap.get(entry.id);
            return {
                id: entry.id,
                displayName: entry.displayName,
                domain: entry.domain,
                priority: explicit?.priority || 10,
                readiness: entry.configurationReadiness,
                reason: explicit?.reason || entry.readinessExplanation,
                ownerAppId: entry.ownerAppId || "",
                sourceType: entry.sourceType,
                managementState: entry.managementState
            };
        })
        .sort((a, b) => a.priority - b.priority || a.displayName.localeCompare(b.displayName));
}

function buildRouteReadiness() {
    return PUBLIC_ROUTES.map(route => ({
        ...route,
        readiness: "Observed",
        routeStatus: "Observed",
        owningModule: route.domain === "Home" ? "site-content" :
            route.domain === "Games" ? "catalog" :
                route.domain === "Legal" ? "legal-static-pages" :
                    route.domain === "System" ? "public-runtime" : "website-runtime"
    }));
}

function buildDiagnostics({ inventory, summary, failures, observedAt }) {
    const migrationCandidates = inventory.filter(entry => ["PARTIAL", "BLOCKED"].includes(entry.configurationReadiness));
    const needsReview = inventory.filter(entry => entry.configurationReadiness === "BLOCKED" || entry.managementState === "UNKNOWN" || entry.sourceType === "UNKNOWN");
    const observationWarnings = [
        ...failures,
        ...inventory
            .filter(entry => entry.configurationReadiness === "UNKNOWN")
            .map(entry => ({ source: entry.id, code: "OBSERVATION_INCOMPLETE", message: entry.readinessExplanation }))
    ];
    const configurationGaps = inventory
        .filter(entry => entry.fallbackBehavior || entry.managementState === "HARDCODED")
        .map(entry => ({
            id: entry.id,
            displayName: entry.displayName,
            domain: entry.domain,
            readiness: entry.configurationReadiness,
            reason: entry.fallbackBehavior || entry.readinessExplanation
        }));

    return {
        sourceFailures: failures,
        hardcodedItemCount: summary.hardcodedCount,
        unknownItemCount: summary.unknownCount,
        blockedItemCount: summary.blockedReadinessCount,
        partialItemCount: summary.partialReadinessCount,
        migrationCandidates,
        needsReview,
        observationWarnings,
        configurationGaps,
        missingPublicRoutes: [],
        missingAssets: [],
        previewAvailability: "SAME_ORIGIN_ROUTES_ONLY",
        regionReadiness: "MM_TH_OBSERVED",
        localizationReadiness: "STATIC_DICTIONARIES_OBSERVED",
        apiReachabilityStatus: failures.length ? "DEGRADED" : "OBSERVED",
        lastSuccessfulObservation: failures.length ? null : observedAt
    };
}

async function countSafely(label, fn, failures) {
    try {
        return await fn();
    } catch (error) {
        failures.push({
            source: label,
            code: error?.code || error?.name || "OBSERVATION_FAILED",
            message: "Observation source unavailable."
        });
        return null;
    }
}

async function buildWebsiteRuntimeProjection({ baseUrl = "" } = {}) {
    const started = Date.now();
    const observedAt = safeNow();
    const failures = [];
    let configurationRegistrySnapshot = null;
    let configurationSessionDiagnostics = null;
    let configurationDraftDiagnostics = null;
    try {
        const configurationRegistry = await getConfigurationRegistry();
        configurationRegistrySnapshot = configurationRegistry.snapshot();
        configurationSessionDiagnostics = getConfigurationSessionManager().diagnostics();
        configurationDraftDiagnostics = getHomePlacementDraftManager().diagnostics();
    } catch (error) {
        failures.push({
            source: "ConfigurationRegistry",
            code: error?.code || error?.name || "CONFIGURATION_REGISTRY_UNAVAILABLE",
            message: "Configuration registry unavailable."
        });
    }

    const [
        homeBannerCount,
        activeHomeBannerCount,
        campaignCount,
        activeCampaignCount,
        catalogProductCount,
        enabledCatalogProductCount,
        storefrontSectionCount,
        sitePlacementCount,
        managedSitePlacementCount
    ] = await Promise.all([
        countSafely("HomeBanner.countDocuments", () => HomeBanner.countDocuments({}), failures),
        countSafely("HomeBanner.active", () => HomeBanner.countDocuments({ enabled: true }), failures),
        countSafely("Campaign.countDocuments", () => Campaign.countDocuments({ archivedAt: null }), failures),
        countSafely("Campaign.active", () => Campaign.countDocuments({ archivedAt: null, enabled: true }), failures),
        countSafely("CatalogProduct.countDocuments", () => CatalogProduct.countDocuments({ deletedAt: null }), failures),
        countSafely("CatalogProduct.enabled", () => CatalogProduct.countDocuments({ deletedAt: null, enabled: true }), failures),
        countSafely("StorefrontSection.countDocuments", () => StorefrontSection.countDocuments({}), failures),
        countSafely("SitePlacement.countDocuments", () => SitePlacement.countDocuments({}), failures),
        countSafely("SitePlacement.managed", () => SitePlacement.countDocuments({ managed: true }), failures)
    ]);

    const inventory = [
        item({
            id: "home.hero",
            displayName: "Home Hero / Banner Carousel",
            domain: "Home",
            route: "/home.html",
            sourceType: "ADMIN_MANAGED",
            sourceOwner: "Home Banners",
            sourceReference: "HomeBanner",
            managementState: "FULLY_MANAGED",
            status: activeHomeBannerCount ? "ACTIVE" : "FALLBACK",
            fallbackBehavior: "Static home banner fallback remains when managed banners are unavailable.",
            ownerAppId: OWNER_APPS.homeBanners,
            metadata: { total: homeBannerCount, active: activeHomeBannerCount }
        }),
        item({
            id: "home.placements",
            displayName: "Home Placements",
            domain: "Home",
            route: "/home.html",
            sourceType: "MIXED",
            sourceOwner: "Site Placement Controls",
            sourceReference: "SitePlacement",
            managementState: managedSitePlacementCount ? "PARTIALLY_MANAGED" : "OBSERVED_ONLY",
            fallbackBehavior: "Source-code fallback sections remain authoritative unless placement is explicitly managed.",
            ownerAppId: OWNER_APPS.homeBanners,
            configurationId: "website.home.placements",
            metadata: { total: sitePlacementCount, managed: managedSitePlacementCount }
        }),
        item({
            id: "campaign.entry-popup",
            displayName: "Entry Popup Campaign",
            domain: "Campaigns",
            route: "/home.html",
            sourceType: "ADMIN_MANAGED",
            sourceOwner: "Campaign Manager",
            sourceReference: "Campaign",
            managementState: "FULLY_MANAGED",
            status: activeCampaignCount ? "ACTIVE" : "IDLE",
            fallbackBehavior: "No popup renders when no eligible campaign exists.",
            ownerAppId: OWNER_APPS.campaigns,
            metadata: { total: campaignCount, active: activeCampaignCount }
        }),
        item({
            id: "catalog.products",
            displayName: "Games and Product Visibility",
            domain: "Games",
            sourceType: "ADMIN_MANAGED",
            sourceOwner: "Catalog",
            sourceReference: "CatalogProduct",
            managementState: "FULLY_MANAGED",
            status: enabledCatalogProductCount ? "ACTIVE" : "DEGRADED",
            fallbackBehavior: "Seed/catalog compatibility remains available where configured.",
            ownerAppId: OWNER_APPS.catalog,
            metadata: { total: catalogProductCount, enabled: enabledCatalogProductCount }
        }),
        item({
            id: "storefront.sections",
            displayName: "Storefront Sections",
            domain: "Games",
            sourceType: "DATABASE",
            sourceOwner: "Catalog Storefront Sections",
            sourceReference: "StorefrontSection",
            managementState: "PARTIALLY_MANAGED",
            fallbackBehavior: "System section defaults are inserted when missing.",
            ownerAppId: OWNER_APPS.catalog,
            metadata: { total: storefrontSectionCount }
        }),
        item({
            id: "navigation.header",
            displayName: "Public Header Navigation",
            domain: "Navigation",
            sourceType: "MIXED",
            sourceOwner: "Header Runtime + Storefront Sections",
            sourceReference: "frontend/js/header.js",
            managementState: "PARTIALLY_MANAGED",
            fallbackBehavior: "Static nav defaults remain when storefront sections are unavailable."
        }),
        item({
            id: "footer.global",
            displayName: "Global Footer",
            domain: "Footer",
            sourceType: "STATIC_HTML",
            sourceOwner: "Shared Footer Markup",
            sourceReference: "frontend/components/footer.html",
            managementState: "HARDCODED",
            fallbackBehavior: "Footer is static shared markup in this phase."
        }),
        item({
            id: "regions.public",
            displayName: "Region-specific Experience",
            domain: "Regions",
            sourceType: "MIXED",
            sourceOwner: "Region runtime + payment/catalog projections",
            sourceReference: "frontend/js/region-payment.js",
            managementState: "PARTIALLY_MANAGED",
            fallbackBehavior: "Shared content is used when no region-specific managed data exists.",
            ownerAppId: OWNER_APPS.paymentInfrastructure
        }),
        item({
            id: "localization.public",
            displayName: "Public Localization",
            domain: "Localization",
            sourceType: "STATIC_JAVASCRIPT",
            sourceOwner: "Public i18n dictionaries",
            sourceReference: "frontend/lang",
            managementState: "OBSERVED_ONLY",
            fallbackBehavior: "Missing localized keys fall back to English."
        }),
        item({
            id: "seo.metadata",
            displayName: "SEO Metadata",
            domain: "SEO",
            sourceType: "STATIC_HTML",
            sourceOwner: "Page-level HTML metadata",
            sourceReference: "frontend/*.html",
            managementState: "HARDCODED",
            fallbackBehavior: "No centralized SEO editor exists in this phase."
        }),
        item({
            id: "pwa.assets",
            displayName: "PWA Assets",
            domain: "System",
            sourceType: "CONFIG_FILE",
            sourceOwner: "Manifest and Service Worker",
            sourceReference: "frontend/manifest.json, frontend/sw.js",
            managementState: "OBSERVED_ONLY",
            fallbackBehavior: "Offline shell and static cache remain current implementation."
        }),
        item({
            id: "legal.pages",
            displayName: "Legal and Trust Pages",
            domain: "Legal",
            sourceType: "STATIC_HTML",
            sourceOwner: "Public HTML pages",
            sourceReference: "frontend/privacy.html, frontend/refund.html, frontend/faq.html",
            managementState: "HARDCODED",
            fallbackBehavior: "No legal content editor exists in this phase."
        })
    ];

    const summary = summarizeInventory(inventory);
    const migrationQueue = buildMigrationQueue(inventory);
    const runtimeHealth = buildRuntimeHealth(summary, failures);
    const routeReadiness = buildRouteReadiness();
    const diagnostics = buildDiagnostics({ inventory, summary, failures, observedAt });
    const status = failures.length ? "DEGRADED" : "OBSERVING";
    const observationDurationMs = Date.now() - started;
    diagnostics.runtimeStatus = status;
    diagnostics.observationDurationMs = observationDurationMs;

    return {
        success: true,
        runtime: {
            id: "website-runtime",
            name: "AZIEL Public Website Runtime",
            version: "0.1.0",
            environment: process.env.NODE_ENV || "development",
            status,
            capabilities: [
                "inventory",
                "region-awareness",
                "public-preview",
                "ownership-diagnostics",
                "configuration-readiness"
            ],
            metadata: {
                publicBaseUrl: baseUrl,
                supportedRegions: ["MM", "TH"],
                observedRoutes: PUBLIC_ROUTES.map(route => route.path),
                lastObservedAt: observedAt
            }
        },
        summary,
        regions: [
            { code: "MM", label: "Myanmar", currency: "MMK", status: "OBSERVED" },
            { code: "TH", label: "Thailand", currency: "THB", status: "OBSERVED" }
        ],
        publicRoutes: PUBLIC_ROUTES,
        routeReadiness,
        inventory,
        ownershipSummary: buildOwnershipSummary(inventory),
        runtimeHealth,
        migrationQueue,
        configurationRegistry: configurationRegistrySnapshot ? {
            lifecycleStatus: configurationRegistrySnapshot.lifecycleStatus,
            definitionCount: configurationRegistrySnapshot.definitionCount,
            adapterCount: configurationRegistrySnapshot.adapterCount,
            diagnostics: configurationRegistrySnapshot.diagnostics,
            sessionDiagnostics: configurationSessionDiagnostics || {},
            draftDiagnostics: configurationDraftDiagnostics || {}
        } : {
            lifecycleStatus: "DEGRADED",
            definitionCount: 0,
            adapterCount: 0,
            diagnostics: {},
            sessionDiagnostics: configurationSessionDiagnostics || {},
            draftDiagnostics: configurationDraftDiagnostics || {}
        },
        diagnostics,
        allowedDomains: ALLOWED_DOMAINS,
        allowedSourceTypes: SOURCE_TYPES,
        allowedManagementStates: MANAGEMENT_STATES,
        allowedReadinessStates: READINESS_STATES
    };
}

function summarizeInventory(inventory) {
    return inventory.reduce((summary, entry) => {
        summary.total += 1;
        if (entry.managementState === "FULLY_MANAGED") summary.fullyManagedCount += 1;
        if (entry.managementState === "PARTIALLY_MANAGED") summary.partiallyManagedCount += 1;
        if (entry.managementState === "HARDCODED") summary.hardcodedCount += 1;
        if (entry.managementState === "UNKNOWN" || entry.sourceType === "UNKNOWN") summary.unknownCount += 1;
        if (entry.status === "DEGRADED") summary.degradedCount += 1;
        if (entry.configurationReadiness === "READY") summary.readyReadinessCount += 1;
        if (entry.configurationReadiness === "PARTIAL") summary.partialReadinessCount += 1;
        if (entry.configurationReadiness === "BLOCKED") summary.blockedReadinessCount += 1;
        if (entry.configurationReadiness === "UNKNOWN") summary.unknownReadinessCount += 1;
        return summary;
    }, {
        total: 0,
        fullyManagedCount: 0,
        partiallyManagedCount: 0,
        hardcodedCount: 0,
        unknownCount: 0,
        degradedCount: 0,
        readyReadinessCount: 0,
        partialReadinessCount: 0,
        blockedReadinessCount: 0,
        unknownReadinessCount: 0
    });
}

function buildOwnershipSummary(inventory) {
    return inventory.map(entry => ({
        id: entry.id,
        displayName: entry.displayName,
        status: entry.status,
        sourceType: entry.sourceType,
        sourceOwner: entry.sourceOwner,
        regionScope: entry.regionScope,
        managementState: entry.managementState,
        configurationReadiness: entry.configurationReadiness,
        readinessExplanation: entry.readinessExplanation,
        configurationId: entry.configurationId,
        ownerAppId: entry.ownerAppId
    }));
}

function isAllowedPreviewRoute(route = "") {
    const normalized = normalizePreviewRoute(route);
    return PUBLIC_ROUTES.some(item => item.path === normalized);
}

function normalizePreviewRoute(route = "") {
    const raw = String(route || "").trim() || "/home.html";
    if (/^https?:\/\//i.test(raw) || raw.startsWith("//")) return "";
    const pathOnly = raw.split("#")[0].split("?")[0];
    const normalized = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
    return PUBLIC_ROUTES.some(item => item.path === normalized) ? normalized : "";
}

function normalizePreviewRegion(region = "") {
    const normalized = String(region || "MM").trim().toUpperCase();
    return ["MM", "TH"].includes(normalized) ? normalized : "MM";
}

module.exports = {
    ALLOWED_DOMAINS,
    MANAGEMENT_STATES,
    PUBLIC_ROUTES,
    READINESS_STATES,
    SOURCE_TYPES,
    buildWebsiteRuntimeProjection,
    calculateConfigurationReadiness,
    isAllowedPreviewRoute,
    normalizePreviewRegion,
    normalizePreviewRoute
};
