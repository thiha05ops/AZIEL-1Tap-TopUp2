// Loads exactly one merged storefront locale dictionary at startup.
(function () {
    if (window.AZIEL_LOCALE_LOADER) return;

    const SUPPORTED = new Set(["en", "my", "th"]);
    const VERSION = "20260829-p4";
    const pending = new Map();

    function normalize(lang) {
        const value = String(lang || "").toLowerCase();
        return SUPPORTED.has(value) ? value : "en";
    }

    function storedLocale() {
        try {
            return normalize(
                localStorage.getItem("azielLanguage") ||
                localStorage.getItem("language") ||
                localStorage.getItem("azielLang") ||
                localStorage.getItem("selectedLanguage") ||
                "en"
            );
        } catch {
            return "en";
        }
    }

    function localeUrl(lang) {
        return `/lang/runtime/${normalize(lang)}.js?v=${VERSION}`;
    }

    function load(lang) {
        const locale = normalize(lang);
        if (window.AZIEL_LANG?.[locale]) return Promise.resolve(locale);
        if (pending.has(locale)) return pending.get(locale);

        const request = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = localeUrl(locale);
            script.async = true;
            script.dataset.azielLocale = locale;
            script.addEventListener("load", () => resolve(locale), { once: true });
            script.addEventListener("error", () => {
                pending.delete(locale);
                reject(new Error(`Could not load locale: ${locale}`));
            }, { once: true });
            document.head.appendChild(script);
        });
        pending.set(locale, request);
        return request;
    }

    const initialLocale = storedLocale();
    document.documentElement.lang = initialLocale;
    window.AZIEL_LOCALE_LOADER = Object.freeze({ load, normalize, initialLocale, localeUrl });

    // Parser-time loading preserves the existing synchronous i18n initialization
    // order without downloading the two inactive dictionaries.
    if (document.readyState === "loading" && !window.AZIEL_LANG?.[initialLocale]) {
        document.write(`<script src="${localeUrl(initialLocale)}" data-aziel-locale="${initialLocale}"><\/script>`);
    } else {
        load(initialLocale).catch(() => {});
    }
})();
