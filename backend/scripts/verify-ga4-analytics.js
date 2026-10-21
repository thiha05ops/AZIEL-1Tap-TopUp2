"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "frontend/js/analytics.js"), "utf8");

function harness({ pathname = "/", consent = "granted", href = `https://azielplay.com${pathname}?email=private@example.com#secret`, referrer = "https://search.example/results?q=private" } = {}) {
    const appended = [], listeners = {}, nodes = new Map(), storage = new Map(consent === "unset" ? [] : [["aziel.analyticsConsent", consent]]);
    const element = tag => ({ tagName: tag.toUpperCase(), dataset: {}, style: {}, setAttribute() {}, addEventListener(type, fn) { this.listeners ||= {}; this.listeners[type] = fn; }, remove() { this.removed = true; } });
    const document = {
        title: "AZIEL Store", referrer, readyState: "complete",
        head: { appendChild(node) { appended.push(node); if (node.tagName === "SCRIPT" && node.onload) node.onload(); } },
        body: { appendChild(node) { appended.push(node); if (node.id) nodes.set(node.id, node); } },
        createElement: element, getElementById: id => nodes.get(id) || null,
        querySelector: selector => selector.includes("aziel-ga4") ? appended.find(node => node.dataset?.azielGa4 === "true") || null : null,
        addEventListener(type, fn) { listeners[type] = fn; }
    };
    const location = { origin: "https://azielplay.com", pathname, href };
    const window = {
        document, location, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
        history: { pushState(_state, _title, url) { const next = new URL(url, location.origin); location.pathname = next.pathname; location.href = next.href; }, replaceState() {} },
        addEventListener(type, fn) { listeners[type] = fn; }, setTimeout: fn => fn(), URL, Object, Date
    };
    const context = vm.createContext({ window, document, URL, Object, Date, Set, String, RegExp, encodeURIComponent, console });
    vm.runInContext(source, context);
    return { window, document, appended, storage, listeners, runAgain: () => vm.runInContext(source, context) };
}

let checks = 0;
const ok = (condition, message) => { assert(condition, message); checks += 1; };
const allowed = harness();
const googleScripts = () => allowed.appended.filter(node => String(node.src || "").startsWith("https://www.googletagmanager.com/"));
ok(googleScripts().length === 1, "consented public page loads one Google tag");
const events = allowed.window.dataLayer.map(args => Array.from(args));
ok(events.filter(row => row[0] === "config").length === 1 && events.find(row => row[0] === "config")[2].send_page_view === false, "automatic page view is disabled");
const views = events.filter(row => row[0] === "event" && row[1] === "page_view");
ok(views.length === 1, "initial page view is emitted once");
ok(views[0][2].page_location === "https://azielplay.com/" && !JSON.stringify(views[0]).includes("private"), "page and referrer URLs are sanitized");
ok(views[0][2].page_referrer === "https://search.example/results", "referrer query data is removed");
allowed.runAgain();
ok(googleScripts().length === 1 && allowed.window.dataLayer.filter(args => args[0] === "event" && args[1] === "page_view").length === 1, "duplicate initialization is prevented");
allowed.window.history.pushState({}, "", "/products/mlbb?gameAccountId=secret");
ok(allowed.window.dataLayer.filter(args => args[0] === "event" && args[1] === "page_view").length === 2, "eligible history navigation emits one page view");
const last = Array.from(allowed.window.dataLayer.at(-1));
ok(last[2].page_location === "https://azielplay.com/products/mlbb" && !JSON.stringify(last).includes("secret"), "navigation page view excludes query data");
const sensitivePaths = ["/admin", "/account", "/wallet", "/orders", "/notifications", "/support", "/live-chat", "/checkout", "/payment-method", "/payment", "/login", "/register", "/money-transfer"];
ok(sensitivePaths.every(pathname => {
    const blocked = harness({ pathname });
    return !blocked.window.dataLayer && blocked.appended.every(node => !String(node.src || "").includes("googletagmanager"));
}), "admin, customer, authentication, support, and payment paths never initialize Google");
const undecided = harness({ pathname: "/explore", consent: "unset" });
ok(!undecided.window.dataLayer && undecided.document.getElementById("azielAnalyticsConsent"), "unset consent shows a banner without loading Google");
const consentMarkup = undecided.document.getElementById("azielAnalyticsConsent").innerHTML;
ok(consentMarkup.includes("Cookies &amp; Privacy") && consentMarkup.includes("We use optional analytics cookies to understand how visitors use AZIEL and improve your experience.") && consentMarkup.includes('href="/policies/privacy"') && consentMarkup.includes(">Privacy Policy<") && consentMarkup.includes(">Accept<") && consentMarkup.includes(">Decline<"), "consent dialog uses the approved customer-facing copy and production-safe privacy link");
undecided.window.AZIEL_ANALYTICS.deny();
ok(undecided.storage.get("aziel.analyticsConsent") === "denied" && !undecided.window.dataLayer, "decline persists without analytics initialization");
const viewsBeforeWithdrawal = allowed.window.dataLayer.filter(args => args[0] === "event" && args[1] === "page_view").length;
allowed.window.AZIEL_ANALYTICS.deny();
allowed.window.history.pushState({}, "", "/products/pubg?playerId=private");
ok(allowed.storage.get("aziel.analyticsConsent") === "denied" && allowed.window["ga-disable-G-XFZ9DK4DX8"] === true && allowed.window.dataLayer.filter(args => args[0] === "event" && args[1] === "page_view").length === viewsBeforeWithdrawal, "withdrawal persists, disables GA, and prevents later page views");
const loader = fs.readFileSync(path.join(root, "frontend/js/header-loader.js"), "utf8");
ok(loader.includes("__AZIEL_ANALYTICS_LOADER__") && loader.includes("/js/analytics.js"), "shared frontend loader includes analytics exactly once");
const publicFiles = ["home.html", "explore.html", "mobile-games.html", "pc-games.html", "gift-cards.html", "social-topup.html", "entertainment.html", "mobile-recharge.html", "about.html", "contact.html", "faq.html", "help.html", "coming-soon.html", "product.html", "product-unavailable.html", "policies/privacy.html", "policies/terms.html", "policies/payment.html", "policies/refund.html", "policies/support.html"];
ok(publicFiles.every(file => fs.readFileSync(path.join(root, "frontend", file), "utf8").includes("header-loader.js?v=20261021-ga4-consent-v1")), "all public storefront entry pages reference the cache-busted shared loader");
const security = require(path.join(root, "backend/config/security"));
const csp = security.getCspConnectSources({ NODE_ENV: "production" });
ok(csp.includes("https://www.google-analytics.com") && csp.includes("https://region1.google-analytics.com"), "GA4 collection endpoints are in connect-src");
console.log(JSON.stringify({ result: "PASS", checks, measurementId: "G-XFZ9DK4DX8", googleNetworkBeforeConsent: 0, sensitiveRouteGoogleLoads: 0, duplicateInitializations: 0 }, null, 2));
