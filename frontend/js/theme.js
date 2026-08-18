// Legacy compatibility bridge.
// Canonical public theme authority:
// /core/settings/theme.js

(function loadCanonicalThemeRuntime() {
    if (window.AZIEL?.theme && window.AZIEL?.applyTheme) {
        return;
    }

    const existing = document.querySelector(
        'script[src*="/core/settings/theme.js"]'
    );

    if (existing) {
        return;
    }

    const script = document.createElement("script");
    script.src = "/core/settings/theme.js?v=20260817-system-authority";
    script.async = false;

    document.head.appendChild(script);
})();