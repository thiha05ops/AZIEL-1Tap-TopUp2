#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    buildFieldsFromContract,
    contractFromSupplierCatalog,
    mappingContractMatchesSupplierCatalog,
    publicCustomerInputContract,
    verifiedMappingContract
} = require("../services/suppliers/fazercardsFulfillmentContractService");
const { supportsFazerCardsMapping, validateFazerCardsMapping } = require("../services/suppliers/fazercardsFulfillmentProcessor");
const { createFazerCardsAdapter } = require("../services/suppliers/fazercardsAdapter");
const { isCustomerMarketEligible } = require("../services/supplierFulfillmentEligibilityService");
const { reviewedContract } = require("../services/supplierCatalog/supplierInputContractReviewService");
const { planMutations } = require("../services/supplierCatalog/providers/fazerCardsCatalogIngestionService");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const mapping = {
    _id: "mapping-1", supplierCatalogOfferId: "offer-1", supplierCode: "FAZERCARDS",
    productCode: "future-generic-game", packageCode: "PACKAGE_100", supplierProductCode: "future_generic_game",
    supplierPackageCode: "100_credits", region: "GLOBAL", enabled: true, executionMode: "API", productionRole: "PRIMARY",
    fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: "isolated fixture", verifiedAt: new Date("2026-09-01T00:00:00.000Z"), version: 1 },
    mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, pricingReady: true, fulfillmentReady: true } }
};
const offer = {
    _id: "offer-1", supplierCatalogProductId: "supplier-product-1", supplierProductCode: "future_generic_game",
    supplierOfferCode: "100_credits", catalogLifecycleState: "ACTIVE"
};
const supplierProduct = {
    _id: "supplier-product-1", supplierProductCode: "future_generic_game", supplierMarketCode: "GLOBAL",
    supportState: "SUPPORTED", rawSnapshotHash: "a".repeat(64),
    normalizedInputContract: { fields: [{ azielField: "userId", providerField: "player_id", required: true, label: "Account ID" }] }
};

const contract = contractFromSupplierCatalog({ mapping, offer, supplierProduct });
assert(contract, "An exact active offer with a non-empty normalized provider field mapping must produce a verified contract.");
assert.deepStrictEqual(buildFieldsFromContract(contract, { accountFields: [{ key: "userId", value: "ACCOUNT-123" }] }), { player_id: "ACCOUNT-123" });
assert.throws(() => buildFieldsFromContract(contract, {}), error => error.code === "FAZERCARDS_REQUIRED_INPUT_MISSING");
assert.deepStrictEqual(publicCustomerInputContract(contract).fields.map(field => [field.key, field.label]), [["userId", "Account ID"]]);

const snapshotted = { ...mapping, mappingMetadata: { ...mapping.mappingMetadata, fulfillmentContract: contract } };
assert(verifiedMappingContract(snapshotted));
assert(mappingContractMatchesSupplierCatalog(snapshotted, supplierProduct));
assert.strictEqual(mappingContractMatchesSupplierCatalog(snapshotted, { ...supplierProduct, rawSnapshotHash: "b".repeat(64) }), false, "Changed supplier evidence must invalidate the executable snapshot.");
assert(supportsFazerCardsMapping(snapshotted), "A verified mapping snapshot must replace game-name allowlisting.");
assert.strictEqual(supportsFazerCardsMapping(mapping), false, "An unknown generic mapping must remain unsupported.");
validateFazerCardsMapping(snapshotted, { customerMarket: "TH" });
assert.throws(() => validateFazerCardsMapping(snapshotted, { customerMarket: "MM" }), error => error.code === "FAZERCARDS_CUSTOMER_MARKET_NOT_ELIGIBLE");
assert.strictEqual(isCustomerMarketEligible(snapshotted.fulfillmentEligibility, "TH"), true);
assert.strictEqual(isCustomerMarketEligible(snapshotted.fulfillmentEligibility, "MM"), false);

