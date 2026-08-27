#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    parseArgs,
    classifyMapping,
    buildMigrationPlan,
    applyMigrationPlan
} = require("./backfill-supplier-fulfillment-eligibility");
const { resolveFulfillmentRoutingMode } = require("../config/fulfillmentRoutingMode");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const VERIFIED_AT = new Date("2026-08-28T12:00:00.000Z");

function mapping(overrides = {}) {
    return {
        _id: overrides._id || `mapping-${overrides.packageCode || "base"}`,
        supplierCode: "WONDD",
        productCode: "mlbb",
        packageCode: "MLBB_55_DIA_FIRST_TOPUP",
        supplierProductCode: "mlbb",
        supplierPackageCode: "MLFT055",
        region: "TH",
        enabled: true,
        productionRole: "PRIMARY",
        executionMode: "API",
        archivedAt: null,
        mappingMetadata: {},
        ...overrides
    };
}

function options(overrides = {}) {
    return { apply: false, overrideExisting: false, supplier: "", product: "", verifiedAt: VERIFIED_AT, ...overrides };
}

async function verifyDryRunAndClassification() {
    const legacy = mapping();
    const providerRestricted = mapping({
        _id: "mapping-fazer-freefire",
        supplierCode: "FAZERCARDS",
        productCode: "freefire",
        packageCode: "FF_33_DIA",
        supplierProductCode: "free_fire_th",
        supplierPackageCode: "33_diamonds",
        mappingMetadata: { regionEvidence: { categoryId: "free_fire_th", regionLocked: true, note: "Region: Thailand; packs are region-locked." } }
    });
    const unknown = mapping({ _id: "mapping-unknown", region: "MM", productionRole: "DISABLED", enabled: false });
    const rows = [legacy, providerRestricted, unknown];
    const plan = buildMigrationPlan(rows, options());
    assert.strictEqual(plan.mode, "DRY_RUN");
    assert.strictEqual(plan.changes.length, 3);
    assert.strictEqual(plan.evidenceCounts.LEGACY_EFFECTIVE_SCOPE, 1);
    assert.strictEqual(plan.evidenceCounts.PROVIDER_CONFIRMED, 1);
    assert.strictEqual(plan.evidenceCounts.UNKNOWN, 1);
    assert.strictEqual(plan.evidenceCounts.GLOBAL, 0);
    assert.strictEqual(plan.afterCounts.UNKNOWN, 2);
    assert.strictEqual(plan.afterCounts.CUSTOMER_MARKET_ALLOWLIST, 1);
    assert.strictEqual(plan.proposedBySupplierProduct["WONDD/mlbb"].eligibilityModes.UNKNOWN, 2);
    assert.strictEqual(plan.proposedBySupplierProduct["WONDD/mlbb"].evidenceClasses.LEGACY_EFFECTIVE_SCOPE, 1);

    const legacyResult = classifyMapping(legacy, { verifiedAt: VERIFIED_AT });
    assert.strictEqual(legacyResult.mode, "UNKNOWN");
    assert.deepStrictEqual(legacyResult.allowedCustomerMarkets, []);
    assert.strictEqual(legacyResult.evidenceCode, "LEGACY_EFFECTIVE_SCOPE");
    assert(legacyResult.evidenceSource.includes("Historically routed through TH"));
    assert(legacyResult.evidenceSource.includes("not provider-confirmed"));
    assert(legacyResult.evidenceSource.includes("not safe for automatic cross-market routing"));

    const providerResult = classifyMapping(providerRestricted, { verifiedAt: VERIFIED_AT });
    assert.deepStrictEqual(providerResult.allowedCustomerMarkets, ["TH"]);
    assert.strictEqual(providerResult.evidenceCode, "PROVIDER_CONFIRMED");
    assert(providerResult.evidenceSource.includes("regionEvidence"));

    const unknownResult = classifyMapping(unknown, { verifiedAt: VERIFIED_AT });
    assert.strictEqual(unknownResult.mode, "UNKNOWN");
    assert.deepStrictEqual(unknownResult.allowedCustomerMarkets, []);

    let sessionStarts = 0;
    const dryResult = await applyMigrationPlan(plan, {
        Mapping: { bulkWrite: async () => { throw new Error("Dry-run must not write."); } },
        connection: { startSession: async () => { sessionStarts += 1; } }
    });
    assert.deepStrictEqual(dryResult, { writes: 0, matched: 0, modified: 0 });
    assert.strictEqual(sessionStarts, 0, "Dry-run must not open a write session.");
}

