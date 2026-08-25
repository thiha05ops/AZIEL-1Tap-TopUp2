const assert = require("assert");
const {
    createWonddAdapter,
    buildWonddMlbbGameId,
    normalizeWonddError,
    normalizeWonddStatus
} = require("../services/suppliers/wonddAdapter");
const { createWonddFulfillmentProcessor, validateWonddMapping } = require("../services/suppliers/wonddFulfillmentProcessor");
const { buildWonddGameId } = require("../services/suppliers/wonddGameIdFormatters");

function response(payload) {
    return { ok: true, status: 200, async text() { return JSON.stringify(payload); } };
}

async function adapterContractTests() {
    assert.strictEqual(buildWonddMlbbGameId(" 123456789 ", " 1234 "), "123456789 1234");
    assert.strictEqual(buildWonddGameId("mlbb", { userId: "123456789", zoneId: "1234" }), "123456789 1234");
    assert.throws(() => buildWonddGameId("pubg", { userId: "123456789" }), error => error.code === "WONDD_INPUT_CONTRACT_NOT_CONFIGURED");
    assert.throws(() => buildWonddMlbbGameId("", "1234"), error => error.code === "WONDD_MLBB_USER_ID_REQUIRED");
    assert.throws(() => buildWonddMlbbGameId("123", ""), error => error.code === "WONDD_MLBB_ZONE_ID_REQUIRED");
    assert.throws(() => buildWonddMlbbGameId("123x", "4"), error => error.code === "WONDD_MLBB_USER_ID_INVALID");

    let calls = 0;
    const disabled = createWonddAdapter({ env: { WONDD_USERNAME: "configured", WONDD_PASSWORD: "configured" }, fetchImpl: async () => { calls += 1; return response({ errorcode: "00" }); } });
    const payload = disabled.buildTopupPayload({ serviceCode: "mlbb", packCode: "verified-pack", gameId: "123456789 1234" });
    assert.deepStrictEqual(payload, { method: "topup", servicecode: "mlbb", packcode: "verified-pack", gameid: "123456789 1234" });
    assert.throws(() => disabled.buildTopupPayload({ serviceCode: "unconfirmed", packCode: "x", gameId: "1 2" }), error => error.code === "WONDD_SERVICE_MAPPING_INVALID");
    assert.throws(() => disabled.buildTopupPayload({ serviceCode: "mlbb", packCode: "", gameId: "1 2" }), error => error.code === "WONDD_PACKAGE_MAPPING_MISSING");
    const dry = disabled.dryRunTopup({ serviceCode: "mlbb", packCode: "verified-pack", gameId: "123456789 1234" });
    assert.strictEqual(dry.status, "DRY_RUN_VALID");
    assert.strictEqual(dry.payload.servicecode, "mlbb");
    assert.strictEqual(dry.payload.packcode, "verified-pack");
    assert.strictEqual(calls, 0, "dry run must never call WonDD");
    await assert.rejects(() => disabled.submitTopup({ productCode: "mlbb", serviceCode: "mlbb", packCode: "x", gameId: "1 2" }), error => error.code === "WONDD_AUTO_FULFILLMENT_DISABLED");
    assert.strictEqual(calls, 0, "disabled live submission must never call WonDD");

    let submittedBody = "";
    const enabled = createWonddAdapter({
        env: { WONDD_USERNAME: "configured-user", WONDD_PASSWORD: "configured-password", WONDD_MLBB_AUTO_FULFILLMENT_ENABLED: "true" },
        fetchImpl: async (_url, options) => { submittedBody = options.body; return response({ errorcode: "00", orderid: "W-100" }); }
    });
    const accepted = await enabled.submitTopup({ serviceCode: "mlbb", packCode: "verified-pack", gameId: "123456789 1234" });
    const submitted = new URLSearchParams(submittedBody);
    assert.strictEqual(submitted.get("method"), "topup");
    assert.strictEqual(submitted.get("servicecode"), "mlbb");
    assert.strictEqual(submitted.get("packcode"), "verified-pack");
    assert.strictEqual(submitted.get("gameid"), "123456789 1234");
    assert.strictEqual(accepted.status, "PENDING");
    assert.strictEqual(accepted.supplierReference, "W-100");

    assert.strictEqual(normalizeWonddError({ errorcode: "E03" }).failureCode, "WONDD_INSUFFICIENT_BALANCE");
    assert.strictEqual(normalizeWonddError({ errorcode: "E03" }).rawMetadata.category, "OPERATIONAL");
    assert.strictEqual(normalizeWonddError({ errorcode: "E04" }).rawMetadata.category, "CONFIGURATION");
    assert.strictEqual(normalizeWonddStatus({ transactionstatus: "process" }).providerStatus, "PROCESSING");
    assert.strictEqual(normalizeWonddStatus({ transactionstatus: "complete" }).status, "SUCCEEDED");
    assert.strictEqual(normalizeWonddStatus({ transactionstatus: "fail" }).status, "FAILED");
    assert.strictEqual(normalizeWonddStatus({ trasactionstatus: "complete" }).status, "SUCCEEDED");
    assert.strictEqual(normalizeWonddStatus({ trascationstatus: "process" }).providerStatus, "PROCESSING");
}

