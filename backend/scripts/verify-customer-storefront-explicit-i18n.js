#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const focusPages = [
  "home.html", "mlbb.html", "pubg.html", "pubg-rp.html", "freefire.html", "hok.html",
  "genshin.html", "roblox.html", "telegram.html", "product.html", "checkout.html",
  "payment-method.html", "payment.html", "tracking.html", "login.html", "register.html",
  "forgot-password.html", "reset-password.html", "verify-otp.html", "support.html",
  "wallet.html", "coming-soon.html"
];

const context = { window: { AZIEL_LANG: {} } };
for (const file of ["en.js", "my.js", "th.js", "storefront-static.js"]) {
  vm.runInNewContext(fs.readFileSync(path.join(root, "frontend/lang", file), "utf8"), context, { filename: file });
}
const dictionaries = context.window.AZIEL_LANG;
const keys = Object.keys(dictionaries.en || {});
const failures = [];

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
        failures.push(`${page}: ${match[1]} missing in ${locale}`);
      }
    }
  }
  if (!source.includes("lang/storefront-static.js?v=20260809-g21-explicit")) {
    failures.push(`${page}: missing current storefront-static script`);
  }
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
        failures.push(`${path.relative(root, file)}: ${match[1]} missing in ${locale}`);
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

console.log(`Customer storefront explicit-key verification passed: ${focusPages.length} routes, ${keys.length} complete EN/MY/TH keys.`);
