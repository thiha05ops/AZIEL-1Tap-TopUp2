"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const paymentMethodsRoute = require("../routes/paymentMethods");
const {
    isProviderValidFor,
    paymentMethodCapabilityState,
    paymentMethodApplicableSections
} = require("../services/paymentProviderRegistry");

async function main() {
    const { applyCompatibilityModes, defaultMethods, normalizePaymentMethodKey, validatePaymentMethodConfiguration } = paymentMethodsRoute._test;
    const thunderDefault = defaultMethods.find(method => method.key === "thunder_promptpay");
    const manualDefault = defaultMethods.find(method => method.key === "promptpay");
    const walletDefault = defaultMethods.find(method => method.key === "wallet");

    assert(thunderDefault, "Thunder must be seeded as a distinct Admin payment method");
    assert.deepStrictEqual({
        region: thunderDefault.region,
        enabled: thunderDefault.enabled,
        paymentType: thunderDefault.paymentType,
        provider: thunderDefault.provider,
        qrMode: thunderDefault.qrMode,
        confirmationMode: thunderDefault.confirmationMode,
        receiptUploadEnabled: thunderDefault.receiptUploadEnabled,
        slipRequired: thunderDefault.slipRequired,
        autoVerificationSupported: thunderDefault.autoVerificationSupported,
        webhookSupported: thunderDefault.webhookSupported
    }, { region: "TH", enabled: false, paymentType: "manual", provider: "thunder_promptpay", qrMode: "aziel_promptpay_dynamic", confirmationMode: "thunder_slip", receiptUploadEnabled: true, slipRequired: true, autoVerificationSupported: true, webhookSupported: false });
    assert.strictEqual(normalizePaymentMethodKey("thunder_promptpay"), "thunder_promptpay");
    assert.strictEqual(isProviderValidFor("TH", "manual", "thunder_promptpay"), true);
    assert.strictEqual(isProviderValidFor("MM", "manual", "thunder_promptpay"), false);
    assert.strictEqual(isProviderValidFor("TH", "auto", "thunder_promptpay"), false, "Thunder remains a receipt-upload/manual rail, not an Omise auto rail");

    const coerced = applyCompatibilityModes({ ...thunderDefault, enabled: true, paymentType: "auto", provider: "promptpay", qrMode: "provider_generated", confirmationMode: "provider_webhook", receiptUploadEnabled: false, slipRequired: false, autoVerificationSupported: false, webhookSupported: true });
    assert.strictEqual(coerced.paymentType, "manual");
    assert.strictEqual(coerced.provider, "thunder_promptpay");
    assert.strictEqual(coerced.confirmationMode, "thunder_slip");
    assert.strictEqual(coerced.qrMode, "aziel_promptpay_dynamic");
    assert.strictEqual(coerced.receiptUploadEnabled, true);
    assert.strictEqual(coerced.slipRequired, true);
    assert.strictEqual(coerced.autoVerificationSupported, true);
    assert.strictEqual(coerced.webhookSupported, false);

    const draftWithoutAccount = applyCompatibilityModes({
        ...thunderDefault,
        accountNumber: "",
        promptPayRecipientType: "PHONE",
        promptPayRecipientValue: "0812345678"
    });
    await assert.doesNotReject(() => validatePaymentMethodConfiguration(draftWithoutAccount));
    await assert.rejects(
        () => validatePaymentMethodConfiguration({ ...draftWithoutAccount, enabled: true }),
        /Thunder PromptPay requires the AZIEL receiving bank account number/
    );

    const priorKey = process.env.THUNDER_API_KEY;
    delete process.env.THUNDER_API_KEY;
    let state = paymentMethodCapabilityState({ ...thunderDefault, enabled: true, accountNumber: "1234567890", promptPayRecipientType: "PHONE", promptPayRecipientValue: "0812345678" });
    assert(state.missingConfiguration.includes("Thunder API key"));
    process.env.THUNDER_API_KEY = "test-only-not-a-real-key";
    state = paymentMethodCapabilityState({ ...thunderDefault, enabled: true, accountNumber: "", promptPayRecipientType: "PHONE", promptPayRecipientValue: "0812345678" });
    assert(state.missingConfiguration.includes("Thunder receiving bank account"));
    state = paymentMethodCapabilityState({ ...thunderDefault, enabled: false, accountNumber: "1234567890", promptPayRecipientType: "PHONE", promptPayRecipientValue: "0812345678" });
    assert.strictEqual(state.publicReady, true); assert.strictEqual(state.customerVisible, false);
    state = paymentMethodCapabilityState({ ...thunderDefault, enabled: true, accountNumber: "1234567890", promptPayRecipientType: "PHONE", promptPayRecipientValue: "0812345678" });
    assert.strictEqual(state.customerVisible, true);
    if (priorKey === undefined) delete process.env.THUNDER_API_KEY; else process.env.THUNDER_API_KEY = priorKey;
    assert(paymentMethodApplicableSections(thunderDefault).includes("account"));

    assert.strictEqual(manualDefault.confirmationMode, "manual_admin");
    assert.strictEqual(manualDefault.autoVerificationSupported, false);
    assert.strictEqual(walletDefault.confirmationMode, "wallet_internal");

    const adminSource = fs.readFileSync(path.join(__dirname, "../../frontend/js/admin-payments.js"), "utf8");
    assert(adminSource.includes('thunder_promptpay: { key: "thunder_promptpay", label: "PromptPay (Verified)"'));
    assert(adminSource.includes('<option value="thunder_slip"'));
    assert(adminSource.includes('payload.confirmationMode = "thunder_slip"'));
    assert(adminSource.includes('payload.paymentType = "manual"'));
    assert(adminSource.includes('payload.webhookSupported = false'));
    assert(adminSource.includes('the uploaded slip is verified automatically by Thunder'));
    assert(adminSource.includes('{ action: "upload_receipt", label: "Upload Payment Slip" }'));

    console.log("Admin Thunder payment configuration verification passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
