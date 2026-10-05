#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const {
    buildFieldsFromContract,
    contractFromSupplierCatalog,
    contractFingerprint,
    normalizedFields,
    publicCustomerInputContract,
    verifiedMappingContract
} = require("../services/suppliers/fazercardsFulfillmentContractService");
const { reviewedContract, sourceLock } = require("../services/supplierCatalog/supplierInputContractReviewService");
const { contractFromCurrentSupplierCatalog } = require("../services/supplierCatalog/supplierRoutePreparationService");
const { gameIdForOrder } = require("../services/suppliers/wonddFulfillmentProcessor");

const hash = value => value.repeat(64);
const base = {
    mapping: { _id: "m1", supplierId: "s1", supplierCode: "WONDD", productCode: "future-game", packageCode: "FUTURE_1", supplierProductCode: "9999", supplierPackageCode: "PK1", supplierCatalogOfferId: "o1", executionMode: "API", mappingMetadata: {} },
    supplier: { _id: "s1", supplierCode: "WONDD", enabled: true, mode: "API" },
    supplierProduct: { _id: "p1", supplierId: "s1", supplierProductCode: "9999", supportState: "SUPPORTED", rawSnapshotHash: hash("a"), sourceRevision: "r1", metadata: { transactionalServiceCode: "future" } },
    offer: { _id: "o1", supplierId: "s1", supplierCatalogProductId: "p1", supplierProductCode: "9999", supplierOfferCode: "PK1", catalogLifecycleState: "ACTIVE", rawSnapshotHash: hash("b"), metadata: {} }
};
const direct = { version: 1, decisionVersion: 1, supplierCode: "WONDD", protocol: "WONDD_GAME_ID_TOPUP", supplierProductCode: "9999", sourceSupplierCatalogProductId: "p1", sourceHash: hash("a"), fields: [{ customerField: "playerId", providerField: "gameid", label: "Player ID", required: true, type: "numeric-text", options: [], constraints: {}, transformationId: "DIRECT" }] };
direct.fingerprint = contractFingerprint(direct);
assert.deepStrictEqual(buildFieldsFromContract(direct, { accountFields: [{ key: "playerId", value: "12345" }] }), { gameid: "12345" });
assert.throws(() => buildFieldsFromContract(direct, { playerId: "abc" }), error => error.code === "SUPPLIER_INPUT_CONSTRAINT_FAILED");

const composed = { ...direct, decisionVersion: 2, fields: [
    { customerField: "playerId", providerField: "gameid", label: "Player ID", required: true, type: "numeric-text", options: [], constraints: {}, evidenceReference: "", transformationId: "JOIN_WITH_SPACE" },
    { customerField: "serverId", providerField: "gameid", label: "Server ID", required: true, type: "numeric-text", options: [], constraints: {}, evidenceReference: "", transformationId: "JOIN_WITH_SPACE" }
] };
composed.fingerprint = contractFingerprint(composed);
assert.deepStrictEqual(buildFieldsFromContract(composed, { playerId: "12345", serverId: "77" }), { gameid: "12345 77" });
assert.strictEqual(verifiedMappingContract({ ...base.mapping, mappingMetadata: { fulfillmentContract: composed } }).fingerprint, composed.fingerprint);

const select = { ...direct, supplierCode: "FAZERCARDS", protocol: "FAZERCARDS_TOPUPS_ORDER_V2", supplierProductCode: "future", fields: [
    { customerField: "playerId", providerField: "player_id", label: "Player ID", required: true, type: "text", options: [], constraints: {}, transformationId: "DIRECT" },
    { customerField: "server", providerField: "server", label: "Server", required: true, type: "select", options: [{ label: "America", value: "america" }, { label: "Asia", value: "asia" }], constraints: {}, transformationId: "DIRECT" }
] };
select.fingerprint = contractFingerprint(select);
assert.deepStrictEqual(buildFieldsFromContract(select, { playerId: "P1", accountFields: [{ key: "server", value: "asia" }] }), { player_id: "P1", server: "asia" });
assert.throws(() => buildFieldsFromContract(select, { playerId: "P1", accountFields: [{ key: "server", value: "forged" }] }), error => error.code === "FAZERCARDS_INPUT_CONSTRAINT_FAILED");
assert.throws(() => buildFieldsFromContract(select, { playerId: "P1", accountFields: [{ key: "server", value: "asia" }, { key: "undeclared", value: "forged" }] }), error => error.code === "SUPPLIER_UNDECLARED_INPUT");
assert.deepStrictEqual(publicCustomerInputContract(select).fields[1].options, [{ label: "America", value: "america" }, { label: "Asia", value: "asia" }]);
assert(!JSON.stringify(publicCustomerInputContract(select)).includes("player_id"), "Public projection must not expose provider destinations.");

assert.deepStrictEqual(normalizedFields({ normalizedInputContract: { fields: [{ customerField: "playerId", providerField: "gameid", transformationId: "EVAL", type: "text" }] } }), []);
assert.deepStrictEqual(normalizedFields({ normalizedInputContract: { fields: [{ customerField: "playerId", providerField: "gameid", transformationId: "DIRECT", type: "text", constraints: { pattern: "(?=secret).*" } }] } }), []);
assert.throws(() => buildFieldsFromContract({ ...direct, fields: [{ ...direct.fields[0], providerField: "__proto__" }] }, { playerId: "123" }), error => error.code === "SUPPLIER_INPUT_CONTRACT_NOT_VERIFIED");