async function stateAuthorityTests() {
    const records = new Map();
    class Attempt {
        constructor(value) { Object.assign(this, value); this.saves = 0; records.set(String(this._id), this); }
        async save() { this.saves += 1; return this; }
        static async findById(id) { return records.get(String(id)) || null; }
    }
    const order = { _id: "order-1", orderId: "AZ-1", status: "processing", fulfilment: { status: "processing", input: { userId: "123456789", zoneId: "1234" } } };
    const mapping = { _id: "map-1", enabled: true, executionMode: "API", supplierCode: "WONDD", productCode: "mlbb", supplierProductCode: "mlbb", supplierPackageCode: "verified-pack", mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, pricingReady: true, fulfillmentReady: true } } };
    validateWonddMapping(mapping);
    assert.throws(() => validateWonddMapping({ ...mapping, supplierPackageCode: "" }), error => error.code === "WONDD_PACKAGE_MAPPING_MISSING");
    assert.throws(() => validateWonddMapping({ ...mapping, mappingMetadata: { readiness: { ...mapping.mappingMetadata.readiness, pricingReady: false } } }), error => error.code === "WONDD_PACKAGE_NOT_PRODUCTION_READY");
    const transitions = [];
    const scheduled = [];
    let submits = 0;
    let statusResult = { status: "SUCCEEDED", supplierReference: "W-100", supplierCode: "WONDD", providerStatus: "COMPLETE", rawMetadata: {} };
    const adapter = {
        isMlbbAutoFulfillmentEnabled: () => true,
        async submitTopup(input) {
            submits += 1;
            assert.strictEqual(input.serviceCode, "mlbb");
            assert.strictEqual(input.gameId, "123456789 1234");
            return { status: "PENDING", supplierReference: "W-100", supplierCode: "WONDD", providerStatus: "ACCEPTED", rawMetadata: { responseCode: "00" } };
        },
        async checkStatus() { return statusResult; },
        dryRunTopup(input) { return { status: "DRY_RUN_VALID", payload: input }; }
    };
    const processor = createWonddFulfillmentProcessor({
        Attempt,
        Order: { async findById() { return order; } },
        Mapping: { async findById() { return mapping; } },
        adapter,
        transitionOrder: async (_order, target) => transitions.push(target),
        schedule: (fn, delay) => scheduled.push({ fn, delay })
    });
    const attempt = new Attempt({ _id: "attempt-1", fulfillmentId: "FUL-1", orderId: "order-1", supplierMappingId: "map-1", supplierCodeSnapshot: "WONDD", status: "IN_PROGRESS", supplierRequest: {}, supplierResult: {} });
    const resolvedDryRun = await processor.dryRunForAttempt(attempt._id);
    assert.strictEqual(resolvedDryRun.payload.packCode, "verified-pack", "dry run must resolve authoritative mapping");
    await processor.submit(attempt._id);
    assert.strictEqual(submits, 1);
    assert.strictEqual(attempt.supplierReference, "W-100", "supplier orderid must persist");
    assert.strictEqual(attempt.status, "IN_PROGRESS", "acceptance must not complete fulfillment");
    assert.deepStrictEqual(transitions, [], "acceptance must not complete CommerceOrder");
    await processor.submit(attempt._id);
    assert.strictEqual(submits, 1, "duplicate processing must not resubmit");
    await scheduled.shift().fn();
    assert.strictEqual(attempt.status, "SUCCEEDED");
    assert.deepStrictEqual(transitions, ["completed"]);

    statusResult = { status: "FAILED", supplierReference: "W-101", supplierCode: "WONDD", providerStatus: "FAIL", failureCode: "FAIL", safeMessage: "failed", rawMetadata: {} };
    const failed = new Attempt({ _id: "attempt-2", fulfillmentId: "FUL-2", orderId: "order-1", supplierMappingId: "map-1", supplierCodeSnapshot: "WONDD", status: "IN_PROGRESS", supplierReference: "W-101", supplierRequest: { submissionState: "ACCEPTED" }, supplierResult: {} });
    await processor.poll(failed._id, 0);
    assert.strictEqual(failed.status, "FAILED");
    assert.strictEqual(transitions.at(-1), "failed");
}

(async () => {
    await adapterContractTests();
    await stateAuthorityTests();
    console.log("WonDD MLBB fulfillment verifier passed (mock transport only; no live request).\n");
})().catch(error => {
    console.error("WonDD MLBB fulfillment verifier failed:", error.message);
    process.exitCode = 1;
});
