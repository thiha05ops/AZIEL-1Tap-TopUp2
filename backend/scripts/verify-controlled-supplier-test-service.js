#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { authorizeControlledAttempt, executeControlledSupplierTest } = require("../services/controlledSupplierTestService");
const id = value => ({ toString: () => value });
async function main() {
    const mapping = { _id: id("m1"), supplierId: "s1", supplierCode: "FAZERCARDS", productCode: "freefire", packageCode: "FF_WONDD_F00033", productionRole: "DISABLED", archivedAt: null, toObject() { return this; } };
    const order = { _id: id("o1"), fulfilment: { routeSnapshot: { routeType: "SUPPLIER_API", supplierMappingId: "m1" } } };
    const attempt = { _id: id("a1"), fulfillmentId: "FUL-CONTROLLED-1", orderId: "o1", supplierMappingId: "m1", routeType: "SUPPLIER_API", status: "IN_PROGRESS", supplierReference: "", supplierRequest: {} };
    const model = value => ({ async findById() { return value; } });
    const deps = { env: { CONTROLLED_SUPPLIER_TEST_AUTHORIZATION_TOKEN: "one-use-secret" }, Attempt: model(attempt), Order: model(order), Mapping: model(mapping), Supplier: model({ _id: "s1" }), assess: async () => ({ ready: true, blockers: [] }), dispatch: () => true };
    const input = { explicitApproval: true, approvalPhrase: "EXECUTE EXACTLY ONE CONTROLLED SUPPLIER TEST", authorizationToken: "one-use-secret", supplier: "FAZERCARDS", product: "freefire", packageCode: "FF_WONDD_F00033", mappingId: "m1", orderId: "o1", attemptId: "a1" };
    assert.strictEqual((await authorizeControlledAttempt(input, deps)).mapping, mapping);
    assert.strictEqual((await executeControlledSupplierTest(input, deps)).dispatched, true);
    await assert.rejects(() => authorizeControlledAttempt({ ...input, authorizationToken: "wrong" }, deps), error => error.code === "CONTROLLED_TEST_AUTHORIZATION_INVALID");
    await assert.rejects(() => authorizeControlledAttempt({ ...input, explicitApproval: false }, deps), error => error.code === "CONTROLLED_TEST_APPROVAL_REQUIRED");
    attempt.supplierRequest.submissionState = "SUBMISSION_UNCERTAIN";
    await assert.rejects(() => authorizeControlledAttempt(input, deps), error => error.code === "CONTROLLED_TEST_ALREADY_SUBMITTED");
    console.log("Controlled supplier test service passed: explicit binding, one-shot lock, and uncertain-submission blocking verified with mocks.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
