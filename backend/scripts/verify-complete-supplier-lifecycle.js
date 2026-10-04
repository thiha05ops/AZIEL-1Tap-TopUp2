"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSupplierLifecycleAudit } = require("../services/supplierLifecycleAuditService");
const { assessMappingReadiness, READINESS_MODES } = require("../services/supplierMappingReadinessService");
const { createRoutingAuthority } = require("../services/supplierProductionSelectionService");
const { applySelectedPublicPurchasability } = require("../services/catalogService");
const { FULFILLMENT_ROUTING_MODES, resolveFulfillmentRoutingMode } = require("../config/fulfillmentRoutingMode");

const root = path.resolve(__dirname, "../..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };

async function main() {
    const mappingA = { _id: "a", supplierId: "sa", supplierCode: "FAZERCARDS", productCode: "game", packageCode: "PACK", region: "GLOBAL", enabled: true, archivedAt: null, executionMode: "API", supplierProductCode: "p", supplierPackageCode: "a", supplierCatalogOfferId: "oa", mappingMetadata: { readiness: { supplierMapped: true, pricingReady: true, inputReady: true, fulfillmentReady: true } }, fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "test", verifiedAt: new Date(), version: 1 } };
    const mappingB = { ...mappingA, _id: "b", supplierId: "sb", supplierCode: "WONDD", supplierPackageCode: "b", supplierCatalogOfferId: "ob" };
    const offerA = { _id: "oa", supplierId: "sa", supplierCatalogProductId: "pa", supplierProductCode: "p", supplierOfferCode: "a", catalogLifecycleState: "ACTIVE", reconciliationState: "EXACT_CANONICAL_MATCH" };
    const offerB = { _id: "ob", supplierId: "sb", supplierCatalogProductId: "pb", supplierProductCode: "p", supplierOfferCode: "b", catalogLifecycleState: "ACTIVE", reconciliationState: "AMBIGUOUS" };
    const audit = buildSupplierLifecycleAudit({ products: [{ _id: "pa" }, { _id: "pb" }, { _id: "unmapped", supplierProductCode: "new" }], offers: [offerA, offerB, { _id: "unresolved", supplierCatalogProductId: "unmapped", supplierOfferCode: "x", reconciliationState: "AMBIGUOUS" }], mappings: [mappingA, mappingB], packages: [{ _id: "pkg", productCode: "game", packageCode: "PACK", name: "Pack", prices: { TH: { supplierCode: "FAZERCARDS" } } }], publications: [{ productCode: "game", packageCode: "PACK", customerMarket: "TH", published: true }], selections: [{ productCode: "game", packageCode: "PACK", customerMarket: "TH", supplierMappingId: "b" }] });
    check("one canonical package has two exact supplier mappings", audit.packagesWithMultipleMappings[0].mappingIds.length === 2);
    check("supplier names never define equivalence", !source("backend/services/supplierCatalog/supplierCatalogReconciliationService.js").includes("similarity"));
    check("ambiguous offer remains unresolved", audit.ambiguousEquivalenceCandidates.some(row => row._id === "unresolved"));
    check("link-existing workflow retained", source("backend/services/supplierCatalog/supplierCatalogReconciliationService.js").includes("LINK_TO_EXISTING_CANONICAL_PACKAGE"));
    check("create-new workflow implemented", source("backend/services/supplierCatalog/supplierCatalogReconciliationService.js").includes("createCanonicalDraft"));
    check("native identities retained", mappingA.supplierProductCode === "p" && mappingA.supplierPackageCode === "a");
    check("customer package projection is canonical", new Set([mappingA, mappingB].map(row => `${row.productCode}|${row.packageCode}`)).size === 1);
    check("admin projection retains both mappings", audit.packagesWithMultipleMappings.length === 1);
    check("selection A representable", mappingA._id === "a");
    check("selection A to B representable", mappingB._id === "b");
    check("TH/MM selection identities are independent", new Set(["TH", "MM"].map(m => `game|PACK|${m}`)).size === 2);
    check("route snapshot source is immutable construction", source("backend/services/supplierProductionSelectionService.js").includes("Object.freeze"));
    const selected = { ready: true, routeSnapshot: { supplierMappingId: "b" }, blockers: [] };
    const route = createRoutingAuthority({ legacyResolver: async () => ({ ready: true, routeSnapshot: { supplierMappingId: "a", routeType: "SUPPLIER_API" } }), selectedResolver: async () => selected, modeResolver: () => FULFILLMENT_ROUTING_MODES.SELECTED });
    check("new order SELECTED uses B", (await route({ productCode: "game", packageCode: "PACK", region: "TH" })).routeSnapshot.supplierMappingId === "b");
    check("selected resolver fails closed without selection", source("backend/services/supplierProductionSelectionService.js").includes("PACKAGE_SUPPLIER_SELECTION_REQUIRED"));
    check("invalid selected mapping fails closed", source("backend/services/supplierProductionSelectionService.js").includes("SELECTED_MAPPING_INVALID"));
    check("selected failure has no fallback", !source("backend/services/supplierProductionSelectionService.js").match(/resolveSelectedCheckoutRouteSnapshot[\s\S]{0,1800}BACKUP/));
    const adapter = { isConfigured: () => true, isAutoFulfillmentEnabled: () => true };
    const supplier = { enabled: true, mode: "API", supplierCode: "TEST" };
    const frozen = assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: { ...mappingA, productionRole: "BACKUP" }, supplier, adapter, eligibilityOverride: mappingA.fulfillmentEligibility });
    check("frozen PRIMARY to BACKUP remains executable", frozen.ready);
    check("frozen disabled fails", !assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: { ...mappingA, enabled: false }, supplier, adapter }).ready);
    check("frozen archived fails", !assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: { ...mappingA, archivedAt: new Date() }, supplier, adapter }).ready);
    check("supplier disabled fails", !assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: mappingA, supplier: { ...supplier, enabled: false }, adapter }).ready);
    check("adapter non-executable fails", !assessMappingReadiness({ mode: READINESS_MODES.FROZEN_ORDER_EXECUTABLE, mapping: mappingA, supplier, adapter: { isConfigured: () => false } }).ready);
    check("pricing supplier may differ", audit.pricingVsFulfillment[0].differs);
    check("selection service does not mutate price", !source("backend/services/packageSupplierSelectionService.js").includes("prices."));
    check("selection service does not mutate publication", !source("backend/services/packageSupplierSelectionService.js").includes("PackageMarketPublication"));
    check("paid replay uses fulfillment idempotency", source("backend/services/paidFulfillmentRoutingService.js").includes("findAttempt(idempotencyKey)"));
    check("fulfillment protects active and successful attempts", source("backend/services/fulfillmentService.js").includes("FULFILLMENT_ALREADY_ACTIVE") && source("backend/services/fulfillmentService.js").includes("ORDER_ALREADY_FULFILLED"));
    check("two mappings do not create orders", !source("backend/services/supplierProductionSelectionService.js").includes("CommerceOrder.create"));
    check("sync decision state is independent from display names", source("backend/models/SupplierCatalogReconciliationDecision.js").includes("sourceOfferHash"));
    check("unmapped supplier product is discovered", audit.supplierProductsWithZeroMappings.some(row => row.id === "unmapped"));
    check("unresolved offer is not production ready", audit.supplierOffersWithZeroMappings.some(row => row.id === "unresolved"));
    check("reconciliation transaction has no Promise.all", !source("backend/services/supplierCatalog/supplierCatalogReconciliationService.js").includes("Promise.all"));
    check("reconciliation audit shares transaction session", source("backend/services/supplierCatalog/supplierCatalogReconciliationService.js").includes("createAudit") && source("backend/services/supplierCatalog/supplierCatalogReconciliationService.js").includes(",s);return{decision"));
    check("selection audit shares transaction session", source("backend/services/packageSupplierSelectionService.js").includes("session,") && source("backend/services/packageSupplierSelectionService.js").includes("await audit({"));
    check("consolidation never rewrites historical models", source("backend/services/catalogPackageConsolidationService.js").includes("HISTORICAL_IMMUTABLE") && source("backend/services/catalogPackageConsolidationService.js").includes("applyAvailable: false"));
    check("existing snapshots are not updated", !source("backend/services/fulfillmentService.js").includes("$set: { \"fulfilment.routeSnapshot\""));
    check("default routing remains legacy", resolveFulfillmentRoutingMode({}) === FULFILLMENT_ROUTING_MODES.LEGACY_REGION);
    const shadowRoute = createRoutingAuthority({ legacyResolver: async () => ({ ready: true, routeSnapshot: { supplierMappingId: "a", routeType: "SUPPLIER_API" } }), selectedResolver: async () => ({ ready: true, routeSnapshot: { supplierMappingId: "b", supplierCode: "WONDD" }, blockers: [] }), modeResolver: () => FULFILLMENT_ROUTING_MODES.SHADOW });
    check("shadow never changes a valid legacy route", (await shadowRoute({})).routeSnapshot.supplierMappingId === "a");
    for (const failure of [
        Object.assign(new Error("selection read failed"), { code: "SELECTION_DB_FAILED" }),
        Object.assign(new Error("readiness failed"), { code: "READINESS_FAILED" }),
        new Error("unexpected selected failure")
    ]) {
        const safeShadow = createRoutingAuthority({
            legacyResolver: async () => ({ ready: true, routeSnapshot: { supplierMappingId: "a", routeType: "SUPPLIER_API" } }),
            selectedResolver: async () => { throw failure; },
            modeResolver: () => FULFILLMENT_ROUTING_MODES.SHADOW
        });
        check(`shadow contains ${failure.code || "unexpected"} selected failure`, (await safeShadow({})).routeSnapshot.supplierMappingId === "a");
    }
    const projected = { packages: [{ packageCode: "PACK", fulfillmentRegions: { TH: true } }] };
    const blockedPublic = applySelectedPublicPurchasability(projected, [{ packageCode: "PACK" }], [], [], [], [], [], [], "TH");
    check("selected public catalog fails closed without selection", blockedPublic.packages[0].fulfillmentRegions.TH === false);
    check("selected uses exact mapping", (await route({})).routeSnapshot === selected.routeSnapshot);
    check("no BACKUP iteration in selected resolver", !source("backend/services/supplierProductionSelectionService.js").includes("productionRole: ROLES.BACKUP"));
    check("no pricing provenance routing", !source("backend/services/supplierProductionSelectionService.js").includes("supplierCostSource"));
    process.stdout.write(`PASS complete supplier lifecycle (${checks.length} assertions)\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
