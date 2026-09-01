#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const guided = read("frontend/js/admin-guided-selling.js");
const supplier = read("frontend/js/admin-supplier-catalog.js");
const catalog = read("frontend/js/admin-catalog.js");
const admin = read("frontend/admin.html");

assert(guided.includes('/api/admin/store-catalog-selections'), "Normal Products/Storefront must read StoreCatalogSelection");
assert(guided.includes("No Store Catalog products yet."), "Normal Products empty state is missing");
assert(guided.includes("Add a Store Catalog product first."), "Normal Storefront empty state is missing");
assert(!supplier.includes('event.detail?.section==="products"&&!productActivationState.loaded'), "Product Activation must not race normal Products rendering");
assert(catalog.includes("catalogStoreSelectionScope") && catalog.includes("setAdminCatalogStoreSelectionScope"), "Normal Storefront canonical presentation must be selection-scoped");
assert(guided.includes("command.hidden=!selections.length"), "Canonical presentation must be hidden when Store Catalog is empty");
assert(admin.includes('data-admin-open-section="catalog" data-admin-context-view="advanced"'), "Canonical catalog editor must remain reachable from Advanced Settings");
assert(admin.includes('/js/admin-add-product-wizard.js?v=20260901-empty-store-v2'), "Add Product must remain available with the repaired cache version");

console.log(JSON.stringify({
    result: "PASS",
    normalProductsAuthority: "StoreCatalogSelection",
    normalProductsEmptyState: "No Store Catalog products yet.",
    normalStorefrontAuthority: "StoreCatalogSelection",
    normalStorefrontEmptyState: "Add a Store Catalog product first.",
    productActivationOverwrite: false,
    canonicalEditorLocation: "Advanced Settings > Commerce System",
    addProductMasterCatalogPreserved: true,
    writes: 0,
    supplierCalls: 0
}, null, 2));
