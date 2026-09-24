"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    DINGER_LEGACY_PAYABLE_REJECTION_CODE,
    isDingerPaymentIdentifier,
    legacyPayableCreationDecision,
    rejectLegacyDingerPayable
} = require("../services/dinger/dingerLegacyPayableBoundary");
const {
    METHODS,
    DingerRegistrationSafetyError,
    registerDingerPaymentMethods
} = require("./register-dinger-payment-methods");

function safeRecord(method, overrides = {}) {
    return {
        ...method,
        enabled: false,
        dingerActivationState: "DISABLED",
        dingerProductionTestApproved: false,
        dingerGoLiveApproved: false,
        dingerAuthorizedTestUserIds: [],
        receiptUploadEnabled: false,
        slipRequired: false,
        autoVerificationSupported: true,
        webhookSupported: true,
        ...overrides
    };
}

function memoryModel(initial = []) {
    const records = new Map(initial.map(record => [record.key, { ...record }]));
    const writes = [];
    return {
        records,
        writes,
        findOne: ({ key }) => ({ lean: async () => records.get(key) || null }),
        updateOne: async (filter, update, options) => {
            writes.push({ filter, update, options });
            if (!records.has(filter.key)) {
                records.set(filter.key, { ...update.$setOnInsert });
                return { upsertedCount: 1 };
            }
            return { upsertedCount: 0 };
        }
    };
}

function mockResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

(async () => {
    [
        "DINGER", "dinger_ayapay_qr", "dinger-wavepay-pin", "DINGER_AYA_PAY_QR",
        "DINGER_WAVE_PAY_PIN", "AYA Pay QR (Dinger)", "Wave Pay PIN Dinger"
    ].forEach(value => assert.strictEqual(isDingerPaymentIdentifier(value), true, `must reject ${value}`));
    ["promptpay", "truewallet", "wavepay", "ayapay", "manual_bank"].forEach(value => {
        assert.strictEqual(isDingerPaymentIdentifier(value), false, `must preserve ${value}`);
    });

    assert.deepStrictEqual(legacyPayableCreationDecision({ enabled: false, payload: { paymentMethod: "dinger_ayapay_qr" } }), { allowed: false, reason: "legacy_disabled" });
    assert.deepStrictEqual(legacyPayableCreationDecision({ enabled: true, payload: { paymentMethod: "dinger_ayapay_qr" } }), { allowed: false, reason: "dinger_forbidden" });
    assert.deepStrictEqual(legacyPayableCreationDecision({ enabled: true, payload: { paymentMethod: "promptpay", paymentProvider: "DINGER" } }), { allowed: false, reason: "dinger_forbidden" });
    assert.deepStrictEqual(legacyPayableCreationDecision({ enabled: true, payload: { paymentMethod: "promptpay" } }), { allowed: true, reason: "allowed" });
    const response = mockResponse();
    rejectLegacyDingerPayable(response);
    assert.strictEqual(response.statusCode, 409);
    assert.strictEqual(response.body.code, DINGER_LEGACY_PAYABLE_REJECTION_CODE);

    for (const relative of ["../routes/payment.js", "../routes/order.js"]) {
        const source = fs.readFileSync(path.join(__dirname, relative), "utf8");
        const routeMarker = relative.endsWith("payment.js") ? 'router.post("/payment/create"' : 'router.post("/orders"';
        const route = source.slice(source.indexOf(routeMarker));
        assert(route.startsWith(routeMarker), `${relative} route must exist`);
        assert(route.slice(0, route.indexOf("async (req, res)")).includes("legacyPayableCreationGuard"), `${relative} must install the shared guard before the handler`);
        if (relative.endsWith("order.js")) assert(route.indexOf("upload.single") < route.indexOf("legacyPayableCreationGuard"), `${relative} must parse multipart fields before evaluating the guard`);
        const guard = source.slice(source.indexOf("function legacyPayableCreationGuard"), source.indexOf("function legacyPayableCreationGuard") + 900);
        assert(guard.includes("legacyPayableCreationDecision") && guard.includes("rejectLegacyDingerPayable"), `${relative} guard must evaluate and reject Dinger`);
    }

    const empty = memoryModel();
    const result = await registerDingerPaymentMethods({ model: empty });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(empty.writes.length, 2);
    METHODS.forEach(method => assert.deepStrictEqual(empty.records.get(method.key), safeRecord(method)));

    const safeExisting = memoryModel(METHODS.map(method => safeRecord(method)));
    await registerDingerPaymentMethods({ model: safeExisting });
    assert.strictEqual(safeExisting.writes.length, 2, "safe existing rows may receive insert-only no-op upserts");
    assert(safeExisting.writes.every(write => write.update.$setOnInsert && !write.update.$set));

    for (const unsafe of [
        { enabled: true },
        { dingerActivationState: "TEST_ONLY" },
        { dingerProductionTestApproved: true },
        { dingerGoLiveApproved: true },
        { dingerAuthorizedTestUserIds: ["user-1"] }
    ]) {
        const model = memoryModel([safeRecord(METHODS[0], unsafe), safeRecord(METHODS[1])]);
        await assert.rejects(
            registerDingerPaymentMethods({ model }),
            error => error instanceof DingerRegistrationSafetyError && error.stage === "preflight"
        );
        assert.strictEqual(model.writes.length, 0, "unsafe preflight must stop before registration writes");
    }

    const disappearing = memoryModel();
    let reads = 0;
    const originalFind = disappearing.findOne;
    disappearing.findOne = query => {
        reads += 1;
        if (reads > METHODS.length && query.key === METHODS[1].key) return { lean: async () => null };
        return originalFind(query);
    };
    await assert.rejects(
        registerDingerPaymentMethods({ model: disappearing }),
        error => error instanceof DingerRegistrationSafetyError && error.stage === "post_registration" && error.violations.includes("record_missing")
    );

    console.log("Dinger legacy-boundary and registration-safety verification passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
