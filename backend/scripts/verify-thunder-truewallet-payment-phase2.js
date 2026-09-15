"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { paymentMethodCapabilityState, paymentConfigurationKind, PAYMENT_CONFIGURATION_KINDS } = require("../services/paymentProviderRegistry");
const { defaultMethods, formatMethod, applyCompatibilityModes, applyPaymentMethodPatch } = require("../routes/paymentMethods")._test;
const { loadManualPaymentMethod } = require("../services/commerce/customerManualPaymentCheckoutService");

async function main() {
    const previousKey = process.env.THUNDER_API_KEY;
    const previousReceiver = process.env.AZIEL_TRUEMONEY_RECEIVER_ACCOUNT;
    const previousTemplate = process.env.AZIEL_TRUEMONEY_QR_TEMPLATE;
    try {
        const seeded = defaultMethods.find(method => method.key === "truewallet");
        assert(seeded, "TrueMoney seed must exist");
        assert.strictEqual(seeded.enabled, false, "TrueMoney must seed disabled");
        assert.strictEqual(paymentConfigurationKind(seeded), PAYMENT_CONFIGURATION_KINDS.TRUE_MONEY_WALLET);

        process.env.THUNDER_API_KEY = "test-key";
        process.env.AZIEL_TRUEMONEY_RECEIVER_ACCOUNT = "0891234567";
        process.env.AZIEL_TRUEMONEY_QR_TEMPLATE = "00020101021129390016A00000067701011103151400006409729845802TH530376463048136";
        const stale = { ...seeded, enabled: true, accountName: "AZIEL", accountNumber: "089-123-4567", qrMode: "none", dynamicQrSupported: false, amountPrefillSupported: false };
        assert.deepStrictEqual(paymentMethodCapabilityState(stale).missingConfiguration, ["TrueMoney template dynamic QR mode", "dynamic QR supported", "amount prefill supported"]);
        const ready = applyCompatibilityModes({ ...seeded, enabled: true, accountName: "AZIEL", accountNumber: "089-123-4567" });
        assert.strictEqual(paymentMethodCapabilityState(ready).customerVisible, true);
        const publicMethod = formatMethod(ready);
        assert.strictEqual(publicMethod.method, "TrueMoney Wallet");
        assert.strictEqual(publicMethod.paymentChannel, "TRUE_MONEY_WALLET");
        assert.strictEqual(publicMethod.qrImage, null);
        assert.strictEqual(publicMethod.qrMode, "truemoney_template_dynamic");
        assert.strictEqual(publicMethod.dynamicQrSupported, true);
        assert.strictEqual(publicMethod.amountPrefillSupported, true);
        assert(!JSON.stringify(publicMethod).includes("test-key"), "Public method must not expose Thunder credentials");
        assert(!JSON.stringify(publicMethod).includes("0891234567"), "Public readiness must not expose the server verification authority");

        assert.throws(() => applyPaymentMethodPatch({ ...ready }, {
            provider: "promptpay", paymentType: "auto", paymentChannel: "PROMPTPAY"
        }), /Provider is not valid/, "Forged incompatible identity must be rejected");
        const forged = { ...ready };
        applyPaymentMethodPatch(forged, {
            confirmationMode: "provider_webhook", qrMode: "none", dynamicQrSupported: false,
            amountPrefillSupported: false, receiptUploadEnabled: false, slipRequired: false
        });
        assert.deepStrictEqual({
            provider: forged.provider, paymentType: forged.paymentType, paymentChannel: forged.paymentChannel,
            confirmationMode: forged.confirmationMode, qrMode: forged.qrMode,
            dynamicQrSupported: forged.dynamicQrSupported, amountPrefillSupported: forged.amountPrefillSupported,
            receiptUploadEnabled: forged.receiptUploadEnabled, slipRequired: forged.slipRequired
        }, {
            provider: "truewallet", paymentType: "manual", paymentChannel: "TRUE_MONEY_WALLET",
            confirmationMode: "thunder_truewallet_slip", qrMode: "truemoney_template_dynamic",
            dynamicQrSupported: true, amountPrefillSupported: true,
            receiptUploadEnabled: true, slipRequired: true
        }, "Forged browser values must not override authoritative TrueMoney invariants");

        delete process.env.THUNDER_API_KEY;
        assert.strictEqual(paymentMethodCapabilityState(ready).customerVisible, false, "Missing Thunder configuration must hide TrueMoney");
        process.env.THUNDER_API_KEY = "test-key";
        const wrongRail = { ...ready, paymentChannel: "PROMPTPAY" };
        assert.strictEqual(paymentMethodCapabilityState(wrongRail).customerVisible, false, "Wrong rail must hide TrueMoney");
        const wrongReceiver = { ...ready, accountNumber: "0812345678" };
        assert.strictEqual(paymentMethodCapabilityState(wrongReceiver).customerVisible, false, "Receiver mismatch must hide TrueMoney");

        const loaded = await loadManualPaymentMethod({ key: "truewallet", region: "TH" }, { findPaymentMethods: async () => [ready] });
        assert.strictEqual(loaded.confirmationMode, "thunder_truewallet_slip");
        await assert.rejects(
            () => loadManualPaymentMethod({ key: "truewallet", region: "MM" }, { findPaymentMethods: async () => [{ ...ready, region: "MM" }] }),
            error => error.code === "PAYMENT_METHOD_UNAVAILABLE"
        );
        const frontendRoot = path.resolve(__dirname, "../../frontend");
        const manualUi = fs.readFileSync(path.join(frontendRoot, "js/payment/payment-manual.js"), "utf8");
        const sheetUi = fs.readFileSync(path.join(frontendRoot, "js/payment/payment-checkout-sheet.js"), "utf8");
        assert(manualUi.includes("trueMoneyWallet: trueWallet"), "TrueMoney must retain its dedicated payment-sheet presentation context");
        assert(manualUi.includes("qrImageUrl: qr"), "TrueMoney session QR must flow into the existing payment sheet");
        assert(sheetUi.includes("azPaymentSheetMethodLogo"), "Payment sheet must render the configured method logo");
        assert(sheetUi.includes("Scan this QR with TrueMoney"), "TrueMoney sheet must show scan guidance");
        assert(sheetUi.includes("azPaymentSheetSlipInput"), "TrueMoney sheet must preserve slip upload");
        console.log("Thunder TrueMoney Wallet Phase 2 verification passed.");
    } finally {
        if (previousKey === undefined) delete process.env.THUNDER_API_KEY; else process.env.THUNDER_API_KEY = previousKey;
        if (previousReceiver === undefined) delete process.env.AZIEL_TRUEMONEY_RECEIVER_ACCOUNT; else process.env.AZIEL_TRUEMONEY_RECEIVER_ACCOUNT = previousReceiver;
        if (previousTemplate === undefined) delete process.env.AZIEL_TRUEMONEY_QR_TEMPLATE; else process.env.AZIEL_TRUEMONEY_QR_TEMPLATE = previousTemplate;
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
