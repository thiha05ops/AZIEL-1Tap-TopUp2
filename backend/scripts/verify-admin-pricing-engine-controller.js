"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const source = read("frontend/js/admin-pricing-engine.js");
const html = read("frontend/admin.html");
assert(html.includes('id="section-pricing-engine"'), "Daily Pricing section is required.");
assert(html.includes('id="section-pricing-settings"'), "Pricing Settings section is required.");
assert(source.includes("const daily ="), "Daily Pricing must own isolated state.");
assert(source.includes("const settings ="), "Pricing Settings must own isolated state.");
assert(source.includes("daily.previewController?.abort()"), "Preview requests must cancel stale work.");
assert(source.includes("if (seq !== daily.previewSeq) return"), "Stale responses must be ignored.");
assert(source.includes("daily.edits.set"), "Supplier cost edits must update explicit state.");
assert(source.includes("daily.publishing = false;"), "Publish controls must restore after settlement.");
assert(!source.includes("FALLBACK_PRODUCT"), "Production bootstrap must not use demo fallback products.");
console.log("Admin Pricing Engine V3 controller verification passed.");
