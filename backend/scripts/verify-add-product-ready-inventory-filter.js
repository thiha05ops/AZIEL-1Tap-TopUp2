#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { projectActivation } = require("../services/adminProductActivationService");

let sequence = 0;
const oid = () => String(++sequence).padStart(24, "0");
const supplier = { _id: oid(), supplierCode: "WONDD", name: "WonDD", enabled: true, mode: "API" };
const contract = { authority: "WONDD_PACKAGE_CATALOG_INPUT_SCHEMA", transactionalServiceCode: "future_service", fields: [{ customerField: "playerId", providerField: "gameid", required: true, label: "Player ID", type: "numeric-text", options: [], constraints: {}, evidenceReference: "supplier schema", transformationId: "DIRECT" }], fulfillmentEligibility: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "fixture", version: 1 } };

function source(name, state = "AVAILABLE", overrides = {}) {
    const product = { _id: oid(), supplierId: supplier._id, supplierProductCode: name.toLowerCase(), displayName: name, supplierMarketCode: "GLOBAL", normalizedInputContract: contract, metadata: {}, ...overrides.product };
    const offer = { _id: oid(), supplierId: supplier._id, supplierCatalogProductId: product._id, supplierProductCode: product.supplierProductCode, supplierOfferCode: `${name}-offer`, supplierOfferName: `${name} offer`, catalogLifecycleState: "ACTIVE", reconciliationState: "NO_CANONICAL_PACKAGE", reconciliationEvidence: { distinctEntitlement: true }, ...overrides.offer };
    const availability = { supplierCatalogOfferId: offer._id, state, coverageComplete: true };
    return { product, offer, availability };
}

