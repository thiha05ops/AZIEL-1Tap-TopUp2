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

const i18n = read("frontend/js/i18n.js");
const locale = read("frontend/js/locale-switcher.js");
const region = read("frontend/js/region-switcher.js");
const notificationLive = read("frontend/js/notification-live.js");
const notificationsPage = read("frontend/js/notifications-page.js");
const recovery = read("frontend/js/payment/pending-payment-recovery.js");

assertIncludes(i18n, 'const LANG_KEY = "azielLanguage"', "Canonical language key");
assertIncludes(i18n, 'const LEGACY_LANG_KEYS = ["language", "azielLang", "selectedLanguage"]', "One-time legacy migration list");
assertIncludes(i18n, "function readStoredLang()", "One-time language bootstrap");
assertIncludes(i18n, "localStorage.setItem(LANG_KEY, migrated)", "Legacy language migration");
assertIncludes(i18n, "localStorage.setItem(LANG_KEY, \"en\")", "First-time English default persistence");
assertIncludes(i18n, "document.documentElement.lang = activeLang", "Initial html lang ownership");
assertIncludes(i18n, "ready()", "AZIEL_I18N.ready API");
assertIncludes(i18n, "missingKeys()", "Missing key reporting API");
assertIncludes(i18n, "detail: { lang: nextLang }", "Canonical languageChanged event detail");

if (/localStorage\.setItem\("language"/.test(i18n) || /localStorage\.setItem\("azielLang"/.test(i18n)) {
    fail("i18n.js must not write legacy language keys after migration");
}

[
    ["frontend/js/locale-switcher.js", locale],
    ["frontend/js/region-switcher.js", region],
    ["frontend/js/notification-live.js", notificationLive],
    ["frontend/js/notifications-page.js", notificationsPage],
    ["frontend/js/payment/pending-payment-recovery.js", recovery]
].forEach(([file, source]) => {
    if (/localStorage\.getItem\("language"\)|localStorage\.getItem\("azielLang"\)|localStorage\.getItem\("selectedLanguage"\)/.test(source)) {
        fail(`${file} still scans legacy language keys`);
    }
});

assertIncludes(locale, "e.detail?.lang", "Locale switcher canonical event consumption");
assertIncludes(recovery, "window.AZIEL_I18N.ready()", "Recovery overlay waits for i18n readiness");

console.log("Global language authority verifier passed.");
