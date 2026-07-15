// frontend/js/campaign-runtime.js
// Shared AZIEL customer ENTRY_POPUP Campaign runtime.

(function () {
    const CLAIM_URL = "/api/campaigns/entry-popup/claim";
    const SESSION_KEY = "aziel_campaign_session_key_v1";
    const SESSION_SEEN_KEY = "aziel_campaign_session_seen_v1";
    const LOCAL_STATE_KEY = "aziel_campaign_frequency_v1";
    const MAX_LOCAL_RECORDS = 80;
    const BANGKOK_TIMEZONE = "Asia/Bangkok";

    let initialized = false;
    let lastFocused = null;

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

    async function claimEntryPopup() {
        if (isAdminPage()) return;
        const token = getToken();
        const headers = {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        try {
            const response = await fetch(apiUrl(CLAIM_URL), {
                method: "POST",
                headers,
                body: JSON.stringify({
                    region: getRegion() === "TH" ? "TH" : "MM",
                    sessionKey: getSessionKey()
                })
            });
            const data = await response.json();
            if (!response.ok || !data?.success) return;

            const campaign = data.authenticated
                ? data.campaign
                : selectGuestCampaign(Array.isArray(data.campaigns) ? data.campaigns : []);

            if (!campaign) return;

            if (!data.authenticated) {
                markGuestShown(campaign);
            }

            renderPopup(campaign);
        } catch (error) {
            // Campaign delivery is non-critical. Never block catalog, payments, wallet, or orders.
        }
    }

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
        const code = campaign.campaignCode;
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
        const code = campaign.campaignCode;
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

    function ensureStyles() {
        if (document.getElementById("azielCampaignPopupStyles")) return;

        const link = document.createElement("link");
        link.id = "azielCampaignPopupStyles";
        link.rel = "stylesheet";
        link.href = "/css/campaign/campaign-popup.css?v=20260715-visual";
        document.head.appendChild(link);
    }

    function renderPopup(campaign = {}) {
        if (!campaign.title || !campaign.body) return;
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
        close.setAttribute("aria-label", "Close campaign popup");
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
        claimEntryPopup();
    }

    window.AZIEL_CAMPAIGNS = {
        refresh: claimEntryPopup,
        close: closePopup
    };

    ready(init);
})();
