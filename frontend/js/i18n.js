// frontend/js/i18n.js
// AZIEL i18n V3 - Auto Scan Translation Engine

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
            dict[value] ||
            dict[keyOrText] ||
            english[value] ||
            english[keyOrText] ||
            fallbackText ||
            value
        );

        if (
            !dict[value] &&
            !dict[keyOrText] &&
            !english[value] &&
            !english[keyOrText]
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
    }

    function translateAttributes(root, dict) {
        const attrs = [
            "placeholder",
            "title",
            "aria-label"
        ];

        root.querySelectorAll("*").forEach(el => {
            if (shouldSkipElement(el)) return;

            attrs.forEach(attr => {
                const current = normalizeText(el.getAttribute(attr));
                if (!current) return;

                if (!el.dataset[`original${toDatasetName(attr)}`]) {
                    el.dataset[`original${toDatasetName(attr)}`] = current;
                }

                const original = el.dataset[`original${toDatasetName(attr)}`];
                const translated = dict[original];

                if (translated) {
                    el.setAttribute(attr, translated);
                }
            });
        });
    }

    function translateTextNodes(root, dict) {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const parent = node.parentElement;

                    if (!parent || shouldSkipElement(parent)) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    const text = normalizeText(node.nodeValue);

                    if (!text) return NodeFilter.FILTER_REJECT;
                    if (/^[\d\s.,:฿$Ks%()+\-\/]+$/.test(text)) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    if (!dict[text]) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const nodes = [];

        while (walker.nextNode()) {
            nodes.push(walker.currentNode);
        }

        nodes.forEach(node => {
            const original = normalizeText(node.nodeValue);

            if (!node.parentElement.dataset.originalText) {
                node.parentElement.dataset.originalText = original;
            }

            const baseText =
                node.parentElement.dataset.originalText ||
                original;

            if (dict[baseText]) {
                node.nodeValue = node.nodeValue.replace(
                    original,
                    dict[baseText]
                );
            }
        });
    }

    function translatePage(root = document) {
        const lang = getLang();
        const dict = getDict(lang);

        if (!dict) return;

        document.documentElement.lang = lang;

        translateDataAttributes(root, dict);
        translateAttributes(root, dict);
        translateTextNodes(root, dict);
    }

    function watchDynamicContent() {
        const observer = new MutationObserver(mutations => {
            let shouldTranslate = false;

            for (const mutation of mutations) {
                if (mutation.addedNodes?.length) {
                    shouldTranslate = true;
                    break;
                }
            }

            if (!shouldTranslate) return;

            clearTimeout(window.__azielI18nTimer);

            window.__azielI18nTimer = setTimeout(() => {
                translatePage(document);
            }, 80);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function toDatasetName(attr) {
        return attr
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
            .replace(/^./, c => c.toUpperCase());
    }

    window.AZIEL_I18N = {
        t,
        getLang,
        setLang,
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

    document.addEventListener("DOMContentLoaded", () => {
        translatePage(document);
        watchDynamicContent();
    });

    window.addEventListener("aziel:headerLoaded", () => {
        translatePage(document);
    });

    window.addEventListener("aziel:languageChanged", () => {
        translatePage(document);
    });
})();
