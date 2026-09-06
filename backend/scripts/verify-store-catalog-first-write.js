#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createStoreCatalogSelectionService, StoreCatalogSelectionError } = require("../services/storeCatalogSelectionService");
const supplierRouter = require("../routes/supplier");

const clone = value => JSON.parse(JSON.stringify(value));
const ids = {
    supplier: "6a8d9acc7021dad826b6d873",
    mappings: ["6a94fec6591c7120027da868", "6a94fec7591c7120027da86c", "6a94fec8591c7120027da870"],
    offers: ["offer-1007", "offer-102", "offer-1084"]
};
const packageRows = [
    ["MC_MLBB_1007_156_DIAMONDS_83C0D0F9", "1007 + 156 Diamonds", "1007_156_diamonds"],
    ["MC_MLBB_102_10_DIAMONDS_1FAD53D5", "102 + 10 Diamonds", "102_10_diamonds"],
    ["MC_MLBB_1084_DIAMONDS_D9B23820", "1084 Diamonds", "1084_diamonds"]
];

function initialState() {
    return {
        selections: [],
        product: { _id: "product-mlbb", productCode: "mlbb", enabled: false, deletedAt: new Date().toISOString(), lifecycleStatus: "RETIRED", supportedRegions: ["GLOBAL"] },
        supplier: { _id: ids.supplier, supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, mode: "API" },
        mappings: packageRows.map(([packageCode, _name, supplierPackageCode], index) => ({
            _id: ids.mappings[index], productCode: "mlbb", packageCode, supplierId: ids.supplier,
            supplierCode: "FAZERCARDS", region: "GLOBAL", supplierProductCode: "mobile_legends_global", supplierPackageCode,
            supplierCatalogOfferId: ids.offers[index], enabled: false, productionRole: "DISABLED", executionMode: "API", archivedAt: null,
            fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "fixture", verifiedAt: new Date().toISOString(), version: 1 },
            mappingMetadata: { readiness: { supplierMapped: true, pricingReady: false, inputReady: true, validationReady: true, fulfillmentReady: true, storefrontReady: false } }
        })),
        offers: packageRows.map(([_packageCode, _name, supplierOfferCode], index) => ({
            _id: ids.offers[index], supplierId: ids.supplier, supplierCatalogProductId: "supplier-product-mlbb", supplierProductCode: "mobile_legends_global", supplierOfferCode, catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH"
        })),
        supplierProducts: [{ _id: "supplier-product-mlbb", supplierId: ids.supplier, supplierProductCode: "mobile_legends_global", supplierMarketCode: "GLOBAL", supportState: "SUPPORTED", rawSnapshotHash: "a".repeat(64), normalizedInputContract: { fields: [{ customerField: "playerId", providerField: "player_id", required: true }] } }],
        availability: ids.offers.map((supplierCatalogOfferId, index) => ({ _id: `availability-${index}`, supplierCatalogOfferId, state: "AVAILABLE", coverageComplete: true, observedAt: new Date().toISOString(), staleAt: null })),
        packages: packageRows.map(([packageCode, name]) => ({ productCode: "mlbb", packageCode, name, deletedAt: null })),
        prices: [], publications: [], supplierCalls: 0, nextSelectionId: 1
    };
}

function matches(row, filter = {}) {
    return Object.entries(filter).every(([key, expected]) => {
        const actual = row[key];
        if (expected && typeof expected === "object" && "$in" in expected) return expected.$in.map(String).includes(String(actual));
        return expected === null ? actual == null : String(actual) === String(expected);
    });
}

function query(sessionOperation, execute) {
    return {
        activeSession: null,
        session(session) { this.activeSession = session; return this; },
        then(resolve, reject) { return this.lean().then(resolve, reject); },
        async lean() {
            const session = this.activeSession;
            if (session) {
                if (session.operationActive) throw Object.assign(new Error("parallel same-session operation"), { code: 117, codeName: "ConflictingOperationInProgress" });
                session.operationActive = true;
            }
            try {
                await Promise.resolve();
                if (session) session.operations.push(sessionOperation);
                return execute();
            } finally {
                if (session) session.operationActive = false;
            }
        }
    };
}

