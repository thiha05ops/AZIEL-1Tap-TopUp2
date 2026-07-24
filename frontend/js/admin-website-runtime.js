(function () {
    const state = {
        activeTab: "overview",
        data: null,
        loading: false,
        error: "",
        previewRoute: "/home.html",
        previewRegion: "MM",
        previewMode: "desktop",
        inventorySearch: "",
        configuration: {
            data: null,
            loading: false,
            error: "",
            resolution: null,
            validation: null,
            session: null,
            sessionDiagnostics: null,
            draft: null,
            contextRegion: "MM",
            actionLoading: ""
        },
        previewHealth: {
            iframeLoaded: false,
            routeAvailable: "Unknown",
            previewLatencyMs: null,
            regionApplied: "MM",
            viewport: "desktop",
            assetStatus: "Unknown",
            refreshState: "Idle",
            sameOriginState: "Same-origin sandbox"
        },
        previewStartedAt: 0,
        previewLoadToken: 0,
        previewTimeoutId: null
    };

    const PREVIEW_REGIONS = ["MM", "TH"];
    const PREVIEW_MODES = ["desktop", "tablet", "mobile"];

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "website") initWebsiteRuntime();
    });

    window.addEventListener("aziel:admin-locale-changed", () => {
        if (document.getElementById("section-website")?.classList.contains("active")) renderWebsiteRuntime();
    });

    function t(key, fallback = "") {
        return window.AZIEL_ADMIN_I18N?.t?.(key, fallback) || fallback || key;
    }

    function escapeHtml(value = "") {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function humanizeEnum(value = "") {
        const labels = {
            FULLY_MANAGED: "Fully managed",
            PARTIALLY_MANAGED: "Partially managed",
            OBSERVED_ONLY: "Observed only",
            HARDCODED: "Hardcoded",
            LEGACY: "Legacy",
            UNKNOWN: "Unknown",
            DATABASE: "Database",
            API: "API",
            ADMIN_MANAGED: "Admin managed",
            STATIC_HTML: "Static HTML",
            STATIC_JAVASCRIPT: "Static JavaScript",
            STATIC_CSS: "Static CSS",
            CONFIG_FILE: "Config file",
            ENVIRONMENT: "Environment",
            FALLBACK: "Fallback",
            MIXED: "Mixed",
            OBSERVED: "Observed",
            ACTIVE: "Active",
            IDLE: "Idle",
            DEGRADED: "Degraded",
            READY: "Ready",
            PARTIAL: "Partial",
            BLOCKED: "Blocked",
            WARNING: "Warning",
            ATTENTION: "Attention",
            HEALTHY: "Healthy",
            SAME_ORIGIN_ROUTES_ONLY: "Same-origin routes only",
            MM_TH_OBSERVED: "Myanmar and Thailand observed",
            STATIC_DICTIONARIES_OBSERVED: "Static dictionaries observed"
        };
        return labels[value] || String(value || "Unknown").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function formatBangkokTimestamp(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        const datePart = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Bangkok",
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(date);
        const timePart = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Bangkok",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        }).format(date);
        return `${datePart}, ${timePart}, Asia/Bangkok`;
    }

    function getKernelService(name) {
        try {
            const services = window.AZIELOS?.services;
            if (!services?.resolve) return null;
            if (typeof services.has === "function" && !services.has(name)) return null;
            return services.resolve(name);
        } catch (_error) {
            return null;
        }
    }

    function showRuntimeNotice(message, type = "error") {
        if (window.showAdminToast) {
            window.showAdminToast(message, type);
            return;
        }
        state.configuration.error = message;
    }

    function allowedPreviewRoutes() {
        const routes = state.data?.publicRoutes || [];
        return routes.map(route => route.path).filter(path => typeof path === "string" && path.startsWith("/") && !path.startsWith("//"));
    }

    function normalizePreviewRoute(route) {
        const fallback = allowedPreviewRoutes().includes("/home.html") ? "/home.html" : allowedPreviewRoutes()[0] || "/home.html";
        const cleanRoute = String(route || "").split("?")[0].trim();
        return allowedPreviewRoutes().includes(cleanRoute) ? cleanRoute : fallback;
    }

    function normalizePreviewRegion(region) {
        return PREVIEW_REGIONS.includes(region) ? region : "MM";
    }

    function normalizePreviewMode(mode) {
        return PREVIEW_MODES.includes(mode) ? mode : "desktop";
    }

    function buildPreviewUrl({ cacheBust = false } = {}) {
        state.previewRoute = normalizePreviewRoute(state.previewRoute);
        state.previewRegion = normalizePreviewRegion(state.previewRegion);
        const params = new URLSearchParams();
        params.set("azPreviewRegion", state.previewRegion);
        if (cacheBust) params.set("azPreviewRefresh", String(Date.now()));
        return `${state.previewRoute}?${params.toString()}`;
    }

    function readinessClass(value = "") {
        return `readiness-${String(value || "unknown").toLowerCase()}`;
    }

    function ownerReadinessLabel(value = "") {
        const labels = {
            READY: "Ready",
            HEALTHY: "Ready",
            PARTIAL: "Needs Review",
            WARNING: "Needs Review",
            BLOCKED: "Action Required",
            ATTENTION: "Action Required",
            DEGRADED: "Action Required",
            UNKNOWN: "Unknown",
            OBSERVING: "Watching"
        };
        return labels[String(value || "UNKNOWN").toUpperCase()] || humanizeEnum(value);
    }

    function draftStatusLabel() {
        const draft = state.configuration.draft;
        if (draft?.previewProjection) return "Draft Preview Ready";
        if (draft?.dirtyState?.isDirty) return "Draft Available";
        if (draft) return "Draft Open";
        return "No Draft";
    }

    function publishStatusLabel(data = state.data || {}) {
        const readiness = data.runtimeHealth?.configurationReadiness?.status || data.runtime?.status || "UNKNOWN";
        if (state.configuration.draft?.dirtyState?.isDirty) return "Draft Available";
        if (readiness === "READY" || readiness === "HEALTHY") return "Ready to Publish";
        if (readiness === "PARTIAL" || readiness === "WARNING") return "Needs Review";
        if (readiness === "BLOCKED" || readiness === "DEGRADED" || readiness === "ATTENTION") return "Action Required";
        return "No Draft";
    }

    function renderOwnerContextBar(data = state.data || {}) {
        const route = state.previewRoute || "/home.html";
        const previewState = state.previewHealth.refreshState || "Idle";
        return `
            <section class="website-owner-context" aria-label="Website workspace context">
                <article>
                    <span>Current Region</span>
                    <strong>${escapeHtml(state.configuration.contextRegion || state.previewRegion || "MM")}</strong>
                </article>
                <article>
                    <span>Current Draft</span>
                    <strong>${escapeHtml(draftStatusLabel())}</strong>
                </article>
                <article>
                    <span>Preview Status</span>
                    <strong>${escapeHtml(ownerReadinessLabel(previewState))}</strong>
                    <small>${escapeHtml(route)}</small>
                </article>
                <article>
                    <span>Publish Readiness</span>
                    <strong>${escapeHtml(publishStatusLabel(data))}</strong>
                </article>
            </section>
        `;
    }

    function searchableInventoryText(entry = {}) {
        return [
            entry.sourceOwner,
            entry.route,
            entry.domain,
            entry.managementState,
            entry.sourceType,
            entry.status,
            entry.runtimeStatus,
            entry.configurationReadiness,
            entry.ownerAppId
        ].filter(Boolean).join(" ").toLowerCase();
    }

    function openWebsiteTab(tab) {
        state.activeTab = tab || "overview";
        renderWebsiteRuntime();
    }

    function initWebsiteRuntime() {
        const tabs = document.querySelectorAll("[data-website-runtime-tab]");
        tabs.forEach(tab => {
            if (tab.dataset.bound === "true") return;
            tab.dataset.bound = "true";
            tab.addEventListener("click", () => {
                state.activeTab = tab.dataset.websiteRuntimeTab || "overview";
                renderWebsiteRuntime();
            });
        });

        const refresh = document.getElementById("websiteRuntimeRefresh");
        if (refresh && refresh.dataset.bound !== "true") {
            refresh.dataset.bound = "true";
            refresh.addEventListener("click", () => loadWebsiteRuntime(true));
        }

        const openPublic = document.getElementById("websiteRuntimeOpenPublic");
        if (openPublic && openPublic.dataset.bound !== "true") {
            openPublic.dataset.bound = "true";
            openPublic.addEventListener("click", () => {
                window.open(state.previewRoute || "/home.html", "_blank", "noopener,noreferrer");
            });
        }

        if (!state.data && !state.loading) loadWebsiteRuntime();
        if (!state.configuration.data && !state.configuration.loading) loadConfigurationRegistry();
        else renderWebsiteRuntime();
    }

    async function loadWebsiteRuntime(force = false) {
        if (state.loading && !force) return;
        state.loading = true;
        state.error = "";
        renderWebsiteRuntime();

        try {
            const data = await adminFetch("/api/admin/website-runtime");
            if (!data?.success) throw new Error(data?.message || "Website runtime unavailable");
            state.data = data;
            registerWebsiteRuntime(data.runtime);
            window.AZIELOS?.events?.emit?.("website.inventory.loaded", {
                itemCount: data.inventory?.length || 0,
                status: data.runtime?.status || "UNKNOWN"
            }, { source: "website-app" });
        } catch (error) {
            state.error = error?.message || t("website_runtime_unavailable", "Website runtime unavailable.");
            window.AZIELOS?.events?.emit?.("website.diagnostics.updated", {
                status: "DEGRADED",
                reason: "fetch-failed"
            }, { source: "website-app" });
        } finally {
            state.loading = false;
            renderWebsiteRuntime();
        }
    }

    async function loadConfigurationRegistry(force = false) {
        if (state.configuration.loading && !force) return;
        state.configuration.loading = true;
        state.configuration.error = "";
        state.configuration.actionLoading = "";
        if (state.activeTab === "configuration") renderWebsiteRuntime();

        try {
            const service = getKernelService("configuration");
            const sessionService = getKernelService("configurationSession");
            const data = service ? await service.list() : await adminFetch("/api/admin/configuration-registry");
            if (!data?.success) throw new Error(data?.message || "Configuration registry unavailable");
            state.configuration.data = data.registry || null;
            if (sessionService) {
                const sessions = await sessionService.list();
                state.configuration.sessionDiagnostics = sessions.diagnostics || null;
                const activeSession = (sessions.sessions || []).find(session => (
                    session.configurationId === "website.home.placements" &&
                    ["OPEN", "ACTIVE", "VALIDATED"].includes(session.status) &&
                    session.context?.region === state.configuration.contextRegion
                ));
                if (activeSession) state.configuration.session = activeSession;
            }
            window.AZIELOS?.events?.emit?.("configuration.definition.registered", {
                definitionCount: state.configuration.data?.definitionCount || 0
            }, { source: "website-app" });
        } catch (error) {
            state.configuration.error = error?.message || "Configuration registry unavailable.";
            window.AZIELOS?.events?.emit?.("configuration.definition.degraded", {
                code: error?.code || "CONFIGURATION_REGISTRY_UNAVAILABLE"
            }, { source: "website-app" });
        } finally {
            state.configuration.loading = false;
            if (state.activeTab === "configuration") renderWebsiteRuntime();
        }
    }

    function registerWebsiteRuntime(runtime = {}) {
        const registry = window.AZIELOS?.runtimes;
        if (!registry || !runtime?.id || registry.has?.(runtime.id)) return;
        try {
            registry.register({
                id: runtime.id,
                name: runtime.name,
                version: runtime.version,
                capabilities: runtime.capabilities || [],
                status: runtime.status || "OBSERVING",
                environment: runtime.environment || "browser",
                lifecycleState: runtime.status || "OBSERVING",
                health: {
                    observedAt: runtime.metadata?.lastObservedAt || ""
                },
                metadata: runtime.metadata || {}
            });
            window.AZIELOS?.events?.emit?.("website.runtime.registered", {
                runtimeId: runtime.id,
                status: runtime.status || "OBSERVING"
            }, { source: "website-app" });
        } catch (error) {
            window.AZIELOS?.diagnostics?.recordError?.(error);
        }
    }

    function renderWebsiteRuntime() {
        const content = document.getElementById("websiteRuntimeContent");
        const status = document.getElementById("websiteRuntimeStatus");
        if (!content || !status) return;

        document.querySelectorAll("[data-website-runtime-tab]").forEach(tab => {
            const active = tab.dataset.websiteRuntimeTab === state.activeTab;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", active ? "true" : "false");
        });

        if (state.loading) {
            status.innerHTML = `<b>${escapeHtml(t("loading", "Loading"))}</b>`;
            content.innerHTML = `<div class="website-runtime-skeleton"></div><div class="website-runtime-skeleton"></div>`;
            return;
        }

        if (state.error) {
            status.innerHTML = `<b>${escapeHtml(t("degraded", "Degraded"))}</b>`;
            content.innerHTML = `
                <div class="admin-empty-state">
                    <strong>${escapeHtml(t("website_runtime_unavailable", "Website runtime unavailable."))}</strong>
                    <p>${escapeHtml(state.error)}</p>
                    <button class="admin-secondary-btn" type="button" data-runtime-retry>${escapeHtml(t("try_again", "Try again"))}</button>
                </div>
            `;
            content.querySelector("[data-runtime-retry]")?.addEventListener("click", () => loadWebsiteRuntime(true));
            return;
        }

        const data = state.data;
        if (!data) {
            status.innerHTML = `<b>${escapeHtml(t("loading", "Loading"))}</b>`;
            content.innerHTML = `<div class="admin-empty-state">${escapeHtml(t("loading", "Loading"))}</div>`;
            return;
        }

        status.innerHTML = `
            <b>${escapeHtml(humanizeEnum(data.runtime?.status || "OBSERVING"))}</b>
            <span>${escapeHtml(t("last_updated", "Last updated"))}: ${escapeHtml(formatBangkokTimestamp(data.runtime?.metadata?.lastObservedAt))}</span>
        `;

        const renderers = {
            overview: renderOverview,
            home: renderOwnerHome,
            navigation: () => renderDomain("Navigation"),
            games: () => renderDomain("Games"),
            campaigns: () => renderDomain("Campaigns"),
            regions: renderRegions,
            configuration: renderConfiguration,
            preview: renderPreview,
            diagnostics: renderDiagnostics
        };
        content.innerHTML = (renderers[state.activeTab] || renderOverview)(data);
        bindWebsiteRuntimeActions(content, data);
    }

    function renderOwnerHome(data) {
        const homeItems = (data.inventory || []).filter(entry => entry.domain === "Home");
        const readyCount = homeItems.filter(entry => ["READY", "HEALTHY"].includes(entry.configurationReadiness || entry.status)).length;
        const reviewCount = Math.max(0, homeItems.length - readyCount);
        return `
            ${renderOwnerContextBar(data)}
            <section class="website-owner-section-head">
                <div>
                    <span class="admin-eyebrow">Manage Home</span>
                    <h3>Home screen controls</h3>
                    <p>Hero banner, placements, featured content, trending content, sections, draft status, and preview.</p>
                </div>
                <button class="admin-secondary-btn" type="button" data-website-runtime-open="preview">Preview Home</button>
            </section>
            <section class="website-owner-action-grid" aria-label="Home management tasks">
                ${ownerActionCard("Hero Banner", "Open the existing Home Banner owner to manage the top storefront banner.", "home", "Review")}
                ${ownerActionCard("Placements", "Review assigned home placements and draft state.", "configuration", "Draft Status")}
                ${ownerActionCard("Featured", "Check featured storefront sections and owner readiness.", "home", "Review")}
                ${ownerActionCard("Trending", "Review visible content used by high-priority home areas.", "home", "Review")}
                ${ownerActionCard("Sections", "Review storefront sections without changing public behavior here.", "home", "Review")}
                ${ownerActionCard("Preview", "Preview the current Home route by region and viewport.", "preview", "Open Preview")}
            </section>
            <div class="website-runtime-grid">
                ${metricCard("Home Items", homeItems.length, "observed surfaces")}
                ${metricCard("Ready", readyCount, "owner-managed")}
                ${metricCard("Needs Review", reviewCount, "check before publish")}
                ${metricCard("Draft", draftStatusLabel(), "editing state")}
            </div>
            <details class="website-developer-tools">
                <summary>
                    <div>
                        <strong>Technical Details</strong>
                        <span>Configuration IDs, adapters, source ownership, diagnostics, and raw readiness.</span>
                    </div>
                    <b>Developer</b>
                </summary>
                ${renderDomains(["Home"])}
            </details>
        `;
    }

    function renderOverview(data) {
        const summary = data.summary || {};
        return `
            ${renderOwnerContextBar(data)}
            <section class="website-owner-hero" aria-labelledby="websiteOwnerPrompt">
                <div>
                    <span class="admin-eyebrow">Owner Mode</span>
                    <h3 id="websiteOwnerPrompt">What do you want to do today?</h3>
                    <p>Choose a daily website task. Technical runtime tools stay available under Developer Tools.</p>
                </div>
                <button class="admin-primary-btn" type="button" data-website-runtime-open="preview">Preview Website</button>
            </section>
            <section class="website-owner-action-grid" aria-label="Website owner tasks">
                ${ownerActionCard("Manage Home", "Hero banner, placements, featured, trending, sections, draft status, and preview.", "home", "Open Home")}
                ${ownerActionCard("Manage Games", "Review games and public catalog surfaces that feed the storefront.", "games", "Open Games")}
                ${ownerActionCard("Promotions", "Check active campaign and promotional placements.", "campaigns", "Open Promotions")}
                ${ownerActionCard("Regions", "Review Myanmar and Thailand storefront coverage.", "regions", "Open Regions")}
                ${ownerActionCard("Preview Website", "See the public website by route, region, and viewport.", "preview", "Open Preview")}
                ${ownerActionCard("Publish Status", "Check readiness, draft status, validation, and safe next steps.", "configuration", "Check Status")}
            </section>
            <details class="website-developer-tools">
                <summary>
                    <div>
                        <strong>Developer Tools</strong>
                        <span>Runtime, Configuration System, Editing Sessions, Diagnostics, Health, Events, Ownership, and raw details.</span>
                    </div>
                    <b>Advanced</b>
                </summary>
                <div class="website-developer-tool-grid">
                    ${developerToolButton("Website Runtime", "overview", `${humanizeEnum(data.runtime?.status || "OBSERVING")} · ${data.runtime?.environment || "browser"}`)}
                    ${developerToolButton("Configuration System", "configuration", `${state.configuration.data?.definitionCount || 0} definitions`)}
                    ${developerToolButton("Editing Sessions", "configuration", state.configuration.session?.sessionId ? ownerReadinessLabel(state.configuration.session.status) : "No active session")}
                    ${developerToolButton("Diagnostics", "diagnostics", `${summary.blockedReadinessCount || 0} action items`)}
                    ${developerToolButton("Health", "diagnostics", ownerReadinessLabel(data.runtimeHealth?.overallHealth?.status || "UNKNOWN"))}
                    ${developerToolButton("Ownership", "navigation", `${data.ownershipSummary?.length || 0} owners`)}
                </div>
                <div class="website-runtime-grid">
                    ${metricCard("Website Runtime", humanizeEnum(data.runtime?.status || "OBSERVING"), data.runtime?.environment || "")}
                    ${metricCard("Routes", data.publicRoutes?.length || 0, "observed public routes")}
                    ${metricCard("Inventory", summary.total || 0, "normalized items")}
                    ${metricCard("Action Required", summary.blockedReadinessCount || 0, "readiness items")}
                </div>
                ${renderRuntimeHealth(data.runtimeHealth || {})}
            </details>
        `;
    }

    function ownerActionCard(title, description, tab, actionLabel) {
        return `
            <article class="website-owner-action-card">
                <div>
                    <h4>${escapeHtml(title)}</h4>
                    <p>${escapeHtml(description)}</p>
                </div>
                <button class="admin-secondary-btn" type="button" data-website-runtime-open="${escapeHtml(tab)}">${escapeHtml(actionLabel)}</button>
            </article>
        `;
    }

    function developerToolButton(title, tab, description) {
        return `
            <button class="website-developer-tool" type="button" data-website-runtime-open="${escapeHtml(tab)}">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(description || "Open")}</span>
            </button>
        `;
    }

    function renderRuntimeHealth(health = {}) {
        const keys = [
            ["inventoryCoverage", "Inventory Coverage"],
            ["ownershipAccuracy", "Ownership Accuracy"],
            ["previewAvailability", "Preview Availability"],
            ["apiReachability", "API Reachability"],
            ["regionAwareness", "Region Awareness"],
            ["localizationCoverage", "Localization Coverage"],
            ["configurationReadiness", "Configuration Readiness"],
            ["overallHealth", "Overall Health"]
        ];
        return `
            <section class="website-runtime-health-grid" aria-label="Runtime health summary">
                ${keys.map(([key, label]) => {
                    const item = health[key] || { status: "Unknown", reason: "" };
                    return `
                        <article class="website-runtime-health ${readinessClass(item.status)}">
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(humanizeEnum(item.status))}</strong>
                            <small>${escapeHtml(item.reason || "")}</small>
                        </article>
                    `;
                }).join("")}
            </section>
        `;
    }

    function metricCard(label, value, hint) {
        return `
            <article class="website-runtime-metric">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                <small>${escapeHtml(hint || "")}</small>
            </article>
        `;
    }

    function ownerCard(item) {
        return `
            <article class="website-runtime-card">
                <div>
                    <span class="admin-status-pill ${readinessClass(item.configurationReadiness)}">${escapeHtml(humanizeEnum(item.configurationReadiness || item.managementState || "OBSERVED"))}</span>
                    <h4>${escapeHtml(item.displayName)}</h4>
                    <p>${escapeHtml(item.sourceOwner || humanizeEnum(item.sourceType) || "Unknown")}</p>
                    <small>${escapeHtml((item.regionScope || []).join(", "))}</small>
                </div>
                ${item.ownerAppId ? `<button class="admin-secondary-btn" type="button" data-open-owner="${escapeHtml(item.ownerAppId)}">${escapeHtml(ownerLabel(item.ownerAppId))}</button>` : ""}
            </article>
        `;
    }

    function ownerLabel(appId) {
        const labels = {
            catalog: "Open Catalog",
            "site-content": "Open Home Banners",
            campaigns: "Open Campaigns",
            payments: "Open Payment Infrastructure",
            settings: "Open Site Settings"
        };
        return labels[appId] || "Open Owner";
    }

    function renderDomain(domain) {
        return renderDomains([domain]);
    }

    function renderDomains(domains) {
        const query = state.inventorySearch.trim().toLowerCase();
        const items = (state.data?.inventory || [])
            .filter(entry => domains.includes(entry.domain))
            .filter(entry => !query || searchableInventoryText(entry).includes(query));
        if (!items.length) {
            return `
                ${renderInventorySearch()}
                <div class="admin-empty-state">${escapeHtml(t("no_data", "No data"))}</div>
            `;
        }
        return `
            ${renderInventorySearch()}
            <div class="website-runtime-list">${items.map(inventoryRow).join("")}</div>
        `;
    }

    function renderInventorySearch() {
        return `
            <label class="website-runtime-search">
                <span>${escapeHtml(t("search", "Search"))}</span>
                <input type="search" value="${escapeHtml(state.inventorySearch)}" data-website-inventory-search placeholder="Owner, route, domain, source, status">
            </label>
        `;
    }

    function inventoryRow(entry) {
        const metadata = entry.metadata || {};
        const metadataText = Object.keys(metadata).length
            ? Object.entries(metadata).map(([key, value]) => `${key}: ${value ?? "—"}`).join(", ")
            : "—";
        return `
            <details class="website-runtime-detail-card ${readinessClass(entry.configurationReadiness)}">
                <summary>
                    <div>
                        <strong>${escapeHtml(entry.displayName)}</strong>
                        <span>${escapeHtml(entry.domain)} · ${escapeHtml(humanizeEnum(entry.sourceType))} · ${escapeHtml(humanizeEnum(entry.managementState))}</span>
                        <small>${escapeHtml(entry.readinessExplanation || entry.fallbackBehavior || "No fallback noted.")}</small>
                    </div>
                    <div>
                        <b>${escapeHtml(humanizeEnum(entry.configurationReadiness || entry.status))}</b>
                        ${entry.ownerAppId ? `<button class="admin-secondary-btn" type="button" data-open-owner="${escapeHtml(entry.ownerAppId)}">${escapeHtml(ownerLabel(entry.ownerAppId))}</button>` : ""}
                    </div>
                </summary>
                <div class="website-runtime-detail-grid">
                    ${detail("Owner", entry.sourceOwner)}
                    ${detail("Owner App", entry.ownerAppId || "—")}
                    ${detail("Management State", humanizeEnum(entry.managementState))}
                    ${detail("Source Type", humanizeEnum(entry.sourceType))}
                    ${detail("Route", entry.route || "—")}
                    ${detail("Regions", (entry.regionScope || []).join(", "))}
                    ${detail("Languages", (entry.languageScope || []).join(", "))}
                    ${detail("Fallback", entry.fallbackBehavior || "None")}
                    ${detail("Observation Method", humanizeEnum(entry.observationMethod))}
                    ${detail("Runtime Status", humanizeEnum(entry.runtimeStatus || entry.status))}
                    ${detail("Configuration Readiness", humanizeEnum(entry.configurationReadiness))}
                    ${detail("Last Updated", formatBangkokTimestamp(entry.lastUpdated))}
                    ${detail("Diagnostics", (entry.diagnostics || []).length ? entry.diagnostics.join(", ") : "None")}
                    ${detail("Metadata", metadataText)}
                </div>
            </details>
        `;
    }

    function detail(label, value) {
        return `
            <div class="website-runtime-detail-item">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value || "—")}</strong>
            </div>
        `;
    }

    function renderRegions(data) {
        return `
            <div class="website-runtime-owner-grid">
                ${(data.regions || []).map(region => `
                    <article class="website-runtime-card">
                        <span class="admin-status-pill">${escapeHtml(region.status)}</span>
                        <h4>${escapeHtml(region.label)}</h4>
                        <p>${escapeHtml(region.code)} · ${escapeHtml(region.currency)}</p>
                        <small>${escapeHtml(t("website_region_note", "Region preview is isolated through preview query parameters."))}</small>
                    </article>
                `).join("")}
            </div>
            ${renderDomains(["Regions", "Localization"])}
        `;
    }

    function renderConfiguration() {
        const configState = state.configuration;
        if (configState.loading) {
            return `<div class="website-runtime-skeleton"></div><div class="website-runtime-skeleton"></div>`;
        }
        if (configState.error) {
            return `
                <div class="admin-empty-state">
                    <strong>Configuration registry unavailable</strong>
                    <p>${escapeHtml(configState.error)}</p>
                    <button class="admin-secondary-btn" type="button" data-configuration-refresh>${escapeHtml(t("try_again", "Try again"))}</button>
                </div>
            `;
        }
        const registry = configState.data;
        if (!registry) {
            return `<div class="admin-empty-state">Configuration registry has not loaded yet.</div>`;
        }
        const diagnostics = registry.diagnostics || {};
        const draftDiagnostics = registry.draftDiagnostics || state.data?.configurationRegistry?.draftDiagnostics || {};
        const definition = (registry.definitions || []).find(item => item.id === "website.home.placements") || registry.definitions?.[0] || {};
        const session = configState.session;
        const sessionContextMatches = session?.context?.region === configState.contextRegion;
        const sessionActive = session?.sessionId && sessionContextMatches && !["CLOSED", "EXPIRED", "FAILED"].includes(session.status);
        const resolution = configState.resolution || session;
        const validation = configState.validation || session?.validation;
        const draft = configState.draft;
        const actionLoading = configState.actionLoading;
        const actionDisabled = actionLoading ? "disabled" : "";
        const actionLabel = actionLoading ? "Working..." : "";
        return `
            ${renderOwnerContextBar(state.data || {})}
            <section class="website-owner-section-head">
                <div>
                    <span class="admin-eyebrow">Publish Status</span>
                    <h3>${escapeHtml(publishStatusLabel(state.data || {}))}</h3>
                    <p>Review draft state, validate changes, and preview safely. Publishing is not implemented in this workspace.</p>
                </div>
                <button class="admin-secondary-btn" type="button" data-website-runtime-open="preview">Preview Website</button>
            </section>
            <article class="website-runtime-card">
                <div>
                    <span class="admin-status-pill ${draft?.dirtyState?.isDirty ? "readiness-warning" : ""}">${escapeHtml(draftStatusLabel())}</span>
                    <h4>${escapeHtml(draft ? "Draft changes are available." : "No draft changes yet.")}</h4>
                    <p>${escapeHtml(sessionActive ? "You can create, validate, preview, or discard runtime-only draft changes." : "Start editing to create a new editing session.")}</p>
                </div>
            </article>
            <section class="website-runtime-config-actions">
                <label class="website-runtime-search">
                    <span>Current Region</span>
                    <select data-configuration-region>
                        <option value="MM" ${configState.contextRegion === "MM" ? "selected" : ""}>Myanmar</option>
                        <option value="TH" ${configState.contextRegion === "TH" ? "selected" : ""}>Thailand</option>
                    </select>
                </label>
                <button class="admin-secondary-btn" type="button" data-configuration-open-session="${escapeHtml(definition.id || "website.home.placements")}" ${actionDisabled}>${escapeHtml(sessionActive ? "Reopen Session" : "Start Editing")}</button>
                <button class="admin-secondary-btn" type="button" data-draft-create="${escapeHtml(session?.sessionId || "")}" ${sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "createDraft" ? "Working..." : "Create Draft"}</button>
                <button class="admin-secondary-btn" type="button" data-draft-toggle="${escapeHtml(session?.sessionId || "")}" ${draft && sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "updateDraft" ? "Working..." : "Toggle First Placement"}</button>
                <button class="admin-secondary-btn" type="button" data-draft-validate="${escapeHtml(session?.sessionId || "")}" ${draft && sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "validateDraft" ? "Working..." : "Validate Draft"}</button>
                <button class="admin-secondary-btn" type="button" data-draft-preview="${escapeHtml(session?.sessionId || "")}" ${draft && sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "previewDraft" ? "Working..." : "Preview Draft"}</button>
                <button class="admin-secondary-btn" type="button" data-draft-discard="${escapeHtml(session?.sessionId || "")}" ${draft && sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "discardDraft" ? "Working..." : "Discard Draft"}</button>
            </section>
            ${draft?.previewProjection ? renderDraftPreview(draft.previewProjection) : ""}
            <details class="website-developer-tools">
                <summary>
                    <div>
                        <strong>Developer Tools</strong>
                        <span>Configuration System, Editing Session, adapters, validation detail, readiness diagnostics, and raw projection data.</span>
                    </div>
                    <b>Advanced</b>
                </summary>
            <div class="website-runtime-grid">
                ${metricCard("Registry", humanizeEnum(registry.lifecycleStatus || diagnostics.lifecycleStatus), "lifecycle")}
                ${metricCard("Definitions", registry.definitionCount || 0, "registered contracts")}
                ${metricCard("Adapters", registry.adapterCount || 0, "owner adapters")}
                ${metricCard("Readiness", `${diagnostics.readyCount || 0}/${diagnostics.partialCount || 0}/${diagnostics.blockedCount || 0}`, "ready / partial / blocked")}
            </div>
            <div class="website-runtime-grid">
                ${metricCard("Active Drafts", draftDiagnostics.activeDrafts || 0, "runtime memory")}
                ${metricCard("Dirty Drafts", draftDiagnostics.dirtyDrafts || 0, "changed drafts")}
                ${metricCard("Expired Drafts", draftDiagnostics.expiredDrafts || 0, "session lifecycle")}
                ${metricCard("Previews", draftDiagnostics.previewCount || 0, "draft projections")}
            </div>
            <article class="website-runtime-detail-card readiness-${String(definition.readiness || "unknown").toLowerCase()}">
                <summary>
                    <div>
                        <strong>${escapeHtml(definition.displayName || "Home Placements")}</strong>
                        <span>${escapeHtml(definition.id || "website.home.placements")} · ${escapeHtml(humanizeEnum(definition.domain))}</span>
                        <small>${escapeHtml(definition.description || "Read-only configuration contract.")}</small>
                    </div>
                    <div>
                        <b>${escapeHtml(humanizeEnum(definition.readiness || "UNKNOWN"))}</b>
                        <button class="admin-secondary-btn" type="button" data-open-owner="${escapeHtml(definition.ownerAppId || "site-content")}">${escapeHtml(ownerLabel(definition.ownerAppId || "site-content"))}</button>
                    </div>
                </summary>
                <div class="website-runtime-detail-grid">
                    ${detail("Owner", definition.ownerAppId || "—")}
                    ${detail("Adapter", definition.ownerAdapterId || "—")}
                    ${detail("Source", `${humanizeEnum(definition.sourceType)} · ${definition.sourceReference || "—"}`)}
                    ${detail("Capabilities", (definition.capabilities || []).map(humanizeEnum).join(", "))}
                    ${detail("Regions", (definition.regionScope || []).join(", "))}
                    ${detail("Languages", (definition.languageScope || []).join(", "))}
                    ${detail("Schema Version", definition.schemaVersion || "—")}
                    ${detail("Readiness Reason", definition.metadata?.readinessReason || "—")}
                </div>
            </article>
            <section class="website-runtime-config-actions">
                <label class="website-runtime-search">
                    <span>Resolution Region</span>
                    <select data-configuration-region>
                        <option value="MM" ${configState.contextRegion === "MM" ? "selected" : ""}>Myanmar</option>
                        <option value="TH" ${configState.contextRegion === "TH" ? "selected" : ""}>Thailand</option>
                    </select>
                </label>
                <button class="admin-secondary-btn" type="button" data-configuration-open-session="${escapeHtml(definition.id || "website.home.placements")}" ${actionDisabled}>${escapeHtml(sessionActive ? "Reopen Session" : "Open Session")}</button>
                <button class="admin-secondary-btn" type="button" data-configuration-resolve-session="${escapeHtml(session?.sessionId || "")}" ${sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "resolveSession" ? actionLabel : "Resolve"}</button>
                <button class="admin-secondary-btn" type="button" data-configuration-validate-session="${escapeHtml(session?.sessionId || "")}" ${sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "validateSession" ? actionLabel : "Validate"}</button>
                <button class="admin-secondary-btn" type="button" data-configuration-close-session="${escapeHtml(session?.sessionId || "")}" ${sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "closeSession" ? actionLabel : "Close Session"}</button>
                <button class="admin-secondary-btn" type="button" data-configuration-refresh ${actionDisabled}>Refresh Registry</button>
            </section>
            ${renderConfigurationSession(session)}
            ${renderConfigurationDraft(session, draft)}
            ${resolution ? renderConfigurationResolution(resolution) : ""}
            ${validation ? renderConfigurationValidation(validation) : ""}
            </details>
        `;
    }

    function renderConfigurationSession(session) {
        if (!session) {
            return `
                <article class="website-runtime-card">
                    <div>
                        <span class="admin-status-pill">No active session</span>
                        <h4>Configuration Runtime Session</h4>
                        <p>Open a transient session to inspect one configuration resolution lifecycle.</p>
                    </div>
                </article>
            `;
        }
        const duration = Math.max(0, Math.round((Date.now() - new Date(session.openedAt).getTime()) / 1000));
        const expired = ["CLOSED", "EXPIRED", "FAILED"].includes(session.status);
        return `
            <article class="website-runtime-detail-card ${readinessClass(session.readiness?.state)}" open>
                <summary>
                    <div>
                        <strong>${expired ? "Session expired" : "Active Session"}</strong>
                        <span>${escapeHtml(session.sessionId)} · ${escapeHtml(session.configurationId)}</span>
                        <small>${escapeHtml(session.context?.region || "MM")} · ${escapeHtml(session.context?.language || "en")} · ${escapeHtml(session.context?.previewMode || "desktop")}</small>
                    </div>
                    <div>
                        <b>${escapeHtml(humanizeEnum(session.status || "OPEN"))}</b>
                    </div>
                </summary>
                <div class="website-runtime-detail-grid">
                    ${detail("Opened", formatBangkokTimestamp(session.openedAt))}
                    ${detail("Last Activity", formatBangkokTimestamp(session.updatedAt))}
                    ${detail("Expires", formatBangkokTimestamp(session.expiresAt))}
                    ${detail("Configuration", session.configurationId)}
                    ${detail("Owner", "Current User")}
                    ${detail("Region", session.context?.region || "—")}
                    ${detail("Context", session.contextFingerprint || "—")}
                    ${detail("Reuse/New", session.reuseState || "—")}
                    ${detail("Expired", expired ? "Yes · Reopen Session" : "No")}
                    ${detail("Validation", session.validation?.valid ? "Valid" : "Needs review")}
                    ${detail("Readiness", `${humanizeEnum(session.readiness?.state)} · ${session.readiness?.reason || "—"}`)}
                    ${detail("Session Duration", `${duration}s`)}
                    ${detail("Capabilities", (session.capabilities || []).map(humanizeEnum).join(", ") || "—")}
                </div>
            </article>
        `;
    }

    function renderConfigurationDraft(session, draft) {
        const sessionActive = session?.sessionId &&
            session.context?.region === state.configuration.contextRegion &&
            !["CLOSED", "EXPIRED", "FAILED"].includes(session.status);
        const actionLoading = state.configuration.actionLoading;
        const changed = draft?.dirtyState?.changedFields || [];
        return `
            <article class="website-runtime-detail-card ${draft?.dirtyState?.isDirty ? "readiness-warning" : ""}" ${draft ? "open" : ""}>
                <summary>
                    <div>
                        <strong>Home Placement Draft</strong>
                        <span>${escapeHtml(draft?.status || "No draft")} · ${draft?.dirtyState?.isDirty ? "Dirty" : "Clean"}</span>
                        <small>${escapeHtml(draft?.draftId || "Runtime only. Production SitePlacement is untouched.")}</small>
                    </div>
                    <div>
                        <b>${escapeHtml(draft?.dirtyState?.isDirty ? `${draft.dirtyState.changeCount} changes` : "Clean")}</b>
                    </div>
                </summary>
                <div class="website-runtime-detail-grid">
                    ${detail("Draft Status", humanizeEnum(draft?.status || "UNKNOWN"))}
                    ${detail("Dirty Indicator", draft?.dirtyState?.isDirty ? "Dirty" : "Clean")}
                    ${detail("Changed Fields", changed.length ? changed.join(", ") : "None")}
                    ${detail("Validation", draft?.validation?.valid ? "Valid" : draft?.validation ? "Needs review" : "Not run")}
                    ${detail("Preview Mode", draft?.previewProjection ? "Draft" : "Production")}
                    ${detail("Production Mutation", "No")}
                </div>
                <section class="website-runtime-config-actions">
                    <button class="admin-secondary-btn" type="button" data-draft-create="${escapeHtml(session?.sessionId || "")}" ${sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "createDraft" ? "Working..." : "Create Draft"}</button>
                    <button class="admin-secondary-btn" type="button" data-draft-toggle="${escapeHtml(session?.sessionId || "")}" ${draft && sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "updateDraft" ? "Working..." : "Toggle First Placement"}</button>
                    <button class="admin-secondary-btn" type="button" data-draft-validate="${escapeHtml(session?.sessionId || "")}" ${draft && sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "validateDraft" ? "Working..." : "Validate Draft"}</button>
                    <button class="admin-secondary-btn" type="button" data-draft-preview="${escapeHtml(session?.sessionId || "")}" ${draft && sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "previewDraft" ? "Working..." : "Preview Draft"}</button>
                    <button class="admin-secondary-btn" type="button" data-draft-discard="${escapeHtml(session?.sessionId || "")}" ${draft && sessionActive && !actionLoading ? "" : "disabled"}>${actionLoading === "discardDraft" ? "Working..." : "Discard Draft"}</button>
                </section>
                ${draft?.previewProjection ? renderDraftPreview(draft.previewProjection) : ""}
            </article>
        `;
    }

    function renderDraftPreview(preview = {}) {
        return `
            <section class="website-runtime-diagnostic-section">
                <h4>Production → Draft</h4>
                <div class="website-runtime-list">
                    ${(preview.placements || []).map(placement => `
                        <article class="website-runtime-row compact ${placement.changed ? "readiness-warning" : ""}">
                            <div>
                                <strong>${escapeHtml(placement.displayName || placement.placementCode)}</strong>
                                <span>${escapeHtml(placement.productionState || "Production")} → ${escapeHtml(placement.draftState || "Draft")}</span>
                            </div>
                            <b>${placement.changed ? "Changed" : "Same"}</b>
                        </article>
                    `).join("")}
                </div>
            </section>
        `;
    }

    function renderConfigurationResolution(resolution = {}) {
        const configured = resolution.configuredValue?.placements || [];
        const fallback = resolution.fallbackValue?.placements || [];
        const effective = resolution.effectiveValue?.placements || [];
        return `
            <section class="website-runtime-diagnostic-section">
                <h4>Resolved Configuration</h4>
                <div class="website-runtime-grid">
                    ${metricCard("Configured", configured.length, "SitePlacement records")}
                    ${metricCard("Fallback", fallback.filter(item => item.fallbackState === "ACTIVE").length, "active fallbacks")}
                    ${metricCard("Effective", effective.length, `${resolution.context?.region || "MM"} projection`)}
                    ${metricCard("Readiness", humanizeEnum(resolution.readiness?.state), resolution.readiness?.reason || "")}
                </div>
                <details class="website-runtime-detail-card">
                    <summary><div><strong>Technical Detail</strong><span>Safe session projection</span></div><b>${escapeHtml(formatBangkokTimestamp(resolution.resolvedAt || resolution.updatedAt))}</b></summary>
                    <div class="website-runtime-detail-grid">
                        ${detail("Configured Summary", configured.map(item => `${item.placementCode}:${item.assignedContentReference?.length || 0}`).join(", ") || "—")}
                        ${detail("Fallback Summary", fallback.map(item => `${item.placementCode}:${item.fallbackState}`).join(", ") || "—")}
                        ${detail("Effective Summary", effective.map(item => `${item.placementCode}:${item.effectiveState}`).join(", ") || "—")}
                        ${detail("Validation", resolution.validation?.valid ? "Valid" : "Needs review")}
                    </div>
                </details>
            </section>
        `;
    }

    function renderConfigurationValidation(validation = {}) {
        return `
            <section class="website-runtime-diagnostic-section">
                <h4>Validation</h4>
                <div class="website-runtime-grid">
                    ${metricCard("Valid", validation.valid ? "Yes" : "No", "read-only validation")}
                    ${metricCard("Errors", validation.errors?.length || 0, "blocking")}
                    ${metricCard("Warnings", validation.warnings?.length || 0, "review")}
                    ${metricCard("Validated", formatBangkokTimestamp(validation.validatedAt || validation.updatedAt), "Asia/Bangkok")}
                </div>
            </section>
        `;
    }

    function renderPreview(data) {
        const routes = data.publicRoutes || [];
        state.previewRoute = normalizePreviewRoute(state.previewRoute);
        state.previewRegion = normalizePreviewRegion(state.previewRegion);
        state.previewMode = normalizePreviewMode(state.previewMode);
        const routeOptions = routes.map(route => `<option value="${escapeHtml(route.path)}" ${route.path === state.previewRoute ? "selected" : ""}>${escapeHtml(route.label)}</option>`).join("");
        const previewSrc = buildPreviewUrl();
        state.previewHealth.regionApplied = state.previewRegion;
        state.previewHealth.viewport = state.previewMode;
        return `
            <div class="website-preview-shell">
                <form class="website-preview-controls" aria-label="Website preview controls">
                    <label>${escapeHtml(t("route", "Route"))}<select data-preview-route>${routeOptions}</select></label>
                    <label>${escapeHtml(t("region", "Region"))}<select data-preview-region>
                        <option value="MM" ${state.previewRegion === "MM" ? "selected" : ""}>Myanmar</option>
                        <option value="TH" ${state.previewRegion === "TH" ? "selected" : ""}>Thailand</option>
                    </select></label>
                    <div class="dashboard-segmented" role="tablist" aria-label="Preview device mode">
                        ${["desktop", "tablet", "mobile"].map(mode => `<button class="${state.previewMode === mode ? "active" : ""}" type="button" data-preview-mode="${mode}">${escapeHtml(mode)}</button>`).join("")}
                    </div>
                    <button class="admin-secondary-btn" type="button" data-refresh-preview>${escapeHtml(t("refresh", "Refresh"))}</button>
                    <button class="admin-secondary-btn" type="button" data-open-preview>${escapeHtml(t("open", "Open"))}</button>
                </form>
                <div class="website-preview-frame-wrap ${escapeHtml(state.previewMode)}">
                    <iframe data-preview-frame title="AZIEL public website preview" sandbox="allow-same-origin allow-scripts allow-forms" referrerpolicy="same-origin" src="${escapeHtml(previewSrc)}"></iframe>
                </div>
                <div id="websitePreviewHealth" class="website-preview-health">
                    ${renderPreviewHealth(data)}
                </div>
                <p class="website-runtime-note">${escapeHtml(t("website_preview_note", "Preview is read-only and limited to approved same-origin public routes."))}</p>
            </div>
        `;
    }

    function renderPreviewHealth(data = {}) {
        const route = (data.routeReadiness || []).find(item => item.path === state.previewRoute);
        const health = {
            ...state.previewHealth,
            routeAvailable: route?.routeStatus || "Unknown",
            regionApplied: state.previewRegion,
            viewport: state.previewMode
        };
        return `
            <div class="website-runtime-grid compact">
                ${metricCard("Iframe loaded", health.iframeLoaded ? "Yes" : "No", health.refreshState)}
                ${metricCard("Route", humanizeEnum(health.routeAvailable), state.previewRoute)}
                ${metricCard("Latency", health.previewLatencyMs == null ? "—" : `${health.previewLatencyMs} ms`, "preview load")}
                ${metricCard("Region", health.regionApplied, "applied preview context")}
                ${metricCard("Viewport", humanizeEnum(health.viewport), "preview frame")}
                ${metricCard("Assets", humanizeEnum(health.assetStatus), "iframe load signal")}
                ${metricCard("Refresh", humanizeEnum(health.refreshState), "current state")}
                ${metricCard("Origin", health.sameOriginState, "sandboxed")}
            </div>
        `;
    }

    function renderDiagnostics(data) {
        const diagnostics = data.diagnostics || {};
        const failures = diagnostics.sourceFailures || [];
        const migrationCandidates = diagnostics.migrationCandidates || [];
        const needsReview = diagnostics.needsReview || [];
        const observationWarnings = diagnostics.observationWarnings || [];
        const configurationGaps = diagnostics.configurationGaps || [];
        return `
            <div class="website-runtime-grid">
                ${metricCard("API", humanizeEnum(diagnostics.apiReachabilityStatus || "OBSERVED"), "reachability")}
                ${metricCard("Hardcoded", diagnostics.hardcodedItemCount || 0, "items")}
                ${metricCard("Unknown", diagnostics.unknownItemCount || 0, "items")}
                ${metricCard("Preview", humanizeEnum(diagnostics.previewAvailability || "SAME_ORIGIN"), "availability")}
            </div>
            ${diagnosticSection("Migration Candidates", migrationCandidates, item => `${item.displayName} · ${humanizeEnum(item.configurationReadiness)}`)}
            ${diagnosticSection("Needs Review", needsReview, item => `${item.displayName} · ${humanizeEnum(item.managementState)}`)}
            ${diagnosticSection("Observation Warnings", observationWarnings, item => `${item.source || item.id || "Runtime"} · ${item.code || "Warning"}`)}
            ${diagnosticSection("Configuration Gaps", configurationGaps, item => `${item.displayName} · ${item.reason || item.readiness || "Review"}`)}
            ${renderMigrationQueue(data.migrationQueue || [])}
            ${failures.length ? diagnosticSection("Source Failures", failures, item => `${item.source} · ${item.code}`) : ""}
        `;
    }

    function diagnosticSection(title, items, labeler) {
        return `
            <section class="website-runtime-diagnostic-section">
                <h4>${escapeHtml(title)}</h4>
                <div class="website-runtime-list">
                    ${items.length ? items.map(item => `
                        <article class="website-runtime-row compact">
                            <div>
                                <strong>${escapeHtml(labeler(item))}</strong>
                                <span>${escapeHtml(item.reason || item.message || item.readinessExplanation || item.domain || "Review before migration.")}</span>
                            </div>
                            <b>${escapeHtml(humanizeEnum(item.readiness || item.configurationReadiness || item.status || "Warning"))}</b>
                        </article>
                    `).join("") : `<div class="admin-empty-state">${escapeHtml(t("no_data", "No data"))}</div>`}
                </div>
            </section>
        `;
    }

    function renderMigrationQueue(queue) {
        return `
            <section class="website-runtime-diagnostic-section">
                <h4>Migration Queue</h4>
                <div class="website-runtime-migration-list">
                    ${queue.map(item => `
                        <article>
                            <span>${escapeHtml(String(item.priority))}</span>
                            <div>
                                <strong>${escapeHtml(item.displayName)}</strong>
                                <small>${escapeHtml(item.domain)} · ${escapeHtml(humanizeEnum(item.readiness))}</small>
                                <p>${escapeHtml(item.reason)}</p>
                            </div>
                        </article>
                    `).join("")}
                </div>
            </section>
        `;
    }

    function bindWebsiteRuntimeActions(root) {
        root.querySelectorAll("[data-open-owner]").forEach(btn => {
            btn.addEventListener("click", () => {
                const appId = btn.dataset.openOwner;
                try {
                    window.AZIELOS?.navigation?.openApp?.(appId, { source: "website-runtime" });
                } catch (_error) {
                    document.querySelector(`.admin-nav[data-section="${appId}"]`)?.click();
                }
            });
        });

        root.querySelectorAll("[data-website-runtime-open]").forEach(btn => {
            btn.addEventListener("click", () => openWebsiteTab(btn.dataset.websiteRuntimeOpen || "overview"));
        });

        root.querySelector("[data-website-inventory-search]")?.addEventListener("input", event => {
            state.inventorySearch = event.target.value || "";
            renderWebsiteRuntime();
        });

        root.querySelector("[data-configuration-refresh]")?.addEventListener("click", () => loadConfigurationRegistry(true));
        root.querySelector("[data-configuration-region]")?.addEventListener("change", event => {
            state.configuration.contextRegion = normalizePreviewRegion(event.target.value);
            state.configuration.session = null;
            state.configuration.resolution = null;
            state.configuration.validation = null;
            state.configuration.draft = null;
            renderWebsiteRuntime();
        });
        root.querySelector("[data-configuration-open-session]")?.addEventListener("click", async event => {
            await openConfigurationSession(event.currentTarget.dataset.configurationOpenSession || "website.home.placements");
        });
        root.querySelector("[data-configuration-resolve-session]")?.addEventListener("click", async event => {
            await resolveConfigurationSession(event.currentTarget.dataset.configurationResolveSession || "");
        });
        root.querySelector("[data-configuration-validate-session]")?.addEventListener("click", async event => {
            await validateConfigurationSession(event.currentTarget.dataset.configurationValidateSession || "");
        });
        root.querySelector("[data-configuration-close-session]")?.addEventListener("click", async event => {
            await closeConfigurationSession(event.currentTarget.dataset.configurationCloseSession || "");
        });
        root.querySelector("[data-draft-create]")?.addEventListener("click", async event => {
            await createHomePlacementDraft(event.currentTarget.dataset.draftCreate || "");
        });
        root.querySelector("[data-draft-toggle]")?.addEventListener("click", async event => {
            await toggleFirstDraftPlacement(event.currentTarget.dataset.draftToggle || "");
        });
        root.querySelector("[data-draft-validate]")?.addEventListener("click", async event => {
            await validateHomePlacementDraft(event.currentTarget.dataset.draftValidate || "");
        });
        root.querySelector("[data-draft-preview]")?.addEventListener("click", async event => {
            await previewHomePlacementDraft(event.currentTarget.dataset.draftPreview || "");
        });
        root.querySelector("[data-draft-discard]")?.addEventListener("click", async event => {
            await discardHomePlacementDraft(event.currentTarget.dataset.draftDiscard || "");
        });

        root.querySelector("[data-preview-route]")?.addEventListener("change", event => {
            state.previewRoute = normalizePreviewRoute(event.target.value);
            window.AZIELOS?.events?.emit?.("website.preview.route_changed", { route: state.previewRoute }, { source: "website-app" });
            navigatePreview(root, "Route changed", true);
        });
        root.querySelector("[data-preview-region]")?.addEventListener("change", event => {
            state.previewRegion = normalizePreviewRegion(event.target.value);
            window.AZIELOS?.events?.emit?.("website.preview.region_changed", { region: state.previewRegion }, { source: "website-app" });
            navigatePreview(root, "Region changed", true);
        });
        root.querySelectorAll("[data-preview-mode]").forEach(btn => {
            btn.addEventListener("click", () => {
                state.previewMode = normalizePreviewMode(btn.dataset.previewMode);
                state.previewHealth.viewport = state.previewMode;
                root.querySelectorAll("[data-preview-mode]").forEach(modeButton => {
                    const active = modeButton.dataset.previewMode === state.previewMode;
                    modeButton.classList.toggle("active", active);
                    modeButton.setAttribute("aria-pressed", active ? "true" : "false");
                });
                root.querySelector(".website-preview-frame-wrap")?.classList.remove("desktop", "tablet", "mobile");
                root.querySelector(".website-preview-frame-wrap")?.classList.add(state.previewMode);
                updatePreviewHealth(root);
            });
        });
        root.querySelector("[data-refresh-preview]")?.addEventListener("click", () => {
            navigatePreview(root, "Refreshing", true);
        });
        bindPreviewFrame(root);
        root.querySelector("[data-open-preview]")?.addEventListener("click", () => {
            window.AZIELOS?.events?.emit?.("website.preview.opened", {
                route: state.previewRoute,
                region: state.previewRegion
            }, { source: "website-app" });
            window.open(buildPreviewUrl(), "_blank", "noopener,noreferrer");
        });
    }

    function navigatePreview(root, refreshState = "Loading", cacheBust = false) {
        state.previewRoute = normalizePreviewRoute(state.previewRoute);
        state.previewRegion = normalizePreviewRegion(state.previewRegion);
        state.previewMode = normalizePreviewMode(state.previewMode);
        resetPreviewHealth(refreshState);
        const frame = root.querySelector("[data-preview-frame]");
        if (!frame) {
            renderWebsiteRuntime();
            return;
        }
        bindPreviewFrame(root);
        frame.src = buildPreviewUrl({ cacheBust });
        updatePreviewHealth(root);
    }

    function clearPreviewTimeout() {
        if (state.previewTimeoutId) {
            window.clearTimeout(state.previewTimeoutId);
            state.previewTimeoutId = null;
        }
    }

    function bindPreviewFrame(root) {
        const frame = root.querySelector("[data-preview-frame]");
        if (!frame) return;
        if (!state.previewStartedAt) state.previewStartedAt = performance.now();
        const token = state.previewLoadToken;
        if (frame.dataset.previewLoadToken === String(token)) return;
        frame.dataset.previewLoadToken = String(token);
        clearPreviewTimeout();
        state.previewTimeoutId = window.setTimeout(() => {
            if (token !== state.previewLoadToken) return;
            state.previewHealth = {
                ...state.previewHealth,
                iframeLoaded: false,
                previewLatencyMs: Math.max(0, Math.round(performance.now() - state.previewStartedAt)),
                routeAvailable: "Timeout",
                assetStatus: "Timeout",
                refreshState: "Timeout"
            };
            updatePreviewHealth(root);
        }, 12000);
        frame.addEventListener("load", () => {
            if (token !== state.previewLoadToken) return;
            clearPreviewTimeout();
            state.previewHealth = {
                ...state.previewHealth,
                iframeLoaded: true,
                previewLatencyMs: Math.max(0, Math.round(performance.now() - state.previewStartedAt)),
                routeAvailable: "Observed",
                regionApplied: state.previewRegion,
                viewport: state.previewMode,
                assetStatus: "Observed",
                refreshState: "Loaded",
                sameOriginState: "Same-origin sandbox"
            };
            updatePreviewHealth(root);
        }, { once: true });
    }

    function resetPreviewHealth(refreshState = "Loading") {
        clearPreviewTimeout();
        state.previewLoadToken += 1;
        state.previewHealth = {
            iframeLoaded: false,
            routeAvailable: "Unknown",
            previewLatencyMs: null,
            regionApplied: state.previewRegion,
            viewport: state.previewMode,
            assetStatus: "Unknown",
            refreshState,
            sameOriginState: "Same-origin sandbox"
        };
        state.previewStartedAt = performance.now();
    }

    function updatePreviewHealth(root) {
        const target = root.querySelector("#websitePreviewHealth");
        if (!target || !state.data) return;
        target.innerHTML = renderPreviewHealth(state.data);
    }

    async function resolveConfigurationDefinition(id) {
        try {
            state.configuration.actionLoading = "resolveDefinition";
            renderWebsiteRuntime();
            const service = getKernelService("configuration");
            const context = {
                region: state.configuration.contextRegion,
                language: window.AZIEL_ADMIN_I18N?.getLocale?.() || "en",
                route: "/home.html",
                previewMode: state.previewMode
            };
            const data = service
                ? await service.resolve(id, context)
                : await adminFetch(`/api/admin/configuration-registry/${encodeURIComponent(id)}/resolve`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ context })
                });
            state.configuration.resolution = data.resolution || null;
            state.configuration.validation = data.resolution?.validation || null;
            renderWebsiteRuntime();
        } catch (error) {
            showRuntimeNotice(error?.message || "Configuration resolution failed.");
            renderWebsiteRuntime();
        } finally {
            state.configuration.actionLoading = "";
            if (state.activeTab === "configuration") renderWebsiteRuntime();
        }
    }

    async function validateConfigurationDefinition(id) {
        try {
            state.configuration.actionLoading = "validateDefinition";
            renderWebsiteRuntime();
            if (!state.configuration.resolution) await resolveConfigurationDefinition(id);
            const service = getKernelService("configuration");
            const context = {
                region: state.configuration.contextRegion,
                language: window.AZIEL_ADMIN_I18N?.getLocale?.() || "en",
                route: "/home.html",
                previewMode: state.previewMode
            };
            const value = state.configuration.resolution?.configuredValue || { placements: [] };
            const data = service
                ? await service.validate(id, value, context)
                : await adminFetch(`/api/admin/configuration-registry/${encodeURIComponent(id)}/validate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value, context })
                });
            state.configuration.validation = data.validation || null;
            renderWebsiteRuntime();
        } catch (error) {
            showRuntimeNotice(error?.message || "Configuration validation failed.");
            renderWebsiteRuntime();
        } finally {
            state.configuration.actionLoading = "";
            if (state.activeTab === "configuration") renderWebsiteRuntime();
        }
    }

    async function openConfigurationSession(id) {
        try {
            state.configuration.actionLoading = "openSession";
            renderWebsiteRuntime();
            const service = getKernelService("configurationSession");
            const context = configurationContext();
            const data = service
                ? await service.openSession(id, context)
                : await adminFetch(`/api/admin/configuration-registry/${encodeURIComponent(id)}/sessions/open`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ context })
                });
            state.configuration.session = data.session || null;
            state.configuration.resolution = data.session || null;
            state.configuration.validation = data.session?.validation || null;
            state.configuration.draft = null;
            renderWebsiteRuntime();
        } catch (error) {
            showRuntimeNotice(error?.message || "Configuration session failed.");
            renderWebsiteRuntime();
        } finally {
            state.configuration.actionLoading = "";
            if (state.activeTab === "configuration") renderWebsiteRuntime();
        }
    }

    async function resolveConfigurationSession(sessionId) {
        if (!sessionId) return;
        try {
            state.configuration.actionLoading = "resolveSession";
            renderWebsiteRuntime();
            const service = getKernelService("configurationSession");
            const data = service
                ? await service.resolveSession(sessionId)
                : await adminFetch(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/resolve`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({})
                });
            state.configuration.session = data.session || null;
            state.configuration.resolution = data.session || null;
            state.configuration.validation = data.session?.validation || null;
            renderWebsiteRuntime();
        } catch (error) {
            handleConfigurationSessionError(error, "Configuration session resolution failed.");
            renderWebsiteRuntime();
        } finally {
            state.configuration.actionLoading = "";
            if (state.activeTab === "configuration") renderWebsiteRuntime();
        }
    }

    async function validateConfigurationSession(sessionId) {
        if (!sessionId) return;
        try {
            state.configuration.actionLoading = "validateSession";
            renderWebsiteRuntime();
            const service = getKernelService("configurationSession");
            const data = service
                ? await service.validateSession(sessionId)
                : await adminFetch(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/validate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({})
                });
            state.configuration.session = data.session || null;
            state.configuration.resolution = data.session || null;
            state.configuration.validation = data.session?.validation || null;
            renderWebsiteRuntime();
        } catch (error) {
            handleConfigurationSessionError(error, "Configuration session validation failed.");
            renderWebsiteRuntime();
        } finally {
            state.configuration.actionLoading = "";
            if (state.activeTab === "configuration") renderWebsiteRuntime();
        }
    }

    async function closeConfigurationSession(sessionId) {
        if (!sessionId) return;
        try {
            state.configuration.actionLoading = "closeSession";
            renderWebsiteRuntime();
            const service = getKernelService("configurationSession");
            const data = service
                ? await service.closeSession(sessionId)
                : await adminFetch(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/close`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({})
                });
            state.configuration.session = data.session || null;
            state.configuration.resolution = null;
            state.configuration.validation = null;
            state.configuration.draft = null;
            renderWebsiteRuntime();
        } catch (error) {
            handleConfigurationSessionError(error, "Configuration session close failed.");
            renderWebsiteRuntime();
        } finally {
            state.configuration.actionLoading = "";
            if (state.activeTab === "configuration") renderWebsiteRuntime();
        }
    }

    function handleConfigurationSessionError(error, fallbackMessage) {
        const message = error?.message || fallbackMessage;
        if (/expired|closed|not found|invalid session/i.test(message)) {
            state.configuration.session = null;
            state.configuration.resolution = null;
            state.configuration.validation = null;
            state.configuration.draft = null;
            showRuntimeNotice("Session expired. Reopen Session to continue.", "error");
            return;
        }
        showRuntimeNotice(message, "error");
    }

    function configurationContext() {
        return {
            region: state.configuration.contextRegion,
            language: window.AZIEL_ADMIN_I18N?.getLocale?.() || "en",
            route: "/home.html",
            previewMode: state.previewMode
        };
    }

    async function createHomePlacementDraft(sessionId) {
        if (!sessionId) return;
        await draftRequest(sessionId, "createDraft");
    }

    async function toggleFirstDraftPlacement(sessionId) {
        if (!sessionId || !state.configuration.draft) return;
        const first = state.configuration.draft.configuredDraft?.placements?.[0];
        if (!first) return;
        await draftRequest(sessionId, "updateDraft", {
            placements: [{
                placementCode: first.placementCode,
                enabled: first.enabled === false
            }]
        });
    }

    async function validateHomePlacementDraft(sessionId) {
        if (!sessionId) return;
        await draftRequest(sessionId, "validateDraft");
    }

    async function previewHomePlacementDraft(sessionId) {
        if (!sessionId) return;
        await draftRequest(sessionId, "previewDraft");
    }

    async function discardHomePlacementDraft(sessionId) {
        if (!sessionId) return;
        await draftRequest(sessionId, "discardDraft");
    }

    async function draftRequest(sessionId, method, patch = null) {
        try {
            state.configuration.actionLoading = method;
            renderWebsiteRuntime();
            const service = getKernelService("configurationSession");
            let data;
            if (service?.[method]) {
                data = patch ? await service[method](sessionId, patch) : await service[method](sessionId);
            } else {
                const suffix = {
                    createDraft: "draft",
                    updateDraft: "draft/update",
                    validateDraft: "draft/validate",
                    previewDraft: "draft/preview",
                    discardDraft: "draft/discard"
                }[method];
                data = await adminFetch(`/api/admin/configuration-sessions/${encodeURIComponent(sessionId)}/${suffix}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch ? { patch } : {})
                });
            }
            state.configuration.draft = data.draft || null;
            renderWebsiteRuntime();
        } catch (error) {
            handleConfigurationSessionError(error, "Home Placement draft operation failed.");
            renderWebsiteRuntime();
        } finally {
            state.configuration.actionLoading = "";
            if (state.activeTab === "configuration") renderWebsiteRuntime();
        }
    }
})();