function verifyEvidenceSafety() {
    const pilot = classifyMapping(mapping(), { verifiedAt: VERIFIED_AT });
    assert.strictEqual(pilot.mode, "UNKNOWN");
    assert.deepStrictEqual(pilot.allowedCustomerMarkets, [], "WonDD MLFT055 must not gain MM.");
    assert.notStrictEqual(pilot.mode, "GLOBAL");

    const conflicting = classifyMapping(mapping({ mappingMetadata: { regionEvidence: {
        regionLocked: true,
        globalCustomerMarketEligibility: true,
        providerConfirmed: true,
        source: "provider"
    } } }), { verifiedAt: VERIFIED_AT });
    assert.strictEqual(conflicting.mode, "UNKNOWN");
    assert.deepStrictEqual(conflicting.allowedCustomerMarkets, []);

    const incomplete = classifyMapping(mapping({ mappingMetadata: { regionEvidence: {
        globalCustomerMarketEligibility: true,
        providerConfirmed: false
    } } }), { verifiedAt: VERIFIED_AT });
    assert.strictEqual(incomplete.mode, "UNKNOWN");
    assert.deepStrictEqual(incomplete.allowedCustomerMarkets, []);

    const explicitlyGlobal = classifyMapping(mapping({ mappingMetadata: { regionEvidence: {
        globalCustomerMarketEligibility: true,
        providerConfirmed: true,
        authority: "PROVIDER_CONTRACT_2026_08"
    } } }), { verifiedAt: VERIFIED_AT });
    assert.strictEqual(explicitlyGlobal.mode, "GLOBAL", "Only explicit provider-confirmed proof may classify GLOBAL.");
}

function verifyExistingPreservationAndIdempotency() {
    const existingUnknown = {
        mode: "UNKNOWN",
        allowedCustomerMarkets: [],
        evidenceCode: "",
        evidenceSource: "previous audit",
        verifiedAt: VERIFIED_AT,
        version: 1
    };
    const restricted = mapping({
        _id: "existing-provider",
        supplierCode: "FAZERCARDS",
        productCode: "valorant",
        packageCode: "VALORANT_475_VP",
        fulfillmentEligibility: existingUnknown,
        mappingMetadata: { regionEvidence: { regionLocked: true, providerRegion: "Thailand", source: "FAZERCARDS_PROVIDER_CATALOG" } }
    });
    const preserved = buildMigrationPlan([restricted], options());
    assert.strictEqual(preserved.changes.length, 0);
    assert.strictEqual(preserved.alreadyPopulated[0].action, "PRESERVE");

    const upgraded = buildMigrationPlan([restricted], options({ overrideExisting: true }));
    assert.strictEqual(upgraded.changes.length, 1);
    assert.strictEqual(upgraded.changes[0].after.evidenceCode, "PROVIDER_CONFIRMED");

    const appliedShape = { ...restricted, fulfillmentEligibility: upgraded.changes[0].after };
    const secondRun = buildMigrationPlan([appliedShape], options());
    assert.strictEqual(secondRun.changes.length, 0, "Second run must be idempotent.");
    assert.strictEqual(secondRun.alreadyPopulated[0].action, "PRESERVE");

    assert.throws(() => buildMigrationPlan([mapping({ fulfillmentEligibility: {
        mode: "GLOBAL",
        allowedCustomerMarkets: ["TH"],
        version: 1
    } })], options()), error => error.code === "MALFORMED_EXISTING_ELIGIBILITY");
}

