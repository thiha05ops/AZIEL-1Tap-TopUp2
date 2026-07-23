document.addEventListener("DOMContentLoaded", () => {
    const regionSelect = document.getElementById("regionSelect");
    const languageSelect = document.getElementById("languageSelect");
    const currencySelect = document.getElementById("currencySelect");

    const savedRegion = localStorage.getItem("region") || "TH";
    const savedLang = window.AZIEL_I18N?.getLang?.() || localStorage.getItem("azielLanguage") || "en";
    const savedCurrency =
        localStorage.getItem("currency") ||
        (savedRegion === "TH" ? "THB" : "MMK");

    if (regionSelect) regionSelect.value = savedRegion;
    if (languageSelect) languageSelect.value = savedLang;
    if (currencySelect) currencySelect.value = savedCurrency;

    regionSelect?.addEventListener("change", () => {
        const region = regionSelect.value;

        localStorage.setItem("region", region);
        localStorage.setItem("selectedRegion", region);

        const defaultCurrency = region === "TH" ? "THB" : "MMK";

        localStorage.setItem("currency", defaultCurrency);
        localStorage.setItem("selectedCurrency", defaultCurrency);

        if (currencySelect) {
            currencySelect.value = defaultCurrency;
        }

        location.reload();
    });

    currencySelect?.addEventListener("change", () => {
        const currency = currencySelect.value;

        localStorage.setItem("currency", currency);
        localStorage.setItem("selectedCurrency", currency);

        location.reload();
    });

    languageSelect?.addEventListener("change", () => {
        const lang = languageSelect.value;

        if (window.AZIEL_I18N?.setLang) {
            window.AZIEL_I18N.setLang(lang);
        } else {
            localStorage.setItem("azielLanguage", lang);
        }
        changeGoogleTranslate(lang);
    });

    function changeGoogleTranslate(lang) {
        const select = document.querySelector(".goog-te-combo");

        if (!select) {
            console.log("Google Translate not ready");
            return;
        }

        select.value = lang;
        select.dispatchEvent(new Event("change"));
    }
});
