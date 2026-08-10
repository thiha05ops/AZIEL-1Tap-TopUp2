// frontend/js/campaign-runtime.js
// Shared AZIEL customer Campaign placement runtime.

(function () {
    const CLAIM_URL = "/api/campaigns/claim";
    const LEGACY_ENTRY_POPUP_CLAIM_URL = "/api/campaigns/entry-popup/claim";
    const SESSION_KEY = "aziel_campaign_session_key_v1";
    const SESSION_SEEN_KEY = "aziel_campaign_session_seen_v1";
    const LOCAL_STATE_KEY = "aziel_campaign_frequency_v1";
    const MAX_LOCAL_RECORDS = 80;
    const BANGKOK_TIMEZONE = "Asia/Bangkok";

    let initialized = false;
    let lastFocused = null;
    const t = (key, fallback) => window.AZIEL_LOCALE?.t?.(key, fallback) || fallback;
    const claimControllers = new Map();
    const claimSequences = new Map();
    const renderedCampaigns = new Map();

    function currentLocale() {
        return window.AZIEL_LOCALE?.getLocale?.() || "en";
    }

    function localizeCampaign(campaign = {}) {
        const locales = campaign.locales && typeof campaign.locales === "object" ? campaign.locales : {};
        const english = locales.en && typeof locales.en === "object" ? locales.en : campaign;
        const requested = locales[currentLocale()] && typeof locales[currentLocale()] === "object" ? locales[currentLocale()] : {};
        return {
            ...campaign,
            title: String(requested.title || english.title || campaign.title || ""),
            body: String(requested.body || english.body || campaign.body || ""),
            ctaLabel: String(requested.ctaLabel || english.ctaLabel || campaign.ctaLabel || "")
        };
    }

    function isAdminPage() {
        return /(^|\/)admin(?:-|\.html|$)/i.test(window.location.pathname);
    }

    function ready(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
        } else {
            fn();
        }
    }

    function apiUrl(path) {
        return window.AZIEL?.apiUrl?.(path) || path;
    }

    function getToken() {
        return window.AZIEL?.getToken?.() || localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    }

    function getRegion() {
        return window.AZIEL?.getShopRegion?.() || window.AZIEL?.getRegion?.() || localStorage.getItem("shopRegion") || "MM";
    }

    function getSessionKey() {
        let key = sessionStorage.getItem(SESSION_KEY);
        if (key) return key;

        key = `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        sessionStorage.setItem(SESSION_KEY, key);
        return key;
    }

    async function claimPlacement(placement, productCode = "") {
        if (isAdminPage()) return;
        const sequence = Number(claimSequences.get(placement) || 0) + 1;
        claimSequences.set(placement, sequence);
        claimControllers.get(placement)?.abort();
        const controller = new AbortController();
        claimControllers.set(placement, controller);
        const token = getToken();
        const headers = {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        try {
            const response = await fetch(apiUrl(CLAIM_URL), {
                method: "POST",
                signal: controller.signal,
                headers,
                body: JSON.stringify({
                    region: getRegion() === "TH" ? "TH" : "MM",
                    placement,
                    ...(placement === "PRODUCT_NOTICE" ? { productCode } : {}),
                    sessionKey: getSessionKey()
                })
            });
            const data = await response.json();
            if (sequence !== claimSequences.get(placement)) return;
            if (!response.ok || !data?.success) return;

            const campaign = data.authenticated
                ? data.campaign
                : selectGuestCampaign(Array.isArray(data.campaigns) ? data.campaigns : []);

            if (!campaign) return closePlacement(placement);
            if (placement === "PRODUCT_NOTICE" && productCode !== currentProductCode()) return;

            if (renderPlacement(campaign) && !data.authenticated) markGuestShown(campaign);
        } catch (error) {
            if (error?.name === "AbortError") return;
            // Campaign delivery is non-critical. Never block catalog, payments, wallet, or orders.
        }
    }

    const claimEntryPopup = () => claimPlacement("ENTRY_POPUP");

    function selectGuestCampaign(campaigns = []) {
        for (const campaign of campaigns) {
            if (isGuestFrequencyAllowed(campaign)) return campaign;
        }
        return null;
    }

    function readLocalState() {
        try {
            const parsed = JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || "{}");
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeLocalState(state = {}) {
        const entries = Object.entries(state)
            .sort((a, b) => Number(b[1]?.lastShownAt || 0) - Number(a[1]?.lastShownAt || 0))
            .slice(0, MAX_LOCAL_RECORDS);
        localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(Object.fromEntries(entries)));
    }

    function readSessionSeen() {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(SESSION_SEEN_KEY) || "{}");
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeSessionSeen(state = {}) {
        sessionStorage.setItem(SESSION_SEEN_KEY, JSON.stringify(state));
    }

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

    function isGuestFrequencyAllowed(campaign = {}) {
        const code = campaignDismissalKey(campaign);
        if (!code) return false;

        if (campaign.frequencyPolicy === "ONCE_PER_SESSION") {
            return !readSessionSeen()[code];
        }

        const state = readLocalState();
        const record = state[code] || {};

        if (campaign.frequencyPolicy === "ONCE_PER_CAMPAIGN") {
            return !record.lastShownAt;
        }

        if (campaign.frequencyPolicy === "ONCE_PER_DAY") {
            return record.dayKey !== bangkokDayKey();
        }

        if (campaign.frequencyPolicy === "ONCE_EVERY_3_DAYS") {
            return !record.lastShownAt || Date.now() - Number(record.lastShownAt || 0) >= 72 * 60 * 60 * 1000;
        }

        return true;
    }

    function markGuestShown(campaign = {}) {
        const code = campaignDismissalKey(campaign);
        if (!code) return;

        if (campaign.frequencyPolicy === "ONCE_PER_SESSION") {
            const seen = readSessionSeen();
            seen[code] = Date.now();
            writeSessionSeen(seen);
            return;
        }

        const state = readLocalState();
        state[code] = {
            lastShownAt: Date.now(),
            dayKey: bangkokDayKey(),
            frequencyPolicy: campaign.frequencyPolicy
        };
        writeLocalState(state);
    }

    function campaignDismissalKey(campaign = {}) {
        const code = String(campaign.campaignCode || "").trim();
        const version = String(campaign.campaignVersion || "v1").trim();
        const placement = String(campaign.placement || "ENTRY_POPUP").trim();
        return code ? `${placement}:${code}:${version}` : "";
    }

    function ensureStyles() {
        if (document.getElementById("azielCampaignPopupStyles")) return;

        const link = document.createElement("link");
        link.id = "azielCampaignPopupStyles";
        link.rel = "stylesheet";
        link.href = "/css/campaign/campaign-popup.css?v=20260715-visual";
        document.head.appendChild(link);
    }

    function renderPopup(campaign = {}) {
        if (!campaign.title || !campaign.body) return false;
        ensureStyles();
        closePopup();

        const overlay = document.createElement("div");
        overlay.id = "azielCampaignPopup";
        overlay.className = "campaign-popup-overlay";

        const dialog = document.createElement("div");
        const imageUrl = normalizeImageUrl(campaign.imageUrl);
        dialog.className = `campaign-popup-dialog ${imageUrl ? "has-image" : "no-image"}`;
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "azielCampaignTitle");
        if (imageUrl) {
            dialog.style.setProperty("--campaign-image-url", toCssImageUrl(imageUrl));
        }

        const atmosphere = document.createElement("div");
        atmosphere.className = "campaign-popup-atmosphere";
        atmosphere.setAttribute("aria-hidden", "true");

        const shade = document.createElement("div");
        shade.className = "campaign-popup-shade";
        shade.setAttribute("aria-hidden", "true");

        const close = document.createElement("button");
        close.className = "campaign-popup-close";
        close.type = "button";
        close.setAttribute("aria-label", t("campaign.closePopup", "Close campaign popup"));
        close.textContent = "×";

        const visual = document.createElement("div");
        visual.className = "campaign-popup-visual";
        visual.setAttribute("aria-hidden", imageUrl ? "false" : "true");

        if (imageUrl) {
            const image = document.createElement("img");
            image.className = "campaign-popup-image";
            image.src = imageUrl;
            image.alt = campaign.imageAltText || campaign.title;
            image.addEventListener("error", () => {
                image.remove();
                visual.remove();
                dialog.classList.remove("has-image");
                dialog.classList.add("no-image");
                dialog.style.removeProperty("--campaign-image-url");
            });
            visual.appendChild(image);
        }

        const content = document.createElement("div");
        content.className = "campaign-popup-content";

        const type = document.createElement("span");
        type.className = "campaign-popup-type";
        type.textContent = `${typeIcon(campaign.type)} ${String(campaign.type || "ANNOUNCEMENT").replace(/_/g, " ")}`;

        const title = document.createElement("h2");
        title.id = "azielCampaignTitle";
        title.textContent = campaign.title;

        const body = document.createElement("p");
        body.textContent = campaign.body;

        content.append(type, title, body);

        if (campaign.ctaLabel && campaign.ctaTarget && !isUnsafeTarget(campaign.ctaTarget)) {
            const cta = document.createElement("a");
            cta.className = "campaign-popup-cta";
            cta.href = campaign.ctaTarget;
            cta.textContent = campaign.ctaLabel;
            cta.setAttribute("aria-label", campaign.ctaLabel);
            content.appendChild(cta);
        }

        dialog.append(atmosphere, shade, close);
        if (imageUrl) dialog.appendChild(visual);
        dialog.appendChild(content);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        function onKey(event) {
            if (event.key === "Escape") closePopup();
            if (event.key === "Tab") trapFocus(event, dialog);
        }

        overlay.addEventListener("click", event => {
            if (event.target === overlay) closePopup();
        });
        close.addEventListener("click", closePopup);
        document.addEventListener("keydown", onKey);
        overlay.dataset.keyHandler = "active";
        overlay._azielKeyHandler = onKey;

        lastFocused = document.activeElement;
        document.body.classList.add("az-campaign-lock");
        requestAnimationFrame(() => {
            overlay.classList.add("show");
            close.focus();
        });
        return true;
    }

    function renderPlacement(campaign = {}) {
        const localized = localizeCampaign(campaign);
        let rendered = false;
        if (localized.placement === "ENTRY_POPUP") rendered = renderPopup(localized);
        if (localized.placement === "TOP_NOTICE") rendered = renderNotice(localized, "top");
        if (localized.placement === "PRODUCT_NOTICE") rendered = renderNotice(localized, "product");
        if (rendered && campaign.placement) renderedCampaigns.set(campaign.placement, campaign);
        return rendered;
    }

    function renderNotice(campaign = {}, kind) {
        if (!campaign.title || !campaign.body) return false;
        ensureStyles();
        const placement = kind === "product" ? "PRODUCT_NOTICE" : "TOP_NOTICE";
        closePlacement(placement);
        const notice = document.createElement("section");
        notice.id = kind === "product" ? "azielProductCampaignNotice" : "azielTopCampaignNotice";
        notice.className = `campaign-notice campaign-${kind}-notice`;
        notice.setAttribute("aria-label", t("campaign.noticeLabel", "Campaign notice"));

        const imageUrl = normalizeImageUrl(campaign.imageUrl);
        if (imageUrl) {
            const image = document.createElement("img");
            image.src = imageUrl;
            image.alt = campaign.imageAltText || "";
            image.addEventListener("error", () => image.remove(), { once: true });
            notice.appendChild(image);
        }
        const content = document.createElement("div");
        const label = document.createElement("small");
        label.textContent = String(campaign.type || "ANNOUNCEMENT").replaceAll("_", " ");
        const title = document.createElement("h2");
        title.textContent = campaign.title;
        const body = document.createElement("p");
        body.textContent = campaign.body;
        content.append(label, title, body);
        notice.appendChild(content);
        if (campaign.ctaLabel && campaign.ctaTarget && !isUnsafeTarget(campaign.ctaTarget)) {
            const cta = document.createElement("a");
            cta.href = campaign.ctaTarget;
            cta.textContent = campaign.ctaLabel;
            cta.className = "campaign-notice-cta";
            notice.appendChild(cta);
        }
        const close = document.createElement("button");
        close.type = "button";
        close.className = "campaign-notice-close";
        close.setAttribute("aria-label", kind === "product" ? t("campaign.dismissProduct", "Dismiss product campaign notice") : t("campaign.dismissTop", "Dismiss top campaign notice"));
        close.textContent = "×";
        close.addEventListener("click", () => notice.remove());
        notice.appendChild(close);

        const anchor = kind === "product" ? productNoticeAnchor() : document.querySelector("main");
        if (!anchor) return false;
        if (kind === "product") anchor.insertAdjacentElement("afterend", notice);
        else anchor.insertAdjacentElement("beforebegin", notice);
        return true;
    }

    function currentProductCode() {
        return String(document.getElementById("packages")?.dataset.game || new URLSearchParams(location.search).get("product") || "").trim().toLowerCase();
    }

    function productNoticeAnchor() {
        return document.querySelector(".product-identity") || document.querySelector(".game-banner") || null;
    }

    function closePlacement(placement) {
        renderedCampaigns.delete(placement);
        if (placement === "ENTRY_POPUP") return closePopup();
        document.getElementById(placement === "PRODUCT_NOTICE" ? "azielProductCampaignNotice" : "azielTopCampaignNotice")?.remove();
    }

    function refreshPlacements() {
        claimPlacement("ENTRY_POPUP");
        claimPlacement("TOP_NOTICE");
        const productCode = currentProductCode();
        if (productCode) claimPlacement("PRODUCT_NOTICE", productCode);
        else closePlacement("PRODUCT_NOTICE");
    }

    function trapFocus(event, dialog) {
        const focusable = [...dialog.querySelectorAll("a[href],button,input,textarea,select,[tabindex]:not([tabindex='-1'])")]
            .filter(item => !item.disabled);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function closePopup() {
        const overlay = document.getElementById("azielCampaignPopup");
        if (!overlay) return;
        if (overlay._azielKeyHandler) {
            document.removeEventListener("keydown", overlay._azielKeyHandler);
        }
        overlay.remove();
        document.body.classList.remove("az-campaign-lock");
        if (lastFocused && typeof lastFocused.focus === "function") {
            lastFocused.focus();
        }
    }

    function isUnsafeTarget(target = "") {
        return /^\s*(javascript|data|vbscript):/i.test(String(target || ""));
    }

    function normalizeImageUrl(value = "") {
        const url = String(value || "").trim();
        if (!url) return "";
        if (url.startsWith("/") || /^https?:\/\//i.test(url)) return url;
        return "";
    }

    function toCssImageUrl(value = "") {
        return `url("${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
    }

    function typeIcon(type = "") {
        if (type === "PROMOTION") return "*";
        if (type === "NEW_GAME") return "+";
        if (type === "IMPORTANT_UPDATE") return "!";
        return "-";
    }

    function init() {
        if (initialized || isAdminPage()) return;
        initialized = true;
        refreshPlacements();
        window.addEventListener("aziel:shopRegionChanged", refreshPlacements);
        window.addEventListener("aziel:productChanged", refreshPlacements);
        window.addEventListener("aziel:locale-changed", () => {
            [...renderedCampaigns.values()].forEach(campaign => renderPlacement(campaign));
        });
    }

    window.AZIEL_CAMPAIGNS = {
        refresh: refreshPlacements,
        close: closePopup,
        closePlacement
    };

    ready(init);
})();
