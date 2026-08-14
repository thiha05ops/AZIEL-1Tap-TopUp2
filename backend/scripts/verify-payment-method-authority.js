"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { assertE2EMode, assertE2EMongoUri } = require("../e2e/e2eSafety");
const PaymentMethod = require("../models/PaymentMethod");
const CommerceOrder = require("../models/CommerceOrder");
const PaymentAttempt = require("../models/PaymentAttempt");
const paymentMethodsRoute = require("../routes/paymentMethods");
const {
    loadPromptPayMethod,
    startCustomerManualPromptPayCheckout,
    ERROR_CODES
} = require("../services/commerce/customerManualPromptPayCheckoutService");

const { applyPaymentMethodPatch, formatAdminMethod, formatMethod } = paymentMethodsRoute._test;

function readyManualMethod(key, method, region = "MM") {
    return {
        key,
        method,
        region,
        enabled: true,
        provider: key,
        paymentType: "manual",
        qrMode: "uploaded_static",
        uploadedQrImage: `/assets/payment/${key}.png`,
        accountName: "Synthetic E2E Account",
        accountNumber: `E2E-${key}`,
        receiptUploadEnabled: true,
        slipRequired: true,
        confirmationMode: "manual_admin"
    };
}

function publicCapability(methods) {
    return methods
        .map(formatMethod)
        .filter(method => method.enabled === true && method.publicReady === true);
}

async function verifyIsolatedAuthority() {
    assertE2EMode(process.env);
    const isolation = assertE2EMongoUri(process.env);
    assert.strictEqual(isolation.databaseName, "aziel_e2e_mm_payment_authority");
    await mongoose.connect(isolation.mongoUri, { serverSelectionTimeoutMS: 5000 });

    const fixtureKeys = ["ayapay", "kbzpay", "wavepay", "promptpay"];
    await PaymentMethod.deleteMany({ key: { $in: fixtureKeys } });

    const mm = await PaymentMethod.create([
        readyManualMethod("ayapay", "AYA Pay"),
        readyManualMethod("kbzpay", "KBZPay"),
        readyManualMethod("wavepay", "WavePay")
    ]);
    await PaymentMethod.create({
        ...readyManualMethod("promptpay", "PromptPay QR", "TH"),
        provider: "promptpay",
        qrMode: "aziel_promptpay_dynamic",
        uploadedQrImage: "",
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        promptPayRecipientType: "PHONE",
        promptPayRecipientValue: "0000000000"
    });

    assert.deepStrictEqual(
        publicCapability(mm).map(method => method.key).sort(),
        ["ayapay", "kbzpay", "wavepay"],
        "Ready enabled Myanmar fixtures must initially be publicly capable."
    );

    for (const method of mm) {
        applyPaymentMethodPatch(method, { enabled: false });
        await method.save();
    }

    const persisted = await PaymentMethod.find({ region: "MM" }).sort({ key: 1 });
    assert(persisted.every(method => method.enabled === false), "Admin mutation contract must persist enabled=false.");
    assert(
        persisted.every(method => formatAdminMethod(method).customerVisible === false),
        "Admin projection must hide every disabled Myanmar method."
    );
    assert.deepStrictEqual(publicCapability(persisted), [], "Public capability must exclude every disabled Myanmar method.");

    const before = {
        orders: await CommerceOrder.countDocuments({}),
        attempts: await PaymentAttempt.countDocuments({})
    };
    await assert.rejects(
        () => startCustomerManualPromptPayCheckout(
            {
                productCode: "mlbb",
                packageCode: "PKG-MM-E2E",
                region: "MM",
                currency: "MMK",
                paymentMethod: "ayapay",
                checkoutKey: "forged-disabled-aya-e2e"
            },
            { user: { id: "synthetic-mm-authority-customer" } },
            {
                loadCatalogPackage: async () => ({
                    pkg: { _id: new mongoose.Types.ObjectId(), name: "Synthetic Package", metadata: {} },
                    price: { amount: 1000, currency: "MMK", enabled: true },
                    region: "MM",
                    currency: "MMK",
                    productCode: "mlbb",
                    packageCode: "PKG-MM-E2E"
                }),
                assertFulfillmentReady: async () => ({ fulfillmentAvailable: true })
            }
        ),
        error => error.code === ERROR_CODES.PAYMENT_METHOD_UNAVAILABLE && !/PromptPay QR/i.test(error.message)
    );
    const after = {
        orders: await CommerceOrder.countDocuments({}),
        attempts: await PaymentAttempt.countDocuments({})
    };
    assert.deepStrictEqual(after, before, "Rejected disabled AYA Pay must not create CommerceOrder or PaymentAttempt records.");

    const promptPay = await loadPromptPayMethod({ paymentMethod: "promptpay" }, "TH");
    assert.strictEqual(promptPay.key, "promptpay", "Thailand PromptPay must remain isolated and available.");

    console.log("Isolated payment-method authority verification passed.");
}

verifyIsolatedAuthority()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
