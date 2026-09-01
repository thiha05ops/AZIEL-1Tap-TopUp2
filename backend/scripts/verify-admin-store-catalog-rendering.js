#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
assert(admin.includes('/js/admin-catalog.js?v=20260901-storefront-loading-v3'), "Admin catalog loading repair must use a fresh immutable asset URL");

async function verifyCatalogLoadingContract() {
    const calls = [];
    const states = { loading: 0, products: 0, empty: [], errors: [] };
    const context = vm.createContext({
        console,
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout,
        sessionStorage: { getItem: () => null, setItem: () => {} },
        document: {
            addEventListener: () => {},
            getElementById: () => null,
            querySelectorAll: () => [],
            querySelector: () => null
        },
        window: { addEventListener: () => {} },
        adminT: (_key, fallback) => fallback,
        escapeHtml: value => String(value || ""),
        adminFetch: async url => {
            calls.push(url);
            if (url === "/api/admin/catalog/products") {
                return { success: true, source: "database", products: [{ productCode: "mlbb" }, { productCode: "pubg" }, { productCode: "hok" }] };
            }
            const productCode = decodeURIComponent(url.split("/products/")[1].split("?")[0]);
            return { success: true, source: "database", product: { productCode } };
        }
    });
    vm.runInContext(catalog, context, { filename: "admin-catalog.js" });
    const evaluate = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
    vm.runInContext(`
        renderCatalogLoading=()=>{globalThis.__states.loading++};
        renderCatalogProducts=()=>{globalThis.__states.products++};
        renderCatalogEmpty=message=>{globalThis.__states.empty.push(message)};
        renderCatalogError=message=>{globalThis.__states.errors.push(message)};
        selectCatalogProduct=async()=>{};
    `, Object.assign(context, { __states: states }));

    vm.runInContext("setAdminCatalogStoreSelectionScope([])", context);
    await vm.runInContext("loadAdminCatalog(true)", context);
    assert.deepStrictEqual(calls, [], "Empty normal Storefront scope must perform no canonical catalog request");
    assert.equal(states.loading, 0, "Empty normal Storefront scope must not render a loading skeleton");
    assert.deepStrictEqual(evaluate("catalogProducts"), []);
    assert.equal(vm.runInContext("selectedCatalogProductCode", context), "");
    assert.equal(vm.runInContext("selectedCatalogProduct", context), null);
    assert.deepStrictEqual(states.empty, ["No products found"]);

    calls.length = 0;
    vm.runInContext("setAdminCatalogStoreSelectionScope(['mlbb','pubg'])", context);
    await vm.runInContext("loadAdminCatalog(true)", context);
    assert.deepStrictEqual(calls, [
        "/api/admin/catalog/products/mlbb?customerMarket=TH",
        "/api/admin/catalog/products/pubg?customerMarket=TH"
    ], "Normal Storefront must use exact selected canonical product reads");
    assert.deepStrictEqual(evaluate("catalogProducts.map(product=>product.productCode)"), ["mlbb", "pubg"]);
    assert(!vm.runInContext("catalogProducts.some(product=>product.productCode==='hok')", context), "Unselected canonical products must not leak");

    calls.length = 0;
    vm.runInContext("setAdminCatalogStoreSelectionScope(null)", context);
    await vm.runInContext("loadAdminCatalog(true)", context);
    assert.deepStrictEqual(calls, ["/api/admin/catalog/products"], "Advanced Commerce must retain the full canonical read");
    assert.deepStrictEqual(evaluate("catalogProducts.map(product=>product.productCode)"), ["mlbb", "pubg", "hok"]);

    calls.length = 0;
    states.errors.length = 0;
    context.adminFetch = async url => { calls.push(url); return null; };
    vm.runInContext("setAdminCatalogStoreSelectionScope(['mlbb'])", context);
    await vm.runInContext("loadAdminCatalog(true)", context);
    assert.deepStrictEqual(states.errors, ["Catalog data unavailable"], "Null responses must render a deterministic error");

    states.errors.length = 0;
    context.adminFetch = async () => { throw new Error("request timeout"); };
    await vm.runInContext("loadAdminCatalog(true)", context);
    assert.deepStrictEqual(states.errors, ["request timeout"], "Thrown request failures must render a deterministic error");

    return { emptyScopeRequests: 0, selectedScopeRequests: 2, advancedFullRead: true, nullFailureTerminal: true, thrownFailureTerminal: true };
}

verifyCatalogLoadingContract().then(loadingContract => console.log(JSON.stringify({
    result: "PASS",
    normalProductsAuthority: "StoreCatalogSelection",
    normalProductsEmptyState: "No Store Catalog products yet.",
    normalStorefrontAuthority: "StoreCatalogSelection",
    normalStorefrontEmptyState: "Add a Store Catalog product first.",
    productActivationOverwrite: false,
    canonicalEditorLocation: "Advanced Settings > Commerce System",
    addProductMasterCatalogPreserved: true,
    loadingContract,
    writes: 0,
    supplierCalls: 0
}, null, 2))).catch(error => {
    console.error(error);
    process.exit(1);
});
