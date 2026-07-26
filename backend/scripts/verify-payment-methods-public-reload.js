const assert = require("assert");

const {
    formatAdminMethod,
    formatMethod,
    toPaymentMethodObject
} = require("../routes/paymentMethods")._test;

function createPromptPayMethod(overrides = {}) {
    return {
        _id: "payment-method-promptpay",
        method: "PromptPay QR",
        key: "promptpay",
        region: "TH",
        enabled: true,
        paymentType: "manual",
        provider: "promptpay",
        qrMode: "aziel_promptpay_dynamic",
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        openAppMode: "bank_chooser",
        appLaunchMode: "APP_ONLY",
        appDisplayName: "Banking App",
        enableSaveQr: true,
        enableOpenApp: true,
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        referenceSupported: true,
        galleryScanSupported: true,
        slipRequired: true,
        autoVerificationSupported: false,
        webhookSupported: false,
        promptPayRecipientType: "PHONE",
        promptPayRecipientValue: "0812345678",
        dynamicQrExpiryMinutes: 15,
        checklistSteps: [
            { key: "save_qr", label: "Save QR", action: "save_qr", enabled: true, sortOrder: 10 },
            { key: "open_app", label: "Open Banking App", action: "open_app", enabled: true, sortOrder: 20 },
            { key: "scan_saved_qr", label: "Scan the saved QR and pay", action: "scan_saved_qr", enabled: true, sortOrder: 30 },
            { key: "upload_receipt", label: "Upload payment receipt", action: "upload_receipt", enabled: true, sortOrder: 40 }
        ],
        bankLaunchers: [
            {
                key: "scb",
                displayName: "SCB EASY",
                logoUrl: "/assets/payment/scb.png",
                enabled: true,
                sortOrder: 10,
                iosAppLaunchUrl: "scbeasy://",
                androidPackageName: "com.scb.phone",
                playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.scb.phone",
                verificationStatus: "verified"
            }
        ],
        sortOrder: 10,
        ...overrides
    };
}

function createDocumentLikeMethod(data) {
    return {
        toObject() {
            return { ...data };
        }
    };
}

function verifyPlainObjectProjection() {
    const plain = createPromptPayMethod();
    const projected = formatMethod(plain);

    assert.strictEqual(projected.key, "promptpay");
    assert.strictEqual(projected.method, "PromptPay QR");
    assert.strictEqual(projected.qrMode, "aziel_promptpay_dynamic");
    assert.strictEqual(projected.qrImage, null, "dynamic PromptPay must not expose uploaded/static QR in public projection");
    assert.strictEqual(projected.enableSaveQr, true);
    assert.strictEqual(projected.enableOpenApp, true);
    assert.strictEqual(projected.enableChecklist, true);
    assert.strictEqual(projected.receiptUploadEnabled, true);
    assert.strictEqual(Array.isArray(projected.bankLaunchers), true);
}

function verifyDocumentProjectionMatchesPlainProjection() {
    const plain = createPromptPayMethod();
    const documentProjected = formatMethod(createDocumentLikeMethod(plain));
    const plainProjected = formatMethod(plain);

    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(documentProjected)),
        JSON.parse(JSON.stringify(plainProjected)),
        "document and plain object payment method projections must match"
    );
}

function verifyAdminProjectionAcceptsPlainObject() {
    const adminProjection = formatAdminMethod(createPromptPayMethod({
        uploadedQrImage: "https://res.cloudinary.com/aziel/image/upload/payment/promptpay.png"
    }));

    assert.strictEqual(adminProjection.key, "promptpay");
    assert.strictEqual(adminProjection.qrImage, "https://res.cloudinary.com/aziel/image/upload/payment/promptpay.png");
    assert.strictEqual(adminProjection.qrMode, "aziel_promptpay_dynamic");
    assert.strictEqual(typeof adminProjection.customerVisible, "boolean");
}

function verifyReloadShapes() {
    const paymentMethodFromInitialLoad = createPromptPayMethod();
    const paymentMethodAfterCompletedAttemptReload = JSON.parse(JSON.stringify(paymentMethodFromInitialLoad));
    const paymentMethodAfterCancelledAttemptReload = JSON.parse(JSON.stringify(paymentMethodFromInitialLoad));

    [
        paymentMethodFromInitialLoad,
        paymentMethodAfterCompletedAttemptReload,
        paymentMethodAfterCancelledAttemptReload
    ].forEach((method, index) => {
        const projected = formatMethod(method);
        assert.strictEqual(projected.key, "promptpay", `reload shape ${index} should project promptpay`);
        assert.strictEqual(projected.qrMode, "aziel_promptpay_dynamic", `reload shape ${index} should preserve QR mode`);
    });
}

function verifyObjectNormalization() {
    const plain = createPromptPayMethod();
    assert.strictEqual(toPaymentMethodObject(plain), plain);
    assert.deepStrictEqual(toPaymentMethodObject(createDocumentLikeMethod(plain)), plain);
}

verifyObjectNormalization();
verifyPlainObjectProjection();
verifyDocumentProjectionMatchesPlainProjection();
verifyAdminProjectionAcceptsPlainObject();
verifyReloadShapes();

console.log("Payment methods public reload verification passed.");
