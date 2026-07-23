const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const fail = message => {
    throw new Error(message);
};
const assertIncludes = (source, needle, label) => {
    if (!source.includes(needle)) fail(`${label} is missing: ${needle}`);
};

const pwaFix = read("frontend/js/pwa-fix.js");
const header = read("frontend/components/header.html");
const headerJs = read("frontend/js/header.js");
const headerCss = read("frontend/css/theme/aziel-header.css");
const en = read("frontend/lang/en.js");
const my = read("frontend/lang/my.js");
const th = read("frontend/lang/th.js");

assertIncludes(pwaFix, "initAzielPwaRefresh()", "PWA refresh initializer");
assertIncludes(pwaFix, "window.AZIEL_PWA_REFRESH = { requestRefresh, isPaymentFlowOpen }", "Public refresh API");
assertIncludes(pwaFix, "pwa_refresh_payment_open_confirm", "Payment-open confirmation");
assertIncludes(pwaFix, "window.__AZIEL_PWA_REFRESHING__", "Reload guard");
assertIncludes(pwaFix, "window.addEventListener(\"aziel:pwaUpdateReady\"", "Service worker update notice");

const updateReadyBlock = pwaFix.slice(pwaFix.indexOf('window.addEventListener("aziel:pwaUpdateReady"'));
if (/location\.reload|location\.replace|window\.location\.href/.test(updateReadyBlock)) {
    fail("Service worker update notice must not force navigation or reload");
}

assertIncludes(header, 'id="mobileRefreshBtn"', "Mobile refresh menu action");
assertIncludes(headerJs, "initMobileRefreshButton()", "Header refresh binding");
assertIncludes(headerJs, "window.AZIEL_PWA_REFRESH.requestRefresh()", "Header calls shared refresh API");
assertIncludes(headerCss, ".az-mobile-refresh-action", "Refresh action CSS owner");
assertIncludes(headerCss, "@media (max-width: 900px)", "Mobile-only refresh visibility");

["pwa_refresh", "pwa_refresh_label", "pwa_refresh_payment_open_confirm", "pwa_update_available"].forEach(key => {
    [en, my, th].forEach((source, index) => {
        if (!source.includes(key)) fail(`${["en", "my", "th"][index]} missing ${key}`);
    });
});

if (/MutationObserver/.test(pwaFix)) {
    fail("PWA refresh must not introduce MutationObserver loops");
}

console.log("PWA refresh verifier passed.");