async function verifyScopedApplySafety() {
    const selected = mapping({ _id: "selected" });
    const outsideSupplier = mapping({ _id: "outside-supplier", supplierCode: "FAZERCARDS" });
    const outsideProduct = mapping({ _id: "outside-product", productCode: "freefire" });
    const scoped = buildMigrationPlan([selected, outsideSupplier, outsideProduct], options({ apply: true, supplier: "WONDD", product: "mlbb" }));
    assert.strictEqual(scoped.selectedCount, 1);
    assert.deepStrictEqual(scoped.changes.map(item => item.id), ["selected"]);

    let operations = [];
    const Mapping = {
        find(query) {
            assert.deepStrictEqual(query, { _id: { $in: ["selected"] } });
            return { session() { return this; }, async lean() { return [selected]; } };
        },
        async bulkWrite(input) {
            operations = input;
            return { matchedCount: input.length, modifiedCount: input.length };
        }
    };
    const session = { async withTransaction(callback) { await callback(); }, async endSession() {} };
    const result = await applyMigrationPlan(scoped, { Mapping, connection: { async startSession() { return session; } } });
    assert.strictEqual(result.modified, 1);
    assert.strictEqual(operations.length, 1);
    const predicate = operations[0].updateOne.filter;
    assert.strictEqual(predicate._id, "selected");
    assert.strictEqual(predicate.supplierCode, "WONDD");
    assert.strictEqual(predicate.productCode, "mlbb");
    assert.strictEqual(predicate.packageCode, "MLBB_55_DIA_FIRST_TOPUP");
    assert.strictEqual(predicate.region, "TH");
    assert.deepStrictEqual(predicate.fulfillmentEligibility, { $exists: false });

    assert.throws(() => buildMigrationPlan([outsideSupplier], options({ supplier: "WONDD" })), error => error.code === "SCOPE_NOT_FOUND");
}

function verifyRuntimeRemainsLegacy() {
    assert.strictEqual(resolveFulfillmentRoutingMode({}), "LEGACY_REGION");
    assert.deepStrictEqual(parseArgs([]), { apply: false, overrideExisting: false, supplier: "", product: "", verifiedAt: null });
    const selection = read("backend/services/supplierProductionSelectionService.js");
    assert(!selection.includes("supplierFulfillmentEligibilityService"));
    assert(selection.includes("region: clean(region).toUpperCase()"));
    assert(selection.includes("region: mapping.region"));
    assert(selection.includes("pilotSelected") && selection.includes("snapshotVersion: 2"), "v2 emission must be limited to the later exact scoped pilot.");
    const capability = read("backend/services/fulfillmentCapabilityService.js");
    assert(capability.includes("normalizeRegion(mapping.region) !== normalizedRegion"));
    const phase2 = read("backend/scripts/backfill-supplier-fulfillment-eligibility.js");
    assert(!phase2.includes("submitTopup("));
    assert(!phase2.includes("/topups/order"));
}

(async () => {
    await verifyDryRunAndClassification();
    verifyEvidenceSafety();
    verifyExistingPreservationAndIdempotency();
    await verifyScopedApplySafety();
    verifyRuntimeRemainsLegacy();
    console.log(JSON.stringify({
        result: "PASS",
        dryRunWrites: 0,
        legacyClassification: true,
        providerConfirmedClassification: true,
        unknownFailClosed: true,
        globalWithoutProof: false,
        wonddMlft055Mode: "UNKNOWN",
        wonddMlft055Markets: [],
        scopedApplyIsolation: true,
        idempotent: true,
        routingMode: "LEGACY_REGION",
        routeSnapshotChanges: 0,
        providerCalls: 0
    }, null, 2));
})().catch(error => {
    console.error(`VERIFY_SUPPLIER_FULFILLMENT_ELIGIBILITY_PHASE2_FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
});
