// frontend/js/i18n.js
// AZIEL Storefront Locale Authority. Explicit keys only; no DOM text scraping.

(function () {
    const LANG_KEY = "azielLanguage";
    const LEGACY_LANG_KEYS = ["language", "azielLang", "selectedLanguage"];
    const SUPPORTED_LANGS = new Set(["en", "my", "th"]);
    const missingKeys = new Set();
    let activeLang = "";
    let readyPromise = null;

    const SKIP_TAGS = new Set([
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "IFRAME",
        "CANVAS",
        "SVG"
    ]);

    const SKIP_SELECTOR = [
        "[data-i18n-skip]",
        ".no-translate",
        ".az-logo",
        ".az-logo-img",
        ".payment-logos",
        ".fa-solid",
        ".fa-regular",
        ".fa-brands"
    ].join(",");

    function normalizeLang(lang) {
        const value = String(lang || "").toLowerCase();
        return SUPPORTED_LANGS.has(value) ? value : "en";
    }

    function readStoredLang() {
        try {
            const canonical = localStorage.getItem(LANG_KEY);
            if (canonical) return normalizeLang(canonical);

            for (const key of LEGACY_LANG_KEYS) {
                const legacy = localStorage.getItem(key);
                if (!legacy) continue;
                const migrated = normalizeLang(legacy);
                localStorage.setItem(LANG_KEY, migrated);
                return migrated;
            }

            localStorage.setItem(LANG_KEY, "en");
            return "en";
        } catch (error) {
            return "en";
        }

        return "en";
    }

    function getLang() {
        if (!activeLang) {
            activeLang = readStoredLang();
            document.documentElement.lang = activeLang;
        }

        return activeLang;
    }

    function safeOwn(object, key) {
        return Boolean(object && typeof key === "string" && !["__proto__", "prototype", "constructor"].includes(key) && Object.prototype.hasOwnProperty.call(object, key));
    }

    function getDict(lang = getLang()) {
        const english = window.AZIEL_LANG?.en || {};
        const localized = window.AZIEL_LANG?.[lang] || {};
        return { ...english, ...localized };
    }

    function normalizeText(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function reportMissingKey(key, lang) {
        if (!key) return;
        if (!["localhost", "127.0.0.1"].includes(location.hostname)) return;

        const missingKey = `${lang}:${key}`;
        if (missingKeys.has(missingKey)) return;
        missingKeys.add(missingKey);
        console.warn("[AZIEL i18n] Missing translation key", { lang, key });
    }

    function interpolate(value, params = {}) {
        return String(value || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
            Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        ));
    }

    function t(keyOrText, fallback = "", maybeParams = {}) {
        const params = typeof fallback === "object" && fallback !== null ? fallback : maybeParams;
        const fallbackText = typeof fallback === "object" && fallback !== null ? "" : fallback;
        const dict = getDict();
        const value = normalizeText(keyOrText);

        const english = window.AZIEL_LANG?.en || {};
        const translated = (
            (safeOwn(dict, value) && dict[value]) ||
            (safeOwn(dict, keyOrText) && dict[keyOrText]) ||
            (safeOwn(english, value) && english[value]) ||
            (safeOwn(english, keyOrText) && english[keyOrText]) ||
            fallbackText ||
            value
        );

        if (
            !safeOwn(dict, value) &&
            !safeOwn(dict, keyOrText) &&
            !safeOwn(english, value) &&
            !safeOwn(english, keyOrText)
        ) {
            reportMissingKey(value || keyOrText, getLang());
        }

        return interpolate(translated, params);
    }

    function setLang(lang) {
        const nextLang = normalizeLang(lang);

        try {
            localStorage.setItem(LANG_KEY, nextLang);
        } catch (error) {
            // Language persistence must never block UI translation.
        }

        activeLang = nextLang;
        document.documentElement.lang = nextLang;

        translatePage(document);

        window.dispatchEvent(
            new CustomEvent("aziel:languageChanged", {
                detail: { lang: nextLang }
            })
        );
        window.dispatchEvent(
            new CustomEvent("aziel:locale-changed", {
                detail: { locale: nextLang }
            })
        );
    }

    function translateError(code, fallback = "Something went wrong.", params = {}) {
        const normalizedCode = String(code || "UNKNOWN_ERROR").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
        return t(`errors.${normalizedCode}`, fallback, params);
    }

    function shouldSkipElement(el) {
        if (!el || !el.tagName) return true;
        if (SKIP_TAGS.has(el.tagName)) return true;
        if (el.closest?.(SKIP_SELECTOR)) return true;

        return false;
    }

    function translateDataAttributes(root, dict) {
        root.querySelectorAll("[data-i18n]").forEach(el => {
            const key = el.dataset.i18n;
            const value = dict[key];

            if (value) el.textContent = value;
        });

        root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            const value = dict[key];

            if (value) el.placeholder = value;
        });

        root.querySelectorAll("[data-i18n-title]").forEach(el => {
            const key = el.dataset.i18nTitle;
            const value = dict[key];

            if (value) el.title = value;
        });

        root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
            const key = el.dataset.i18nAriaLabel;
            const value = dict[key];

            if (value) el.setAttribute("aria-label", value);
        });

        root.querySelectorAll("[data-i18n-aria-description]").forEach(el => {
            const value = dict[el.dataset.i18nAriaDescription];
            if (value) el.setAttribute("aria-description", value);
        });

        root.querySelectorAll("[data-i18n-alt]").forEach(el => {
            const value = dict[el.dataset.i18nAlt];
            if (value) el.alt = value;
        });
    }

    function translatePage(root = document) {
        const lang = getLang();
        const dict = getDict(lang);

        if (!dict) return;

        document.documentElement.lang = lang;

        translateDataAttributes(root, dict);
    }

    window.AZIEL_I18N = {
        t,
        getLang,
        setLang,
        getLocale: getLang,
        setLocale: setLang,
        normalizeLocale: normalizeLang,
        translateError,
        supportedLocales: Object.freeze(["en", "my", "th"]),
        translatePage,
        ready() {
            if (!readyPromise) {
                readyPromise = Promise.resolve().then(() => {
                    getLang();
                    return activeLang;
                });
            }

            return readyPromise;
        },
        missingKeys() {
            return Array.from(missingKeys);
        }
    };
    window.AZIEL_LOCALE = window.AZIEL_I18N;

    document.addEventListener("DOMContentLoaded", () => {
        translatePage(document);
    });

    window.addEventListener("aziel:headerLoaded", () => {
        translatePage(document);
    });

    window.addEventListener("aziel:languageChanged", () => {
        translatePage(document);
    });
})();
