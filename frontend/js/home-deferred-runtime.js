(function () {
    "use strict";
    if (window.__AZIEL_HOME_DEFERRED_RUNTIME_INITIALIZED__) return;
    window.__AZIEL_HOME_DEFERRED_RUNTIME_INITIALIZED__ = true;
    const scripts = [
        "/js/home-promotion-preview.js?v=20260920-storefront-performance-v1",
        "/js/search.js?v=20260920-storefront-performance-v1",
        "/js/live-chat.js?v=20260920-storefront-performance-v1",
        "/js/payment-trust-display.js?v=20260920-storefront-performance-v1",
        "/js/home-coupon-preview.js?v=20260920-storefront-performance-v1"
    ];
    function loadStylesheet(href) { const link = document.createElement("link"); link.rel = "stylesheet"; link.href = href; document.head.appendChild(link); }
    function loadScript(src) { return new Promise(resolve => { const script = document.createElement("script"); script.src = src; script.async = false; script.onload = resolve; script.onerror = resolve; document.head.appendChild(script); }); }
    async function loadFeatures() {
        loadStylesheet("/css/support/live-chat.css?v=20260920-storefront-performance-v1");
        for (const src of scripts) await loadScript(src);
        window.AZIEL_PAYMENT_TRUST?.renderFooterTrustLogos?.().catch(() => {});
    }
    window.addEventListener("load", () => {
        if ("requestIdleCallback" in window) requestIdleCallback(loadFeatures, { timeout: 2500 });
        else setTimeout(loadFeatures, 600);
    }, { once: true });
})();
