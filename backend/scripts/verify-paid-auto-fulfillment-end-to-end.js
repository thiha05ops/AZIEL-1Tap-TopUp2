#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { createPaidFulfillmentHandoffService } = require("../services/paidFulfillmentHandoffService");
const { ensurePaidOrderFulfillmentWork, supplierApiIdempotencyKey } = require("../services/paidFulfillmentRoutingService");
const { dispatchSubmission } = require("../services/suppliers/supplierFulfillmentDispatcher");
const { createWonddFulfillmentProcessor } = require("../services/suppliers/wonddFulfillmentProcessor");
const { createFazerCardsFulfillmentProcessor } = require("../services/suppliers/fazercardsFulfillmentProcessor");
const { contractFingerprint } = require("../services/suppliers/fazercardsFulfillmentContractService");

const clone = value => structuredClone(value);

function contract(supplierCode) {
    const value = { version: 1, decisionVersion: 1, supplierCode, protocol: supplierCode === "WONDD" ? "WONDD_GAME_ID_TOPUP" : "FAZERCARDS_TOPUPS_ORDER_V2", transactionalServiceCode: supplierCode === "WONDD" ? "mlbb" : "", supplierProductCode: supplierCode === "WONDD" ? "9622" : "mobile_legends_global", sourceSupplierCatalogProductId: "catalog-product", sourceHash: "source", sourceOfferHash: "offer", authorityScope: "PRODUCT", noCustomerInput: false, fields: [
        { customerField: "playerId", providerField: supplierCode === "WONDD" ? "gameid" : "player_id", required: true, label: "Player ID", type: "numeric-text", options: [], constraints: {}, evidenceReference: "fixture", transformationId: "DIRECT" },
        { customerField: "serverId", providerField: supplierCode === "WONDD" ? "gameid2" : "server_id", required: true, label: "Server ID", type: "numeric-text", options: [], constraints: {}, evidenceReference: "fixture", transformationId: "DIRECT" }
    ] };
    value.fingerprint = contractFingerprint(value);
    return value;
}

