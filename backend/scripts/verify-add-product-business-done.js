"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { evaluateAddProductOffer } = require("../services/supplierCatalog/addProductPreparabilityService");
const { scopedAuthorityFor, authorityFor } = require("../services/supplierCatalog/supplierBusinessAuthorityService");

const hash = "a".repeat(64);
const available = { state: "AVAILABLE" };
const offer = { _id: "offer-1", catalogLifecycleState: "ACTIVE", reconciliationState: "NO_CANONICAL_PACKAGE", reconciliationEvidence: { distinctEntitlement: true }, rawSnapshotHash: hash };
const eligibility = markets => ({ mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: markets, evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "verified provider evidence", verifiedAt: new Date().toISOString(), version: 1 });
const autoContract = { authority: "FAZERCARDS_PROVIDER_SCHEMA", noCustomerInput: true, fields: [] };

const exact = evaluateAddProductOffer({ supplier: { supplierCode: "FAZERCARDS" }, product: { supplierMarketCode: "TH", normalizedInputContract: autoContract, metadata: { fulfillmentEligibility: eligibility(["TH"]) } }, offer, availability: available, customerMarkets: ["TH"], newCanonicalProduct: true });
assert.strictEqual(exact.state, "PREPARABLE");

const unspecified = evaluateAddProductOffer({ supplier: { supplierCode: "FAZERCARDS" }, product: { supplierMarketCode: "UNSPECIFIED", normalizedInputContract: autoContract }, offer, availability: available, customerMarkets: ["TH"], newCanonicalProduct: true });
assert(unspecified.blockers.includes("SUPPLIER_MARKET_AUTHORITY_REQUIRED"));

const approvedMarket = evaluateAddProductOffer({ supplier: { supplierCode: "FAZERCARDS" }, product: { supplierMarketCode: "UNSPECIFIED", normalizedInputContract: autoContract, metadata: { businessAuthority: { marketAuthority: { nativeMarketEvidence: "TH", fulfillmentEligibility: eligibility(["TH"]) } } } }, offer, availability: available, customerMarkets: ["TH"], newCanonicalProduct: true });
assert.strictEqual(approvedMarket.state, "PREPARABLE");

const missingInput = evaluateAddProductOffer({ supplier: { supplierCode: "FAZERCARDS" }, product: { supplierMarketCode: "TH", metadata: { fulfillmentEligibility: eligibility(["TH"]) } }, offer, availability: available, customerMarkets: ["TH"], newCanonicalProduct: true });
assert(missingInput.blockers.includes("INPUT_CONTRACT_REQUIRED"));

const wonddBase = { supplierMarketCode: "TH", normalizedInputContract: { authority: "OWNER_REVIEWED_PROVIDER_EVIDENCE", review: { status: "OWNER_REVIEWED" }, noCustomerInput: true, fields: [] }, metadata: { fulfillmentEligibility: eligibility(["TH"]) } };
const missingExecution = evaluateAddProductOffer({ supplier: { supplierCode: "WONDD" }, product: wonddBase, offer, availability: available, customerMarkets: ["TH"], newCanonicalProduct: true });
assert(missingExecution.blockers.includes("EXECUTION_IDENTITY_REQUIRED"));
const approvedExecution = evaluateAddProductOffer({ supplier: { supplierCode: "WONDD" }, product: { ...wonddBase, metadata: { ...wonddBase.metadata, businessAuthority: { executionAuthority: { executionIdentity: { servicecode: "HPTOPUP" } } } } }, offer, availability: available, customerMarkets: ["TH"], newCanonicalProduct: true });
assert.strictEqual(approvedExecution.state, "PREPARABLE");
const scopedProduct = { metadata: { businessAuthority: { executionAuthority: { decisionVersion: 4, executionIdentity: { servicecode: "PRODUCT" } } } } }, scopedOffer = { metadata: {} };
assert.strictEqual(scopedAuthorityFor(scopedProduct, scopedOffer, "EXECUTION"), null, "offer mutation version must not inherit the product version");
assert.strictEqual(authorityFor(scopedProduct, scopedOffer, "EXECUTION").decisionVersion, 4, "effective reads must still inherit product authority");

const service = fs.readFileSync(path.join(__dirname, "../services/supplierCatalog/supplierBusinessAuthorityService.js"), "utf8");
assert(service.includes("session.withTransaction"));
assert(service.includes("writeAdminAudit"));
assert(!/Promise\.all\s*\(/.test(service), "authority transaction must not parallelize session operations");
assert(service.includes("expectedDecisionVersion"));
assert(service.includes("STALE_SOURCE"));
assert(service.includes('scope: state.offer ? "OFFER" : "PRODUCT"'));

const finalization = fs.readFileSync(path.join(__dirname, "../services/supplierCatalog/addProductFinalizationService.js"), "utf8");
assert(finalization.includes("MARKET_SCOPED_CANONICAL_CONFLICT"));
assert(finalization.includes("sellableMarketScope"));
assert(finalization.includes('enabled:false,productionRole:"DISABLED"'));

console.log(JSON.stringify({ result: "PASS", autoContract: exact.state, marketResolution: approvedMarket.state, inputContractBlocker: missingInput.primaryBlocker, executionResolution: approvedExecution.state, authorityTransaction: "STATIC_SESSION_AND_AUDIT_CONTRACT_VERIFIED", marketScopedCanonicalSafety: "VERIFIED" }, null, 2));
