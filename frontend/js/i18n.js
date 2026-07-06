// frontend/js/i18n.js
// AZIEL i18n Engine V1

(function () {
    const LANG_KEY = "azielLanguage";

    function getLang() {
        return (
            localStorage.getItem(LANG_KEY) ||
            localStorage.getItem("language") ||
            "en"
        );
    }

    function getDict() {
        const lang = getLang();

        return (
            window.AZIEL_LANG?.[lang] ||
            window.AZIEL_LANG?.en ||
            {}
        );
    }

    function t(key, fallback = "") {
        const dict = getDict();
        return dict[key] || fallback || key;
    }

    function setLang(lang) {
        if (!window.AZIEL_LANG?.[lang]) return;

        localStorage.setItem(LANG_KEY, lang);
        localStorage.setItem("language", lang);

        translatePage();

        window.dispatchEvent(
            new CustomEvent("aziel:languageChanged", {
                detail: { language: lang }
            })
        );
    }

    function translatePage(root = document) {
        const dict = getDict();

        root.querySelectorAll("[data-i18n]").forEach(el => {
            const key = el.dataset.i18n;
            if (dict[key]) el.textContent = dict[key];
        });

        root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if (dict[key]) el.placeholder = dict[key];
        });

        root.querySelectorAll("[data-i18n-title]").forEach(el => {
            const key = el.dataset.i18nTitle;
            if (dict[key]) el.title = dict[key];
        });
    }

    window.AZIEL_I18N = {
        t,
        getLang,
        setLang,
        translatePage
    };

    document.addEventListener("DOMContentLoaded", () => {
        translatePage();
    });

    window.addEventListener("aziel:headerLoaded", () => {
        translatePage();
    });

    window.addEventListener("aziel:languageChanged", () => {
        translatePage();
    });
})();