async function scenario(supplierCode, market, providerStatus = "SUCCEEDED") {
    const mapping = { _id: `${supplierCode}-${market}-mapping`, supplierId: `${supplierCode}-supplier`, supplierCode, productCode: "mlbb", packageCode: "MLBB-EXACT", supplierProductCode: supplierCode === "WONDD" ? "9622" : "mobile_legends_global", supplierPackageCode: `${supplierCode}-NATIVE-PACK`, region: "GLOBAL", enabled: true, executionMode: "API", mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, pricingReady: false, fulfillmentReady: true }, fulfillmentContract: contract(supplierCode) } };
    const selection = { productCode: "mlbb", packageCode: "MLBB-EXACT", customerMarket: market, supplierProductMappingId: mapping._id, decisionVersion: 1 };
    const selectionBefore = clone(selection);
    const routeSnapshot = { snapshotVersion: 2, routeType: "SUPPLIER_API", supplierMappingId: mapping._id, supplierId: mapping.supplierId, supplierCode, productCode: "mlbb", packageCode: "MLBB-EXACT", supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode, supplierMarket: "GLOBAL", customerMarket: market, executionMode: "API", selectedRole: "PACKAGE_SUPPLIER_SELECTION", fulfillmentContract: mapping.mappingMetadata.fulfillmentContract };
    const now = new Date("2030-01-01T00:00:00.000Z");
    const order = { _id: `${supplierCode}-${market}-order-db`, orderId: `AZL-${supplierCode}-${market}`, schemaVersion: 2, status: "paid", paymentStatus: "paid", commercial: { region: market }, product: { gameCode: "mlbb", packageCode: "MLBB-EXACT" }, fulfilment: { status: "not_started", input: { accountFields: [{ key: "playerId", value: "123456789" }, { key: "serverId", value: "2468" }] }, routeSnapshot, paidHandoff: { version: 1, status: "PENDING", requestedAt: now, availableAt: now, attemptCount: 0, retryable: true, claimToken: "", leaseExpiresAt: null } } };
    const attempts = new Map();
    const deferred = [];
    const payloads = [];
    const transitions = [];

    class Attempt {
        constructor(value) { Object.assign(this, value); attempts.set(String(this._id), this); }
        async save() { return this; }
        static async findById(id) { return attempts.get(String(id)) || null; }
    }
    const transition = async (_order, target) => { transitions.push(target); order.status = target === "completed" ? "completed" : target === "failed" ? "failed" : "processing"; order.fulfilment.status = target; };
    const adapter = supplierCode === "WONDD" ? {
        async submitTopup(input) { payloads.push(input); return { status: providerStatus, supplierReference: `${supplierCode}-REF`, supplierCode, providerStatus, failureCode: providerStatus === "FAILED" ? "DECLINED" : "", safeMessage: "fixture", rawMetadata: {} }; },
        async checkStatus() { return { status: providerStatus, supplierReference: `${supplierCode}-REF`, supplierCode, providerStatus, rawMetadata: {} }; }
    } : {
        async submitTopup(input) { payloads.push(input); return { status: providerStatus, supplierReference: `${supplierCode}-REF`, supplierCode, providerStatus, failureCode: providerStatus === "FAILED" ? "DECLINED" : "", safeMessage: "fixture", rawMetadata: {} }; },
        async checkStatus() { return { status: providerStatus, supplierReference: `${supplierCode}-REF`, supplierCode, providerStatus, rawMetadata: {} }; }
    };
    const processor = supplierCode === "WONDD"
        ? createWonddFulfillmentProcessor({ Attempt, Order: { findById: async () => order }, Mapping: { findById: async () => mapping }, adapter, transitionOrder: transition, schedule: callback => deferred.push(callback) })
        : createFazerCardsFulfillmentProcessor({ Attempt, Order: { findById: async () => order }, Mapping: { findById: async () => mapping }, adapter, transitionOrder: transition, schedule: callback => deferred.push(callback) });

    const repos = {
        async claim(orderId, token) { if (orderId !== order.orderId || order.fulfilment.paidHandoff.status !== "PENDING") return null; order.fulfilment.paidHandoff.status = "CLAIMED"; order.fulfilment.paidHandoff.claimToken = token; order.fulfilment.paidHandoff.attemptCount += 1; return order; },
        async complete() { order.fulfilment.paidHandoff.status = "COMPLETED"; return order; },
        async awaitingSubmission() { order.fulfilment.paidHandoff.status = "AWAITING_SUBMISSION"; return order; },
        async block(_id, _token, _time, failure) { order.fulfilment.paidHandoff.status = "BLOCKED"; order.fulfilment.paidHandoff.lastError = failure; return order; },
        async dueIds() { return order.fulfilment.paidHandoff.status === "PENDING" ? [order.orderId] : []; },
        async attemptByIdempotency(key) { return [...attempts.values()].find(item => item.idempotencyKey === key) || null; }
    };
    let submissions = 0;
    const startSupplierFulfillment = async (_orderCode, payload) => {
        assert.strictEqual(payload.supplierMappingId, mapping._id);
        const attempt = new Attempt({ _id: `${supplierCode}-${market}-attempt`, fulfillmentId: `FUL-${supplierCode}-${market}`, orderId: order._id, orderCode: order.orderId, supplierMappingId: mapping._id, supplierCodeSnapshot: supplierCode, status: "IN_PROGRESS", idempotencyKey: payload.idempotencyKey, supplierReference: "", supplierRequest: { supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode }, supplierResult: {} });
        dispatchSubmission(supplierCode, attempt._id, { processorResolver: () => processor, defer: callback => deferred.push(callback), recordFailure: async () => { throw new Error("unexpected dispatch failure"); } });
        return attempt;
    };
    const ensureWork = current => ensurePaidOrderFulfillmentWork(current, { findAttemptByIdempotency: repos.attemptByIdempotency, startSupplierFulfillment });
    const handoff = createPaidFulfillmentHandoffService({ repositories: repos, clock: () => now, ensurePaidOrderFulfillmentWork: ensureWork, dispatchSubmission: () => { submissions += 1; } });
    const first = await handoff.processOrder(order.orderId);
    assert.strictEqual(first.processed, true);
    while (deferred.length) await deferred.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(attempts.size, 1);
    assert.strictEqual(payloads.length, 1);
    assert.deepStrictEqual(selection, selectionBefore);
    assert.strictEqual(await handoff.processOrder(order.orderId).then(value => value.processed), false, "Repeated PAID handling must not create or submit again.");
    assert.strictEqual(submissions, 0);
    const payload = payloads[0];
    if (supplierCode === "WONDD") {
        assert.strictEqual(payload.serviceCode, "mlbb"); assert.strictEqual(payload.packCode, mapping.supplierPackageCode); assert.deepStrictEqual(payload.providerFields, { gameid: "123456789", gameid2: "2468" });
    } else {
        assert.strictEqual(payload.categoryId, mapping.supplierProductCode); assert.strictEqual(payload.offerId, mapping.supplierPackageCode); assert.deepStrictEqual(payload.fields, { player_id: "123456789", server_id: "2468" }); assert.strictEqual(payload.idempotencyKey, supplierApiIdempotencyKey(order.orderId, mapping._id));
    }
    assert.strictEqual(order.status, providerStatus === "FAILED" ? "failed" : "completed");
    assert.strictEqual(transitions.at(-1), providerStatus === "FAILED" ? "failed" : "completed");
    return { supplierCode, market, attempts: attempts.size, submissions: payloads.length, finalStatus: order.status };
}

(async () => {
    const results = [];
    for (const supplierCode of ["WONDD", "FAZERCARDS"]) for (const market of ["TH", "MM"]) results.push(await scenario(supplierCode, market));
    results.push(await scenario("WONDD", "TH", "FAILED"));
    results.push(await scenario("FAZERCARDS", "TH", "FAILED"));
    console.log(JSON.stringify({ result: "PASS", results, duplicateSubmissions: 0, supplierSwitches: 0, providerNetworkCalls: 0, productionWrites: 0 }, null, 2));
})().catch(error => { console.error("VERIFY_PAID_AUTO_FULFILLMENT_E2E_FAILED:", error.stack || error); process.exitCode = 1; });
