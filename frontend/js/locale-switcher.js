// frontend/js/locale-switcher.js - AZIEL V2.5 Shop Region Switcher

document.addEventListener("DOMContentLoaded", () => {
    initLocaleSwitcher();
});

function initLocaleSwitcher() {
    const openBtn = document.getElementById("localeOpenBtn");
    const closeBtn = document.getElementById("localeCloseBtn");
    const modal = document.getElementById("localeModal");

    const regionSelect = document.getElementById("regionSelect");
    const languageSelect = document.getElementById("languageSelect");
    const currencySelect = document.getElementById("currencySelect");
    const saveBtn = document.getElementById("saveLocaleBtn");
    const localeFlag = document.getElementById("localeFlag");

    const activeRegion = window.AZIEL?.getShopRegion?.() || "MM";
    const activeCurrency = window.AZIEL?.getShopCurrency?.() || "MMK";
    const activeLang = localStorage.getItem("azielLang") || "en";

    renderLocaleUI(activeRegion, activeCurrency, activeLang);

    openBtn?.addEventListener("click", () => {
        modal?.classList.add("show");
    });

    closeBtn?.addEventListener("click", () => {
        modal?.classList.remove("show");
    });

    modal?.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("show");
        }
    });

    regionSelect?.addEventListener("change", () => {
        const region = normalizeRegion(regionSelect.value);
        const currency = getCurrencyByRegion(region);

        if (currencySelect) {
            currencySelect.value = currency;
        }

        updateFlag(localeFlag, region);
    });

    saveBtn?.addEventListener("click", () => {
        const region = normalizeRegion(regionSelect?.value || "MM");
        const currency = getCurrencyByRegion(region);
        const lang = languageSelect?.value || "en";

        localStorage.setItem("azielLang", lang);

        window.AZIEL?.setShopRegion?.(region, { reload: true });

        localStorage.setItem("shopCurrency", currency);
        localStorage.setItem("currency", currency);
        localStorage.setItem("selectedCurrency", currency);

        modal?.classList.remove("show");
    });

    window.addEventListener("aziel:shopRegionChanged", (e) => {
        const region = e.detail?.region || window.AZIEL?.getShopRegion?.() || "MM";
        const currency = e.detail?.currency || getCurrencyByRegion(region);
        const lang = localStorage.getItem("azielLang") || "en";

        renderLocaleUI(region, currency, lang);
    });

    function renderLocaleUI(region, currency, lang) {
        if (regionSelect) regionSelect.value = region;
        if (currencySelect) currencySelect.value = currency;
        if (languageSelect) languageSelect.value = lang;

        updateFlag(localeFlag, region);
    }

    function updateFlag(flagEl, region) {
        if (flagEl) {
            flagEl.innerText = region === "TH" ? "🇹🇭" : "🇲🇲";
        }
    }

    function normalizeRegion(region) {
        return region === "TH" ? "TH" : "MM";
    }

    function getCurrencyByRegion(region) {
        return region === "TH" ? "THB" : "MMK";
    }
}