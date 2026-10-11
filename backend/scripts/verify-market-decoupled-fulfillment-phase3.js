#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    basicCandidateBlockers,
    summarizeEligibilityResolution,
    OUTCOMES
} = require("../services/supplierEligibilityRouteResolver");
const {
    createRoutingAuthority
} = require("../services/supplierProductionSelectionService");

const ROOT = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const now = new Date("2026-08-28T00:00:00.000Z");
const adapter = { isConfigured: () => true, isAutoFulfillmentEnabled: () => true };
const supplier = { _id: "supplier-wondd", supplierCode: "WONDD", enabled: true, mode: "API" };
const pkg = markets => ({ enabled: true, deletedAt: null, prices: Object.fromEntries(markets.map(market => [market, { enabled: true, amount: 100 }])) });

function mapping(overrides = {}) {
    return {
        _id: overrides._id || "mapping-1",
        supplierId: "supplier-wondd",
        supplierCode: "WONDD",
        productCode: "mlbb",
        packageCode: "MLBB_55_DIA_FIRST_TOPUP",
        supplierProductCode: "mlbb",
        supplierPackageCode: "MLFT055",
        region: "TH",
        productionRole: "PRIMARY",
        enabled: true,
        archivedAt: null,
        executionMode: "API",
        supplierCostAuthority: { rawSupplierCost: 10, capturedAt: now },
        mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true }, costAuthorityMaximumAgeSeconds: 86400 * 30 },
        fulfillmentEligibility: { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "LEGACY_EFFECTIVE_SCOPE", evidenceSource: "legacy", verifiedAt: now, version: 1 },
        ...overrides
    };
}

function assess(rows, customerMarket, catalogPackage = pkg(["TH", "MM"])) {
    return new Map(rows.map(row => [String(row._id), basicCandidateBlockers({ mapping: row, supplier, pkg: catalogPackage, customerMarket, now, adapter })]));
}

function resolve(rows, customerMarket, catalogPackage) {
    return summarizeEligibilityResolution({ mappings: rows, assessments: assess(rows, customerMarket, catalogPackage), productCode: "mlbb", packageCode: "MLBB_55_DIA_FIRST_TOPUP", customerMarket });
}

async function verifyGlobalSelectedAuthority() {
    const calls = [];
    const authority = createRoutingAuthority({ selectedResolver: async input => {
        calls.push(input);
        return { ready: true, blockers: [], routeSnapshot: { routeType: "SUPPLIER_API", snapshotVersion: 2, supplierMappingId: "mapping-global", supplierCode: "WONDD", supplierMarket: "GLOBAL", customerMarket: input.region, supplierPackageCode: "MLFT055" } };
    } });
    const th = await authority({ productCode: "mlbb", packageCode: "X", region: "TH" });
    const mm = await authority({ productCode: "mlbb", packageCode: "X", region: "MM" });
    assert.strictEqual(th.routeSnapshot.supplierMappingId, mm.routeSnapshot.supplierMappingId);
    assert.strictEqual(th.routeSnapshot.supplierPackageCode, mm.routeSnapshot.supplierPackageCode);
    assert.notStrictEqual(th.routeSnapshot.customerMarket, mm.routeSnapshot.customerMarket);
    assert.deepStrictEqual(calls.map(item => item.region), ["TH", "MM"]);
    const blocked = createRoutingAuthority({ selectedResolver: async () => ({ ready: false, blockers: ["GLOBAL_SUPPLIER_SELECTION_REQUIRED"], routeSnapshot: null }) });
    const missing = await blocked({ productCode: "mlbb", packageCode: "X", region: "TH" });
    assert.strictEqual(missing.ready, false);
    assert.strictEqual(missing.routeSnapshot, null);
    assert.deepStrictEqual(missing.blockers, ["GLOBAL_SUPPLIER_SELECTION_REQUIRED"]);
}