const reviewed = reviewedContract(base.supplierProduct, { fields: composed.fields, evidenceReference: "provider-doc-42", evidenceExcerpt: "gameid is Player ID and Server ID joined with one space" }, { id: "owner1", username: "owner", role: "OWNER" }, new Date("2026-10-05T00:00:00Z"), "WONDD_GAME_ID_TOPUP", {});
assert.strictEqual(reviewed.decisionVersion, 1);
assert.strictEqual(reviewed.transactionalServiceCode, "future");
assert.throws(() => reviewedContract({ ...base.supplierProduct, metadata: {} }, { fields: direct.fields, evidenceReference: "provider-doc-42", evidenceExcerpt: "gameid is Player ID" }, { role: "OWNER" }, new Date(), "WONDD_GAME_ID_TOPUP", {}), error => error.code === "WONDD_TRANSACTIONAL_SERVICE_IDENTITY_REQUIRED");
const ownerExecutionIdentity = reviewedContract({ ...base.supplierProduct, metadata: {} }, { fields: direct.fields, transactionalServiceCode: "future_api", evidenceReference: "provider-doc-42", evidenceExcerpt: "gameid and future_api are provider identities" }, { role: "OWNER" }, new Date(), "WONDD_GAME_ID_TOPUP", {});
assert.strictEqual(ownerExecutionIdentity.transactionalServiceCode, "future_api");
assert.strictEqual(sourceLock({ ...base.supplierProduct, normalizedInputContract: reviewed }).expectedDecisionVersion, 1);
const productAuthority = { ...base.supplierProduct, normalizedInputContract: reviewed };
const productContract = contractFromCurrentSupplierCatalog({ ...base, supplierProduct: productAuthority });
assert(productContract && productContract.protocol === "WONDD_GAME_ID_TOPUP");
assert.deepStrictEqual(buildFieldsFromContract(productContract, { playerId: "123", serverId: "9" }), { gameid: "123 9" });
const offerOverride = { ...base.offer, metadata: { normalizedInputContract: { ...reviewed, decisionVersion: 2, fields: [direct.fields[0]] } } };
const overrideContract = contractFromSupplierCatalog({ mapping: base.mapping, offer: offerOverride, supplierProduct: productAuthority, supplierCode: "WONDD" });
assert.strictEqual(overrideContract.authorityScope, "OFFER");
assert.deepStrictEqual(buildFieldsFromContract(overrideContract, { playerId: "123" }), { gameid: "123" });
const noInputOverride = contractFromSupplierCatalog({ mapping: base.mapping, offer: { ...base.offer, metadata: { normalizedInputContract: { noCustomerInput: true, decisionVersion: 3, fields: [] } } }, supplierProduct: productAuthority, supplierCode: "WONDD" });
assert.strictEqual(noInputOverride.authorityScope, "OFFER");
assert.deepStrictEqual(buildFieldsFromContract(noInputOverride, {}), {});
assert.strictEqual(contractFromCurrentSupplierCatalog({ ...base, supplierProduct: { ...base.supplierProduct, normalizedInputContract: {} } }), null, "Heartopia-equivalent products remain blocked before approval.");

const noInputProduct = { ...base.supplierProduct, normalizedInputContract: { noCustomerInput: true, decisionVersion: 1, fields: [] } };
const noInput = contractFromCurrentSupplierCatalog({ ...base, supplierProduct: noInputProduct });
assert(noInput?.noCustomerInput);
assert.deepStrictEqual(buildFieldsFromContract(noInput, {}), {});
const retryMapping = { ...base.mapping, mappingMetadata: { fulfillmentContract: composed } };
const frozenOrder = { fulfilment: { input: { playerId: "123" }, routeSnapshot: { fulfillmentContract: direct } } };
assert.strictEqual(gameIdForOrder(retryMapping, frozenOrder), "123", "Retries must use the frozen contract instead of later mapping authority.");

const contractSource = fs.readFileSync("backend/services/suppliers/fazercardsFulfillmentContractService.js", "utf8");
const reviewSource = fs.readFileSync("backend/services/supplierCatalog/supplierInputContractReviewService.js", "utf8");
const adminSource = fs.readFileSync("frontend/js/admin-supplier-catalog.js", "utf8");
assert(!/\beval\s*\(|\bFunction\s*\(/.test(contractSource), "Declarative contract runtime must not execute arbitrary code.");
assert(reviewSource.includes('role).toUpperCase() !== "OWNER"'), "Approval service must enforce Owner authority.");
assert(reviewSource.includes("INPUT_CONTRACT_VERSION_CONFLICT"), "Approval service must enforce optimistic decision-version concurrency.");
assert(reviewSource.includes("session.withTransaction"), "Contract and audit writes must share a transaction boundary.");
assert(reviewSource.includes("writeAdminAudit") && reviewSource.includes("session });"), "Approval audit must receive the transaction session.");
assert(adminSource.includes("Override for this package") && adminSource.includes("offerId:supplierInputContractOfferScope"), "Admin must support a codeless exact-offer override as well as the product default.");
assert(adminSource.includes("WonDD execution service code") && adminSource.includes("transactionalServiceCode:serviceCode"), "Owner evidence workflow must collect missing WonDD execution identity without a code change.");

console.log(JSON.stringify({ result: "PASS", supplierProvidedDirect: true, composedGameId: true, selectOptions: true, productInheritance: true, offerOverride: true, unknownTransformRejected: true, unsafePatternRejected: true, prototypeDestinationRejected: true, undeclaredInputRejected: true, noEval: true, ownerOnlyApproval: "STATIC_CONTRACT_VERIFIED", optimisticConcurrency: "STATIC_CONTRACT_VERIFIED", auditTransaction: "STATIC_SESSION_CONTRACT_VERIFIED", heartopiaBefore: "INPUT_CONTRACT_UNRESOLVED", heartopiaAfterEquivalent: "PREPARABLE_CONTRACT", supplierCalls: 0, productionWrites: 0 }, null, 2));
