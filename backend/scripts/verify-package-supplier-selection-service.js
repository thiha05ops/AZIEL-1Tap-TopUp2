"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { createPackageSupplierSelectionService } = require("../services/packageSupplierSelectionService");

const id = () => new mongoose.Types.ObjectId();
const ids = {
    supplierA: id(), supplierB: id(), supplierDisabled: id(),
    offerA: id(), offerB: id(), offerDisabled: id(),
    mappingA: id(), mappingB: id(), mappingDisabled: id(), mappingArchived: id(), mappingWrong: id(), mappingIneligible: id()
};
const ready = { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true };
const eligible = markets => ({ mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: markets, evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "test", verifiedAt: new Date(), version: 1 });
const baseMapping = { productCode: "game", packageCode: "PACK", region: "GLOBAL", enabled: true, executionMode: "API", mappingMetadata: { readiness: ready }, fulfillmentEligibility: eligible(["TH", "MM"]), supplierCostAuthority: { rawSupplierCost: 4, supplierCurrency: "USD", capturedAt: new Date(), source: "test" } };
const mappings = [
    { ...baseMapping, _id: ids.mappingA, supplierId: ids.supplierA, supplierCode: "A", supplierProductCode: "P", supplierPackageCode: "A", supplierCatalogOfferId: ids.offerA, productionRole: "PRIMARY" },
    { ...baseMapping, _id: ids.mappingB, supplierId: ids.supplierB, supplierCode: "B", supplierProductCode: "P", supplierPackageCode: "B", supplierCatalogOfferId: ids.offerB, productionRole: "BACKUP" },
    { ...baseMapping, _id: ids.mappingDisabled, supplierId: ids.supplierA, supplierCode: "A", supplierProductCode: "P", supplierPackageCode: "A", supplierCatalogOfferId: ids.offerA, enabled: false, productionRole: "DISABLED" },
    { ...baseMapping, _id: ids.mappingArchived, supplierId: ids.supplierA, supplierCode: "A", supplierProductCode: "P", supplierPackageCode: "A", supplierCatalogOfferId: ids.offerA, archivedAt: new Date(), productionRole: "DISABLED" },
    { ...baseMapping, _id: ids.mappingWrong, supplierId: ids.supplierA, supplierCode: "A", productCode: "other", supplierProductCode: "P", supplierPackageCode: "W", supplierCatalogOfferId: ids.offerA, productionRole: "PRIMARY" },
    { ...baseMapping, _id: ids.mappingIneligible, supplierId: ids.supplierA, supplierCode: "A", supplierProductCode: "P", supplierPackageCode: "A", supplierCatalogOfferId: ids.offerA, fulfillmentEligibility: eligible(["TH"]), productionRole: "PRIMARY" }
];
const suppliers = [
    { _id: ids.supplierA, supplierCode: "A", name: "Supplier A", enabled: true, mode: "API" },
    { _id: ids.supplierB, supplierCode: "B", name: "Supplier B", enabled: true, mode: "API" },
    { _id: ids.supplierDisabled, supplierCode: "X", name: "Disabled", enabled: false, mode: "API" }
];
const offers = [
    { _id: ids.offerA, supplierId: ids.supplierA, supplierProductCode: "P", supplierOfferCode: "A", catalogLifecycleState: "ACTIVE", supplierCost: { amount: 4, currency: "USD", observedAt: new Date() } },
    { _id: ids.offerB, supplierId: ids.supplierB, supplierProductCode: "P", supplierOfferCode: "B", catalogLifecycleState: "ACTIVE", supplierCost: { amount: 3.8, currency: "USD", observedAt: new Date() } }
];
const availability = [ids.offerA, ids.offerB].map(offerId => ({ supplierCatalogOfferId: offerId, state: "AVAILABLE", staleAt: new Date(Date.now() + 3600000) }));
const selections = [];
const audits = [];
const untouched = { price: 149, publication: "PUBLIC", storeSelection: "UNCHANGED", orders: 2, attempts: 3 };
const transactionSession = { transaction: true };
let auditFailure = null;

