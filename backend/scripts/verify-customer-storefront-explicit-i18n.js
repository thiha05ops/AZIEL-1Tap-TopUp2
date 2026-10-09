#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const focusPages = [
  "home.html", "product.html", "checkout.html",
  "payment-method.html", "payment.html", "tracking.html", "login.html", "register.html",
  "forgot-password.html", "reset-password.html", "verify-otp.html", "support.html",
  "wallet.html", "coming-soon.html"
];

const dictionaries = {};
for (const locale of ["en", "my", "th"]) {
  const context = { window: { AZIEL_LANG: {} } };
  const file = path.join(root, "frontend/lang/runtime", `${locale}.js`);
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  dictionaries[locale] = context.window.AZIEL_LANG[locale];
}
const keys = Object.keys(dictionaries.en || {});
const failures = [];
const coverageDebt = [];

for (const locale of ["en", "my", "th"]) {
  for (const key of keys) {
    if (typeof dictionaries[locale]?.[key] !== "string" || !dictionaries[locale][key].trim()) {
      failures.push(`${locale}: missing ${key}`);
    }
  }
}

const attributePattern = /data-i18n(?:-placeholder|-title|-aria-label|-aria-description|-alt)?="([^"]+)"/g;
for (const page of focusPages) {
  const source = fs.readFileSync(path.join(root, "frontend", page), "utf8");
  for (const match of source.matchAll(attributePattern)) {
    for (const locale of ["en", "my", "th"]) {
      if (typeof dictionaries[locale]?.[match[1]] !== "string" || !dictionaries[locale][match[1]].trim()) {
        coverageDebt.push(`${page}: ${match[1]} missing in ${locale}`);
      }
    }
  }
  if (!source.includes("locale-loader.js") || !source.includes("i18n.js")) failures.push(`${page}: canonical locale runtime is not loaded`);
  if (source.includes("lang/storefront-static.js")) failures.push(`${page}: storefront-static.js must not be a browser runtime authority`);
}

const jsRoots = [path.join(root, "frontend/js")];
const jsFiles = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.name.endsWith(".js") && !entry.name.startsWith("admin-")) jsFiles.push(target);
  }
}
jsRoots.forEach(collect);
const callPattern = /(?:\b(?:t|tr|wt|authT|supportT|rt)\s*\(\s*|AZIEL_I18N\?\.t\?\.\(\s*)["']([A-Za-z0-9_.-]+)["']/g;
for (const file of jsFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(callPattern)) {
    for (const locale of ["en", "my", "th"]) {
      if (typeof dictionaries[locale]?.[match[1]] !== "string" || !dictionaries[locale][match[1]].trim()) {
        coverageDebt.push(`${path.relative(root, file)}: ${match[1]} missing in ${locale}`);
      }
    }
  }
}

const i18nSource = fs.readFileSync(path.join(root, "frontend/js/i18n.js"), "utf8");
if (/TreeWalker|createTreeWalker/.test(i18nSource)) failures.push("i18n.js: DOM text scraping is forbidden");

if (failures.length) {
  console.error(`Customer storefront i18n verification failed (${failures.length})`);
  console.error([...new Set(failures)].join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  result: "PASS",
  authority: "frontend/lang/runtime/{en,my,th}.js",
  routes: focusPages.length,
  runtimeKeys: keys.length,
  infrastructureFailures: 0,
  translationCoverageDebt: [...new Set(coverageDebt)].length
}, null, 2));
