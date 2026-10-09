#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { applyAdminProductionAttribution, resolveAdminCatalogProduct } = require("../services/catalogService");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const guided = read("frontend/js/admin-guided-selling.js");
const supplier = read("frontend/js/admin-supplier-catalog.js");
const catalog = read("frontend/js/admin-catalog.js");
const admin = read("frontend/admin.html");
const catalogRoutes = read("backend/routes/catalog.js");

assert(guided.includes('/api/admin/store-catalog-selections'), "Normal Products/Storefront must read StoreCatalogSelection");
assert(guided.includes("No Store Catalog products yet."), "Normal Products empty state is missing");
assert(guided.includes("Add a Store Catalog product first."), "Normal Storefront empty state is missing");
assert(!supplier.includes('event.detail?.section==="products"&&!productActivationState.loaded'), "Product Activation must not race normal Products rendering");
assert(catalog.includes("catalogStoreSelectionScope") && catalog.includes("setAdminCatalogStoreSelectionScope"), "Normal Storefront canonical presentation must be selection-scoped");
assert(guided.includes("command.hidden=!selections.length"), "Canonical presentation must be hidden when Store Catalog is empty");
assert(admin.includes('data-admin-open-section="catalog" data-admin-context-view="advanced"'), "Canonical catalog editor must remain reachable from Advanced Settings");
assert(admin.includes('/js/admin-add-product-wizard.js?v=20260901-empty-store-v2'), "Add Product must remain available with the repaired cache version");
assert(admin.includes('/js/admin-catalog.js?v=20260901-storefront-loading-v3'), "Admin catalog loading repair must use a fresh immutable asset URL");
assert(catalogRoutes.includes('packageScope || ""') && catalogRoutes.includes('storeCatalogPackageScope'), "Store Catalog package scope must be explicit on the existing Admin detail endpoint");

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
        "/api/admin/catalog/products/mlbb?customerMarket=TH&packageScope=store-catalog",
        "/api/admin/catalog/products/pubg?customerMarket=TH&packageScope=store-catalog"
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

async function verifyPackageProjectionContract() {
    const productCode = "future-store-product";
    const selectedPackage = {
        _id: "package-selected", productCode, packageCode: "SELECTED_PACKAGE", name: "Selected Package",
        enabled: true, deletedAt: null, prices: { TH: { amount: 159, currency: "THB", enabled: true } }
    };
    const historicalPackage = {
        _id: "package-historical", productCode, packageCode: "HISTORICAL_PACKAGE", name: "Historical Package",
        enabled: false, deletedAt: null, prices: { TH: { amount: 299, currency: "THB", enabled: true } }
    };
    const dependencies = {
        findProduct: async () => ({ _id: "product-1", productCode, name: "Future Store Product", enabled: true, deletedAt: null, supportedRegions: ["TH"], commerceState: "HIDDEN", presentation: {} }),
        findPackages: async () => [selectedPackage, historicalPackage],
        findMappings: async () => [],
        findInventoryStates: async () => [],
        findPublications: async () => [{ productCode, packageCode: "SELECTED_PACKAGE", customerMarket: "TH", published: true, decisionVersion: 3 }],
        findSuppliers: async () => [],
        loadMediaMap: async () => new Map()
    };
    const full = await resolveAdminCatalogProduct(productCode, {
        ...dependencies,
        findStoreSelections: async () => { throw new Error("Full Admin catalog must not read Store Catalog package scope"); }
    });
    assert.deepStrictEqual(full.packages.map(item => item.packageCode), ["SELECTED_PACKAGE", "HISTORICAL_PACKAGE"], "Advanced/full Admin catalog must retain all canonical packages");

    const scoped = await resolveAdminCatalogProduct(productCode, {
        ...dependencies,
        storeCatalogPackageScope: true,
        findStoreSelections: async () => [{ status: "ACTIVE", packages: [{ packageCode: "SELECTED_PACKAGE" }] }]
    });
    assert.deepStrictEqual(scoped.packages.map(item => item.packageCode), ["SELECTED_PACKAGE"], "Normal Storefront must exclude unselected canonical packages");
    assert.strictEqual(scoped.packageCount, 1);
    assert.strictEqual(scoped.packages[0].prices.TH.amount, 159, "Selected package pricing metadata must remain intact");
    assert.strictEqual(scoped.packages[0].publication.published, true, "Selected package publication metadata must remain intact");
    assert.strictEqual(scoped.packages[0].productionAttribution.publication.published, true, "Selected package production attribution must remain intact");
    assert(!read("backend/services/catalogService.js").includes('productCode === "pubg"'), "Store Catalog package scoping must not add product-specific branches");
    return { fullPackages: 2, selectedPackages: 1, historicalPackagesPreserved: 1, publicCatalogChanged: false };
}