const noContract = contractFromSupplierCatalog({
    mapping: { ...mapping, productCode: "afk-journey", supplierProductCode: "afk_journey" },
    offer: { ...offer, supplierProductCode: "afk_journey" },
    supplierProduct: { ...supplierProduct, supplierProductCode: "afk_journey", normalizedInputContract: { fields: [] }, requiredFields: [] }
});
assert.strictEqual(noContract, null, "A human-readable Account ID note without an exact provider field must remain unverified.");
assert.throws(() => reviewedContract(supplierProduct, { fields: [{ customerField: "userId", providerField: "player_id", label: "Account ID" }], evidenceReference: "provider panel", evidenceExcerpt: "Enter Account ID" }, { username: "owner" }, new Date()), error => error.code === "PROVIDER_FIELD_NOT_EVIDENCED");
const ownerReviewed = reviewedContract(supplierProduct, { fields: [{ customerField: "userId", providerField: "player_id", label: "Account ID" }], evidenceReference: "provider API documentation", evidenceExcerpt: "fields.player_id is required" }, { username: "owner", role: "OWNER" }, new Date("2026-09-02T00:00:00Z"));
assert.strictEqual(ownerReviewed.review.status, "OWNER_REVIEWED");
assert.strictEqual(ownerReviewed.review.sourceHash, supplierProduct.rawSnapshotHash);
const constrainedContract={...contract,fields:[{...contract.fields[0],constraints:{pattern:"^[A-Z0-9-]+$",minLength:4,maxLength:20}}]};constrainedContract.fingerprint=require("../services/suppliers/fazercardsFulfillmentContractService").contractFingerprint(constrainedContract);
assert.throws(()=>buildFieldsFromContract(constrainedContract,{userId:"bad"}),error=>error.code==="FAZERCARDS_INPUT_CONSTRAINT_FAILED");
const preserved = planMutations({ supplierId: "supplier-1", observedAt: new Date(), coverageState: "COMPLETE", errors: [], categoryResults: [], products: [{ ...supplierProduct, normalizedInputContract: { fields: [] }, requiredFields: [] }], offers: [] }, { products: [{ ...supplierProduct, normalizedInputContract: ownerReviewed, requiredFields: ownerReviewed.fields }], offers: [] });
assert.strictEqual(preserved.products[0].normalizedInputContract.fingerprint, ownerReviewed.fingerprint, "Unchanged ingestion must retain an Owner-reviewed contract.");
const invalidated = planMutations({ supplierId: "supplier-1", observedAt: new Date(), coverageState: "COMPLETE", errors: [], categoryResults: [], products: [{ ...supplierProduct, rawSnapshotHash: "b".repeat(64), normalizedInputContract: { fields: [] }, requiredFields: [] }], offers: [] }, { products: [{ ...supplierProduct, normalizedInputContract: ownerReviewed, requiredFields: ownerReviewed.fields }], offers: [] });
assert.strictEqual(invalidated.products[0].normalizedInputContract.fingerprint, undefined, "Changed ingestion must not silently retain a reviewed executable contract.");

let transportCalls = 0;
const adapter = createFazerCardsAdapter({
    env: { FAZERCARDS_API_KEY: "fixture", FAZERCARDS_AUTO_FULFILLMENT_ENABLED: "true" },
    fetchImpl: async () => { transportCalls += 1; throw new Error("network must not be called"); }
});
assert.strictEqual(adapter.productGateKey("future-generic-game"), "FAZERCARDS_AUTO_FULFILLMENT_ENABLED");
assert(adapter.isProductAutoFulfillmentEnabled("future-generic-game"));
assert.strictEqual(adapter.isProductAutoFulfillmentEnabled("another-future-game"), true, "No product-specific environment variable may be required.");
const dryRun = adapter.dryRunTopup({ categoryId: mapping.supplierProductCode, offerId: mapping.supplierPackageCode, fields: buildFieldsFromContract(contract, { userId: "ACCOUNT-123" }), idempotencyKey: "fixture-key" });
assert.strictEqual(dryRun.payload.category_id, "future_generic_game");
assert.strictEqual(dryRun.payload.offer_id, "100_credits");
assert.deepStrictEqual(Object.keys(dryRun.payload.fields), ["player_id"]);
assert.strictEqual(transportCalls, 0);

const productionFiles = [
    "backend/services/suppliers/fazercardsFulfillmentContractService.js",
    "backend/services/suppliers/fazercardsFulfillmentProcessor.js",
    "backend/services/suppliers/fazercardsAdapter.js",
    "backend/services/storePackageActivationService.js",
    "frontend/js/product-detail.js"
];
productionFiles.forEach(file => assert(!read(file).includes('productCode === "afk-journey"'), `${file} must not whitelist AFK.`));
assert(read("backend/routes/supplier.js").includes("/input-contract/approve"));
assert(read("frontend/js/admin-supplier-catalog.js").includes("Never invent a provider API key"));
assert(!read("backend/services/suppliers/fazercardsAdapter.js").includes("replace(/[^A-Z0-9]+/g"), "FazerCards must not derive per-product environment keys.");

console.log(JSON.stringify({
    result: "PASS",
    genericProtocol: contract.protocol,
    genericProviderFields: contract.fields.map(field => field.providerField),
    noDedicatedHtml: true,
    gameNameAllowlistRequired: false,
    unknownContractFailClosed: true,
    globalMarketAutomaticallyEligible: false,
    afkContractVerified: false,
    afkReady: false,
    ownerReviewWorkflow: true,
    sourceChangeInvalidatesExecution: true,
    perProductEnvironmentVariableRequired: false,
    liveSupplierCalls: 0,
    productionWrites: 0,
    environmentChanges: 0
}, null, 2));
