// frontend/js/locale-switcher.js - AZIEL V2.5 Shop Region Switcher

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

    const activeRegion = window.AZIEL?.getShopRegion?.() || localStorage.getItem("shopRegion") || localStorage.getItem("region") || "MM";
    const activeCurrency = getCurrencyByRegion(activeRegion);
    const activeLang = localStorage.getItem("azielLang") || "en";

    renderLocaleUI(activeRegion, activeCurrency, activeLang);

    openBtn.addEventListener("click", () => {
        modal.classList.add("show");
    });

    closeBtn?.addEventListener("click", () => {
        modal.classList.remove("show");
    });

    modal.addEventListener("click", (e) => {
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

    saveBtn?.addEventListener("click", () => {
        const region = normalizeRegion(regionSelect?.value || "MM");
        const currency = getCurrencyByRegion(region);
        const lang = languageSelect?.value || "en";

        localStorage.setItem("azielLang", lang);
        localStorage.setItem("shopRegion", region);
        localStorage.setItem("region", region);
        localStorage.setItem("selectedRegion", region);
        localStorage.setItem("shopCurrency", currency);
        localStorage.setItem("currency", currency);
        localStorage.setItem("selectedCurrency", currency);

        if (window.AZIEL?.setShopRegion) {
            window.AZIEL.setShopRegion(region, { reload: true });
            return;
        }

        location.reload();
    });

    window.addEventListener("aziel:shopRegionChanged", (e) => {
        const region = e.detail?.region || window.AZIEL?.getShopRegion?.() || "MM";
        const currency = e.detail?.currency || getCurrencyByRegion(region);
        const lang = localStorage.getItem("azielLang") || "en";

        renderLocaleUI(region, currency, lang);
    });

    function renderLocaleUI(region, currency, lang) {
        const finalRegion = normalizeRegion(region);

        if (regionSelect) regionSelect.value = finalRegion;
        if (currencySelect) currencySelect.value = currency;
        if (languageSelect) languageSelect.value = lang;

        updateFlag(localeFlag, finalRegion);
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
        return normalizeRegion(region) === "TH" ? "THB" : "MMK";
    }
}