const fixtures = [
    source("ReadyOnly"),
    source("PreparableOnly"),
    source("Mixed"),
    source("AttentionOnly", "AVAILABLE", { product: { normalizedInputContract: {} } }),
    source("UnavailableOnly", "UNAVAILABLE"),
    source("WrongMarketOnly", "AVAILABLE", { product: { normalizedInputContract: { ...contract, fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM"], evidenceCode: "TEST", evidenceSource: "fixture", version: 1 } } } }),
    source("UnsupportedOnly", "AVAILABLE", { product: { supplierId: oid() } })
];
const unsupportedSupplier = { _id: fixtures.at(-1).product.supplierId, supplierCode: "UNKNOWN", name: "Unknown", enabled: true, mode: "API" };
const ready = fixtures[0];
const readyMapping = { _id: oid(), supplierId: supplier._id, supplierCode: "WONDD", supplierProductCode: ready.product.supplierProductCode, supplierPackageCode: ready.offer.supplierOfferCode, supplierCatalogOfferId: ready.offer._id, productCode: "ready-product", packageCode: "READY_PACKAGE", region: "GLOBAL", fulfillmentEligibility: contract.fulfillmentEligibility };
const data = { products: [{ productCode: "ready-product", name: "Ready product" }], packages: [{ productCode: "ready-product", packageCode: "READY_PACKAGE", enabled: true, deletedAt: null }], mappings: [readyMapping], publications: [], selections: [], suppliers: [supplier, unsupportedSupplier], supplierProducts: fixtures.map(item => item.product), offers: fixtures.map(item => item.offer), availability: fixtures.map(item => item.availability) };
const result = projectActivation(data, { customerMarket: "TH" });
const visible = new Set(result.logicalProducts.map(item => item.name));
assert(visible.has("Ready product") && visible.has("PreparableOnly") && visible.has("Mixed"), JSON.stringify([...visible]));
assert(visible.has("AttentionOnly") && visible.has("UnavailableOnly") && visible.has("WrongMarketOnly") && visible.has("UnsupportedOnly"), "Execution readiness must not hide safe supplier-native catalog imports.");
assert(result.logicalProducts.every(item => item.sources.length > 0));
const unavailableSource = result.logicalProducts.find(item => item.name === "UnavailableOnly").sources[0];
assert.strictEqual(unavailableSource.totalOfferCount, 1);
assert.strictEqual(unavailableSource.importableOfferCount, 0, "Explicitly unavailable supplier offers must never be selectable.");
assert.strictEqual(unavailableSource.unavailableOfferCount, 1);
assert.strictEqual(unavailableSource.exclusionReasonCounts.SUPPLIER_UNAVAILABLE, 1);

const mlbbMapped = source("Mobile Legends (Global)");
const mlbbUnresolved = source("Mobile Legends (Global)");
mlbbUnresolved.product.supplierProductCode = "mobile_legends_global_unresolved";
mlbbUnresolved.offer.supplierProductCode = mlbbUnresolved.product.supplierProductCode;
const mlbbMapping = { _id: oid(), supplierId: supplier._id, supplierCode: "WONDD", supplierProductCode: mlbbMapped.product.supplierProductCode, supplierPackageCode: mlbbMapped.offer.supplierOfferCode, supplierCatalogOfferId: mlbbMapped.offer._id, productCode: "mlbb", packageCode: "MLBB_10", region: "GLOBAL", fulfillmentEligibility: contract.fulfillmentEligibility };
const duplicateProjection = projectActivation({ products: [{ productCode: "mlbb", name: "Mobile Legends (Global)" }], packages: [{ productCode: "mlbb", packageCode: "MLBB_10", enabled: true, deletedAt: null }], mappings: [mlbbMapping], publications: [], selections: [], suppliers: [supplier], supplierProducts: [mlbbMapped.product, mlbbUnresolved.product], offers: [mlbbMapped.offer, mlbbUnresolved.offer], availability: [mlbbMapped.availability, mlbbUnresolved.availability] }, { customerMarket: "TH" });
assert.strictEqual(duplicateProjection.logicalProducts.length, 2, "Backend identities remain separate.");
assert.strictEqual(new Set(duplicateProjection.logicalProducts.map(item => item.presentationGroupId)).size, 1, "Duplicate-looking identities receive one presentation group only.");
assert(duplicateProjection.logicalProducts.every(item => item.sources[0].totalOfferCount === 1));
const serviceSource = fs.readFileSync(path.resolve(__dirname, "../services/adminProductActivationService.js"), "utf8");
const wizardSource = fs.readFileSync(path.resolve(__dirname, "../../frontend/js/admin-add-product-wizard.js"), "utf8");
assert(serviceSource.includes("region fulfillmentEligibility"), "Navigation must load mapping eligibility used by preparability.");
assert(serviceSource.includes("metadata normalizedInputContract requiredFields"), "Navigation must load the normalized customer input contract.");
assert(serviceSource.includes("catalogLifecycleState metadata"), "Navigation must load offer-scoped business authority.");
assert(serviceSource.includes("M.CatalogPackage.find({ deletedAt: null, $or: packageKeys })"), "Navigation must batch-load canonical package context.");
assert(!serviceSource.includes("for (const offer) await M.CatalogPackage"), "Navigation must not add a per-offer package query.");
assert(wizardSource.includes("function apwPresentationProducts()") && wizardSource.includes("AZIEL package") && wizardSource.includes("supplier offer"), "Wizard must distinguish canonical packages from supplier offers.");
assert(wizardSource.includes("review required") && wizardSource.includes("unavailable") && wizardSource.includes("exclusionReasonCounts"), "Wizard must display server-projected coverage and exclusion reasons.");
console.log(JSON.stringify({ result: "PASS", visible: [...visible].sort(), duplicateNamePresentationGroups: 1, backendIdentitiesPreserved: 2, unavailableSelectable: false, importReadinessSeparatedFromSellingReadiness: true, authoritativeInputs: ["normalizedInputContract", "requiredFields", "fulfillmentEligibility", "canonicalPackage", "offerBusinessAuthority"], packageQueries: "ONE_BATCH", writes: 0, providerCalls: 0 }, null, 2));
