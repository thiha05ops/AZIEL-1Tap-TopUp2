"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { assertE2EMode, assertE2EMongoUri } = require("../e2e/e2eSafety");
const PaymentMethod = require("../models/PaymentMethod");
const CommerceOrder = require("../models/CommerceOrder");
const PaymentAttempt = require("../models/PaymentAttempt");
const paymentMethodsRoute = require("../routes/paymentMethods");
const {
    paymentMethodCapabilityState,
    PAYMENT_CONFIGURATION_KINDS
} = require("../services/paymentProviderRegistry");
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
        .filter(method => method.customerVisible === true);
}

async function verifyIsolatedAuthority() {
    assertE2EMode(process.env);
    const isolation = assertE2EMongoUri(process.env);
    assert.strictEqual(isolation.databaseName, "aziel_e2e_mm_payment_authority");
    await mongoose.connect(isolation.mongoUri, { serverSelectionTimeoutMS: 5000 });

    const fixtureKeys = ["ayapay", "kbzpay", "wavepay", "promptpay", "scb", "wallet"];
    await PaymentMethod.deleteMany({ key: { $in: fixtureKeys } });

    const mm = await PaymentMethod.create([
        {
            ...readyManualMethod("ayapay", "AYA Pay"),
            shortDescription: "Pay using the K PLUS mobile app",
            badgeText: "Bank App",
            appDisplayName: "SCB EASY",
            enableOpenApp: true,
            openAppMode: "direct",
            androidPackageName: "com.kasikorn.retail.mbanking.wap",
            promptPayRecipientType: "PHONE",
            promptPayRecipientValue: "legacy-contamination"
        },
        { ...readyManualMethod("kbzpay", "KBZPay"), maintenanceMessage: "Temporarily unavailable" },
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
    await PaymentMethod.create({
        key: "scb",
        method: "SCB",
        region: "TH",
        enabled: true,
        provider: "scb",
        paymentType: "deeplink",
        qrMode: "none",
        accountName: "Synthetic SCB Account",
        accountNumber: "E2E-SCB",
        appDisplayName: "SCB EASY",
        enableOpenApp: true,
        openAppMode: "direct",
        iosAppLaunchUrl: "scbeasy://",
        receiptUploadEnabled: true,
        slipRequired: true,
        confirmationMode: "manual_admin"
    });
    await PaymentMethod.create({
        key: "wallet",
        method: "AZIEL Wallet",
        region: "MM",
        enabled: true,
        provider: "wallet",
        paymentType: "wallet",
        qrMode: "none",
        confirmationMode: "wallet_internal",
        accountName: "Legacy irrelevant account",
        uploadedQrImage: "/assets/payment/legacy-wallet-qr.png",
        appDisplayName: "Legacy irrelevant app"
    });

    assert.deepStrictEqual(
        publicCapability(mm).map(method => method.key).sort(),
        ["ayapay", "wavepay"],
        "Maintenance must suppress KBZPay while ready AYA Pay and WavePay remain publicly capable."
    );

    const contaminatedAya = mm.find(method => method.key === "ayapay");
    const ayaCapability = paymentMethodCapabilityState(contaminatedAya);
    const ayaAdmin = formatAdminMethod(contaminatedAya);
    assert.strictEqual(ayaCapability.configurationKind, PAYMENT_CONFIGURATION_KINDS.MANUAL_QR);
    assert.strictEqual(ayaCapability.publicReady, true, "Irrelevant bank-app contamination must not make a complete Manual QR method unready.");
    assert(!ayaAdmin.applicableSections.includes("bankApp") && !ayaAdmin.applicableSections.includes("promptPay"));
    assert.strictEqual(ayaAdmin.appDisplayName, "", "AYA Admin projection must not expose stale SCB app identity.");
    assert.strictEqual(ayaAdmin.androidPackageName, "", "AYA Admin projection must not expose stale K PLUS package identity.");
    assert.strictEqual(ayaAdmin.promptPayRecipientValue, "", "AYA Admin projection must not expose irrelevant PromptPay recipient state.");
    assert.strictEqual(ayaAdmin.shortDescription, "", "AYA projection must suppress display text that identifies another payment provider.");
    assert.strictEqual(ayaAdmin.badgeText, "", "Manual QR projection must suppress a stale Bank App badge.");

    const kbzAdmin = formatAdminMethod(mm.find(method => method.key === "kbzpay"));
    assert.strictEqual(kbzAdmin.publicReady, true, "Maintenance must remain distinct from configuration readiness.");
    assert.strictEqual(kbzAdmin.customerVisible, false, "Maintenance must suppress backend customer visibility.");
    assert.strictEqual(kbzAdmin.unavailableReason, "maintenance");

    applyPaymentMethodPatch(contaminatedAya, {
        shortDescription: "Canonical AYA manual QR",
        appDisplayName: "Must not overwrite persisted contamination",
        androidPackageName: "com.example.must.not.apply",
        promptPayRecipientValue: "must-not-apply"
    });
    await contaminatedAya.save();
    const ayaAfterSave = await PaymentMethod.findOne({ key: "ayapay" });
    assert.strictEqual(ayaAfterSave.shortDescription, "Canonical AYA manual QR");
    assert.strictEqual(ayaAfterSave.appDisplayName, "SCB EASY", "Admin save must ignore irrelevant bank-app fields without deleting historical data.");
    assert.strictEqual(ayaAfterSave.promptPayRecipientValue, "legacy-contamination", "Admin save must ignore irrelevant PromptPay fields.");

    const scbAdmin = formatAdminMethod(await PaymentMethod.findOne({ key: "scb" }));
    assert.strictEqual(scbAdmin.configurationKind, PAYMENT_CONFIGURATION_KINDS.MANUAL_BANK_APP);
    assert(scbAdmin.applicableSections.includes("bankApp") && !scbAdmin.applicableSections.includes("promptPay"));
    const walletAdmin = formatAdminMethod(await PaymentMethod.findOne({ key: "wallet" }));
    assert.strictEqual(walletAdmin.configurationKind, PAYMENT_CONFIGURATION_KINDS.AZIEL_WALLET);
    assert.deepStrictEqual(walletAdmin.applicableSections.sort(), ["availability", "display", "wallet"]);
    assert.strictEqual(walletAdmin.appDisplayName, "", "Wallet projection must ignore legacy app fields.");
    assert.strictEqual(walletAdmin.qrImage, "", "Wallet projection must ignore legacy QR fields.");

    for (const method of mm) {
        applyPaymentMethodPatch(method, { enabled: false });
        await method.save();
    }

    const persisted = await PaymentMethod.find({ key: { $in: ["ayapay", "kbzpay", "wavepay"] } }).sort({ key: 1 });
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