function fixture(state, options = {}) {
    const models = {
        Supplier: { findOne: filter => query("Supplier.findOne", () => matches(state.supplier, filter) ? clone(state.supplier) : null) },
        Mapping: { find: filter => query("Mapping.find", () => clone(state.mappings.filter(row => matches(row, filter)))) },
        Offer: { find: filter => query("Offer.find", () => clone(state.offers.filter(row => matches(row, filter)))) },
        SupplierProduct: { find: filter => query("SupplierProduct.find", () => clone(state.supplierProducts.filter(row => matches(row, filter)))) },
        Availability: { find: filter => query("Availability.find", () => clone(state.availability.filter(row => matches(row, filter)))) },
        Package: {
            find: filter => query("Package.find", () => clone(state.packages.filter(row => matches(row, filter)))),
            updateMany: (_filter, update, options = {}) => query("Package.updateMany", () => { state.packages.forEach(row => Object.assign(row, clone(update.$set))); return { modifiedCount: state.packages.length }; }).session(options.session)
        },
        Product: {
            findOne: filter => query("Product.findOne", () => matches(state.product, filter) ? clone(state.product) : null),
            updateOne: (_filter, update, options = {}) => query("Product.updateOne", () => { Object.assign(state.product, clone(update.$set)); return { modifiedCount: 1 }; }).session(options.session)
        }, Publication: {},
        Selection: {
            findOne: filter => query("Selection.findOne", () => clone(state.selections.find(row => matches(row, filter)) || null)),
            findOneAndUpdate: (filter, update, options = {}) => {
                const operation = query("Selection.findOneAndUpdate", () => {
                let row = state.selections.find(item => matches(item, filter));
                if (!row) {
                    row = { _id: `selection-${state.nextSelectionId++}` };
                    state.selections.push(row);
                }
                Object.assign(row, clone(update.$set));
                return clone(row);
                });
                if (options.session) operation.session(options.session);
                return operation;
            }
        }
    };
    const transaction = async callback => {
        const before = clone(state);
        const session = { operationActive: false, operations: [] };
        try {
            const result = await callback(session);
            if (options.failAfterCallback) throw new Error("forced commit failure after upsert");
            state.lastOperations = [...session.operations];
            return result;
        } catch (error) {
            Object.keys(state).forEach(key => delete state[key]);
            Object.assign(state, before);
            throw error;
        }
    };
    return { service: createStoreCatalogSelectionService(models, { adapterResolver: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true }), processorSupportResolver: () => true }), transaction };
}

const input = {
    productCode: "mlbb", supplierMarket: "GLOBAL", supplierId: ids.supplier,
    sellingRegions: ["TH", "MM"], mappingIds: ids.mappings, expectedDecisionVersion: 0
};