function query(value, initialSession = null) {
    let boundSession = initialSession;
    return {
        session(session) {
            assert.strictEqual(session, transactionSession, "every transaction query must use the transaction session");
            boundSession = session;
            return this;
        },
        lean: async () => {
            assert.strictEqual(boundSession, transactionSession, "transaction query must be session-bound before execution");
            return value;
        }
    };
}
function same(a, b) { return String(a) === String(b); }
const models = {
    Product: { findOne: filter => query(filter.productCode === "game" ? { productCode: "game" } : null) },
    Package: { findOne: filter => query(filter.productCode === "game" && filter.packageCode === "PACK" ? { productCode: "game", packageCode: "PACK", prices: { TH: { amount: 149, currency: "THB", enabled: true }, MM: { amount: 12000, currency: "MMK", enabled: true } } } : null) },
    Mapping: { findById: value => query(mappings.find(item => same(item._id, value)) || null) },
    Supplier: { findById: value => query(suppliers.find(item => same(item._id, value)) || null) },
    Offer: { findById: value => query(offers.find(item => same(item._id, value)) || null) },
    Availability: { findOne: filter => query(availability.find(item => same(item.supplierCatalogOfferId, filter.supplierCatalogOfferId)) || null) },
    Selection: {
        findOne: filter => {
            const row = selections.find(item => item.productCode === filter.productCode && item.packageCode === filter.packageCode && item.customerMarket === filter.customerMarket);
            return query(row ? { ...row } : null);
        },
        create: async (docs, options) => {
            assert.strictEqual(options?.session, transactionSession, "selection create must use the transaction session");
            const row = { _id: id(), ...docs[0] };
            selections.push(row);
            return [{ toObject: () => ({ ...row }) }];
        },
        findOneAndUpdate: (filter, update, options) => {
            assert.strictEqual(options?.session, transactionSession, "selection update must use the transaction session");
            return query((() => {
                const row = selections.find(item => same(item._id, filter._id) && item.decisionVersion === filter.decisionVersion);
                if (!row) return null;
                Object.assign(row, update.$set);
                return { ...row };
            })(), options.session);
        }
    }
};
const service = createPackageSupplierSelectionService(models, {
    transaction: async callback => {
        const selectionSnapshot = selections.map(row => ({ ...row }));
        const auditLength = audits.length;
        try {
            return await callback(transactionSession);
        } catch (error) {
            selections.splice(0, selections.length, ...selectionSnapshot);
            audits.splice(auditLength);
            throw error;
        }
    },
    writeAdminAudit: async event => {
        assert.strictEqual(event.session, transactionSession, "audit write must use the selection transaction session");
        if (auditFailure) throw auditFailure;
        audits.push(event);
    },
    getSupplierAdapter: () => ({ isConfigured: () => true, isAutoFulfillmentEnabled: () => true })
});
const actor = { id: id(), username: "owner", role: "OWNER" };
const call = (market, mappingId, expectedDecisionVersion) => service({ productCode: " GAME ", packageCode: " pack ", customerMarket: market, supplierMappingId: mappingId, expectedDecisionVersion, reason: "test" }, { actor });
async function rejectsCode(promise, code) {
    await assert.rejects(promise, error => error.code === code);
}

