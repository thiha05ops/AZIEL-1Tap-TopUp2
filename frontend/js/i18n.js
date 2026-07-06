// frontend/js/i18n.js
// AZIEL i18n V3 - Auto Scan Translation Engine

(function () {
    const LANG_KEY = "azielLanguage";

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

    function getLang() {
        return (
            localStorage.getItem(LANG_KEY) ||
            localStorage.getItem("language") ||
            localStorage.getItem("azielLang") ||
            "en"
        );
    }

    function getDict(lang = getLang()) {
        return (
            window.AZIEL_LANG?.[lang] ||
            window.AZIEL_LANG?.en ||
            {}
        );
    }

    function normalizeText(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function t(keyOrText, fallback = "") {
        const dict = getDict();
        const value = normalizeText(keyOrText);

        return (
            dict[value] ||
            dict[keyOrText] ||
            fallback ||
            keyOrText
        );
    }

    function setLang(lang) {
        if (!window.AZIEL_LANG?.[lang]) return;

        localStorage.setItem(LANG_KEY, lang);
        localStorage.setItem("language", lang);
        localStorage.setItem("azielLang", lang);

        translatePage(document);

        window.dispatchEvent(
            new CustomEvent("aziel:languageChanged", {
                detail: { language: lang }
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
        translatePage
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