(function () {
    const STORAGE_KEY = "aziel_admin_locale";
    const SUPPORTED = new Set(["en", "my"]);

    function getInitialLocale() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (SUPPORTED.has(saved)) return saved;

        const customer = localStorage.getItem("azielLanguage") || localStorage.getItem("language");
        if (SUPPORTED.has(customer)) return customer;

        return "en";
    }

    function getLocale() {
        return document.documentElement.dataset.adminLocale || getInitialLocale();
    }

    function getDictionary(locale = getLocale()) {
        return window.AZIEL_ADMIN_LANG?.[locale] || window.AZIEL_ADMIN_LANG?.en || {};
    }

    function t(key, fallback = "") {
        const dict = getDictionary();
        return dict[key] || fallback || key;
    }

    function translate(root = document) {
        const dict = getDictionary();

        root.querySelectorAll("[data-admin-i18n]").forEach(el => {
            const key = el.dataset.adminI18n;
            if (dict[key]) el.textContent = dict[key];
        });

        root.querySelectorAll("[data-admin-i18n-placeholder]").forEach(el => {
            const key = el.dataset.adminI18nPlaceholder;
            if (dict[key]) el.placeholder = dict[key];
        });

        root.querySelectorAll("[data-admin-i18n-title]").forEach(el => {
            const key = el.dataset.adminI18nTitle;
            if (dict[key]) el.title = dict[key];
        });
    }

    function setLocale(locale) {
        const next = SUPPORTED.has(locale) ? locale : "en";
        localStorage.setItem(STORAGE_KEY, next);
        document.documentElement.dataset.adminLocale = next;
        document.documentElement.lang = next;

        const selector = document.getElementById("adminLocaleSelect");
        if (selector) selector.value = next;
        const mobileSelector = document.getElementById("adminMobileLocaleSelect");
        if (mobileSelector) mobileSelector.value = next;

        translate(document);
        window.dispatchEvent(new CustomEvent("aziel:admin-locale-changed", {
            detail: { locale: next }
        }));
    }

    function init() {
        const locale = getInitialLocale();
        document.documentElement.dataset.adminLocale = locale;
        document.documentElement.lang = locale;

        const selector = document.getElementById("adminLocaleSelect");
        if (selector) {
            selector.value = locale;
            selector.addEventListener("change", () => setLocale(selector.value));
        }

        const mobileSelector = document.getElementById("adminMobileLocaleSelect");
        if (mobileSelector) {
            mobileSelector.value = locale;
            mobileSelector.addEventListener("change", () => setLocale(mobileSelector.value));
        }

        translate(document);
    }

    window.AZIEL_ADMIN_I18N = {
        getLocale,
        setLocale,
        t,
        translate
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