(async () => {
    const serviceSource = fs.readFileSync(path.join(__dirname, "../services/packageSupplierSelectionService.js"), "utf8");
    assert(!serviceSource.includes("Promise.all("), "supplier-selection transaction must not parallelize session-bound operations");

    const before = JSON.stringify(untouched);
    const created = await call("TH", ids.mappingA, null);
    assert.strictEqual(created.changed, true);
    assert.strictEqual(created.previousSelection, null);
    assert.strictEqual(created.selection.decisionVersion, 1);
    assert.strictEqual(audits[0].action, "PACKAGE_SUPPLIER_SELECTION_CREATED");
    assert.strictEqual(audits[0].metadata.customerPriceChanged, false);
    assert.strictEqual(audits[0].metadata.publicationChanged, false);

    const idempotent = await call("TH", ids.mappingA, 1);
    assert.strictEqual(idempotent.changed, false);
    assert.strictEqual(idempotent.selection.decisionVersion, 1);
    assert.strictEqual(audits.length, 1, "idempotent save must not audit");

    await rejectsCode(call("TH", ids.mappingB, 0), "PACKAGE_SUPPLIER_SELECTION_STALE");
    const changed = await call("TH", ids.mappingB, 1);
    assert.strictEqual(changed.selection.decisionVersion, 2);
    assert.strictEqual(changed.previousSelection.supplierMappingId, String(ids.mappingA));
    assert.strictEqual(audits[1].action, "PACKAGE_SUPPLIER_SELECTION_CHANGED");
    assert.strictEqual(audits[1].metadata.oldSupplierCode, "A");
    assert.strictEqual(audits[1].metadata.newSupplierCode, "B");
    assert.strictEqual(mappings[1].productionRole, "BACKUP", "non-primary role remains unchanged and selectable");

    const mm = await call("MM", ids.mappingA, null);
    assert.strictEqual(mm.selection.decisionVersion, 1);
    assert.strictEqual(selections.find(item => item.customerMarket === "TH").supplierMappingId, ids.mappingB);
    assert.strictEqual(selections.find(item => item.customerMarket === "MM").supplierMappingId, ids.mappingA);

    await rejectsCode(call("TH", ids.mappingWrong, 2), "SUPPLIER_MAPPING_SCOPE_MISMATCH");
    await rejectsCode(call("TH", ids.mappingDisabled, 2), "SUPPLIER_MAPPING_NOT_READY");
    await rejectsCode(call("TH", ids.mappingArchived, 2), "SUPPLIER_MAPPING_NOT_READY");
    const marketDecoupled = await call("MM", ids.mappingIneligible, 1);
    assert.strictEqual(marketDecoupled.selection.decisionVersion, 2, "customer payment market must not reject an otherwise exact executable supplier route");
    assert.strictEqual(marketDecoupled.selection.supplierMappingId, String(ids.mappingIneligible));

    suppliers[0].enabled = false;
    await rejectsCode(call("MM", ids.mappingA, 2), "SUPPLIER_DISABLED");
    suppliers[0].enabled = true;
    const savedAvailability = availability.splice(availability.findIndex(item => same(item.supplierCatalogOfferId, ids.offerA)), 1)[0];
    await rejectsCode(call("MM", ids.mappingA, 2), "SUPPLIER_NOT_AVAILABLE");
    availability.push(savedAvailability);

    const beforeAuditFailure = { ...selections.find(item => item.customerMarket === "MM") };
    const auditCountBeforeFailure = audits.length;
    auditFailure = new Error("simulated audit failure");
    await assert.rejects(call("MM", ids.mappingB, 2), error => error === auditFailure);
    auditFailure = null;
    const afterAuditFailure = selections.find(item => item.customerMarket === "MM");
    assert.strictEqual(afterAuditFailure.supplierMappingId, beforeAuditFailure.supplierMappingId, "simulated transaction must roll back selection when audit fails");
    assert.strictEqual(afterAuditFailure.decisionVersion, beforeAuditFailure.decisionVersion, "simulated transaction must roll back decisionVersion when audit fails");
    assert.strictEqual(audits.length, auditCountBeforeFailure, "failed audit must not leave an audit event");

    assert.strictEqual(JSON.stringify(untouched), before, "price/publication/store/order/attempt state must remain untouched");
    console.log("PASS selection create/change/version/stale/idempotency/validation/market independence/session contract/simulated rollback/audit/zero side effects");
    console.log("NOTE rollback coverage uses the fake transaction harness; a real replica-set integration test is still required to prove MongoDB rollback behavior");
})().catch(error => { console.error(error); process.exitCode = 1; });
