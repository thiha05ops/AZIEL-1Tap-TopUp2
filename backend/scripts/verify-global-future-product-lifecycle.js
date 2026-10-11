#!/usr/bin/env node
"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { evaluatePackageSupplierCandidates } = require("../services/packageSupplierCandidateService");
const { createPackageSupplierSelectionService } = require("../services/packageSupplierSelectionService");
const { projectPackagePublication } = require("../services/packageMarketPublicationService");
const { createRoutingAuthority, selectedRouteSnapshot } = require("../services/supplierProductionSelectionService");
const { ensurePaidOrderFulfillmentWork, supplierApiIdempotencyKey } = require("../services/paidFulfillmentRoutingService");
const { contractFingerprint } = require("../services/suppliers/fazercardsFulfillmentContractService");

const now = new Date("2031-01-01T00:00:00.000Z");
const mappingId = new mongoose.Types.ObjectId();
const supplierId = new mongoose.Types.ObjectId();
const offerId = new mongoose.Types.ObjectId();
const product = { productCode: "future-game", name: "Future Game", enabled: true, deletedAt: null, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE" };
const pkg = { productCode: "future-game", packageCode: "FUTURE_100", name: "100 Credits", enabled: true, deletedAt: null, prices: { TH: { amount: 79, currency: "THB", enabled: true }, MM: { amount: 9800, currency: "MMK", enabled: true } } };
const fulfillmentContract = { version: 1, decisionVersion: 1, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", transactionalServiceCode: "", supplierProductCode: "future_game_global", sourceSupplierCatalogProductId: "future-catalog-product", sourceHash: "fixture-source", sourceOfferHash: "fixture-offer", authorityScope: "PRODUCT", noCustomerInput: false, fields: [{ customerField: "playerId", providerField: "player_id", required: true, label: "Player ID", type: "numeric-text", options: [], constraints: {}, evidenceReference: "fixture", transformationId: "DIRECT" }, { customerField: "serverId", providerField: "server_id", required: true, label: "Server ID", type: "numeric-text", options: [], constraints: {}, evidenceReference: "fixture", transformationId: "DIRECT" }] };
fulfillmentContract.fingerprint = contractFingerprint(fulfillmentContract);
const mapping = { _id: mappingId, supplierId, supplierCode: "FAZERCARDS", productCode: product.productCode, packageCode: pkg.packageCode, supplierProductCode: "future_game_global", supplierPackageCode: "future_100_native", supplierCatalogOfferId: offerId, region: "GLOBAL", enabled: true, archivedAt: null, productionRole: "PRIMARY", executionMode: "API", supplierCostAuthority: { rawSupplierCost: 1, supplierCurrency: "USD", capturedAt: now }, mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true }, costAuthorityMaximumAgeSeconds: 86400 * 36500, fulfillmentContract }, fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "isolated fixture", verifiedAt: now, version: 1 } };
const supplier = { _id: supplierId, supplierCode: "FAZERCARDS", name: "FazerCards", enabled: true, mode: "API" };
const offer = { _id: offerId, supplierId, supplierProductCode: mapping.supplierProductCode, supplierOfferCode: mapping.supplierPackageCode, catalogLifecycleState: "ACTIVE", supplierCost: { amount: 1, currency: "USD", observedAt: now } };
const availability = { supplierCatalogOfferId: offerId, state: "AVAILABLE", observedAt: now, staleAt: new Date("2032-01-01T00:00:00.000Z") };
const adapterFor = () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true });
const query = value => ({ session() { return this; }, async lean() { return value; } });

