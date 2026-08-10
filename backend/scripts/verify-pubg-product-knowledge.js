#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { getStaticCatalogSnapshot } = require("../catalog/catalogProjection");
const { normalizeProductKnowledge } = require("../catalog/productKnowledge");
const { resolvePublicProductReadiness } = require("../catalog/publicProductReadiness");
const approved = require("../catalog/verifiedProductKnowledge").pubg;

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const expectedPackages = [
    ["PUBG_60_UC", "60 UC"],
    ["PUBG_300_25_UC", "300 + 25 UC"],
    ["PUBG_600_60_UC", "600 + 60 UC"],
    ["PUBG_1500_300_UC", "1500 + 300 UC"],
    ["PUBG_3000_850_UC", "3000 + 850 UC"],
    ["PUBG_6000_2100_UC", "6000 + 2100 UC"],
    ["PUBG_12000_4200_UC", "12000 + 4200 UC"],
    ["PUBG_18000_6300_UC", "18000 + 6300 UC"],
    ["PUBG_24000_8400_UC", "24000 + 8400 UC"],
    ["PUBG_30000_10500_UC", "30000 + 10500 UC"]
];

const knowledge = normalizeProductKnowledge(approved);
assert.equal(knowledge.faq.length, 4, "PUBG must have exactly four FAQs");
for (const locale of ["en", "my", "th"]) {
    const value = knowledge.locales[locale];
    assert(value.shortDescription && value.about.summary && value.about.details, `${locale} core Product Knowledge must be populated`);
    assert.equal(value.purchaseNotes.length, 3, `${locale} must have three purchase notes`);
    assert.equal(value.packageGuide.groups.length, 1, `${locale} must have one package guide group`);
    assert.equal(value.faq.length, 4, `${locale} must have four FAQs`);
    const serialized = JSON.stringify(value);
    for (const term of ["PUBG Mobile", "UC", "Player ID"]) assert(serialized.includes(term), `${locale} must preserve ${term}`);
    assert(!/<|>/.test(serialized), `${locale} must remain plain-text safe`);
    assert(!/instant delivery|guaranteed delivery|automatic fulfillment|bonus UC|refund eligibility|cancellation eligibility|reversal guarantee|supplier routing|outside MM|outside TH/i.test(serialized), `${locale} contains a prohibited claim`);
    assert(!/Royale Pass|pubgrp/i.test(serialized), `${locale} must not contain PUBG Royale Pass content`);
}

const pubgFlow = read("frontend/js/pubg.js");
assert(pubgFlow.includes('{ key: "userId", label: "PUBG Player ID", selector: "#userId", required: true'), "Player ID must remain the only configured required field");
assert(pubgFlow.includes('zoneIdSelector: ""') && pubgFlow.includes("zoneRequired: false"), "Zone ID must remain unconfigured");
assert(!/password/i.test(pubgFlow), "PUBG flow must not configure a password field");
assert.equal((pubgFlow.match(/required:\s*true/g) || []).length, 1, "PUBG flow must have exactly one required account field");

const snapshot = getStaticCatalogSnapshot();
const packages = snapshot.packages.filter(item => item.productCode === "pubg" && item.enabled !== false);
assert.deepEqual(packages.map(item => [item.packageCode, item.name]), expectedPackages, "PUBG active package identities and order must remain canonical");

const product = {
    productCode: "pubg",
    name: "PUBG Mobile UC",
    enabled: true,
    deletedAt: null,
    publicDiscoveryEnabled: true,
    commerceState: "PURCHASABLE",
    lifecycleStatus: "ACTIVE",
    productRoute: "pubg.html",
    supportedRegions: ["MM", "TH"],
    productKnowledge: knowledge
};
const commerceReadiness = {
    checks: { fulfillment: true, availability: true },
    regions: {
        MM: { fulfillment: true, availability: true },
        TH: { fulfillment: true, availability: true }
    }
};
const readiness = resolvePublicProductReadiness(product, packages, commerceReadiness);
assert.equal(readiness.regions.MM.state, "AVAILABLE", "MM readiness must remain AVAILABLE");
assert.equal(readiness.regions.TH.state, "AVAILABLE", "TH readiness must remain AVAILABLE");

const stage = read("frontend/js/product-detail-stage.js");
assert(stage.includes("resolveProductKnowledge(product.productKnowledge || {})"), "shared Product Detail must own Product Knowledge rendering");
assert(stage.includes('window.addEventListener("aziel:locale-changed", renderLowerProductContent)'), "Product Knowledge must support live locale switching");
assert(stage.includes("document.createElement(\"details\")") && stage.includes("document.createElement(\"summary\")"), "FAQ must retain native disclosure elements");
assert(!read("frontend/pubg.html").includes(approved.shortDescription), "approved Product Knowledge must not be hardcoded into pubg.html");

console.log(JSON.stringify({
    productCode: "pubg",
    activePackages: packages.length,
    faqCount: knowledge.faq.length,
    locales: ["en", "my", "th"],
    requiredAccountFields: ["userId"],
    readiness: { MM: readiness.regions.MM.state, TH: readiness.regions.TH.state }
}, null, 2));
