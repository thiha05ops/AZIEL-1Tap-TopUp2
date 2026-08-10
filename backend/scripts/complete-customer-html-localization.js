const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const PAGES = [
    "home", "mlbb", "pubg", "pubg-rp", "freefire", "hok", "genshin", "roblox", "telegram", "product",
    "checkout", "payment-method", "payment", "tracking", "login", "register", "forgot-password", "reset-password",
    "verify-otp", "support", "wallet", "coming-soon"
];
const CANONICAL = new Set([
    "AZIEL", "Mobile Legends", "Mobile Legends Diamonds", "PUBG Mobile", "PUBG Mobile UC", "Free Fire",
    "Honor of Kings", "Marvel Rivals", "Blood Strike", "Android", "iOS", "MMK", "THB", "Ks", "Facebook",
    "Telegram", "YouTube", "Discord", "Google", "PromptPay", "AYA Pay", "WavePay", "KBZPay", "SCB",
    "aziel1tapshop@gmail.com", "© 2026 AZIEL 1Tap Shop.", "1 TAP. TOP UP. DONE."
]);
const OWNER_OR_IDENTITY = [
    /Diamonds?$/i, /^UC$/i, /Tokens?(& Packages)?$/i, /^Top Up$/i, /^Golds, Pass$/i,
    /^0 (Ks|THB|MMK|฿)$/i, /^AZIEL 1Tap Shop$/i
];
const INTERNAL = [/^\d+$/, /^[-–—×✓]+$/, /^[A-Z0-9_./:+-]+$/];

function loadDictionary(file, locale) {
    const context = { window: { AZIEL_LANG: {} } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context);
    return context.window.AZIEL_LANG[locale] || {};
}

function normalize(value) {
    return String(value || "").replace(/&amp;/g, "&").replace(/&nbsp;/g, "").replace(/\s+/g, " ").trim();
}

function slug(value) {
    const words = normalize(value).replace(/[’']/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/);
    const base = words.slice(0, 9).map((word, index) => index ? word[0].toUpperCase() + word.slice(1) : word.toLowerCase()).join("");
    return (base || "label").slice(0, 72);
}

function escapeAttr(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function classify(text) {
    if (CANONICAL.has(text) || OWNER_OR_IDENTITY.some(pattern => pattern.test(text))) return "CANONICAL_NON_TRANSLATED";
    if (INTERNAL.some(pattern => pattern.test(text))) return "INTERNAL_NON_UI";
    return "CUSTOMER_VISIBLE_TRANSLATABLE";
}

function findLegacyTranslation(dict, english, fallback) {
    if (Object.prototype.hasOwnProperty.call(dict, english)) return normalize(dict[english]);
    const key = Object.keys(dict).find(item => normalize(fallback[item]) === english);
    return key && Object.prototype.hasOwnProperty.call(dict, key) ? normalize(dict[key]) : "";
}

function run({ apply = false } = {}) {
    const dicts = {
        en: loadDictionary("frontend/lang/en.js", "en"),
        my: loadDictionary("frontend/lang/my.js", "my"),
        th: loadDictionary("frontend/lang/th.js", "th")
    };
    const translations = { en: {}, my: {}, th: {} };
    const report = [];
    const used = new Map();

    for (const page of PAGES) {
        const file = path.join(ROOT, "frontend", `${page}.html`);
        if (!fs.existsSync(file)) continue;
        let html = fs.readFileSync(file, "utf8");
        html = html.replace(/(<(?!script\b|style\b|title\b)([a-z][a-z0-9-]*)\b(?![^>]*\bdata-i18n(?:-skip)?=)[^>]*>)(\s*)([^<>{}\n][^<>{}]*?[A-Za-z][^<>{}]*?)(\s*)(<\/\2>)/gi,
            (whole, open, tag, before, rawText, after, close) => {
                const text = normalize(rawText);
                if (!text || /<|>/.test(text)) return whole;
                const category = classify(text);
                if (category !== "CUSTOMER_VISIBLE_TRANSLATABLE") {
                    report.push({ page, category, text });
                    return whole;
                }
                const base = `${page.replace(/-/g, ".")}.${slug(text)}`;
                const signature = `${page}:${text}`;
                let key = base;
                if (used.has(key) && used.get(key) !== signature) {
                    let suffix = 2;
                    while (used.has(`${base}${suffix}`)) suffix += 1;
                    key = `${base}${suffix}`;
                }
                used.set(key, signature);
                translations.en[key] = text;
                translations.my[key] = findLegacyTranslation(dicts.my, text, dicts.en);
                translations.th[key] = findLegacyTranslation(dicts.th, text, dicts.en);
                report.push({ page, category, text, key, missing: ["my", "th"].filter(locale => !translations[locale][key]) });
                const localizedOpen = open.replace(/>$/, ` data-i18n="${escapeAttr(key)}">`);
                return `${localizedOpen}${before}${rawText}${after}${close}`;
            });
        if (apply) fs.writeFileSync(file, html);
    }

    const output = {
        counts: report.reduce((counts, item) => ({ ...counts, [item.category]: (counts[item.category] || 0) + 1 }), {}),
        missingStaticTranslations: report.filter(item => item.missing?.length).map(item => ({ page: item.page, key: item.key, text: item.text, locales: item.missing })),
        report,
        translations
    };
    if (apply) fs.writeFileSync("/private/tmp/aziel-storefront-html-localization.json", JSON.stringify(output, null, 2));
    return output;
}

if (require.main === module) {
    const result = run({ apply: process.argv.includes("--apply") });
    console.log(JSON.stringify({ counts: result.counts, missingStaticTranslations: result.missingStaticTranslations }, null, 2));
}

module.exports = { PAGES, run };
