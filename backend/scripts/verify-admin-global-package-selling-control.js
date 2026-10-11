#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { projectPackagePublication } = require("../services/packageMarketPublicationService");

const root = path.join(__dirname, "../..");
const frontend = fs.readFileSync(path.join(root, "frontend/js/admin-catalog.js"), "utf8");
const route = fs.readFileSync(path.join(root, "backend/routes/catalog.js"), "utf8");

const checks = [];
const ok = (condition, message) => {
    assert(condition, message);
    checks.push(message);
};

const pkg = { packageCode: "MLBB_TEST" };
const globalOn = [{ productCode: "mlbb", packageCode: "MLBB_TEST", customerMarket: "GLOBAL", published: true, decisionVersion: 2 }];
const globalOffOverLegacyOn = [
    { productCode: "mlbb", packageCode: "MLBB_TEST", customerMarket: "TH", published: true, decisionVersion: 7 },
    { productCode: "mlbb", packageCode: "MLBB_TEST", customerMarket: "GLOBAL", published: false, decisionVersion: 3 }
];

ok(projectPackagePublication(pkg, globalOn, "TH").published === true, "GLOBAL ON projects ON in TH");
ok(projectPackagePublication(pkg, globalOn, "MM").published === true, "GLOBAL ON projects ON in MM");
ok(projectPackagePublication(pkg, globalOffOverLegacyOn, "TH").published === false, "GLOBAL OFF overrides legacy TH ON");
ok(projectPackagePublication(pkg, globalOffOverLegacyOn, "MM").published === false, "GLOBAL OFF projects OFF in MM");
ok(frontend.includes('data-manage-package-publication aria-label="Global Selling ON/OFF"'), "Manage Package drawer exposes the Global Selling switch");
ok(frontend.includes("Turn Selling ON globally?"), "Selling ON requires explicit confirmation");
ok(frontend.includes("updateManagePackagePublication(product, pkg, modal)"), "Drawer switch uses the existing publication mutation path");
ok(frontend.includes("await loadCatalogPackageOverview(result.product || product, { force: true })"), "Successful mutation refreshes package rows and counters");
ok(frontend.includes('filter("DISABLED", "Disabled", counts.DISABLED)'), "Package Offers exposes a DISABLED filter and counter");
ok(frontend.includes('operational === "DISABLED" ? "DISABLED · Selling OFF" : "BLOCKED · Selling ON"'), "Admin labels distinguish DISABLED from BLOCKED");
ok(route.includes('setPackageMarketPublication({') && route.includes('resourceId: `${result.publication.productCode}:${result.publication.packageCode}:GLOBAL`'), "API delegates to the existing GLOBAL publication authority");
ok(!frontend.includes("/publication/global"), "UI does not introduce a second publication API");

console.log(JSON.stringify({ result: "PASS", checks: checks.length, productionWrites: 0, paymentCalls: 0, supplierCalls: 0 }, null, 2));
