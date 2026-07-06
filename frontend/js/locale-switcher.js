// frontend/js/locale-switcher.js
// AZIEL V2.5 Region + Language + Currency Switcher

document.addEventListener("DOMContentLoaded", initLocaleSwitcher);
window.addEventListener("aziel:headerLoaded", initLocaleSwitcher);

function initLocaleSwitcher() {
    const openBtn = document.getElementById("localeOpenBtn");
    const closeBtn = document.getElementById("localeCloseBtn");
    const modal = document.getElementById("localeModal");

    if (!openBtn || !modal) return;
    if (openBtn.dataset.localeReady === "true") return;

    openBtn.dataset.localeReady = "true";

    const regionSelect = document.getElementById("regionSelect");
    const languageSelect = document.getElementById("languageSelect");
    const currencySelect = document.getElementById("currencySelect");
    const saveBtn = document.getElementById("saveLocaleBtn");
    const localeFlag = document.getElementById("localeFlag");

    const activeRegion =
        window.AZIEL?.getShopRegion?.() ||
        localStorage.getItem("shopRegion") ||
        localStorage.getItem("region") ||
        "MM";

    const activeCurrency =
        localStorage.getItem("shopCurrency") ||
        localStorage.getItem("currency") ||
        getCurrencyByRegion(activeRegion);

    const activeLang =
        window.AZIEL_I18N?.getLang?.() ||
        localStorage.getItem("azielLanguage") ||
        localStorage.getItem("language") ||
        localStorage.getItem("azielLang") ||
        "en";

    renderLocaleUI(activeRegion, activeCurrency, activeLang);

    openBtn.addEventListener("click", () => {
        modal.classList.add("show");
    });

    closeBtn?.addEventListener("click", () => {
        modal.classList.remove("show");
    });

    modal.addEventListener("click", e => {
        if (e.target === modal) {
            modal.classList.remove("show");
        }
    });

    regionSelect?.addEventListener("change", () => {
        const region = normalizeRegion(regionSelect.value);
        const currency = getCurrencyByRegion(region);

        if (currencySelect) currencySelect.value = currency;
        updateFlag(localeFlag, region);
    });

    languageSelect?.addEventListener("change", () => {
        const lang = normalizeLang(languageSelect.value);

        if (window.AZIEL_I18N?.setLang) {
            window.AZIEL_I18N.setLang(lang);
        } else {
            localStorage.setItem("azielLanguage", lang);
            localStorage.setItem("language", lang);
            localStorage.setItem("azielLang", lang);
        }
    });

    saveBtn?.addEventListener("click", async () => {
        const region = normalizeRegion(regionSelect?.value || "MM");
        const currency = currencySelect?.value || getCurrencyByRegion(region);
        const lang = normalizeLang(languageSelect?.value || "en");

        saveLocale(region, currency, lang);
        updateFlag(localeFlag, region);

        if (window.AZIEL_I18N?.setLang) {
            window.AZIEL_I18N.setLang(lang);
        }

        modal.classList.remove("show");

        window.dispatchEvent(
            new CustomEvent("aziel:shopRegionChanged", {
                detail: { region, currency }
            })
        );

        if (window.AZIEL?.setShopRegion) {
            window.AZIEL.setShopRegion(region, { reload: false });
        }

        if (window.AZIEL?.loadWallet) {
            await window.AZIEL.loadWallet();
        }

        if (window.renderHeader) {
            window.renderHeader();
        }

        if (window.AZIEL_I18N?.translatePage) {
            window.AZIEL_I18N.translatePage(document);
        }
    });

    window.addEventListener("aziel:shopRegionChanged", e => {
        const region =
            e.detail?.region ||
            window.AZIEL?.getShopRegion?.() ||
            localStorage.getItem("shopRegion") ||
            "MM";

        const currency =
            e.detail?.currency ||
            localStorage.getItem("shopCurrency") ||
            getCurrencyByRegion(region);

        const lang =
            window.AZIEL_I18N?.getLang?.() ||
            localStorage.getItem("azielLanguage") ||
            "en";

        renderLocaleUI(region, currency, lang);
    });

    window.addEventListener("aziel:languageChanged", e => {
        const lang =
            e.detail?.language ||
            window.AZIEL_I18N?.getLang?.() ||
            "en";

        if (languageSelect) {
            languageSelect.value = normalizeLang(lang);
        }
    });

    function renderLocaleUI(region, currency, lang) {
        const finalRegion = normalizeRegion(region);
        const finalLang = normalizeLang(lang);
        const finalCurrency = currency || getCurrencyByRegion(finalRegion);

        if (regionSelect) regionSelect.value = finalRegion;
        if (currencySelect) currencySelect.value = finalCurrency;
        if (languageSelect) languageSelect.value = finalLang;

        updateFlag(localeFlag, finalRegion);
    }
}

function saveLocale(region, currency, lang) {
    localStorage.setItem("azielLanguage", lang);
    localStorage.setItem("language", lang);
    localStorage.setItem("azielLang", lang);

    localStorage.setItem("shopRegion", region);
    localStorage.setItem("region", region);
    localStorage.setItem("selectedRegion", region);

    localStorage.setItem("shopCurrency", currency);
    localStorage.setItem("currency", currency);
    localStorage.setItem("selectedCurrency", currency);
}

function updateFlag(flagEl, region) {
    if (!flagEl) return;
    flagEl.innerText = normalizeRegion(region) === "TH" ? "🇹🇭" : "🇲🇲";
}

function normalizeRegion(region) {
    return String(region || "").toUpperCase() === "TH" ? "TH" : "MM";
}

function normalizeLang(lang) {
    const value = String(lang || "en").toLowerCase();
    return ["en", "th", "my"].includes(value) ? value : "en";
}

function getCurrencyByRegion(region) {
    return normalizeRegion(region) === "TH" ? "THB" : "MMK";
}