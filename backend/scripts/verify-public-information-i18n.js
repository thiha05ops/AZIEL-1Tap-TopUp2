#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const pages = [
  "frontend/about.html", "frontend/contact.html", "frontend/faq.html", "frontend/help.html",
  "frontend/product-unavailable.html", "frontend/support.html", "frontend/policies/privacy.html",
  "frontend/policies/terms.html", "frontend/policies/payment.html", "frontend/policies/refund.html",
  "frontend/policies/support.html"
];
const localeSources = ["frontend/lang/en.js", "frontend/lang/my.js", "frontend/lang/th.js", "frontend/lang/storefront-static.js"];
const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
for (const source of localeSources) {
  vm.runInNewContext(fs.readFileSync(path.join(root, source), "utf8"), sandbox, { filename: source });
}
const catalogs = sandbox.window.AZIEL_LANG;
const failures = [];
const keys = new Set();
const attrPattern = /data-i18n(?:-placeholder|-aria-label|-title|-content)?=["']([^"']+)["']/g;

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  let match;
  while ((match = attrPattern.exec(html))) keys.add(match[1]);
  if (!/locale-loader\.js/.test(html) || !/locale-switcher\.js/.test(html)) {
    failures.push(`${page}: missing shared locale loader or language selector`);
  }
  if (/\/lang\/(?:en|my|th)\.js/.test(html)) failures.push(`${page}: directly loads a canonical catalog`);
}

const analyticsUi = fs.readFileSync(path.join(root, "frontend/js/analytics.js"), "utf8");
let analyticsMatch;
while ((analyticsMatch = attrPattern.exec(analyticsUi))) keys.add(analyticsMatch[1]);

for (const key of [...keys].sort()) {
  for (const language of ["en", "my", "th"]) {
    const value = catalogs?.[language]?.[key];
    if (typeof value !== "string" || !value.trim()) failures.push(`${language}: missing or empty ${key}`);
  }
}

const intentionalSharedValues = new Set([
  "about.hero.brandLine", "about.promise.line1", "about.promise.line2", "about.promise.line3",
  "contact.options.discord.label", "contact.options.telegram.label", "faqPage.items.13.answerAfter",
  "footerCopyright", "help.contact.telegram", "tagline"
]);
for (const language of ["my", "th"]) {
  for (const key of keys) {
    if (!intentionalSharedValues.has(key) && catalogs[language][key] === catalogs.en[key]) {
      failures.push(`${language}: unintended English fallback at ${key}`);
    }
  }
}

const policyPages = pages.filter((page) => page.includes("/policies/"));
for (const page of policyPages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
    if (!/data-i18n=["']info\.legalEnglishOnlyNotice["']/.test(html)) {
      failures.push(`${page}: missing English-only legal translation notice`);
    }
  const elementPattern = /<([a-z][\w-]*)\b[^>]*data-i18n=["'](policy\.[^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = elementPattern.exec(html))) {
    const sourceText = match[3].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    if (sourceText && catalogs.en[match[2]] !== sourceText) {
      failures.push(`${page}: English legal source mismatch for ${match[2]}`);
    }
  }
}

const i18nRuntime = fs.readFileSync(path.join(root, "frontend/js/i18n.js"), "utf8");
for (const route of ["/policies/privacy", "/policies/terms", "/policies/payment", "/policies/refund", "/policies/support"]) {
  if (!i18nRuntime.includes(`"${route}"`)) failures.push(`English-only legal route missing from i18n guard: ${route}`);
}
if (!/startsWith\(["']policy\.["']\)/.test(i18nRuntime) || !/AZIEL_LANG\?\.en/.test(i18nRuntime) || !/setAttribute\(["']lang["'], ["']en["']\)/.test(i18nRuntime)) {
  failures.push("English-only legal presentation guard is incomplete");
}

const expectedSlogan = {
  "about.hero.brandLine": "1 TAP. TOP UP. DONE.",
  "about.promise.line1": "1 TAP.", "about.promise.line2": "TOP UP.", "about.promise.line3": "DONE."
};
for (const [key, expected] of Object.entries(expectedSlogan)) {
  for (const language of ["en", "my", "th"]) if (catalogs[language][key] !== expected) failures.push(`${language}: official slogan changed at ${key}`);
}

const faq = fs.readFileSync(path.join(root, "frontend/faq.html"), "utf8");
const questionCount = (faq.match(/faqPage\.items\.\d+\.question/g) || []).length;
if (questionCount !== 28) failures.push(`FAQ expected 28 localized questions, found ${questionCount}`);
const faqJs = fs.readFileSync(path.join(root, "frontend/js/faq.js"), "utf8");
if (!/aziel:languageChanged/.test(faqJs) || !/aria-expanded/.test(faqJs)) failures.push("FAQ live search/accordion accessibility hooks missing");

const routes = fs.readFileSync(path.join(root, "backend/config/storefrontRouteContract.js"), "utf8");
for (const route of ["/about", "/contact", "/faq", "/help", "/support", "/policies/privacy", "/policies/terms", "/policies/payment", "/policies/refund", "/policies/support"]) {
  if (!routes.includes(`\"${route}\"`) && !routes.includes(`'${route}'`)) failures.push(`canonical route not found: ${route}`);
}

for (const language of ["en", "my", "th"]) {
  const runtimePath = path.join(root, `frontend/lang/runtime/${language}.js`);
  if (!fs.existsSync(runtimePath)) failures.push(`runtime locale bundle missing: ${language}`);
  else {
    const runtimeSandbox = { window: {} };
    runtimeSandbox.window.window = runtimeSandbox.window;
    vm.runInNewContext(fs.readFileSync(runtimePath, "utf8"), runtimeSandbox, { filename: runtimePath });
    for (const key of keys) if (runtimeSandbox.window.AZIEL_LANG?.[language]?.[key] !== catalogs[language][key]) failures.push(`${language}: stale runtime value for ${key}`);
  }
}

if (failures.length) {
  console.error(`FAIL public information i18n (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PASS public information i18n: ${pages.length} pages, ${keys.size} referenced keys, 3 locales, 28 FAQ items.`);
