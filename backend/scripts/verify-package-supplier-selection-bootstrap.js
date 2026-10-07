"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    createPackageSupplierSelectionBootstrapService,
    projectBootstrapPlan
} = require("../services/packageSupplierSelectionBootstrapService");
const { projectProductReadyPublication } = require("../services/productReadyPublicationService");

const clone = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const future = "2099-01-01T00:00:00.000Z";
const adapter = calls => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true, createOrder: async () => { calls.count += 1; } });

function fixture() {
    const product = { _id: "product-1", productCode: "game", name: "Game", enabled: true, deletedAt: null, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE", lifecycleStatus: "ACTIVE", supportedRegions: ["TH", "MM"], updatedAt: "2026-01-01T00:00:00.000Z" };
    const packages = ["READY", "DISABLED", "MISSING"].map((packageCode, index) => ({ _id: `package-${index}`, productCode: "game", packageCode, name: packageCode, enabled: packageCode !== "DISABLED", deletedAt: null, prices: { TH: { amount: 10, currency: "THB", enabled: true }, MM: { amount: 100, currency: "MMK", enabled: true } }, updatedAt: "2026-01-01T00:00:00.000Z" }));
    const mappings = ["READY", "DISABLED"].map((packageCode, index) => ({ _id: `mapping-${index}`, supplierId: "supplier-1", supplierCode: "FIXTURE", productCode: "game", packageCode, supplierProductCode: "native-product", supplierPackageCode: `native-${packageCode}`, supplierCatalogOfferId: `offer-${index}`, region: "GLOBAL", enabled: packageCode !== "DISABLED", archivedAt: null, executionMode: "API", productionRole: "DISABLED", fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", version: 1 }, mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true } }, updatedAt: "2026-01-01T00:00:00.000Z" }));
    return {
        product,
        packages,
        storeSelections: [{ _id: "store-1", productCode: "game", supplierId: "supplier-1", supplierCode: "FIXTURE", supplierMarket: "GLOBAL", sellingRegions: ["TH", "MM"], visibleRegions: ["TH", "MM"], status: "ACTIVE", decisionVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z", packages: mappings.map(row => ({ packageCode: row.packageCode, supplierProductMappingId: row._id })) }],
        selections: [],
        mappings,
        suppliers: [{ _id: "supplier-1", supplierCode: "FIXTURE", enabled: true, mode: "API", configurationStatus: "CONFIGURED", updatedAt: "2026-01-01T00:00:00.000Z" }],
        offers: mappings.map((row, index) => ({ _id: `offer-${index}`, supplierId: "supplier-1", supplierProductCode: "native-product", supplierOfferCode: row.supplierPackageCode, catalogLifecycleState: "ACTIVE", sourceRevision: "1", rawSnapshotHash: `hash-${index}`, updatedAt: "2026-01-01T00:00:00.000Z" })),
        availability: mappings.map((row, index) => ({ _id: `availability-${index}`, supplierCatalogOfferId: row.supplierCatalogOfferId, state: "AVAILABLE", staleAt: future, observedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })),
        publications: []
    };
}

async function verify() {
    let checks = 0;
    const ok = (condition, message) => { assert(condition, message); checks += 1; };
    const calls = { count: 0 };
    const base = fixture();
    const projected = projectBootstrapPlan(base, { markets: ["TH", "MM"], adapterFor: () => adapter(calls) });
    ok(projected.markets.TH.packages.find(row => row.packageCode === "READY").state === "SAFE_TO_CREATE", "exact ready provenance is safe in TH");
    ok(projected.markets.MM.packages.find(row => row.packageCode === "READY").state === "SAFE_TO_CREATE", "GLOBAL mapping is independently safe in MM");
    ok(projected.markets.TH.packages.find(row => row.packageCode === "DISABLED").state === "BLOCKED", "disabled mapping remains blocked");
    ok(projected.markets.TH.packages.find(row => row.packageCode === "MISSING").blockers.includes("STORE_CATALOG_MAPPING_AUTHORITY_MISSING"), "missing exact offer provenance is blocked");

    const thOnly = fixture();
    thOnly.mappings[0].fulfillmentEligibility = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", version: 1 };
    const thOnlyPlan = projectBootstrapPlan(thOnly, { markets: ["TH", "MM"], adapterFor: () => adapter(calls) });
    ok(thOnlyPlan.markets.TH.packages.find(row => row.packageCode === "READY").state === "SAFE_TO_CREATE", "TH allowlist permits TH");
    ok(thOnlyPlan.markets.MM.packages.find(row => row.packageCode === "READY").state === "INELIGIBLE", "TH allowlist rejects MM");
    const mmOnly = fixture();
    mmOnly.mappings[0].fulfillmentEligibility = { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM"], evidenceCode: "PROVIDER_CONFIRMED", version: 1 };
    const mmOnlyPlan = projectBootstrapPlan(mmOnly, { markets: ["TH", "MM"], adapterFor: () => adapter(calls) });
    ok(mmOnlyPlan.markets.TH.packages.find(row => row.packageCode === "READY").state === "INELIGIBLE", "MM allowlist rejects TH");
    ok(mmOnlyPlan.markets.MM.packages.find(row => row.packageCode === "READY").state === "SAFE_TO_CREATE", "MM allowlist permits MM");

    const same = fixture();
    same.selections.push({ _id: "selection-same", productCode: "game", packageCode: "READY", customerMarket: "TH", supplierMappingId: "mapping-0", decisionVersion: 1 });
    ok(projectBootstrapPlan(same, { markets: ["TH"], adapterFor: () => adapter(calls) }).markets.TH.packages.find(row => row.packageCode === "READY").state === "ALREADY_SELECTED", "same selection is idempotent");
    const different = fixture();
    different.selections.push({ _id: "selection-other", productCode: "game", packageCode: "READY", customerMarket: "TH", supplierMappingId: "mapping-other", decisionVersion: 4 });
    ok(projectBootstrapPlan(different, { markets: ["TH"], adapterFor: () => adapter(calls) }).markets.TH.packages.find(row => row.packageCode === "READY").state === "PROTECTED_EXISTING_SELECTION", "different explicit selection is protected");
    const ambiguous = fixture();
    ambiguous.mappings.push({ ...clone(ambiguous.mappings[0]), _id: "mapping-other", supplierId: "supplier-2", supplierCode: "OTHER", supplierCatalogOfferId: "offer-other", supplierPackageCode: "other-ready" });
    ambiguous.storeSelections.push({ ...clone(ambiguous.storeSelections[0]), _id: "store-2", supplierId: "supplier-2", supplierCode: "OTHER", packages: [{ packageCode: "READY", supplierProductMappingId: "mapping-other" }] });
    ok(projectBootstrapPlan(ambiguous, { markets: ["TH"], adapterFor: () => adapter(calls) }).markets.TH.packages.find(row => row.packageCode === "READY").state === "AMBIGUOUS", "disagreeing durable authorities are ambiguous");

    const state = fixture();
    const audits = [];
    const pricesBefore = clone(state.packages.map(row => row.prices));
    const mappingsBefore = clone(state.mappings);
    const offersBefore = clone(state.offers);
    const availabilityBefore = clone(state.availability);
    const service = createPackageSupplierSelectionBootstrapService({}, {
        loadAuthority: async ({ markets }) => ({ ...clone(state), selections: clone(state.selections.filter(row => markets.includes(row.customerMarket))) }),
        getSupplierAdapter: () => adapter(calls),
        createSelection: async document => { const saved = { _id: `selection-${state.selections.length + 1}`, ...clone(document) }; state.selections.push(saved); return saved; },
        writeAdminAudit: async input => { audits.push(clone(input)); },
        transaction: async callback => { const snapshot = clone(state.selections); try { return await callback({ fixture: true }); } catch (error) { state.selections = snapshot; throw error; } }
    });
    const initial = await service.plan({ productCode: "game", markets: ["TH"] });
    const applied = await service.apply({ productCode: "game", markets: ["TH"], marketPlanTokens: { TH: initial.markets.TH.marketPlanToken } }, { actor: { username: "owner" } });
    ok(applied.markets.TH.status === "APPLIED" && applied.markets.TH.created === 1, "safe apply creates one exact selection");
    ok(state.selections[0].supplierMappingId === "mapping-0" && state.selections[0].customerMarket === "TH", "created selection retains exact mapping and market");
    ok(audits.length === 1 && audits[0].session.fixture === true, "audit shares selection transaction");
    const replayPlan = await service.plan({ productCode: "game", markets: ["TH"] });
    const replay = await service.apply({ productCode: "game", markets: ["TH"], marketPlanTokens: { TH: replayPlan.markets.TH.marketPlanToken } }, { actor: { username: "owner" } });
    ok(replay.markets.TH.created === 0 && replay.markets.TH.counts.ALREADY_SELECTED === 1 && state.selections.length === 1, "replay is idempotent");
    assert.deepStrictEqual(state.packages.map(row => row.prices), pricesBefore); checks += 1;
    assert.deepStrictEqual(state.publications, []); checks += 1;
    assert.deepStrictEqual(state.mappings, mappingsBefore); checks += 1;
    assert.deepStrictEqual(state.offers, offersBefore); checks += 1;
    assert.deepStrictEqual(state.availability, availabilityBefore); checks += 1;

    const staleState = fixture();
    let staleWrites = 0;
    const staleService = createPackageSupplierSelectionBootstrapService({}, { loadAuthority: async () => clone(staleState), getSupplierAdapter: () => adapter(calls), createSelection: async () => { staleWrites += 1; }, writeAdminAudit: async () => {}, transaction: async callback => callback({}) });
    const stalePlan = await staleService.plan({ productCode: "game", markets: ["TH"] });
    staleState.mappings[0].enabled = false;
    const staleResult = await staleService.apply({ productCode: "game", markets: ["TH"], marketPlanTokens: { TH: stalePlan.markets.TH.marketPlanToken } });
    ok(staleResult.markets.TH.status === "CONFLICT" && staleWrites === 0, "stale token conflicts before writes");

    const raceState = fixture();
    const raceService = createPackageSupplierSelectionBootstrapService({}, { loadAuthority: async () => clone(raceState), getSupplierAdapter: () => adapter(calls), createSelection: async () => { throw Object.assign(new Error("duplicate"), { code: 11000 }); }, writeAdminAudit: async () => {}, transaction: async callback => callback({}) });
    const racePlan = await raceService.plan({ productCode: "game", markets: ["TH"] });
    const race = await raceService.apply({ productCode: "game", markets: ["TH"], marketPlanTokens: { TH: racePlan.markets.TH.marketPlanToken } });
    ok(race.markets.TH.status === "CONFLICT" && race.markets.TH.created === 0, "unique-index race is a safe conflict");

    const rollbackState = fixture();
    const rollbackService = createPackageSupplierSelectionBootstrapService({}, { loadAuthority: async () => clone(rollbackState), getSupplierAdapter: () => adapter(calls), createSelection: async document => { rollbackState.selections.push(document); return document; }, writeAdminAudit: async () => { throw new Error("audit failure"); }, transaction: async callback => { const snapshot = clone(rollbackState.selections); try { return await callback({}); } catch (error) { rollbackState.selections = snapshot; throw error; } } });
    const rollbackPlan = await rollbackService.plan({ productCode: "game", markets: ["TH"] });
    const rollback = await rollbackService.apply({ productCode: "game", markets: ["TH"], marketPlanTokens: { TH: rollbackPlan.markets.TH.marketPlanToken } });
    ok(rollback.markets.TH.status === "FAILED" && rollbackState.selections.length === 0, "audit failure rolls back created selections");

    const readyData = { ...clone(base), publications: [], selections: [] };
    const beforeReady = projectProductReadyPublication(readyData, { markets: ["TH"], adapterFor: () => adapter(calls), storeCatalogMode: "EXPLICIT" });
    readyData.selections.push({ productCode: "game", packageCode: "READY", customerMarket: "TH", supplierMappingId: "mapping-0", decisionVersion: 1 });
    const afterReady = projectProductReadyPublication(readyData, { markets: ["TH"], adapterFor: () => adapter(calls), storeCatalogMode: "EXPLICIT" });
    ok(beforeReady.markets.TH.blockedPackages.find(row => row.packageCode === "READY").blockers.some(row => row.code === "PACKAGE_SUPPLIER_SELECTION_REQUIRED"), "Product Ready blocks a missing selection");
    ok(afterReady.markets.TH.readyPackages.some(row => row.packageCode === "READY"), "Product Ready becomes ready only after selection when all other gates pass");

    const routes = read("backend/routes/catalog.js");
    const ui = read("frontend/js/admin-catalog.js");
    const addProduct = read("backend/services/supplierCatalog/addProductFinalizationService.js");
    ok(routes.includes("supplier-selection-bootstrap-plan") && routes.includes("supplier-selection-bootstrap-apply"), "admin plan/apply API exists");
    const normalMerchandising = ui.slice(ui.indexOf("function renderOperationalPackageRows"), ui.indexOf("function renderCatalogMerchandisingPanel"));
    ok(!normalMerchandising.includes("renderCatalogSupplierSetup") && !normalMerchandising.includes("renderCatalogMarketAvailability") && !normalMerchandising.includes("Publish Ready"), "normal merchandising renders status without setup/publication ceremony");
    ok(normalMerchandising.includes("Live ${counts.LIVE} · Blocked ${counts.BLOCKED} · Total ${joined.length}"), "operator counts use one non-overlapping sellability denominator");
    const checkboxHandler = ui.slice(ui.indexOf('detail.querySelectorAll("[data-bulk-package-select]")'), ui.indexOf('bindCatalogBulkActionBar(detail, product);', ui.indexOf('detail.querySelectorAll("[data-bulk-package-select]")')));
    ok(checkboxHandler.includes("syncCatalogBulkSelectionUi") && !checkboxHandler.includes("renderCatalogDetail(product)"), "package checkbox scroll-preservation remains intact");
    ok(addProduct.includes("getPackageSupplierSelectionBootstrapPlan") && addProduct.includes("applyPackageSupplierSelectionBootstrapPlan") && addProduct.includes("packageSupplierSelectionWrites"), "Add Product reuses bootstrap authority without duplicate validation");
    ok(calls.count === 0, "zero provider/network requests");

    console.log(JSON.stringify({ result: "PASS", checks, writes: state.selections.length, providerRequests: calls.count, publicationWrites: 0, priceWrites: 0 }, null, 2));
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
