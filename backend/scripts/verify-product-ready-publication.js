"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    createProductReadyPublicationService,
    projectProductReadyPublication
} = require("../services/productReadyPublicationService");
const publicationService = require("../services/packageMarketPublicationService");

const clone = value => JSON.parse(JSON.stringify(value));
const future = "2099-01-01T00:00:00.000Z";
const productCode = "fixture-product";

function mapping(code, { enabled = true } = {}) {
    return {
        _id: `mapping-${code}`,
        supplierId: "supplier-1",
        supplierCode: "FIXTURE",
        productCode,
        packageCode: code,
        supplierProductCode: "native-product",
        supplierPackageCode: `native-${code}`,
        supplierCatalogOfferId: `offer-${code}`,
        region: "GLOBAL",
        enabled,
        archivedAt: null,
        executionMode: "API",
        fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", version: 1 },
        mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true, pricingReady: true } }
    };
}

function pkg(packageCode, { enabled = true, th = 10, mm = 20 } = {}) {
    return { productCode, packageCode, name: packageCode, enabled, deletedAt: null, prices: { TH: th == null ? null : { enabled: true, amount: th }, MM: mm == null ? null : { enabled: true, amount: mm } } };
}

function fixture() {
    const packages = [
        pkg("READY"),
        pkg("PUBLIC_TH"),
        pkg("DISABLED", { enabled: false }),
        pkg("NO_MM_PRICE", { mm: null }),
        pkg("NO_SELECTION"),
        pkg("NOT_READY"),
        pkg("NO_MAPPING"),
        pkg("NO_STORE")
    ];
    const mappingRows = packages.filter(item => !["NO_MAPPING", "NO_SELECTION"].includes(item.packageCode)).map(item => mapping(item.packageCode, { enabled: item.packageCode !== "NOT_READY" }));
    const selectedCodes = ["READY", "PUBLIC_TH", "DISABLED", "NO_MM_PRICE", "NOT_READY", "NO_STORE"];
    return {
        product: { productCode, enabled: true, deletedAt: null, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE", lifecycleStatus: "ACTIVE", supportedRegions: ["GLOBAL"] },
        packages,
        mappings: mappingRows,
        suppliers: [{ _id: "supplier-1", supplierCode: "FIXTURE", enabled: true, mode: "API" }],
        offers: mappingRows.map(item => ({ _id: item.supplierCatalogOfferId, supplierId: item.supplierId, supplierProductCode: item.supplierProductCode, supplierOfferCode: item.supplierPackageCode, catalogLifecycleState: "ACTIVE" })),
        availability: mappingRows.map(item => ({ supplierCatalogOfferId: item.supplierCatalogOfferId, state: "AVAILABLE", staleAt: future })),
        selections: ["TH", "MM"].flatMap(market => selectedCodes.map(code => ({ productCode, packageCode: code, customerMarket: market, supplierMappingId: `mapping-${code}`, decisionVersion: 1 }))),
        publications: [{ productCode, packageCode: "PUBLIC_TH", customerMarket: "TH", published: true, decisionVersion: 2 }],
        storeSelections: [{ productCode, status: "ACTIVE", sellingRegions: ["TH", "MM"], visibleRegions: ["TH", "MM"], packages: packages.filter(item => item.packageCode !== "NO_STORE").map(item => ({ packageCode: item.packageCode, supplierProductMappingId: `mapping-${item.packageCode}` })) }]
    };
}

function adapter() {
    return { isConfigured: () => true, isAutoFulfillmentEnabled: () => true };
}

async function verify() {
    let checks = 0;
    const ok = (condition, message) => { assert(condition, message); checks += 1; };
    const state = fixture();
    const projection = projectProductReadyPublication(state, { markets: ["TH", "MM"], adapterFor: adapter, storeCatalogMode: "EXPLICIT" });
    const th = projection.markets.TH, mm = projection.markets.MM;
    ok(th.readyPackages.some(item => item.packageCode === "READY"), "TH ready package planned");
    ok(mm.readyPackages.some(item => item.packageCode === "READY"), "MM ready package planned independently");
    ok(th.publicPackages.some(item => item.packageCode === "PUBLIC_TH") && !mm.publicPackages.some(item => item.packageCode === "PUBLIC_TH"), "already-public state is market-specific");
    ok(th.blockedPackages.find(item => item.packageCode === "DISABLED").blockers.some(item => item.code === "PACKAGE_DISABLED"), "disabled package blocked");
    ok(mm.blockedPackages.find(item => item.packageCode === "NO_MM_PRICE").blockers.some(item => item.code === "NO_VALID_PRICE"), "missing market price blocked");
    ok(th.blockedPackages.find(item => item.packageCode === "NO_SELECTION").blockers.some(item => item.code === "PACKAGE_SUPPLIER_SELECTION_REQUIRED"), "missing selection blocked");
    ok(th.blockedPackages.find(item => item.packageCode === "NOT_READY").blockers.some(item => item.code === "MAPPING_DISABLED"), "non-selectable mapping blocked");
    ok(th.blockedPackages.find(item => item.packageCode === "NO_STORE").blockers.some(item => item.code === "STORE_CATALOG_AUTHORITY_REQUIRED"), "missing Store Catalog authority blocked");
    ok(th.blockedPackages.find(item => item.packageCode === "NO_MAPPING").blockers.some(item => item.code === "NO_EXACT_SUPPLIER_MAPPING"), "canonical package without mapping included and blocked");

    const writes = [], audits = [];
    const beforeSelections = clone(state.selections), beforeMappings = clone(state.mappings), beforePackages = clone(state.packages);
    const service = createProductReadyPublicationService({}, {
        loadAuthority: async () => clone(state),
        adapterFor: adapter,
        storeCatalogMode: () => "EXPLICIT",
        transaction: async callback => {
            const snapshot = clone(state.publications);
            try { return await callback({ fixture: true }); }
            catch (error) { state.publications = snapshot; throw error; }
        },
        batchPublish: async input => {
            writes.push(clone(input));
            input.packages.forEach(item => state.publications.push({ productCode, packageCode: item.packageCode, customerMarket: input.customerMarket, published: true, decisionVersion: item.expectedDecisionVersion + 1 }));
            return { packageCodes: input.packages.map(item => item.packageCode) };
        },
        audit: async input => { audits.push(clone(input)); }
    });
    const plan = await service.plan({ productCode, markets: ["TH", "MM"] });
    const apply = await service.apply({ productCode, markets: ["TH", "MM"], marketPlanTokens: { TH: plan.markets.TH.marketPlanToken, MM: plan.markets.MM.marketPlanToken } }, { actor: { username: "owner" } });
    ok(apply.markets.TH.status === "APPLIED" && apply.markets.MM.status === "APPLIED", "both markets apply independently");
    const expectedReadyByMarket = { TH: new Set(plan.markets.TH.readyPackages.map(item => item.packageCode)), MM: new Set(plan.markets.MM.readyPackages.map(item => item.packageCode)) };
    ok(writes.length === 2 && writes.every(write => write.packages.every(item => expectedReadyByMarket[write.customerMarket].has(item.packageCode))), "only ready unpublished packages batch-written");
    const blockedByMarket = { TH: new Set(plan.markets.TH.blockedPackages.map(item => item.packageCode)), MM: new Set(plan.markets.MM.blockedPackages.map(item => item.packageCode)) };
    ok(!writes.some(write => write.packages.some(item => blockedByMarket[write.customerMarket].has(item.packageCode))), "blocked packages never written");
    ok(writes.every(write => write.session?.fixture === true), "batch writes receive transaction session");
    ok(audits.length === 2 && audits.every(item => item.session?.fixture === true), "batch audit shares transaction session");
    ok(audits.every(item => !Object.keys(item.metadata).some(key => /packages|supplier|price|mapping/i.test(key))), "audit summary remains bounded");
    assert.deepStrictEqual(state.selections, beforeSelections); checks += 1;
    assert.deepStrictEqual(state.mappings, beforeMappings); checks += 1;
    assert.deepStrictEqual(state.packages, beforePackages); checks += 1;

    async function verifyStaleMutation(label, mutate) {
        const staleState = fixture();
        let staleWrites = 0;
        const staleService = createProductReadyPublicationService({}, { loadAuthority: async () => clone(staleState), adapterFor: adapter, storeCatalogMode: () => "EXPLICIT", transaction: async callback => callback({}), batchPublish: async () => { staleWrites += 1; }, audit: async () => {} });
        const stalePlan = await staleService.plan({ productCode, markets: ["TH"] });
        mutate(staleState);
        const changedPlan = await staleService.plan({ productCode, markets: ["TH"] });
        ok(changedPlan.markets.TH.marketPlanToken !== stalePlan.markets.TH.marketPlanToken, `${label} changes market token`);
        const staleApply = await staleService.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: stalePlan.markets.TH.marketPlanToken } });
        ok(staleApply.markets.TH.status === "CONFLICT" && staleWrites === 0, `${label} conflicts with zero writes`);
    }
    await verifyStaleMutation("availability state", state => { state.availability.find(item => item.supplierCatalogOfferId === "offer-READY").state = "UNAVAILABLE"; });
    await verifyStaleMutation("supplier offer lifecycle", state => { state.offers.find(item => item._id === "offer-READY").catalogLifecycleState = "INACTIVE"; });
    await verifyStaleMutation("supplier API readiness", state => { state.suppliers[0].enabled = false; });
    await verifyStaleMutation("selected mapping readiness", state => { state.mappings.find(item => item.packageCode === "READY").mappingMetadata.readiness.inputReady = false; });
    const featureState = fixture();
    let featureEnabled = true, featureWrites = 0;
    const featureAdapter = () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => featureEnabled });
    const featureService = createProductReadyPublicationService({}, { loadAuthority: async () => clone(featureState), adapterFor: featureAdapter, storeCatalogMode: () => "EXPLICIT", transaction: async callback => callback({}), batchPublish: async () => { featureWrites += 1; }, audit: async () => {} });
    const featurePlan = await featureService.plan({ productCode, markets: ["TH"] });
    featureEnabled = false;
    const changedFeaturePlan = await featureService.plan({ productCode, markets: ["TH"] });
    ok(featurePlan.markets.TH.marketPlanToken !== changedFeaturePlan.markets.TH.marketPlanToken, "local feature-gate change changes market token");
    const featureApply = await featureService.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: featurePlan.markets.TH.marketPlanToken } });
    ok(featureApply.markets.TH.status === "CONFLICT" && featureWrites === 0, "local feature-gate change conflicts with zero writes");

    const marketScopedState = fixture();
    const thReady = marketScopedState.mappings.find(item => item.packageCode === "READY");
    const mmReady = { ...clone(thReady), _id: "mapping-READY-MM", supplierCatalogOfferId: "offer-READY-MM", supplierPackageCode: "native-READY-MM" };
    marketScopedState.mappings.push(mmReady);
    marketScopedState.offers.push({ _id: "offer-READY-MM", supplierId: "supplier-1", supplierProductCode: "native-product", supplierOfferCode: "native-READY-MM", catalogLifecycleState: "ACTIVE" });
    marketScopedState.availability.push({ supplierCatalogOfferId: "offer-READY-MM", state: "AVAILABLE", staleAt: future });
    marketScopedState.selections.find(item => item.customerMarket === "MM" && item.packageCode === "READY").supplierMappingId = "mapping-READY-MM";
    const marketScopedService = createProductReadyPublicationService({}, { loadAuthority: async () => clone(marketScopedState), adapterFor: adapter, storeCatalogMode: () => "EXPLICIT", transaction: async callback => callback({}), batchPublish: async () => {}, audit: async () => {} });
    const beforeMarketChange = await marketScopedService.plan({ productCode, markets: ["TH", "MM"] });
    marketScopedState.offers.find(item => item._id === "offer-READY").catalogLifecycleState = "INACTIVE";
    const afterMarketChange = await marketScopedService.plan({ productCode, markets: ["TH", "MM"] });
    ok(beforeMarketChange.markets.TH.marketPlanToken !== afterMarketChange.markets.TH.marketPlanToken, "TH-selected offer change stales TH");
    ok(beforeMarketChange.markets.MM.marketPlanToken === afterMarketChange.markets.MM.marketPlanToken, "TH-only selected-offer change does not stale MM");

    const isolatedState = fixture();
    const isolatedPlan = projectProductReadyPublication(isolatedState, { markets: ["TH", "MM"], adapterFor: adapter, storeCatalogMode: "EXPLICIT" });
    const isolatedWrites = [];
    const isolatedService = createProductReadyPublicationService({}, { loadAuthority: async () => clone(isolatedState), adapterFor: adapter, storeCatalogMode: () => "EXPLICIT", transaction: async callback => callback({}), batchPublish: async input => { if (input.customerMarket === "TH") throw Object.assign(new Error("TH failure"), { code: "TH_FAILURE" }); isolatedWrites.push(input.customerMarket); }, audit: async () => {} });
    const isolatedApply = await isolatedService.apply({ productCode, markets: ["TH", "MM"], marketPlanTokens: { TH: isolatedPlan.markets.TH.marketPlanToken, MM: isolatedPlan.markets.MM.marketPlanToken } });
    ok(isolatedApply.markets.TH.status === "FAILED" && isolatedApply.markets.MM.status === "APPLIED" && isolatedWrites.join() === "MM", "TH failure does not prevent MM transaction");

    const rollbackState = fixture();
    const rollbackPlan = projectProductReadyPublication(rollbackState, { markets: ["TH"], adapterFor: adapter, storeCatalogMode: "EXPLICIT" });
    const rollbackBefore = clone(rollbackState.publications);
    const rollbackService = createProductReadyPublicationService({}, { loadAuthority: async () => clone(rollbackState), adapterFor: adapter, storeCatalogMode: () => "EXPLICIT", transaction: async callback => { const snapshot = clone(rollbackState.publications); try { return await callback({}); } catch (error) { rollbackState.publications = snapshot; throw error; } }, batchPublish: async input => input.packages.forEach(item => rollbackState.publications.push({ productCode, packageCode: item.packageCode, customerMarket: input.customerMarket, published: true })), audit: async () => { throw new Error("audit failure"); } });
    const rollbackApply = await rollbackService.apply({ productCode, markets: ["TH"], marketPlanTokens: { TH: rollbackPlan.markets.TH.marketPlanToken } });
    assert.deepStrictEqual(rollbackState.publications, rollbackBefore); checks += 1;
    ok(rollbackApply.markets.TH.status === "FAILED", "audit failure rolls back market publication transaction");

    const serviceSource = fs.readFileSync(path.join(__dirname, "../services/productReadyPublicationService.js"), "utf8");
    const primitiveSource = fs.readFileSync(path.join(__dirname, "../services/packageMarketPublicationService.js"), "utf8");
    ok(serviceSource.includes("publishPackageMarketBatch") && !serviceSource.includes("setPackageMarketPublication"), "bulk service does not call package publication service in a per-package loop");
    ok(primitiveSource.includes("model.bulkWrite(operations"), "publication primitive uses one bounded bulkWrite");
    ok(typeof publicationService.setPackageMarketPublication === "function", "existing package-level publication path remains exported");
    let primitiveCall = null;
    const primitiveResult = await publicationService.publishPackageMarketBatch({
        productCode,
        customerMarket: "TH",
        packages: [{ packageCode: "READY", expectedDecisionVersion: 0 }, { packageCode: "PUBLIC_TH", expectedDecisionVersion: 2 }],
        session: { fixture: "batch" },
        model: { bulkWrite: async (operations, options) => { primitiveCall = { operations, options }; return { matchedCount: 1, modifiedCount: 1, upsertedCount: 1 }; } }
    });
    ok(primitiveCall.operations.length === 2 && primitiveCall.options.session.fixture === "batch" && primitiveResult.packageCodes.length === 2, "batch primitive performs one session-bound bulk write");

    console.log(JSON.stringify({ result: "PASS", checks, productionWrites: 0, supplierRequests: 0, markets: ["TH", "MM"] }, null, 2));
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
