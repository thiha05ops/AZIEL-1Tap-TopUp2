#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { resolveCanonicalProductRoute } = require("../catalog/canonicalOperationalCatalog");
const { resolvePublicProductReadiness } = require("../catalog/publicProductReadiness");
const {
    resolveAdminCatalogProduct,
    resolveDatabasePackagePriceFromRows
} = require("../services/catalogService");
const {
    canonicalPricingRegions,
    workspaceSupplierCostState
} = require("../services/commerce/adminPricingControlCenterService");
const {
    activationBlockers,
    createStorePackageActivationService
} = require("../services/storePackageActivationService");
const { hasFazerCardsInputContract } = require("../services/suppliers/fazercardsInputFormatters");
const { supportsFazerCardsMapping } = require("../services/suppliers/fazercardsFulfillmentProcessor");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const productCode = "future-master-catalog-product";
const packageCode = "MC_FUTURE_PACKAGE";
const mappingId = "mapping-1";
const supplierId = "supplier-1";
const now = new Date("2026-09-01T00:00:00.000Z");
const product = {
    _id: "product-1", productCode, name: "Future Master Catalog Product", description: "A generic Master Catalog product used by the isolated onboarding verifier.",
    enabled: false, deletedAt: null, supportedRegions: [], commerceState: "HIDDEN", publicDiscoveryEnabled: false,
    lifecycleStatus: "ACTIVE", presentation: {}, seo: {}, updatedAt: now
};
const pkg = {
    _id: "package-1", productCode, packageCode, name: "100 Credits", enabled: false, deletedAt: null,
    prices: {}, updatedAt: now
};
const mapping = {
    _id: mappingId, supplierId, supplierCode: "FAZERCARDS", productCode, packageCode,
    supplierProductCode: "future_category", supplierPackageCode: "100_credits", region: "GLOBAL",
    supplierCatalogOfferId: "offer-1",
    enabled: false, productionRole: "DISABLED", executionMode: "MANUAL", archivedAt: null, updatedAt: now,
    supplierCostAuthority: { rawSupplierCost: null }, mappingMetadata: { readiness: { supplierMapped: true } },
    fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [] }
};
const selection = {
    _id: "selection-1", status: "ACTIVE", supplierId, productCode, supplierMarket: "GLOBAL",
    sellingRegions: ["TH"], visibleRegions: [], decisionVersion: 1,
    packages: [{ packageCode, supplierProductMappingId: mappingId }]
};

