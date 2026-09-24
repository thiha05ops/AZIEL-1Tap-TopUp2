"use strict";

const mongoose = require("mongoose");
const PaymentMethod = require("../models/PaymentMethod");

const METHODS = Object.freeze([
    {
        key: "dinger_ayapay_qr", method: "AYA Pay QR (Dinger)", region: "MM", provider: "dinger_ayapay_qr",
        paymentType: "auto", paymentChannel: "DINGER_AYA_PAY_QR", qrMode: "provider_generated",
        confirmationMode: "provider_webhook", shortDescription: "Pay with AYA Pay QR", badgeText: "DINGER", sortOrder: 30
    },
    {
        key: "dinger_wavepay_pin", method: "Wave Pay PIN (Dinger)", region: "MM", provider: "dinger_wavepay_pin",
        paymentType: "auto", paymentChannel: "DINGER_WAVE_PAY_PIN", qrMode: "none",
        confirmationMode: "provider_webhook", shortDescription: "Pay with Wave Pay PIN", badgeText: "DINGER", sortOrder: 31
    }
]);

class DingerRegistrationSafetyError extends Error {
    constructor(key, violations, stage) {
        super(`Dinger payment method ${key} is not in the required safe initial state.`);
        this.name = "DingerRegistrationSafetyError";
        this.code = "DINGER_REGISTRATION_UNSAFE_EXISTING_STATE";
        this.key = key;
        this.stage = stage;
        this.violations = Object.freeze([...violations]);
    }
}

async function resolveRecord(query) {
    if (!query) return null;
    const result = typeof query.lean === "function" ? query.lean() : query;
    return result && typeof result.exec === "function" ? result.exec() : result;
}

async function findMethod(model, key) {
    return resolveRecord(model.findOne({ key }));
}

function safeInitialStateViolations(record, method) {
    if (!record) return [];
    const violations = [];
    if (record.enabled !== false) violations.push("enabled_must_be_false");
    if (record.dingerActivationState !== "DISABLED") violations.push("activation_state_must_be_disabled");
    if (record.dingerProductionTestApproved !== false) violations.push("production_test_approval_must_be_false");
    if (record.dingerGoLiveApproved !== false) violations.push("go_live_approval_must_be_false");
    if (!Array.isArray(record.dingerAuthorizedTestUserIds) || record.dingerAuthorizedTestUserIds.length !== 0) violations.push("authorized_test_users_must_be_empty");
    if (record.key !== method.key) violations.push("method_key_mismatch");
    if (record.region !== method.region) violations.push("region_mismatch");
    if (record.provider !== method.provider) violations.push("provider_mismatch");
    if (record.paymentType !== method.paymentType) violations.push("payment_type_mismatch");
    if (record.paymentChannel !== method.paymentChannel) violations.push("payment_channel_mismatch");
    if (record.confirmationMode !== method.confirmationMode) violations.push("confirmation_mode_mismatch");
    if (record.receiptUploadEnabled !== false) violations.push("receipt_upload_must_be_false");
    if (record.slipRequired !== false) violations.push("slip_required_must_be_false");
    return violations;
}

async function assertSafeMethodRecords(model, { allowMissing, stage }) {
    const records = [];
    for (const method of METHODS) {
        const record = await findMethod(model, method.key);
        if (!record && !allowMissing) throw new DingerRegistrationSafetyError(method.key, ["record_missing"], stage);
        const violations = safeInitialStateViolations(record, method);
        if (violations.length) throw new DingerRegistrationSafetyError(method.key, violations, stage);
        records.push(record);
    }
    return records;
}

async function registerDingerPaymentMethods(options = {}) {
    const model = options.model || PaymentMethod;
    if (!model || typeof model.findOne !== "function" || typeof model.updateOne !== "function") {
        throw new TypeError("Dinger registration requires findOne and updateOne model operations.");
    }
    await assertSafeMethodRecords(model, { allowMissing: true, stage: "preflight" });
    const results = [];
    for (const method of METHODS) {
        const result = await model.updateOne({ key: method.key }, {
            $setOnInsert: {
                ...method,
                enabled: false,
                dingerActivationState: "DISABLED",
                dingerProductionTestApproved: false,
                dingerGoLiveApproved: false,
                dingerAuthorizedTestUserIds: [],
                receiptUploadEnabled: false,
                slipRequired: false,
                autoVerificationSupported: true,
                webhookSupported: true
            }
        }, { upsert: true });
        results.push({ key: method.key, created: Number(result.upsertedCount || 0) === 1 });
    }
    await assertSafeMethodRecords(model, { allowMissing: false, stage: "post_registration" });
    return results;
}

async function main() {
    require("dotenv").config();
    const uri = String(process.env.MONGO_URI || "").trim();
    if (!uri) throw new Error("MONGO_URI is required.");
    await mongoose.connect(uri);
    try {
        const results = await registerDingerPaymentMethods();
        console.log(JSON.stringify({ success: true, methods: results }));
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) main().catch(error => {
    console.error(JSON.stringify({
        success: false,
        code: error?.code || error?.name || "DINGER_REGISTRATION_FAILED",
        stage: String(error?.stage || "registration"),
        methodKey: String(error?.key || ""),
        violations: Array.isArray(error?.violations) ? error.violations : []
    }));
    process.exitCode = 1;
});

module.exports = Object.freeze({
    METHODS,
    DingerRegistrationSafetyError,
    safeInitialStateViolations,
    assertSafeMethodRecords,
    registerDingerPaymentMethods
});
