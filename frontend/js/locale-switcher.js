// frontend/js/locale-switcher.js
// AZIEL public storefront Region + Language + Currency preference controller.

(function () {
    const REGIONS = Object.freeze({
        MM: { code: "MM", name: "Myanmar", flag: "🇲🇲", currency: "MMK", compact: "MM", symbol: "Ks" },
        TH: { code: "TH", name: "Thailand", flag: "🇹🇭", currency: "THB", compact: "TH", symbol: "฿" }
    });
    const LANGUAGES = Object.freeze({
        my: { code: "my", name: "မြန်မာ", compact: "MY" },
        en: { code: "en", name: "English", compact: "EN" },
        th: { code: "th", name: "ไทย", compact: "TH" }
    });
    const CURRENCIES = Object.freeze({
        MMK: { code: "MMK", name: "Myanmar Kyat", symbol: "Ks", region: "MM" },
        THB: { code: "THB", name: "Thai Baht", symbol: "฿", region: "TH" }
    });

    let panel = null;
    let activeTrigger = null;
    let pending = null;
    let isReady = false;

    document.addEventListener("DOMContentLoaded", initStorefrontPreferences);
    window.addEventListener("aziel:headerLoaded", initStorefrontPreferences);
    window.addEventListener("aziel:shopRegionChanged", syncPreferenceControls);
    window.addEventListener("aziel:languageChanged", e => {
        if (e.detail?.lang) pending = null;
        syncPreferenceControls();
    });
    window.addEventListener("aziel:locale-changed", syncPreferenceControls);

    function initStorefrontPreferences() {
        const desktopBtn = document.getElementById("storefrontPreferenceBtn");
        const mobileBtn = document.getElementById("mobilePreferenceBtn");

        if (!desktopBtn && !mobileBtn) return;

        ensurePreferencePanel();
        [desktopBtn, mobileBtn].filter(Boolean).forEach(bindTrigger);
        syncPreferenceControls();

        if (isReady) return;
        isReady = true;

        document.addEventListener("click", event => {
            if (!panel?.classList.contains("show")) return;
            if (panel.contains(event.target) || event.target.closest("#storefrontPreferenceBtn, #mobilePreferenceBtn")) return;
            closePreferencePanel();
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && panel?.classList.contains("show")) {
                event.preventDefault();
                closePreferencePanel({ restoreFocus: true });
            }
        });
    }

    function bindTrigger(trigger) {
        if (trigger.dataset.preferenceReady === "true") return;
        trigger.dataset.preferenceReady = "true";
        trigger.addEventListener("click", event => {
            event.stopPropagation();
            togglePreferencePanel(trigger);
        });
    }

    function ensurePreferencePanel() {
        panel = document.getElementById("azPreferencePanel");
        if (panel) return panel;

        panel = document.createElement("section");
        panel.id = "azPreferencePanel";
        panel.className = "az-preference-panel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "false");
        panel.setAttribute("aria-labelledby", "azPreferenceTitle");
        panel.innerHTML = panelMarkup();
        document.body.appendChild(panel);

        panel.addEventListener("click", event => {
            event.stopPropagation();
            const option = event.target.closest("[data-preference-option]");
            if (option) {
                updatePending(option.dataset.preferenceGroup, option.dataset.preferenceValue);
                return;
            }
            if (event.target.closest("[data-preference-close]")) {
                closePreferencePanel({ restoreFocus: true });
                return;
            }
            if (event.target.closest("[data-preference-save]")) {
                savePreferences();
            }
        });

        return panel;
    }

    function panelMarkup() {
        return `
            <div class="az-preference-sheet">
                <div class="az-preference-head">
                    <div>
                        <h2 id="azPreferenceTitle" data-i18n="preferences.title">Region & Preferences</h2>
                        <p data-i18n="preferences.description">Choose your storefront market, language, and currency.</p>
                    </div>
                    <button class="az-preference-close" type="button" aria-label="Close preferences" data-i18n-aria-label="common.close" data-preference-close>×</button>
                </div>

                <div class="az-preference-group" aria-labelledby="azPreferenceRegionLabel">
                    <h3 id="azPreferenceRegionLabel" data-i18n="preferences.region">Region</h3>
                    <div class="az-preference-options">
                        <button type="button" data-preference-option data-preference-group="region" data-preference-value="MM"><span>🇲🇲</span><strong>Myanmar</strong></button>
                        <button type="button" data-preference-option data-preference-group="region" data-preference-value="TH"><span>🇹🇭</span><strong>Thailand</strong></button>
                    </div>
                </div>

                <div class="az-preference-group" aria-labelledby="azPreferenceLanguageLabel">
                    <h3 id="azPreferenceLanguageLabel" data-i18n="preferences.language">Language</h3>
                    <div class="az-preference-options az-preference-options--three">
                        <button type="button" data-preference-option data-preference-group="language" data-preference-value="my"><strong>မြန်မာ</strong></button>
                        <button type="button" data-preference-option data-preference-group="language" data-preference-value="en"><strong>English</strong></button>
                        <button type="button" data-preference-option data-preference-group="language" data-preference-value="th"><strong>ไทย</strong></button>
                    </div>
                </div>

                <div class="az-preference-group" aria-labelledby="azPreferenceCurrencyLabel">
                    <h3 id="azPreferenceCurrencyLabel" data-i18n="preferences.currency">Currency</h3>
                    <div class="az-preference-options">
                        <button type="button" data-preference-option data-preference-group="currency" data-preference-value="MMK" aria-disabled="true"><strong>Myanmar Kyat</strong><small>Ks</small></button>
                        <button type="button" data-preference-option data-preference-group="currency" data-preference-value="THB" aria-disabled="true"><strong>Thai Baht</strong><small>฿</small></button>
                    </div>
                    <p class="az-preference-note" data-i18n="preferences.currencyFollowsRegion">Currency follows the selected commerce region.</p>
                </div>

                <button class="az-preference-save" type="button" data-i18n="preferences.save" data-preference-save>Save Preferences</button>
            </div>
        `;
    }

    function togglePreferencePanel(trigger) {
        if (panel?.classList.contains("show") && activeTrigger === trigger) {
            closePreferencePanel({ restoreFocus: true });
            return;
        }
        openPreferencePanel(trigger);
    }

    function openPreferencePanel(trigger) {
        ensurePreferencePanel();
        activeTrigger = trigger;
        pending = readPreferences();
        renderPending();
        panel.classList.add("show");
        panel.dataset.open = "true";
        document.body.classList.add("az-preferences-open");
        setTriggerExpanded(true);
        closeOtherHeaderSurfaces(trigger);
        requestAnimationFrame(() => panel.querySelector("[data-preference-option]")?.focus({ preventScroll: true }));
    }

    function closePreferencePanel({ restoreFocus = false } = {}) {
        if (!panel) return;
        panel.classList.remove("show");
        panel.dataset.open = "false";
        document.body.classList.remove("az-preferences-open");
        setTriggerExpanded(false);
        if (restoreFocus) activeTrigger?.focus({ preventScroll: true });
        activeTrigger = null;
    }

    function setTriggerExpanded(expanded) {
        document.getElementById("storefrontPreferenceBtn")?.setAttribute("aria-expanded", String(expanded));
        document.getElementById("mobilePreferenceBtn")?.setAttribute("aria-expanded", String(expanded));
    }

    function closeOtherHeaderSurfaces(trigger) {
        const header = trigger?.closest(".az-header");
        header?.querySelectorAll(".az-nav-dropdown.show").forEach(dropdown => {
            dropdown.classList.remove("show");
            dropdown.querySelector(".az-nav-drop-btn")?.setAttribute("aria-expanded", "false");
        });
        header?.querySelector(".az-profile-dropdown.show")?.classList.remove("show");
        header?.querySelector(".az-profile-btn")?.setAttribute("aria-expanded", "false");
    }

    function updatePending(group, value) {
        if (!pending) pending = readPreferences();
        if (group === "region") {
            pending.region = normalizeRegion(value);
            pending.currency = currencyByRegion(pending.region);
        }
        if (group === "language") {
            pending.language = normalizeLang(value);
        }
        if (group === "currency") {
            pending.currency = currencyByRegion(pending.region);
        }
        renderPending();
    }

    async function savePreferences() {
        if (!pending) pending = readPreferences();
        const nextRegion = normalizeRegion(pending.region);
        const nextCurrency = currencyByRegion(nextRegion);
        const nextLang = normalizeLang(pending.language);

        if (window.AZIEL_I18N?.setLang) {
            await window.AZIEL_I18N.setLang(nextLang);
        } else {
            persistLanguage(nextLang);
        }

        if (window.AZIEL?.setShopRegion) {
            window.AZIEL.setShopRegion(nextRegion, { reload: false });
        } else {
            persistRegion(nextRegion, nextCurrency);
            window.dispatchEvent(new CustomEvent("aziel:shopRegionChanged", {
                detail: { region: nextRegion, currency: nextCurrency }
            }));
        }

        if (window.AZIEL?.loadWallet) {
            await window.AZIEL.loadWallet();
        }

        syncPreferenceControls();
        closePreferencePanel();
        window.dispatchEvent(new CustomEvent("aziel:storefrontPreferencesSaved", {
            detail: { region: nextRegion, language: nextLang, currency: nextCurrency }
        }));
    }

    function renderPending() {
        if (!panel || !pending) return;
        const currency = currencyByRegion(pending.region);

        panel.querySelectorAll("[data-preference-option]").forEach(button => {
            const group = button.dataset.preferenceGroup;
            const value = button.dataset.preferenceValue;
            const selected = (
                (group === "region" && value === pending.region) ||
                (group === "language" && value === pending.language) ||
                (group === "currency" && value === currency)
            );
            button.classList.toggle("is-selected", selected);
            button.setAttribute("aria-pressed", String(selected));
            if (group === "currency") {
                const locked = value !== currency;
                button.classList.toggle("is-locked", locked);
                button.setAttribute("aria-disabled", String(locked));
            }
        });
    }

    function syncPreferenceControls() {
        const preference = readPreferences();
        const region = REGIONS[preference.region];
        const lang = LANGUAGES[preference.language];
        const currency = CURRENCIES[preference.currency];
        const compact = `${region.flag} ${region.compact} · ${lang.compact} · ${region.symbol}`;
        const long = `${region.flag} ${region.name} · ${lang.name} · ${currency.code}`;

        document.querySelectorAll("[data-preference-flag]").forEach(el => {
            el.textContent = region.flag;
        });
        document.querySelectorAll("[data-preference-summary]").forEach(el => {
            el.textContent = `${region.compact} · ${lang.compact} · ${region.symbol}`;
        });
        document.querySelectorAll("[data-mobile-preference-summary]").forEach(el => {
            el.textContent = long;
        });
        const preferenceLabel = window.AZIEL_LOCALE?.t?.("preferences.title", "Region & Preferences") || "Region & Preferences";
        document.getElementById("storefrontPreferenceBtn")?.setAttribute("aria-label", `${preferenceLabel}: ${compact}`);
        document.getElementById("mobilePreferenceBtn")?.setAttribute("aria-label", `${preferenceLabel}: ${long}`);

        if (panel?.classList.contains("show")) {
            pending = pending || preference;
            renderPending();
        }
    }

    function readPreferences() {
        const region = normalizeRegion(
            window.AZIEL?.getShopRegion?.() ||
            localStorage.getItem("shopRegion") ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM"
        );
        const language = normalizeLang(
            window.AZIEL_I18N?.getLang?.() ||
            localStorage.getItem("azielLanguage") ||
            "en"
        );
        const currency = currencyByRegion(region);
        persistRegion(region, currency);
        persistLanguage(language);
        return { region, language, currency };
    }

    function persistRegion(region, currency) {
        try {
            localStorage.setItem("shopRegion", region);
            localStorage.setItem("selectedRegion", region);
            localStorage.setItem("region", region);
            localStorage.setItem("shopCurrency", currency);
            localStorage.setItem("selectedCurrency", currency);
            localStorage.setItem("currency", currency);
        } catch {
            // Preferences should enhance navigation, not block rendering.
        }
    }

    function persistLanguage(lang) {
        try {
            localStorage.setItem("azielLanguage", normalizeLang(lang));
            localStorage.removeItem("azielLang");
            localStorage.removeItem("selectedLanguage");
            localStorage.removeItem("language");
        } catch {
            // Ignore private browsing storage errors.
        }
    }

    function normalizeRegion(region) {
        return String(region || "").toUpperCase() === "TH" ? "TH" : "MM";
    }

    function normalizeLang(lang) {
        const value = String(lang || "en").toLowerCase();
        return Object.prototype.hasOwnProperty.call(LANGUAGES, value) ? value : "en";
    }

    function currencyByRegion(region) {
        return normalizeRegion(region) === "TH" ? "THB" : "MMK";
    }

    window.AZIEL_STOREFRONT_PREFERENCES = Object.freeze({
        get: readPreferences,
        open: openPreferencePanel,
        close: closePreferencePanel,
        currencyByRegion,
        supportedRegions: Object.keys(REGIONS),
        supportedLanguages: Object.keys(LANGUAGES),
        supportedCurrencies: Object.keys(CURRENCIES)
    });
})();