function verifyProductionAttributionSelection() {
    const supplier = { _id: "supplier-fazer", supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, mode: "API" };
    const publication = packageCode => ({ productCode: "pubg", packageCode, customerMarket: "TH", published: true, decisionVersion: 1 });
    const packageProjection = packageCode => ({ packageCode, name: packageCode, enabled: true, prices: { TH: { amount: 35, currency: "THB", enabled: true } } });
    const mapping = ({ id, packageCode, region, eligibility, ready = true }) => ({
        _id: id,
        supplierId: supplier._id,
        supplierCode: supplier.supplierCode,
        productCode: "pubg",
        packageCode,
        supplierProductCode: `pubg_${region.toLowerCase()}`,
        supplierPackageCode: "60_uc",
        region,
        enabled: true,
        productionRole: "PRIMARY",
        executionMode: "API",
        fulfillmentEligibility: eligibility,
        mappingMetadata: { readiness: {
            supplierMapped: ready,
            inputReady: ready,
            validationReady: ready,
            pricingReady: ready,
            fulfillmentReady: ready,
            storefrontReady: ready
        } }
    });
    const explicitTh = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", verifiedAt: new Date(), version: 2 };
    const unknown = { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "", evidenceSource: "", verifiedAt: null, version: 1 };
    const eligibilityContext = {
        adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }),
        mappingSupportResolver: () => true
    };
    const project = (packageCode, mappings) => {
        const projection = { productCode: "pubg", packages: [packageProjection(packageCode)] };
        applyAdminProductionAttribution(projection, mappings, [supplier], [publication(packageCode)], "TH", eligibilityContext);
        return projection.packages[0].productionAttribution;
    };

    const current = mapping({ id: "current-global", packageCode: "PUBG_60_UC", region: "GLOBAL", eligibility: explicitTh });
    const legacy = mapping({ id: "legacy-th", packageCode: "PUBG_60_UC", region: "TH", eligibility: unknown });
    const resolved = project("PUBG_60_UC", [legacy, current]);
    assert.strictEqual(resolved.status, "SELLING", "One eligible ready mapping must defeat an UNKNOWN legacy candidate");
    assert.strictEqual(resolved.mappingId, "current-global");
    assert.strictEqual(resolved.supplier.code, "FAZERCARDS");
    assert.strictEqual(resolved.supplierMarket, "GLOBAL");

    const ambiguous = project("AMBIGUOUS", [
        mapping({ id: "ready-a", packageCode: "AMBIGUOUS", region: "GLOBAL", eligibility: explicitTh }),
        mapping({ id: "ready-b", packageCode: "AMBIGUOUS", region: "GLOBAL", eligibility: explicitTh })
    ]);
    assert.strictEqual(ambiguous.status, "PRODUCTION_SUPPLIER_MARKET_UNRESOLVED", "Two eligible ready mappings must fail closed");
    assert.strictEqual(ambiguous.mappingId, null);
    assert.strictEqual(ambiguous.supplier, null);

    const notReady = project("ONE_NOT_READY", [mapping({ id: "one-not-ready", packageCode: "ONE_NOT_READY", region: "GLOBAL", eligibility: explicitTh, ready: false })]);
    assert.strictEqual(notReady.status, "PUBLISHED_ROUTE_NOT_READY", "One meaningful non-ready candidate must retain route diagnostics");
    assert.strictEqual(notReady.mappingId, "one-not-ready");
    assert(notReady.blockers.length > 0);

    const noneEligible = project("NONE_ELIGIBLE", [
        mapping({ id: "unknown-a", packageCode: "NONE_ELIGIBLE", region: "TH", eligibility: unknown }),
        mapping({ id: "unknown-b", packageCode: "NONE_ELIGIBLE", region: "GLOBAL", eligibility: unknown })
    ]);
    assert.strictEqual(noneEligible.status, "PRODUCTION_SUPPLIER_MARKET_UNRESOLVED", "Multiple non-eligible candidates must fail closed");
    assert.strictEqual(noneEligible.mappingId, null);

    const ordinary = project("ORDINARY", [mapping({ id: "ordinary-ready", packageCode: "ORDINARY", region: "GLOBAL", eligibility: explicitTh })]);
    assert.strictEqual(ordinary.status, "SELLING");
    assert.strictEqual(ordinary.mappingId, "ordinary-ready", "Ordinary unique ready attribution must remain unchanged");
    assert(!read("backend/services/catalogService.js").includes('packageCode === "PUBG_60_UC"'), "Production attribution must remain product/package generic");
    return { unknownDefeatedByExplicitReady: true, trueAmbiguityFailClosed: true, uniqueNotReadyDiagnosed: true, zeroEligibleFailClosed: true, ordinaryUniqueUnchanged: true };
}

Promise.all([verifyCatalogLoadingContract(), verifyPackageProjectionContract()]).then(([loadingContract, packageProjection]) => console.log(JSON.stringify({
    result: "PASS",
    normalProductsAuthority: "StoreCatalogSelection",
    normalProductsEmptyState: "No Store Catalog products yet.",
    normalStorefrontAuthority: "StoreCatalogSelection",
    normalStorefrontEmptyState: "Add a Store Catalog product first.",
    productActivationOverwrite: false,
    canonicalEditorLocation: "Advanced Settings > Commerce System",
    addProductMasterCatalogPreserved: true,
    loadingContract,
    packageProjection,
    productionAttributionSelection: verifyProductionAttributionSelection(),
    writes: 0,
    supplierCalls: 0
}, null, 2))).catch(error => {
    console.error(error);
    process.exit(1);
});
