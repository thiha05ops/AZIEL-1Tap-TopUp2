#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { applyAdminSupplierSupport, applyPackageFulfillmentReadiness, applyPublicPackageEligibility, projectCommerceReadiness } = require("../services/catalogService");
const { resolveFulfillmentCapability } = require("../services/fulfillmentCapabilityService");

const ready = Object.freeze({ supplierMapped: true, inputReady: true, validationReady: true, pricingReady: true, fulfillmentReady: true, storefrontReady: true });
const allowTH = Object.freeze({ mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "deterministic verifier", verifiedAt: "2026-08-30T00:00:00.000Z", version: 1 });
const unknown = Object.freeze({ mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "LEGACY_EFFECTIVE_SCOPE", evidenceSource: "legacy fixture", verifiedAt: "2026-08-30T00:00:00.000Z", version: 1 });
const suppliers = [
    { _id: "wondd", supplierCode: "WONDD", enabled: true, mode: "API", supportedRegions: ["TH"] },
    { _id: "fazer", supplierCode: "FAZERCARDS", enabled: true, mode: "API", supportedRegions: ["TH"] }
];
const eligibilityContext = { adapterResolver: () => ({ isConfigured: () => true }), mappingSupportResolver: mapping => ["WONDD", "FAZERCARDS"].includes(mapping.supplierCode) };
const product = code => ({ productCode: code, enabled: true, supportedRegions: ["MM", "TH"], fulfillment: { manualAllowedRegions: ["MM", "TH"] } });
const pkg = (packageCode, overrides = {}) => ({ _id: packageCode, productCode: overrides.productCode || "mlbb", packageCode, name: packageCode, enabled: overrides.enabled !== false, deletedAt: null, prices: { MM: { amount: 1000, enabled: true }, TH: { amount: 30, enabled: true }, ...(overrides.prices || {}) } });
const mapping = (supplierCode, packageCode, overrides = {}) => {
    const fazer = supplierCode === "FAZERCARDS";
    return { _id: `${supplierCode}-${packageCode}`, supplierId: fazer ? "fazer" : "wondd", supplierCode, productCode: overrides.productCode || "mlbb", packageCode, region: "TH", enabled: true, archivedAt: null, productionRole: "PRIMARY", executionMode: "API", supplierProductCode: fazer ? "mobile_legends_global" : (overrides.productCode || "mlbb"), supplierPackageCode: `${supplierCode}-${packageCode}-offer`, fulfillmentEligibility: allowTH, mappingMetadata: { readiness: ready }, ...overrides };
};

function project(productCode, packages, mappings, supplierRows = suppliers) {
    const projection = { ...product(productCode), packages: packages.map(item => ({ ...item })) };
    applyPackageFulfillmentReadiness(projection, mappings, [], supplierRows, eligibilityContext);
    applyAdminSupplierSupport(projection, mappings, supplierRows, eligibilityContext);
    applyPublicPackageEligibility(projection);
    return projection;
}

const wonddOnly = project("mlbb", [pkg("WONDD_ONLY")], [mapping("WONDD", "WONDD_ONLY")]);
assert.deepStrictEqual(wonddOnly.packages.map(item => item.packageCode), ["WONDD_ONLY"]);
const fazerOnly = project("mlbb", [pkg("FAZER_ONLY")], [mapping("FAZERCARDS", "FAZER_ONLY")]);
assert.deepStrictEqual(fazerOnly.packages.map(item => item.packageCode), ["FAZER_ONLY"]);
const both = project("mlbb", [pkg("BOTH")], [mapping("WONDD", "BOTH"), mapping("FAZERCARDS", "BOTH")]);
assert.deepStrictEqual(both.packages.map(item => item.packageCode), ["BOTH"], "Multiple eligible suppliers must not duplicate a canonical package.");
assert.strictEqual(project("mlbb", [pkg("NONE")], []).packages.length, 0);
assert.strictEqual(project("mlbb", [pkg("DISABLED", { enabled: false })], [mapping("FAZERCARDS", "DISABLED")]).packages.length, 0);
assert.strictEqual(project("mlbb", [pkg("NO_PRICE", { prices: { TH: { amount: 0, enabled: false } } })], [mapping("FAZERCARDS", "NO_PRICE")]).packages.length, 0);
assert.strictEqual(project("mlbb", [pkg("SUPPLIER_OFF")], [mapping("FAZERCARDS", "SUPPLIER_OFF")], suppliers.map(item => item._id === "fazer" ? { ...item, enabled: false } : item)).packages.length, 0);
assert.strictEqual(project("mlbb", [pkg("MAPPING_OFF")], [mapping("FAZERCARDS", "MAPPING_OFF", { enabled: false })]).packages.length, 0);
assert.strictEqual(project("mlbb", [pkg("NOT_READY")], [mapping("FAZERCARDS", "NOT_READY", { mappingMetadata: { readiness: { ...ready, fulfillmentReady: false } } })]).packages.length, 0);
assert.strictEqual(project("mlbb", [pkg("UNKNOWN")], [mapping("FAZERCARDS", "UNKNOWN", { fulfillmentEligibility: unknown })]).packages.length, 0, "UNKNOWN market eligibility must fail closed.");
const freeFireMapping = mapping("FAZERCARDS", "FF_33", { productCode: "freefire", supplierProductCode: "free_fire_th" });
assert.deepStrictEqual(project("freefire", [pkg("FF_33", { productCode: "freefire" })], [freeFireMapping]).packages.map(item => item.packageCode), ["FF_33"]);

const mmProduct = product("mlbb");
const mmPackage = pkg("MM_MANUAL");
const mmCapability = resolveFulfillmentCapability({ product: mmProduct, mappings: [], suppliers: [], productCode: "mlbb", packageCode: "MM_MANUAL", region: "MM" });
assert(mmCapability.fulfillmentAvailable && mmCapability.manualAdminAllowed, "MM manual fulfillment must remain available.");
const commerce = projectCommerceReadiness(mmProduct, [mmPackage], [], [], []);
assert.strictEqual(commerce.regions.MM.fulfillment, true);

const adminProjection = { ...product("mlbb"), packages: [pkg("FAZER_ADMIN")] };
applyAdminSupplierSupport(adminProjection, [mapping("FAZERCARDS", "FAZER_ADMIN")], suppliers, eligibilityContext);
assert.strictEqual(adminProjection.packages[0].supplierSupport.TH.status, "SUPPORTED");
assert.strictEqual(adminProjection.packages[0].supplierSupport.TH.suppliers[0].supplierCode, "FAZERCARDS");

const root = path.resolve(__dirname, "../..");
const catalogSource = fs.readFileSync(path.join(root, "backend/services/catalogService.js"), "utf8");
const operationsSource = fs.readFileSync(path.join(root, "backend/services/supplierOperationsService.js"), "utf8");
assert(!catalogSource.includes("getSupplierOperations"), "Public catalog reads must not call Supplier Operations or a live supplier API.");
assert(operationsSource.includes('availability = evidence?.availability || "UNKNOWN"'), "Supplier Operations availability semantics must remain fail-closed.");
assert(!catalogSource.includes("isProductionReadyWonddMlbbMapping"), "Catalog authority must not depend on the legacy WonDD-only predicate.");

console.log(JSON.stringify({ result: "PASS", cases: 16, wonddOnlyPublic: wonddOnly.packageCount, fazerCardsOnlyPublic: fazerOnly.packageCount, multipleSupplierPackageCount: both.packageCount, unknownEligibilityPublic: 0, freeFireSupplierNeutral: true, mmManualPreserved: true, supplierApiCalls: 0 }, null, 2));