function verifyEligibilitySemantics() {
    const unknown = mapping();
    for (const market of ["TH", "MM"]) {
        const result = resolve([unknown], market);
        assert.strictEqual(result.outcome, OUTCOMES.NO_ELIGIBLE_ROUTE);
        assert(result.blockerCodes.includes("FULFILLMENT_ELIGIBILITY_UNKNOWN"));
    }

    const thOnly = mapping({ fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "provider", verifiedAt: now, version: 1 } });
    assert.strictEqual(resolve([thOnly], "TH").outcome, OUTCOMES.ELIGIBLE);
    assert.strictEqual(resolve([thOnly], "MM").outcome, OUTCOMES.NO_ELIGIBLE_ROUTE);

    const global = mapping({ fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "provider", verifiedAt: now, version: 1 } });
    assert.strictEqual(resolve([global], "TH").outcome, OUTCOMES.ELIGIBLE);
    assert.strictEqual(resolve([global], "MM").outcome, OUTCOMES.ELIGIBLE);

    const both = mapping({ fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH", "MM"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "provider", verifiedAt: now, version: 1 } });
    assert.strictEqual(resolve([both], "TH").outcome, OUTCOMES.ELIGIBLE);
    assert.strictEqual(resolve([both], "MM").outcome, OUTCOMES.ELIGIBLE);

    const second = mapping({ ...both, _id: "mapping-2", supplierId: "supplier-2", supplierCode: "OTHER", supplierPackageCode: "EXACT-2" });
    assert.strictEqual(resolve([both, second], "TH").outcome, OUTCOMES.AMBIGUOUS_PRIMARY_ROUTE);

    const missingIdentity = mapping({ ...both, supplierProductCode: "", supplierPackageCode: "" });
    const identityResult = resolve([missingIdentity], "TH");
    assert.strictEqual(identityResult.outcome, OUTCOMES.NO_ELIGIBLE_ROUTE);
    assert(identityResult.blockerCodes.includes("EXACT_MAPPING_INCOMPLETE"));

    const malformed = mapping({ fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: ["TH"], version: 1 } });
    assert.strictEqual(resolve([malformed], "TH").outcome, OUTCOMES.NO_ELIGIBLE_ROUTE);

    const missingMmPrice = resolve([global], "MM", pkg(["TH"]));
    assert.strictEqual(missingMmPrice.outcome, OUTCOMES.NO_ELIGIBLE_ROUTE);
    assert(missingMmPrice.blockerCodes.includes("CUSTOMER_MARKET_PRICE_NOT_PUBLISHED"));

    const eligible = resolve([global], "MM");
    assert.strictEqual(eligible.routeSnapshot.supplierProductCode, "mlbb");
    assert.strictEqual(eligible.routeSnapshot.supplierPackageCode, "MLFT055");
    assert.strictEqual(eligible.routeSnapshot.region, "MM");
    assert.strictEqual(eligible.routeSnapshot.snapshotVersion, undefined, "Phase 3 must not emit v2 snapshots.");
    assert.strictEqual(eligible.routeSnapshot.customerMarket, undefined, "Phase 3 production snapshot shape remains v1.");
}

function verifyStaticBoundaries() {
    const resolver = read("backend/services/supplierEligibilityRouteResolver.js");
    assert(resolver.includes('productionRole: "PRIMARY", archivedAt: null') && resolver.includes('if (mapping.enabled !== true) blockers.push("MAPPING_DISABLED")'), "PRIMARY candidates must remain scoped and disabled mappings must fail closed during assessment.");
    assert(!resolver.includes('packageCode: normalizedPackage, region:'), "Eligibility mapping query must not prefilter legacy mapping.region.");
    assert(!resolver.includes("submitTopup("));
    const paid = read("backend/services/paidFulfillmentRoutingService.js");
    assert(paid.includes("SUPPLIER_ROUTE_SNAPSHOT_BOUND"), "Paid fulfillment must remain bound to the immutable snapshot.");
    assert(paid.indexOf("if (routeSnapshot)") < paid.indexOf("options.resolveCurrentRoute || resolveCheckoutRouteSnapshot"), "A frozen route must be consumed before the historical no-snapshot compatibility resolver.");
    const productionSelection = read("backend/services/supplierProductionSelectionService.js");
    assert(productionSelection.includes('customerMarket: "GLOBAL"'));
    assert(productionSelection.includes("GLOBAL_SUPPLIER_SELECTION_REQUIRED"));
    assert(!productionSelection.includes('selectedRouteSnapshot(ready[0].mapping'));
}

(async () => {
    await verifyGlobalSelectedAuthority();
    verifyEligibilitySemantics();
    verifyStaticBoundaries();
    console.log(JSON.stringify({
        result: "PASS",
        globalSelectedAuthority: true,
        implicitCandidateSelection: false,
        wonddMlbbUnknown: true,
        providerConfirmedMarketRules: true,
        ambiguityFailsClosed: true,
        exactProviderIdentityRequired: true,
        customerMarketPricingRequired: true,
        v2SnapshotsEmitted: 0,
        providerCalls: 0,
        databaseWrites: 0
    }, null, 2));
})().catch(error => {
    console.error(`VERIFY_MARKET_DECOUPLED_FULFILLMENT_PHASE3_FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
});