async function main() {
    assert.strictEqual(resolveCanonicalProductRoute(productCode), `product.html?product=${productCode}`);
    assert.strictEqual(fs.existsSync(path.join(ROOT, `frontend/${productCode}.html`)), false);

    assert.deepStrictEqual(canonicalPricingRegions(product, pkg, "TH"), []);
    assert.deepStrictEqual(canonicalPricingRegions(product, pkg, "TH", {
        allowDisabledProduct: true,
        allowDisabledPackage: true,
        preparationRegions: selection.sellingRegions
    }), ["TH"], "An exact Store Catalog selection must prepare disabled Master Catalog packages for pricing.");
    const observed = workspaceSupplierCostState(mapping, { amount: 4.25, currency: "USD" });
    assert.strictEqual(observed.previewSupplierCost, 4.25);
    assert.strictEqual(observed.provisional, false);
    assert.strictEqual(observed.status, "COST_READY");
    assert.strictEqual(mapping.supplierCostAuthority.rawSupplierCost, null, "Pricing preparation must not approve cost.");

    const adminProduct = await resolveAdminCatalogProduct(productCode, {
        findProduct: async () => product,
        findPackages: async () => [pkg],
        findMappings: async () => [mapping],
        findInventoryStates: async () => [],
        findPublications: async () => [],
        findSuppliers: async () => [{ _id: supplierId, supplierCode: "FAZERCARDS", enabled: true, mode: "API", supportedRegions: ["TH"] }],
        loadMediaMap: async () => new Map()
    });
    assert(adminProduct, "Presentation editor must resolve a persisted Master Catalog product outside the legacy page registry.");
    assert.strictEqual(adminProduct.productCode, productCode);
    assert.strictEqual(adminProduct.productRoute, `product.html?product=${productCode}`);
    assert.strictEqual(adminProduct.packages.length, 1);

    const preparedProduct = { ...product, enabled: true, supportedRegions: ["TH"], commerceState: "PURCHASABLE", publicDiscoveryEnabled: true };
    const preparedPackage = { ...pkg, enabled: true, prices: { TH: { amount: 159, currency: "THB", enabled: true } } };
    const readiness = resolvePublicProductReadiness(preparedProduct, [preparedPackage], {
        regions: { TH: { fulfillment: true, availability: true } }, checks: { availability: true }
    });
    assert.strictEqual(readiness.state, "AVAILABLE");
    assert.strictEqual(readiness.route, `product.html?product=${productCode}`);
    const checkoutPrice = resolveDatabasePackagePriceFromRows({ productCode, packageCode, region: "TH" }, {
        products: [preparedProduct], packages: [preparedPackage]
    });
    assert.strictEqual(checkoutPrice.amount, 159);
    assert.strictEqual(checkoutPrice.currency, "THB");

    const activation = createStorePackageActivationService(fakeActivationModels(), {
        adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }),
        inputContractResolver: () => true,
        mappingSupportResolver: () => true,
        preCommercialReadinessResolver: () => ({ ready: true, blockers: [] })
    });
    const activationInspection = await activation.inspect({ selectionId: selection._id, mappingId, customerMarket: "TH" });
    assert(!activationInspection.blockers.includes("CANONICAL_PACKAGE_NOT_ENABLED"), "Selected canonical records are prepared by the system, not an Owner approval blocker.");
    assert(!activationInspection.blockers.includes("APPROVED_SUPPLIER_COST_REQUIRED"));
    assert(!activationInspection.blockers.includes("CUSTOMER_MARKET_PRICE_REQUIRED"), "Start Selling must not depend on retail pricing.");
    assert(!activationInspection.blockers.includes("CUSTOMER_INPUT_CONTRACT_NOT_VERIFIED"));
    assert(!activationInspection.blockers.includes("EXACT_SUPPLIER_OFFER_UNSUPPORTED"));
    const activationReadyMapping = {
        ...mapping,
        supplierCostAuthority: { rawSupplierCost: 4.25, supplierCurrency: "USD", capturedAt: now }
    };
    const readyActivation = createStorePackageActivationService(fakeActivationModels({
        mapping: activationReadyMapping, product: preparedProduct, pkg: preparedPackage
    }), {
        adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }),
        inputContractResolver: () => true,
        mappingSupportResolver: () => true,
        preCommercialReadinessResolver: () => ({ ready: true, blockers: [] })
    });
    const readyInspection = await readyActivation.inspect({ selectionId: selection._id, mappingId, customerMarket: "TH" });
    assert.strictEqual(readyInspection.ready, true, `The existing activation command must accept a genuinely ready generic product: ${readyInspection.blockers.join(", ")}`);

    const afkMapping = { ...mapping, productCode: "afk-journey", supplierProductCode: "afk_journey" };
    assert.strictEqual(hasFazerCardsInputContract("afk-journey"), false);
    assert.strictEqual(supportsFazerCardsMapping(afkMapping), false);
    const afkBlockers = activationBlockers({
        selection: { ...selection, productCode: "afk-journey" }, mapping: afkMapping,
        supplier: { _id: supplierId, enabled: true, mode: "API" }, product: { ...preparedProduct, productCode: "afk-journey" },
        pkg: preparedPackage, offer: { _id: "offer-1", supplierId, supplierOfferCode: "100_credits", catalogLifecycleState: "ACTIVE" },
        availability: { state: "AVAILABLE", coverageComplete: true }, customerMarket: "TH", conflicts: [],
        adapter: { isConfigured: () => true, isAutoFulfillmentEnabled: () => false, autoFulfillmentGateState: () => ({ blockerCode: "SUPPLIER_PRODUCT_AUTO_FULFILLMENT_DISABLED" }) },
        preCommercial: { ready: false, blockers: ["INPUT_CONTRACT_UNRESOLVED", "PROCESSOR_UNSUPPORTED"] }
    });
    assert(afkBlockers.includes("INPUT_CONTRACT_UNRESOLVED"));
    assert(afkBlockers.includes("PROCESSOR_UNSUPPORTED"));

    const productionSources = [
        "backend/services/catalogAdminService.js",
        "backend/services/catalogService.js",
        "backend/catalog/publicProductReadiness.js",
        "backend/services/commerce/adminPricingControlCenterService.js",
        "backend/services/commerce/customerManualPromptPayCheckoutService.js",
        "backend/services/storePackageActivationService.js",
        "frontend/js/product-detail.js"
    ];
    productionSources.forEach(file => assert(!read(file).includes('productCode === "afk-journey"'), `${file} must remain product-generic.`));
    const genericFrontend = read("frontend/js/product-detail.js");
    const i18nFrontend = read("frontend/js/i18n.js");
    assert(genericFrontend.includes("AZIEL_CATALOG?.ensureFresh?."));
    assert(genericFrontend.includes("window.AZIEL_GENERIC_PRODUCT_DETAIL"));
    const identityBinding = genericFrontend.indexOf('setAttribute("data-game", productCode)');
    const asynchronousBootstrap = genericFrontend.indexOf("async function bootstrap");
    const catalogAwait = genericFrontend.indexOf("await window.AZIEL_CATALOG?.ensureFresh?.");
    assert(identityBinding >= 0, "Generic Product Detail must bind its URL-derived product identity.");
    assert(identityBinding < asynchronousBootstrap && identityBinding < catalogAwait, "Product identity must be bound before asynchronous catalog hydration.");
    assert(genericFrontend.includes('node.removeAttribute("data-i18n")'), "Runtime-owned text must release legacy translation ownership.");
    assert(genericFrontend.includes('node.removeAttribute("data-i18n-placeholder")'), "Runtime-owned placeholders must release legacy translation ownership.");
    assert(genericFrontend.includes('node.setAttribute("data-i18n-skip", "true")'), "Runtime-owned Product Detail elements must use the existing i18n skip convention.");
    assert(genericFrontend.includes('applyText("[data-product-summary-name]", name)'), "The generic Order Summary must use the resolved public product name.");
    assert(genericFrontend.includes('applyText(\'label[for="userId"]\', firstField.label)'), "The account label must use the verified public input contract.");
    assert(genericFrontend.includes('applyPlaceholder("#userId", firstField.key === "riotId" ? "Name#TAG" : `Enter ${firstField.label}`)'), "The account placeholder must use the verified public input contract.");
    assert(i18nFrontend.includes('querySelectorAll("[data-i18n]")'), "The verifier must track the translation selector used by later i18n passes.");
    assert(i18nFrontend.includes('querySelectorAll("[data-i18n-placeholder]")'), "The verifier must track the placeholder selector used by later i18n passes.");
    assert(!genericFrontend.includes("heaven-burns-red"), "Generic Product Detail must not special-case Heaven Burns Red.");

    console.log(JSON.stringify({
        result: "PASS", noDedicatedHtml: true, genericRoute: readiness.route,
        selectedPricingRows: 1, presentationResolved: true, supplierCatalogCostUsable: true,
        activationCommandReusable: true, publicProjectionAfterExplicitActivation: true,
        checkoutPriceResolved: true, afkFulfillmentReady: false,
        afkBlockers,
        productionWrites: 0, supplierCalls: 0, environmentChanges: 0
    }, null, 2));
}

function query(value) {
    return { session() { return this; }, lean: async () => value };
}

function fakeActivationModels(overrides = {}) {
    const stateMapping = overrides.mapping || mapping;
    const stateProduct = overrides.product || product;
    const statePackage = overrides.pkg || pkg;
    const offer = { _id: "offer-1", supplierId, supplierOfferCode: stateMapping.supplierPackageCode, catalogLifecycleState: "ACTIVE", sourceRevision: "r1" };
    return {
        Selection: { findOne: () => query(selection) }, Mapping: {
            findOne: () => query(stateMapping), find: () => query([])
        },
        Supplier: { findById: () => query({ _id: supplierId, enabled: true, mode: "API", updatedAt: now }) },
        Product: { findOne: () => query(stateProduct) }, Package: { findOne: () => query(statePackage) },
        Offer: { findById: () => query(offer) }, Availability: { findOne: () => query({ state: "AVAILABLE", coverageComplete: true, observedAt: now }) },
        Publication: { findOne: () => query({ published: false, decisionVersion: 0 }) }
    };
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
