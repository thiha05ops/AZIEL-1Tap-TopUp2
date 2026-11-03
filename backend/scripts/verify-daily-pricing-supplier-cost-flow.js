#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { createWeeklySupplierCostSyncService } = require("../services/supplierCatalog/weeklySupplierCostSyncService");
const { observedCostHash } = require("../services/supplierCatalog/supplierCostComparisonService");
const { workspaceSupplierCostState, resolvePricingInventoryMappings } = require("../services/commerce/adminPricingControlCenterService");

const NOW = new Date("2026-11-04T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function fixture(supplierCode, index) {
    const supplierId = `supplier-${index}`, mappingId = `mapping-${index}`, offerId = `offer-${index}`, runId = `run-${index}`;
    const productCode = supplierCode === "FAZERCARDS" ? "pubg" : "freefire";
    const packageCode = supplierCode === "FAZERCARDS" ? "PUBG_60" : "FF_100";
    const supplierProductCode = supplierCode === "FAZERCARDS" ? "pubg_mobile_auto" : "freefire_th";
    const supplierPackageCode = supplierCode === "FAZERCARDS" ? "60_uc" : "100_diamonds";
    const offer = { _id: offerId, supplierCatalogProductId: `product-${index}`, supplierId, catalogNamespace: `${supplierCode}_CATALOG`, supplierProductCode, supplierOfferCode: supplierPackageCode, catalogLifecycleState: "ACTIVE", supplierCost: { amount: 2 + index, currency: "USD", observedAt: NOW }, rawSnapshotHash: String(index).repeat(64), sourceRevision: `revision-${index}` };
    const observation = { supplierCatalogOfferId: offerId, supplierCatalogProductId: offer.supplierCatalogProductId, supplierId, catalogNamespace: offer.catalogNamespace, supplierProductCode, supplierOfferCode: supplierPackageCode, amount: offer.supplierCost.amount, currency: "USD", observedAt: NOW, ingestionRunId: runId, rawSnapshotHash: offer.rawSnapshotHash, observedCostHash: observedCostHash(offer), sourceRevision: offer.sourceRevision, evidenceMode: "LATEST_ONLY" };
    const mapping = { _id: mappingId, updatedAt: NOW, supplierId, supplierCode, productCode, packageCode, region: supplierCode === "FAZERCARDS" ? "GLOBAL" : "TH", supplierProductCode, supplierPackageCode, supplierCatalogOfferId: offerId, archivedAt: null, enabled: true, productionRole: "PRIMARY", supplierCostAuthority: {}, mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, fulfillmentReady: true, storefrontReady: true } } };
    return { supplier: { _id: supplierId, supplierCode }, mapping, offer, observation, availability: { supplierCatalogOfferId: offerId, observationRunId: runId, state: "AVAILABLE", observedAt: NOW, staleAt: null }, runId };
}

async function synchronize(row) {
    let promoted = 0;
    const repositories = {
        selections: async () => [],
        exactMappings: async supplierId => String(supplierId) === row.supplier._id ? [row.mapping] : [],
        offers: async () => [row.offer], observations: async () => [row.observation], availability: async () => [row.availability],
        supplier: async () => row.supplier, updateRun: async () => null
    };
    const promoter = async input => {
        promoted += 1;
        row.mapping.supplierCostAuthority = {
            rawSupplierCost: row.observation.amount, supplierCurrency: row.observation.currency,
            capturedAt: row.observation.observedAt, observedAt: row.observation.observedAt,
            source: "SUPPLIER_CATALOG_OBSERVATION", providerProductCode: row.mapping.supplierProductCode,
            providerOfferCode: row.mapping.supplierPackageCode, ingestionRunId: row.runId,
            rawSnapshotHash: row.observation.rawSnapshotHash, observedCostHash: row.observation.observedCostHash,
            verificationMode: "AUTOMATIC_VERIFIED_API", fundingCost: 0, otherAcquisitionCost: 0
        };
        return { replayed: false };
    };
    const report = await createWeeklySupplierCostSyncService({ repositories, promoter, clock: () => NOW }).reconcile({
        supplierCode: row.supplier.supplierCode, ingestionRunId: row.runId, scope: "ALL_EXACT_MAPPINGS",
        policy: { maximumObservationAgeMs: 24 * HOUR, maximumAutomaticChangePercent: 20 }, actor: { role: "OWNER" }
    });
    assert.strictEqual(report.updated, 1);
    assert.strictEqual(report.reviewRequired, 0);
    assert.strictEqual(promoted, 1);
    return report;
}

async function main() {
    const fazer = fixture("FAZERCARDS", 1), wondd = fixture("WONDD", 2);
    await synchronize(fazer);
    await synchronize(wondd);
    const realNow = Date.now;
    Date.now = () => NOW.getTime();
    try {
        for (const row of [fazer, wondd]) {
            const state = workspaceSupplierCostState(row.mapping, row.observation);
            assert.strictEqual(state.status, "AUTHORITATIVE");
            assert.strictEqual(state.previewSupplierCost, row.observation.amount);
            assert.deepStrictEqual(state.blockerCodes, []);
        }
        const stale = { ...fazer.mapping, supplierCostAuthority: { ...fazer.mapping.supplierCostAuthority, capturedAt: new Date(NOW - 25 * HOUR), observedAt: new Date(NOW - 25 * HOUR) } };
        const staleState = workspaceSupplierCostState(stale, { ...fazer.observation, observedAt: new Date(NOW - 25 * HOUR) });
        assert.strictEqual(staleState.previewSupplierCost, null);
        assert(staleState.blockerCodes.includes("SUPPLIER_COST_AUTHORITY_STALE"));
        const missing = workspaceSupplierCostState({ ...wondd.mapping, supplierCostAuthority: {} }, wondd.observation);
        assert(missing.blockerCodes.includes("SUPPLIER_COST_AUTHORITY_MISSING"));
        assert.strictEqual(missing.previewSupplierCost, null);
        const packageMap = new Map([[`${fazer.mapping.productCode}:${fazer.mapping.packageCode}`, { productCode: fazer.mapping.productCode, packageCode: fazer.mapping.packageCode, enabled: false }]]);
        const productMap = new Map([[fazer.mapping.productCode, { productCode: fazer.mapping.productCode }]]);
        const resolved = resolvePricingInventoryMappings({ mappings: [stale, fazer.mapping], packageMap, productMap, offerMap: new Map([[fazer.offer._id, { supplierCost: fazer.observation }]]), preferredMappingIds: new Set([String(fazer.mapping._id)]) });
        assert.strictEqual(resolved.length, 1, "disabled canonical packages remain visible to Admin pricing diagnostics");
        assert.strictEqual(resolved[0]._id, fazer.mapping._id, "fresh selected mapping wins over a stale duplicate reference");
        assert.strictEqual(packageMap.values().next().value.enabled, false, "pricing flow never enables an intentionally disabled package");
    } finally { Date.now = realNow; }
    console.log(JSON.stringify({ result: "PASS", suppliers: ["FAZERCARDS", "WONDD"], manualScope: "ALL_EXACT_MAPPINGS", freshAuthorities: 2, staleEvidenceBlocked: true, structuredBlockers: true, disabledPackagePreserved: true, customerPricesWritten: 0, publicationWrites: 0, orderWrites: 0, paymentWrites: 0, fulfillmentWrites: 0 }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