async function main() {
    let selection = null;
    const auditRows = [];
    const selectionService = createPackageSupplierSelectionService({
        Product: { findOne: () => query(product) }, Package: { findOne: () => query(pkg) }, Mapping: { findById: () => query(mapping) },
        Supplier: { findById: () => query(supplier) }, Offer: { findById: () => query(offer) }, Availability: { findOne: () => query(availability) },
        Selection: {
            findOne: () => query(selection),
            async create(rows) { selection = { _id: new mongoose.Types.ObjectId(), ...rows[0], toObject() { const { toObject, ...value } = this; return value; } }; return [selection]; }
        }
    }, {
        getSupplierAdapter: adapterFor,
        transaction: callback => callback({ isolated: true }),
        writeAdminAudit: async row => auditRows.push(row)
    });

    const before = evaluatePackageSupplierCandidates({ productCode: product.productCode, packageCode: pkg.packageCode, customerMarket: "TH", product, storeCatalogMember: true, pkg, publication: { published: false }, selection: null, mappings: [mapping], suppliers: [supplier], offers: [offer], availabilityRows: [availability], adapterFor, marketPaymentReady: true });
    assert.strictEqual(before.candidates.length, 1);
    assert.strictEqual(before.candidates[0].readiness.selectable, true, JSON.stringify(before.candidates[0].readiness.blockerCodes));
    assert.strictEqual(before.effectiveState.state, "DISABLED");

    const selected = await selectionService({ productCode: product.productCode, packageCode: pkg.packageCode, customerMarket: "TH", supplierMappingId: String(mappingId), expectedDecisionVersion: 0, reason: "isolated future product owner decision" }, { actor: { username: "owner-fixture" } });
    assert.strictEqual(selected.selection.customerMarket, "GLOBAL");
    assert.strictEqual(selected.selection.supplierMappingId, String(mappingId));
    assert.strictEqual(auditRows.length, 1);

    const publicationRecord = { productCode: product.productCode, packageCode: pkg.packageCode, customerMarket: "GLOBAL", published: true, decisionVersion: 1 };
    const thPublication = projectPackagePublication(pkg, [publicationRecord], "TH");
    const mmPublication = projectPackagePublication(pkg, [publicationRecord], "MM");
    const projection = market => evaluatePackageSupplierCandidates({ productCode: product.productCode, packageCode: pkg.packageCode, customerMarket: market, product, storeCatalogMember: true, pkg, publication: market === "TH" ? thPublication : mmPublication, selection, mappings: [mapping], suppliers: [supplier], offers: [offer], availabilityRows: [availability], adapterFor, marketPaymentReady: true });
    const th = projection("TH"); const mm = projection("MM");
    assert.strictEqual(th.effectiveState.state, "LIVE"); assert.strictEqual(mm.effectiveState.state, "LIVE");
    assert.deepStrictEqual(th.customerPrice, { amount: 79, currency: "THB", enabled: true, publishedPriceMode: "", supplierId: "", supplierCode: "", supplierName: "", supplierCost: null, supplierCurrency: "", supplierCostTimestamp: null });
    assert.strictEqual(mm.customerPrice.amount, 9800); assert.strictEqual(mm.customerPrice.currency, "MMK");
    assert.strictEqual(th.effectiveState.supplierMappingId, String(mappingId)); assert.strictEqual(mm.effectiveState.supplierMappingId, String(mappingId));

    const routing = createRoutingAuthority({ selectedResolver: async ({ region }) => ({ ready: true, blockers: [], routeSnapshot: selectedRouteSnapshot(mapping, selection, region), resolution: "GLOBAL_OWNER_SELECTION" }) });
    const thRoute = (await routing({ productCode: product.productCode, packageCode: pkg.packageCode, region: "TH" })).routeSnapshot;
    const mmRoute = (await routing({ productCode: product.productCode, packageCode: pkg.packageCode, region: "MM" })).routeSnapshot;
    assert.strictEqual(thRoute.supplierMappingId, mmRoute.supplierMappingId);
    assert.strictEqual(thRoute.supplierPackageCode, mmRoute.supplierPackageCode);
    assert.notStrictEqual(thRoute.customerMarket, mmRoute.customerMarket);

    const accountFields = { playerId: "123456789", serverId: "2468" };
    const order = { _id: "future-order-db", orderId: "AZL-FUTURE-1", schemaVersion: "2", commerce: { source: "QUOTE_CHECKOUT" }, status: "paid", paymentStatus: "paid", product: { gameCode: product.productCode, packageCode: pkg.packageCode }, commercial: { region: "MM", currency: "MMK", totalAmount: 9800 }, fulfilment: { status: "not_started", input: { accountFields }, routeSnapshot: mmRoute } };
    let existingAttempt = null; let supplierSubmissions = 0; let outgoingPayload = null;
    const options = {
        findAttemptByIdempotency: async key => existingAttempt?.idempotencyKey === key ? existingAttempt : null,
        startSupplierFulfillment: async (_orderId, payload) => {
            supplierSubmissions += 1;
            assert.strictEqual(payload.mappingId, String(mappingId));
            outgoingPayload = { product: mmRoute.supplierProductCode, package: mmRoute.supplierPackageCode, player_id: accountFields.playerId, server_id: accountFields.serverId, reference: payload.idempotencyKey };
            existingAttempt = { fulfillmentId: "FUL-FUTURE-1", idempotencyKey: payload.idempotencyKey, status: "SUCCEEDED", supplierReference: "MOCK-ACCEPTED-1" };
            return existingAttempt;
        }
    };
    const first = await ensurePaidOrderFulfillmentWork(order, options);
    const duplicate = await ensurePaidOrderFulfillmentWork(order, options);
    assert.strictEqual(first.reason, "SUPPLIER_FULFILLMENT_STARTED");
    assert.strictEqual(duplicate.reason, "SUPPLIER_FULFILLMENT_ALREADY_BOUND");
    assert.strictEqual(supplierSubmissions, 1);
    assert.deepStrictEqual(outgoingPayload, { product: "future_game_global", package: "future_100_native", player_id: "123456789", server_id: "2468", reference: supplierApiIdempotencyKey(order.orderId, mappingId) });

    console.log(JSON.stringify({ result: "PASS", canonicalProducts: 1, canonicalPackages: 1, discoveredCandidates: before.candidates.length, globalOwnerSelections: 1, globalSellingOn: true, th: { state: th.effectiveState.state, amount: th.customerPrice.amount, currency: th.customerPrice.currency, mappingId: th.effectiveState.supplierMappingId }, mm: { state: mm.effectiveState.state, amount: mm.customerPrice.amount, currency: mm.customerPrice.currency, mappingId: mm.effectiveState.supplierMappingId }, frozenNativeSku: mmRoute.supplierPackageCode, verifiedPaidHandoff: first.reason, mockedSupplierSubmissions: supplierSubmissions, duplicateSubmissions: 0, providerNetworkCalls: 0, productionWrites: 0 }, null, 2));
}

main().catch(error => { console.error("VERIFY_GLOBAL_FUTURE_PRODUCT_LIFECYCLE_FAILED:", error.stack || error); process.exit(1); });
