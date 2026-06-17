document.addEventListener("DOMContentLoaded", () => {
    const openBtn = document.getElementById("localeOpenBtn");
    const closeBtn = document.getElementById("localeCloseBtn");
    const modal = document.getElementById("localeModal");

    const regionSelect = document.getElementById("regionSelect");
    const languageSelect = document.getElementById("languageSelect");
    const currencySelect = document.getElementById("currencySelect");
    const saveBtn = document.getElementById("saveLocaleBtn");
    const localeFlag = document.getElementById("localeFlag");

    const region = localStorage.getItem("region") || "TH";
    const lang = localStorage.getItem("azielLang") || "en";
    const currency = localStorage.getItem("currency") || (region === "TH" ? "THB" : "MMK");

    regionSelect.value = region;
    languageSelect.value = lang;
    currencySelect.value = currency;
    updateFlag(region);

    openBtn?.addEventListener("click", () => {
        modal.classList.add("show");
    });

    closeBtn?.addEventListener("click", () => {
        modal.classList.remove("show");
    });

    modal?.addEventListener("click", e => {
        if (e.target === modal) modal.classList.remove("show");
    });

    regionSelect?.addEventListener("change", () => {
        const r = regionSelect.value;
        currencySelect.value = r === "TH" ? "THB" : "MMK";
        updateFlag(r);
    });

    saveBtn?.addEventListener("click", () => {
        localStorage.setItem("region", regionSelect.value);
        localStorage.setItem("selectedRegion", regionSelect.value);
        localStorage.setItem("azielLang", languageSelect.value);
        localStorage.setItem("currency", currencySelect.value);
        localStorage.setItem("selectedCurrency", currencySelect.value);

        modal.classList.remove("show");
        location.reload();
    });

    function updateFlag(region) {
        localeFlag.innerText = region === "MM" ? "🇲🇲" : "🇹🇭";
    }
});