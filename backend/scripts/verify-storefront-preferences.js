const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { run: verifyHomeDiscoveryCards } = require("./verify-home-product-discovery-cards");
const { run: verifyStorefrontSystemTheme } = require("./verify-storefront-system-theme");
const { run: verifyHomeHeroCampaignFallback } = require("./verify-home-hero-campaign-fallback");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(source, needle, message) {
    assert(source.includes(needle), message || `Missing ${needle}`);
}

function notIncludes(source, needle, message) {
    assert(!source.includes(needle), message || `Unexpected ${needle}`);
}

async function run() {
    const locale = read("frontend/js/locale-switcher.js");
    const header = read("frontend/components/header.html");
    const headerJs = read("frontend/js/header.js");
    const headerCss = read("frontend/css/theme/aziel-header.css");
    const homeHtml = read("frontend/home.html");
    const userState = read("frontend/js/user-state.js");
    const i18n = read("frontend/js/i18n.js");
    const gameFlow = read("frontend/js/game-flow.js");
    const paymentTrust = read("frontend/js/payment-trust-display.js");
    const wallet = read("frontend/js/wallet.js");

    includes(userState, "AZIEL.getShopRegion", "Commerce region authority must remain AZIEL.getShopRegion.");
    includes(userState, "AZIEL.setShopRegion", "Commerce region mutation authority must remain AZIEL.setShopRegion.");
    includes(userState, 'finalRegion === "TH" ? "THB" : "MMK"', "Region must derive the commerce currency.");
    includes(userState, "aziel:shopRegionChanged", "Region changes must continue notifying pricing/payment consumers.");
    includes(i18n, 'const LANG_KEY = "azielLanguage"', "Language authority must remain AZIEL i18n.");
    includes(i18n, 'SUPPORTED_LANGS = new Set(["en", "my", "th"])', "Only English, Myanmar, and Thai languages should be supported.");

    ["getShopRegion", "shopRegionChanged"].forEach(needle => {
        includes(gameFlow, needle, `Product detail pricing/checkout consumer missing ${needle}.`);
        includes(wallet, needle, `Wallet consumer missing ${needle}.`);
    });
    includes(paymentTrust, "getShopRegion", "Payment availability must read the current commerce region.");
    includes(paymentTrust, "/api/payment-methods?region=", "Payment availability must fetch methods by commerce region.");

    includes(header, "storefrontPreferenceBtn", "Desktop header must expose one compact storefront preference control.");
    includes(header, "data-preference-summary", "Desktop preference summary missing.");
    notIncludes(header, "regionSelect", "Header must not expose separate region select.");
    notIncludes(header, "currencySelect", "Header must not expose separate currency select.");
    notIncludes(header, "languageSelect", "Header must not expose separate language select.");

    includes(headerJs, "mobilePreferenceBtn", "Mobile drawer must expose the preference row.");
    includes(headerJs, "Region & Preferences", "Mobile drawer preference label missing.");
    includes(headerJs, "data-mobile-preference-summary", "Mobile drawer summary missing.");

    includes(locale, "AZIEL_STOREFRONT_PREFERENCES", "Public preference runtime must expose one storefront preference authority.");
    includes(locale, "const REGIONS = Object.freeze", "Preference runtime must centralize supported regions.");
    includes(locale, "MM: { code: \"MM\"", "Myanmar region support missing.");
    includes(locale, "TH: { code: \"TH\"", "Thailand region support missing.");
    includes(locale, "const LANGUAGES = Object.freeze", "Preference runtime must centralize supported languages.");
    includes(locale, "my: { code: \"my\"", "Myanmar language option missing.");
    includes(locale, "en: { code: \"en\"", "English language option missing.");
    includes(locale, "th: { code: \"th\"", "Thai language option missing.");
    includes(locale, "const CURRENCIES = Object.freeze", "Preference runtime must centralize supported currencies.");
    includes(locale, "MMK: { code: \"MMK\"", "MMK support missing.");
    includes(locale, "THB: { code: \"THB\"", "THB support missing.");
    notIncludes(locale, "USD", "Storefront preference runtime must not add USD.");
    notIncludes(locale, "EUR", "Storefront preference runtime must not add EUR.");
    includes(locale, 'return normalizeRegion(region) === "TH" ? "THB" : "MMK"', "Region must determine currency.");
    includes(locale, "pending.region = normalizeRegion(value);\n            pending.currency = currencyByRegion(pending.region);", "Changing region must update pending currency.");
    includes(locale, "pending.language = normalizeLang(value);", "Language must update independently.");
    notIncludes(locale, "pending.region = normalizeRegion(pending.language", "Language must not modify region.");
    notIncludes(locale, "pending.currency = currencyByRegion(pending.language", "Language must not modify currency.");
    includes(locale, "window.AZIEL?.setShopRegion", "Preference save must reuse existing commerce region authority.");
    includes(locale, "window.AZIEL_I18N?.setLang", "Preference save must reuse existing i18n authority.");
    includes(locale, 'localStorage.setItem("shopRegion"', "Preference persistence must preserve shopRegion.");
    includes(locale, 'localStorage.setItem("azielLanguage"', "Preference persistence must preserve azielLanguage.");
    notIncludes(locale, "localStorage.setItem(\"azielTheme\"", "Preference runtime must not touch theme storage.");
    notIncludes(locale, "theme-light", "Preference runtime must not own theme classes.");
    notIncludes(locale, "theme-dark", "Preference runtime must not own theme classes.");
    includes(locale, "Escape", "Preference panel must support Escape close.");
    includes(locale, "document.addEventListener(\"click\"", "Preference panel must support outside-click close.");
    includes(locale, "aria-pressed", "Preference options must expose selected state.");
    includes(locale, "aria-disabled", "Currency lock state must be accessible.");

    notIncludes(homeHtml, "localeModal", "Home must not keep the old full-page locale modal.");
    notIncludes(homeHtml, "US Dollar", "Home must not expose unsupported USD currency.");

    includes(headerCss, ".az-preference-btn", "Desktop preference trigger CSS missing.");
    includes(headerCss, ".az-preference-panel", "Preference panel CSS missing.");
    includes(headerCss, "width: min(380px, calc(100vw - 28px))", "Desktop popover width must stay compact.");
    includes(headerCss, ".az-mobile-preference-row", "Mobile drawer preference row CSS missing.");
    includes(headerCss, "@media (max-width: 900px)", "Mobile preference rules must be scoped.");
    includes(headerCss, "bottom: max(12px, env(safe-area-inset-bottom))", "Mobile preference panel must be a bottom sheet.");
    includes(headerCss, "left: 12px", "Mobile preference panel must fit 375px width.");
    includes(headerCss, "right: 12px", "Mobile preference panel must fit 375px width.");
    includes(headerCss, "var(--surface", "Preference UI must use storefront surface tokens.");
    includes(headerCss, "var(--text", "Preference UI must use storefront text tokens.");
    includes(headerCss, "var(--border", "Preference UI must use storefront border tokens.");
    includes(headerCss, "var(--primary", "Preference UI must preserve AZIEL purple accent.");

    await verifyHomeDiscoveryCards();
    verifyStorefrontSystemTheme();
    await verifyHomeHeroCampaignFallback();

    return {
        authorities: {
            region: "AZIEL.getShopRegion / AZIEL.setShopRegion",
            language: "AZIEL_I18N using azielLanguage",
            currency: "derived from commerce region"
        },
        supported: {
            regions: ["MM", "TH"],
            languages: ["my", "en", "th"],
            currencies: ["MMK", "THB"]
        },
        regionCurrency: {
            MM: "MMK",
            TH: "THB"
        },
        guardrails: [
            "Home product discovery cards",
            "Storefront system theme",
            "Home hero campaign fallback"
        ]
    };
}

if (require.main === module) {
    run()
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => {
            console.error(error?.message || error);
            process.exitCode = 1;
        });
}

module.exports = { run };
