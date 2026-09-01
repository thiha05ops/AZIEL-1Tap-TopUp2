"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = read("frontend/admin.html");
const app = read("frontend/js/admin-app.js");
const products = read("frontend/js/admin-supplier-catalog.js");
const pricing = read("frontend/js/admin-pricing-engine.js");
const css = read("frontend/css/admin/admin-operator-workflows.css");

const topLevel = ["dashboard", "products", "pricing-engine", "orders", "fulfillment", "payments", "wallet", "users", "catalog", "admin-security", "settings", "advanced-settings"];
topLevel.forEach(section => assert(html.includes(`data-section="${section}"`), `Missing operator destination: ${section}`));
assert(html.includes('id="section-products"'));
assert(html.includes("Overview &amp; Packages"));
assert(html.includes("Pricing</button>"));
assert(html.includes("Fulfillment</button>"));
assert(html.includes("Presentation</button>"));
assert(html.indexOf('id="section-products"') < html.indexOf('id="section-supplier-catalog"'), "Products must not be buried under supplier diagnostics.");
assert(!html.includes('data-supplier-catalog-tab="activation"'), "Product Activation must not remain a supplier sub-tab.");
assert(html.includes('data-supplier-catalog-tab="overview"'));
assert(html.includes('data-admin-open-section="supplier-catalog"'), "Supplier diagnostics must remain available through Advanced Settings.");
assert(html.includes('data-supplier-catalog-tab="costs"'));
assert(html.includes('data-supplier-catalog-tab="offers"'));
assert(html.includes("raw diagnostic offer catalog"));
assert(app.includes('products: {'));
assert(app.includes("data-admin-open-section"));
assert(products.includes('event.detail?.section==="products"'));
assert(products.includes("/api/admin/product-activation?"), "Products must reuse Product Activation authority.");
assert(products.includes("/api/admin/supplier-mappings/"), "Route preparation must reuse mapping authority.");
assert(products.includes("/publication"), "Publication must reuse explicit publication command.");
assert(pricing.includes("Calculation details"), "Technical pricing evidence must be progressive disclosure.");
assert(pricing.includes("Current ") && pricing.includes("New ") && pricing.includes("pricing-change-value"));
assert(html.includes('role="tablist"'));
assert(html.includes('aria-label="Product workflow"'));
assert(css.includes("@media(max-width:600px)"));
assert(css.includes("operator-filter-bar"));

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepStrictEqual([...new Set(duplicateIds)], [], `Duplicate Admin IDs: ${duplicateIds.join(", ")}`);

console.log(JSON.stringify({
    result: "PASS",
    operatorDestinations: topLevel.length,
    productActivationIsPrimaryWorkspace: true,
    supplierRawCatalogIsSecondary: true,
    existingAuthoritiesReused: true,
    explicitPublicationPreserved: true,
    technicalEvidenceProgressive: true,
    responsiveFilters: true,
    duplicateIds: 0,
    productionWrites: 0,
    supplierCalls: 0
}, null, 2));
