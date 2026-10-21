"use strict";

(function initializeAzielAnalytics() {
    if (window.__AZIEL_GA4_INITIALIZED__) return;
    window.__AZIEL_GA4_INITIALIZED__ = true;

    const MEASUREMENT_ID = "G-XFZ9DK4DX8";
    const CONSENT_KEY = "aziel.analyticsConsent";
    const DISABLE_KEY = `ga-disable-${MEASUREMENT_ID}`;
    const PUBLIC_PATHS = new Set([
        "/", "/explore", "/mobile-games", "/pc-games", "/gift-cards",
        "/social-topup", "/entertainment", "/mobile-recharge", "/about",
        "/contact", "/faq", "/help", "/coming-soon", "/product-unavailable",
        "/policies/privacy", "/policies/terms", "/policies/payment",
        "/policies/refund", "/policies/support"
    ]);
    const LEGACY_PUBLIC_FILES = new Set([
        "/home.html", "/all-games.html", "/explore.html", "/mobile-games.html",
        "/pc-games.html", "/gift-cards.html", "/social-topup.html",
        "/entertainment.html", "/mobile-recharge.html", "/about.html",
        "/contact.html", "/faq.html", "/help.html", "/coming-soon.html",
        "/product.html", "/product-unavailable.html"
    ]);

    const normalizedPath = () => {
        const path = String(window.location.pathname || "/").replace(/\/+$/, "");
        return path || "/";
    };
    const eligiblePath = path => PUBLIC_PATHS.has(path)
        || LEGACY_PUBLIC_FILES.has(path)
        || /^\/products\/[a-z0-9-]+$/i.test(path)
        || /^\/games\/[a-z0-9-]+$/i.test(path);
    const safeUrl = value => {
        if (!value) return "";
        try {
            const url = new URL(value, window.location.origin);
            if (!/^https?:$/.test(url.protocol)) return "";
            return `${url.origin}${url.pathname}`;
        } catch {
            return "";
        }
    };
    const readConsent = () => {
        try {
            const value = window.localStorage.getItem(CONSENT_KEY);
            return value === "granted" || value === "denied" ? value : "unset";
        } catch {
            return "unset";
        }
    };
    const writeConsent = value => {
        try { window.localStorage.setItem(CONSENT_KEY, value); } catch { /* Consent remains session-only. */ }
    };

    let consent = readConsent();
    window[DISABLE_KEY] = consent === "denied";
    let tagLoading = false;
    let tagLoaded = false;
    let lastPagePath = "";

    function queueGoogle() {
        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
        window.gtag("consent", "default", {
            analytics_storage: "denied",
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied"
        });
        window.gtag("consent", "update", {
            analytics_storage: "granted",
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied"
        });
    }

    function pageParameters() {
        return {
            page_location: safeUrl(window.location.href),
            page_path: normalizedPath(),
            page_title: String(document.title || "AZIEL 1Tap Shop").slice(0, 150),
            page_referrer: safeUrl(document.referrer || ""),
            allow_google_signals: false,
            allow_ad_personalization_signals: false
        };
    }

    function trackPageView() {
        const path = normalizedPath();
        if (consent !== "granted" || !tagLoaded || !eligiblePath(path) || lastPagePath === path) return false;
        lastPagePath = path;
        window.gtag("event", "page_view", pageParameters());
        return true;
    }

    function loadGoogleTag() {
        const path = normalizedPath();
        if (consent !== "granted" || !eligiblePath(path) || tagLoading || tagLoaded) return;
        tagLoading = true;
        queueGoogle();
        window.gtag("js", new Date());
        window.gtag("config", MEASUREMENT_ID, {
            send_page_view: false,
            allow_google_signals: false,
            allow_ad_personalization_signals: false
        });
        const script = document.createElement("script");
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
        script.dataset.azielGa4 = "true";
        script.onload = () => { tagLoading = false; tagLoaded = true; trackPageView(); };
        script.onerror = () => { tagLoading = false; };
        document.head.appendChild(script);
    }

    function removeBanner() {
        document.getElementById("azielAnalyticsConsent")?.remove();
    }
    function updateGoogleConsent(next) {
        window[DISABLE_KEY] = next === "denied";
        if (typeof window.gtag !== "function") return;
        window.gtag("consent", "update", {
            analytics_storage: next,
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied"
        });
    }
    function clearAnalyticsCookies() {
        try {
            String(document.cookie || "").split(";").forEach(cookie => {
                const name = cookie.split("=")[0].trim();
                if (name === "_ga" || name.startsWith("_ga_")) {
                    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
                }
            });
        } catch { /* Cookie cleanup must never affect storefront behavior. */ }
    }
    function choose(next) {
        consent = next;
        writeConsent(next);
        updateGoogleConsent(next);
        if (next === "denied") clearAnalyticsCookies();
        removeBanner();
        if (next === "granted") {
            loadGoogleTag();
            if (tagLoaded) trackPageView();
        }
    }
    function ensureConsentStyles() {
        if (document.getElementById("azielAnalyticsConsentStyles")) return;
        const style = document.createElement("style");
        style.id = "azielAnalyticsConsentStyles";
        style.textContent = `#azielAnalyticsConsent{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;display:flex;gap:16px;align-items:center;justify-content:space-between;max-width:900px;margin:auto;padding:16px 18px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:#10101c;color:#fff;box-shadow:0 12px 40px rgba(0,0,0,.45);font:500 14px/1.5 system-ui,sans-serif}#azielAnalyticsConsent h2{margin:0 0 4px;font:700 17px/1.3 system-ui,sans-serif}#azielAnalyticsConsent p{margin:0}#azielAnalyticsConsent a{color:#9bdcff}#azielAnalyticsConsent div[data-consent-copy]{min-width:0}#azielAnalyticsConsent div[data-consent-actions]{display:flex;gap:8px;flex:none}#azielAnalyticsConsent button{min-width:92px;border:1px solid rgba(255,255,255,.25);border-radius:9px;padding:9px 12px;background:#25253a;color:#fff;cursor:pointer}#azielAnalyticsConsent button[data-choice=granted]{background:#5c5cff;border-color:#7777ff}.aziel-privacy-settings-link{appearance:none;border:0;background:none;padding:0;color:inherit;font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}@media(max-width:640px){#azielAnalyticsConsent{align-items:stretch;flex-direction:column}#azielAnalyticsConsent div[data-consent-actions],#azielAnalyticsConsent button{width:100%}}`;
        document.head.appendChild(style);
    }
    function showConsentBanner() {
        if (!eligiblePath(normalizedPath()) || document.getElementById("azielAnalyticsConsent")) return;
        ensureConsentStyles();
        const banner = document.createElement("aside");
        banner.id = "azielAnalyticsConsent";
        banner.setAttribute("role", "dialog");
        banner.setAttribute("aria-label", "Analytics privacy choice");
        banner.innerHTML = `<div data-consent-copy><h2>Cookies &amp; Privacy</h2><p>We use optional analytics cookies to understand how visitors use AZIEL and improve your experience. <a href="/policies/privacy">Privacy Policy</a></p></div><div data-consent-actions><button type="button" data-choice="denied">Decline</button><button type="button" data-choice="granted">Accept</button></div>`;
        banner.addEventListener("click", event => {
            const selected = event.target.closest("button[data-choice]")?.dataset.choice;
            if (selected === "granted" || selected === "denied") choose(selected);
        });
        document.body.appendChild(banner);
    }
    function installPrivacySettingsLink() {
        if (!eligiblePath(normalizedPath()) || document.querySelector("[data-aziel-privacy-settings]")) return;
        const footer = document.querySelector(".site-footer, .game-mini-footer, .explore-footer, footer");
        if (!footer) return;
        ensureConsentStyles();
        const link = document.createElement("a");
        link.href = "#privacy-settings";
        link.className = "aziel-privacy-settings-link";
        link.dataset.azielPrivacySettings = "true";
        link.textContent = "Privacy Settings";
        link.addEventListener("click", event => {
            event.preventDefault();
            showConsentBanner();
            document.getElementById("azielAnalyticsConsent")?.querySelector("button")?.focus();
        });
        const target = footer.querySelector(".footer-copy") || footer;
        target.append(document.createTextNode(" · "), link);
    }

    function navigationHook(method) {
        const original = window.history?.[method];
        if (typeof original !== "function") return;
        window.history[method] = function azielAnalyticsHistoryHook() {
            const result = original.apply(this, arguments);
            window.setTimeout(trackPageView, 0);
            return result;
        };
    }

    window.AZIEL_ANALYTICS = Object.freeze({
        measurementId: MEASUREMENT_ID,
        isEligiblePath: path => eligiblePath(String(path || "")),
        consent: () => consent,
        grant: () => choose("granted"),
        deny: () => choose("denied"),
        trackPageView
    });

    if (!eligiblePath(normalizedPath())) return;
    navigationHook("pushState");
    navigationHook("replaceState");
    window.addEventListener("popstate", () => window.setTimeout(trackPageView, 0));
    if (consent === "granted") loadGoogleTag();
    else if (consent === "unset") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showConsentBanner, { once: true });
        else showConsentBanner();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installPrivacySettingsLink, { once: true });
    else installPrivacySettingsLink();
})();