async function main() {
    const source = fs.readFileSync(path.resolve(__dirname, "../services/storeCatalogSelectionService.js"), "utf8");
    const routeSource = fs.readFileSync(path.resolve(__dirname, "../routes/supplier.js"), "utf8");
    const callback = source.slice(source.indexOf("return transaction(async session"), source.indexOf("async function removePackage"));
    assert(!/Promise\.(all|allSettled|race|any)\s*\(/.test(callback), "Parallel execution reintroduced into Store Catalog transaction callback");
    assert(routeSource.includes("/admin/store-catalog-selections/:selectionId/selling-regions"), "Existing Store Catalog selections must expose a selling-market mutation endpoint.");
    assert(routeSource.includes("STORE_CATALOG_SELLING_MARKETS_CHANGED"), "Selling-market changes must be audited.");

    const state = initialState();
    const beforeMappings = clone(state.mappings), beforePrices = clone(state.prices), beforePublications = clone(state.publications);
    const { service, transaction } = fixture(state);
    const result = await service.save(input, { actor: { username: "owner" }, transaction });
    assert.equal(result.created, true);
    assert.equal(state.selections.length, 1);
    const selection = state.selections[0];
    assert.equal(selection.productCode, "mlbb");
    assert.equal(selection.supplierId, ids.supplier);
    assert.equal(selection.supplierCode, "FAZERCARDS");
    assert.equal(selection.supplierMarket, "GLOBAL");
    assert.deepStrictEqual(selection.sellingRegions, ["MM", "TH"]);
    assert.deepStrictEqual(selection.visibleRegions, []);
    assert.deepStrictEqual(selection.packages.map(row => String(row.supplierProductMappingId)).sort(), [...ids.mappings].sort());
    assert.deepStrictEqual(state.mappings.map(row => row.fulfillmentEligibility.allowedCustomerMarkets), [["TH"], ["TH"], ["TH"]], "TH+MM Store Catalog commerce scope must not manufacture MM supplier eligibility.");
    const firstWriteSummary = { created: true, count: 1, productCode: selection.productCode, supplierCode: selection.supplierCode, supplierMarket: selection.supplierMarket, sellingRegions: [...selection.sellingRegions], selectedMappings: selection.packages.length, visibleRegions: [...selection.visibleRegions] };
    assert.deepStrictEqual(state.mappings, beforeMappings);
    assert.deepStrictEqual(state.prices, beforePrices);
    assert.deepStrictEqual(state.publications, beforePublications);
    assert.equal(state.supplierCalls, 0);
    assert.deepStrictEqual(state.lastOperations, ["Supplier.findOne", "Mapping.find", "Selection.findOne", "Offer.find", "Product.findOne", "Package.find", "SupplierProduct.find", "Availability.find", "Product.updateOne", "Package.updateMany", "Selection.findOneAndUpdate"]);

    const existingPackages = clone(selection.packages);
    const existingMappings = clone(state.mappings);
    const existingPrices = clone(state.prices);
    const existingPublications = clone(state.publications);
    let marketResult = await service.setSellingRegions({
        selectionId: selection._id,
        sellingRegions: ["TH"],
        expectedDecisionVersion: selection.decisionVersion
    }, { actor: { username: "owner" } });
    assert.deepStrictEqual(marketResult.selection.sellingRegions, ["TH"]);
    assert.deepStrictEqual(marketResult.selection.visibleRegions, []);
    assert.deepStrictEqual(marketResult.selection.packages, existingPackages);
    assert.deepStrictEqual(state.mappings, existingMappings);
    assert.deepStrictEqual(state.prices, existingPrices);
    assert.deepStrictEqual(state.publications, existingPublications);

    marketResult = await service.setSellingRegions({
        selectionId: selection._id,
        sellingRegions: ["TH", "MM"],
        expectedDecisionVersion: marketResult.selection.decisionVersion
    }, { actor: { username: "owner" } });
    assert.deepStrictEqual(marketResult.selection.sellingRegions, ["MM", "TH"]);
    assert.deepStrictEqual(marketResult.selection.visibleRegions, []);
    const visibleResult = await service.setRegionVisibility({
        selectionId: selection._id,
        region: "MM",
        visible: true,
        expectedDecisionVersion: marketResult.selection.decisionVersion
    }, { actor: { username: "owner" } });
    assert.deepStrictEqual(visibleResult.selection.visibleRegions, ["MM"]);
    marketResult = await service.setSellingRegions({
        selectionId: selection._id,
        sellingRegions: ["TH"],
        expectedDecisionVersion: visibleResult.selection.decisionVersion
    }, { actor: { username: "owner" } });
    assert.deepStrictEqual(marketResult.selection.sellingRegions, ["TH"]);
    assert.deepStrictEqual(marketResult.selection.visibleRegions, [], "Removing a selling market must preserve visibleRegions subset invariant.");
    assert.deepStrictEqual(marketResult.selection.packages, existingPackages);
    assert.deepStrictEqual(state.mappings, existingMappings);
    assert.deepStrictEqual(state.prices, existingPrices);
    assert.deepStrictEqual(state.publications, existingPublications);

    await assert.rejects(
        () => service.setSellingRegions({ selectionId: selection._id, sellingRegions: ["ID"], expectedDecisionVersion: marketResult.selection.decisionVersion }),
        error => error instanceof StoreCatalogSelectionError && error.code === "STORE_SELECTION_SELLING_MARKETS_INVALID"
    );

    await assert.rejects(
        () => service.save(input, { actor: { username: "owner" }, transaction }),
        error => error instanceof StoreCatalogSelectionError && error.code === "STORE_SELECTION_STALE"
    );
    assert.equal(state.selections.length, 1);

    const invalidState = initialState();
    const invalidFixture = fixture(invalidState);
    await assert.rejects(
        () => invalidFixture.service.save({ ...input, mappingIds: [...ids.mappings, "missing-mapping"] }, { transaction: invalidFixture.transaction }),
        error => error instanceof StoreCatalogSelectionError && error.code === "STORE_SELECTION_SCOPE_MISMATCH"
    );
    assert.equal(invalidState.selections.length, 0);

    const rollbackState = initialState();
    const rollbackFixture = fixture(rollbackState, { failAfterCallback: true });
    await assert.rejects(() => rollbackFixture.service.save(input, { transaction: rollbackFixture.transaction }), /forced commit failure/);
    assert.equal(rollbackState.selections.length, 0);

    const logs = [];
    const audit = await supplierRouter._test.recordStoreSelectionAudit(
        { result, actor: { username: "owner" }, req: { method: "POST", originalUrl: "/api/admin/store-catalog-selections" } },
        { auditWriter: async () => { throw Object.assign(new Error("password=unsafe mongodb+srv://user:pass@example/test"), { code: 91, codeName: "ShutdownInProgress" }); }, logger: (...args) => logs.push(args) }
    );
    assert.deepStrictEqual(audit, { auditRecorded: false, auditWarning: "STORE_SELECTION_AUDIT_LOG_FAILED" });
    assert.equal(logs.length, 1);
    assert(!JSON.stringify(logs).includes("user:pass"));
    assert(!JSON.stringify(logs).includes("password=unsafe"));

    console.log(JSON.stringify({
        result: "PASS",
        firstWrite: firstWriteSummary,
        sellingMarkets: { expandable: true, removable: true, visibilitySubsetPreserved: true, mappingsChanged: 0, pricesChanged: 0, publicationsChanged: 0 },
        transaction: { operations: state.lastOperations, parallelSameSessionOperations: 0, retained: true },
        staleDecisionRejected: true,
        validationFailureSelectionCount: invalidState.selections.length,
        postUpsertFailureRolledBack: true,
        auditFailureResponse: { selectionSuccessPreserved: true, ...audit, diagnosticsSanitized: true },
        authorityChanges: { mappings: 0, prices: 0, publications: 0, fulfillment: 0 },
        supplierCalls: 0,
        productionWrites: 0
    }, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
