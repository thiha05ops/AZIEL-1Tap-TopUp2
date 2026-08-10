const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
    normalizeProductKnowledge,
    resolveLocalizedProductKnowledge,
    normalizeCustomerNoteLocales,
    resolveLocalizedCustomerNote
} = require("../catalog/productKnowledge");
const { normalizeCampaignLocales, resolveCampaignLocale, normalizeTextLocales, resolveTextLocale } = require("../catalog/localizedContent");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function dictionary(file, locale) {
    const context = { window: { AZIEL_LANG: {} } };
    vm.createContext(context);
    vm.runInContext(read(file), context);
    return context.window.AZIEL_LANG[locale];
}

function main() {
    const dictionaries = {
        en: dictionary("frontend/lang/en.js", "en"),
        my: dictionary("frontend/lang/my.js", "my"),
        th: dictionary("frontend/lang/th.js", "th")
    };
    const englishKeys = Object.keys(dictionaries.en).sort();
    ["my", "th"].forEach(locale => assert.deepStrictEqual(Object.keys(dictionaries[locale]).sort(), englishKeys, `${locale} dictionary parity`));

    const runtime = read("frontend/js/i18n.js");
    assert(runtime.includes('new Set(["en", "my", "th"])'), "locale whitelist must be explicit");
    assert(runtime.includes('const LANG_KEY = "azielLanguage"'), "one canonical persistence key required");
    assert(runtime.includes('"aziel:locale-changed"'), "shared locale event required");
    assert(runtime.includes("document.documentElement.lang"), "document language must be synchronized");
    assert(runtime.includes("interpolate"), "safe interpolation required");
    assert(!runtime.includes("TreeWalker"), "DOM text scraping is forbidden");
    assert(!runtime.includes("innerHTML = translated"), "translations must never become executable HTML");
    assert(runtime.includes('"__proto__"'), "prototype-pollution translation keys must be rejected");

    const englishKnowledge = {
        shortDescription: "English description",
        about: { summary: "English about", details: "English details" },
        purchaseNotes: [{ title: "Check", body: "Verify ID" }],
        packageGuide: { intro: "English guide", groups: [{ title: "Diamonds", description: "Guide", packageCodes: ["pkg-1"] }] },
        faq: [{ question: "Question?", answer: "Answer" }]
    };
    const localized = normalizeProductKnowledge({ ...englishKnowledge, locales: { en: englishKnowledge, my: { shortDescription: "မြန်မာဖော်ပြချက်" } } });
    const myKnowledge = resolveLocalizedProductKnowledge(localized, "my");
    assert.strictEqual(myKnowledge.shortDescription, "မြန်မာဖော်ပြချက်");
    assert.strictEqual(myKnowledge.about.summary, "English about", "partial locale must fall back per section");
    assert.deepStrictEqual(Array.from(myKnowledge.faq), localized.locales.en.faq, "missing FAQ must use English fallback");
    assert.strictEqual(resolveLocalizedProductKnowledge(localized, "invalid").shortDescription, "English description");

    const notes = normalizeCustomerNoteLocales({}, "English package note");
    assert.strictEqual(resolveLocalizedCustomerNote(notes, "th"), "English package note");
    assert.throws(() => normalizeCustomerNoteLocales({ my: "<script>" }, ""), /cannot contain HTML/);

    const campaignLocales = normalizeCampaignLocales({ my: { title: "ခေါင်းစဉ်" } }, { title: "Title", body: "Body", ctaLabel: "Open" });
    assert.deepStrictEqual(resolveCampaignLocale(campaignLocales, "my", {}), { title: "ခေါင်းစဉ်", body: "Body", ctaLabel: "Open" });
    assert.throws(() => normalizeCampaignLocales({ th: { title: "<b>x</b>" } }, { title: "Title", body: "Body" }), /cannot contain HTML/);
    assert.strictEqual(resolveTextLocale(normalizeTextLocales({}, "Explore"), "th", "Explore"), "Explore");

    const detail = read("frontend/js/product-detail-stage.js");
    assert(detail.includes("resolveProductKnowledge(product.productKnowledge"), "Product Detail must resolve Catalog-owned knowledge");
    assert(detail.includes('window.addEventListener("aziel:locale-changed", renderLowerProductContent)'), "Product Detail must update in place");
    assert(!detail.includes("selectedPackage = null"), "locale switching must not clear selected package");
    assert(!detail.includes("createPayment"), "locale switching must not create payment state");

    const preferences = read("frontend/js/locale-switcher.js");
    const regionBranch = preferences.match(/if \(group === "region"\) \{([\s\S]*?)\n        \}/)?.[1] || "";
    assert(regionBranch && !regionBranch.includes("pending.language"), "region changes must not mutate language");
    assert(preferences.includes("data-i18n=\"preferences.title\""), "preference dialog must use explicit keys");

    const campaignRuntime = read("frontend/js/campaign-runtime.js");
    assert(campaignRuntime.includes("localizeCampaign"), "Campaign content must resolve by locale");
    assert(campaignRuntime.includes("renderedCampaigns"), "Campaign locale changes must not reclaim eligibility");
    assert(campaignRuntime.includes('window.addEventListener("aziel:locale-changed"'), "Campaigns must update in place");

    ["login", "register", "forgot-password", "reset-password", "support", "home", "mlbb", "checkout", "payment", "tracking", "wallet"].forEach(page => {
        const html = read(`frontend/${page}.html`);
        assert(html.includes("i18n.js"), `${page} must load locale authority`);
    });

    console.log("Storefront localization system verification passed.");
}

main();
