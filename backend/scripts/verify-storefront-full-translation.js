#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { normalizeProductKnowledge } = require("../catalog/productKnowledge");
const knowledgeSeeds = require("../catalog/verifiedProductKnowledge");

const ROOT = path.resolve(__dirname, "../..");
const ROUTES = [
  "home.html", "mlbb.html", "pubg.html", "pubg-rp.html", "freefire.html", "hok.html",
  "genshin.html", "roblox.html", "telegram.html", "product.html", "checkout.html",
  "payment-method.html", "payment.html", "tracking.html", "login.html", "register.html",
  "forgot-password.html", "reset-password.html", "verify-otp.html", "support.html",
  "wallet.html", "coming-soon.html"
];
const CANONICAL_KEYS = new Set([
  "home.marvelRIVALS", "home.bloodSTRIKE", "footerCopyright", "tagline", "mobileLegends",
  "userId", "serverId", "orderId", "pubgMobile", "playerId", "pubgRoyalePass",
  "freeFire", "honorOfKings", "genshinImpact", "uid", "roblox", "walletBadge", "topupId",
  "PUBG Royale Pass | AZIEL 1Tap Shop", "Wallet - AZIEL"
]);
const fail = message => { throw new Error(`G.2.3 full translation verification failed: ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

const context = { window: { AZIEL_LANG: {} } };
for (const file of ["en.js", "my.js", "th.js", "storefront-static.js"]) {
  vm.runInNewContext(read(`frontend/lang/${file}`), context, { filename: file });
}
const dictionaries = context.window.AZIEL_LANG;
const used = new Set();
const attrPattern = /data-i18n(?:-placeholder|-title|-aria-label|-aria-description|-alt)?="([^"]+)"/g;
const callPattern = /(?:\b(?:t|tr|wt|authT|supportT|rt)\s*\(\s*|AZIEL_I18N\?\.t\?\.\(\s*)["']([A-Za-z0-9_.-]+)["']/g;

for (const route of ROUTES) {
  const html = read(`frontend/${route}`);
  assert(html.includes("i18n.js"), `${route} must use the shared locale authority`);
  for (const match of html.matchAll(attrPattern)) used.add(match[1]);
}

function collectJs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJs(target);
    else if (entry.name.endsWith(".js") && !entry.name.startsWith("admin-")) {
      const source = fs.readFileSync(target, "utf8");
      for (const match of source.matchAll(callPattern)) used.add(match[1]);
    }
  }
}
collectJs(path.join(ROOT, "frontend/js"));

for (const locale of ["my", "th"]) {
  const unresolved = [];
  for (const key of used) {
    assert(typeof dictionaries.en?.[key] === "string" && dictionaries.en[key].trim(), `${key} missing in EN`);
    assert(typeof dictionaries[locale]?.[key] === "string" && dictionaries[locale][key].trim(), `${key} missing in ${locale.toUpperCase()}`);
    if (dictionaries[locale][key] === dictionaries.en[key] && !CANONICAL_KEYS.has(key)) unresolved.push(key);
  }
  assert(unresolved.length === 0, `${locale.toUpperCase()} unresolved customer strings: ${unresolved.join(", ")}`);
}

function comparableLeaves(value, prefix = "") {
  if (Array.isArray(value)) return value.flatMap((item, index) => comparableLeaves(item, `${prefix}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => comparableLeaves(item, prefix ? `${prefix}.${key}` : key));
  return typeof value === "string" && value.trim() ? [[prefix, value]] : [];
}

for (const [code, seed] of Object.entries(knowledgeSeeds)) {
  const normalized = normalizeProductKnowledge(seed);
  const english = new Map(comparableLeaves(normalized.locales.en).filter(([key]) => !key.endsWith("packageCodes")));
  for (const locale of ["my", "th"]) {
    const localized = new Map(comparableLeaves(normalized.locales[locale]).filter(([key]) => !key.endsWith("packageCodes")));
    for (const [key, englishValue] of english) {
      const value = localized.get(key);
      assert(value, `${code} ${locale}.${key} must not fall back to English`);
      assert(value !== englishValue, `${code} ${locale}.${key} must be a real translation`);
      assert(!/[<>]/.test(value), `${code} ${locale}.${key} must remain plain text`);
    }
    assert(localized.has("faq[0].question") && localized.has("faq[0].answer"), `${code} ${locale} FAQ question and answer required`);
  }
}

const runtime = read("frontend/js/i18n.js");
const allCustomerJs = fs.readdirSync(path.join(ROOT, "frontend/js"), { withFileTypes: true });
assert(!/TreeWalker|createTreeWalker/.test(runtime), "DOM text scraping is forbidden");
assert(!/MutationObserver/.test(runtime), "MutationObserver translation is forbidden");
assert(!/google\s*translate|TranslateElement/i.test(runtime), "browser translation is forbidden");
assert(runtime.includes('const LANG_KEY = "azielLanguage"'), "a second locale authority is forbidden");
assert(runtime.includes('"aziel:locale-changed"'), "live locale event must remain authoritative");
assert(runtime.includes("document.documentElement.lang"), "html lang synchronization required");
assert(runtime.includes("textContent"), "translations must use safe text rendering");
assert(!runtime.includes("innerHTML = translated"), "translated strings must not become trusted HTML");

const stage = read("frontend/js/product-detail-stage.js");
assert(stage.includes('window.addEventListener("aziel:locale-changed", renderLowerProductContent)'), "Product Knowledge must update live");
assert(!stage.includes("selectedPackage = null"), "locale changes must preserve package state");
const preferences = read("frontend/js/locale-switcher.js");
const regionBranch = preferences.match(/if \(group === "region"\) \{([\s\S]*?)\n        \}/)?.[1] || "";
assert(regionBranch && !regionBranch.includes("pending.language"), "region and language must remain independent");

const translatedCounts = Object.fromEntries(["my", "th"].map(locale => [locale,
  [...used].filter(key => dictionaries[locale][key] !== dictionaries.en[key]).length
]));
console.log(JSON.stringify({
  routes: ROUTES.length,
  customerKeysAudited: used.size,
  translatedCounts,
  unresolved: { my: 0, th: 0 },
  canonicalAllowlist: [...CANONICAL_KEYS],
  productKnowledgeRecords: Object.keys(knowledgeSeeds)
}, null, 2));
