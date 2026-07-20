const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const {
    buildPromptPayPayload,
    createPromptPayQr,
    decodePromptPayPayload,
    normalizePromptPayReference,
    normalizePromptPayRecipient,
    qrImageMatchesPayload,
    validatePromptPayPayloadCrc
} = require("../services/promptPayQrService");
const { paymentMethodReadiness } = require("../services/paymentProviderRegistry");

const REFERENCED_PROMPTPAY_GOLDEN_VECTOR = "00020101021229370016A000000677010111011300668123456785802TH530376454071490.0062200516AZL-20260721-00163041D64";

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function assertThrowsCode(fn, code, message) {
    try {
        fn();
    } catch (error) {
        assert.strictEqual(error.code, code, message);
        return;
    }
    assert.fail(message);
}

function topLevelTagOrder(payload = "") {
    const order = [];
    let index = 0;
    while (index + 4 <= payload.length) {
        const id = payload.slice(index, index + 2);
        const length = Number(payload.slice(index + 2, index + 4));
        assert(/^\d{2}$/.test(id), "Payload tag IDs must be two numeric digits.");
        assert(Number.isFinite(length) && length >= 0, "Payload tag lengths must be valid.");
        const end = index + 4 + length;
        assert(end <= payload.length, "Payload tag length must not exceed payload length.");
        order.push(id);
        index = end;
    }
    assert.strictEqual(index, payload.length, "Payload must not contain trailing bytes.");
    return order;
}

function decodedCrc(payload = "") {
    const match = String(payload || "").match(/6304([0-9A-F]{4})$/i);
    return match ? match[1].toUpperCase() : "";
}

function validDynamicMethod(overrides = {}) {
    return {
        method: "SCB",
        key: "scb",
        region: "TH",
        paymentType: "deeplink",
        provider: "scb",
        accountName: "AZIEL",
        accountNumber: "PromptPay",
        qrMode: "aziel_promptpay_dynamic",
        promptPayRecipientType: "PHONE",
        promptPayRecipientValue: "0812345678",
        dynamicQrExpiryMinutes: 15,
        enableSaveQr: true,
        enableOpenApp: true,
        appDisplayName: "SCB EASY",
        appLaunchMode: "APP_ONLY",
        iosAppLaunchUrl: "scbeasy://",
        androidAppLaunchUrl: "scbeasy://",
        enableChecklist: true,
        dynamicQrSupported: true,
        amountPrefillSupported: true,
        galleryScanSupported: true,
        slipRequired: true,
        receiptUploadEnabled: true,
        confirmationMode: "manual_admin",
        checklistSteps: [
            { action: "save_qr", label: "Save QR", enabled: true, sortOrder: 10 },
            { action: "open_app", label: "Open Bank App", enabled: true, sortOrder: 20 },
            { action: "upload_receipt", label: "Upload Receipt", enabled: true, sortOrder: 30 }
        ],
        ...overrides
    };
}

async function verifyQrPayload() {
    const payloadA = buildPromptPayPayload({
        recipientType: "PHONE",
        recipientValue: "0812345678",
        amount: 1490,
        orderReference: "AZL-20260721-001"
    });
    const payloadB = buildPromptPayPayload({
        recipientType: "PHONE",
        recipientValue: "0812345678",
        amount: 1491,
        orderReference: "AZL-20260721-001"
    });

    assert.notStrictEqual(payloadA, payloadB, "QR payload must change when amount changes.");
    assert.strictEqual(payloadA, REFERENCED_PROMPTPAY_GOLDEN_VECTOR, "PromptPay payload must match the reference-bearing AZIEL golden vector byte-for-byte.");
    assert.deepStrictEqual(topLevelTagOrder(payloadA), ["00", "01", "29", "58", "53", "54", "62", "63"], "PromptPay top-level tag order must include Additional Data before CRC.");
    assert(payloadA.includes("0066812345678"), "QR payload must contain the configured normalized PromptPay recipient.");
    assert(payloadA.includes("54071490.00"), "QR payload must contain amount field.");
    assert(payloadA.includes("62200516AZL-20260721-001"), "QR payload must contain Additional Data Field Template tag 62 with subtag 05 reference label.");
    assert(validatePromptPayPayloadCrc(payloadA), "QR payload CRC must be valid.");
    assert.strictEqual(decodedCrc(payloadA), "1D64", "PromptPay reference-bearing golden vector CRC must match expected output.");
    const decodedA = decodePromptPayPayload(payloadA);
    assert.strictEqual(decodedA.amountText, "1490.00", "Decoded QR payload must contain the exact expected amount.");
    assert.strictEqual(decodedA.amount, 1490, "Decoded QR amount must match finalized amount.");
    assert.strictEqual(decodedA.currency, "764", "Decoded QR currency must be Thai Baht numeric code.");
    assert.strictEqual(decodedA.country, "TH", "Decoded QR country must be Thailand.");
    assert.strictEqual(decodedA.additionalData.referenceLabel, "AZL-20260721-001", "Decoded QR additional data reference label must match server-owned AZIEL reference.");
    assert.strictEqual(decodedA.merchantAccountInfo.applicationId, "A000000677010111", "Decoded QR must use PromptPay AID.");
    assert.strictEqual(decodedA.merchantAccountInfo.proxyTag, "01", "Phone PromptPay recipient must be encoded directly in merchant subtag 01.");
    assert.strictEqual(decodedA.merchantAccountInfo.proxyValue, "0066812345678", "Decoded QR recipient must match configured recipient.");
    assert.strictEqual(decodedA.crcValid, true, "Decoded QR CRC must be valid.");
    assert(!payloadA.includes("01020102130066812345678"), "PromptPay merchant account info must not encode a separate proxy type field before the phone.");

    const recipient = normalizePromptPayRecipient("PHONE", "0812345678");
    assert.deepStrictEqual(recipient, {
        recipientType: "PHONE",
        proxyTag: "01",
        proxyValue: "0066812345678"
    });
    assert.strictEqual(normalizePromptPayReference("azl-20260721-001!!"), "AZL-20260721-001", "PromptPay reference normalization must preserve compact AZIEL reference safely.");

    const result = await createPromptPayQr({
        method: validDynamicMethod(),
        amount: "1490.00",
        currency: "THB",
        orderReference: "AZL-20260721-001"
    });
    assert(result.qrImage.startsWith("data:image/png;base64,"), "QR image must be generated server-side as a data URL.");
    assert.strictEqual(result.orderReference, "AZL-20260721-001");
    assert.strictEqual(result.encodedReference, "AZL-20260721-001", "Backend QR result must expose safe encoded reference metadata.");
    assert.strictEqual(result.amount, 1490, "Backend QR result must preserve finalized amount unchanged.");
    assert.strictEqual(result.encodedAmount, "1490.00", "Backend QR result must expose decoded encoded amount.");
    assert.strictEqual(result.qrPayload, REFERENCED_PROMPTPAY_GOLDEN_VECTOR, "Generated QR response payload must match reference-bearing golden vector byte-for-byte.");
    assert.strictEqual(decodePromptPayPayload(result.qrPayload).amountText, "1490.00", "Generated QR must decode to expected amount before return.");
    assert.strictEqual(decodePromptPayPayload(result.qrPayload).additionalData.referenceLabel, "AZL-20260721-001", "Generated QR must decode to expected reference before return.");
    assert.strictEqual(result.qrImagePayloadMatches, true, "Backend QR result must prove returned QR image matches qrPayload.");
    assert.strictEqual(qrImageMatchesPayload(result.qrImage, result.qrPayload), true, "Verifier must inspect generated QR image pixels and match them to qrPayload.");

    assertThrowsCode(() => buildPromptPayPayload({
        recipientType: "PHONE",
        recipientValue: "0812345678",
        amount: "10.123",
        orderReference: "AZL-20260721-001"
    }), "PROMPTPAY_AMOUNT_INVALID", "Invalid amount must be rejected.");
}

function verifyReadiness() {
    const ready = paymentMethodReadiness(validDynamicMethod());
    assert.deepStrictEqual(ready, { ready: true, missing: [] }, "APP_ONLY dynamic PromptPay method must be public ready without official deeplink.");

    const recipientOnly = paymentMethodReadiness(validDynamicMethod({
        accountName: "",
        accountNumber: ""
    }));
    assert.deepStrictEqual(recipientOnly, { ready: true, missing: [] }, "Dynamic PromptPay readiness must use configured recipient, not public account fields.");

    const needsDeeplink = paymentMethodReadiness(validDynamicMethod({
        appLaunchMode: "OFFICIAL_PAYMENT_DEEPLINK",
        deepLinkUrl: ""
    }));
    assert(needsDeeplink.missing.includes("deep link URL"), "Official payment deeplink mode must still require deep link URL.");

    const noRecipient = paymentMethodReadiness(validDynamicMethod({
        promptPayRecipientValue: ""
    }));
    assert(noRecipient.missing.includes("PromptPay recipient"), "Dynamic QR must require configured server-side recipient.");
}

function verifyBackendRoute() {
    const route = read("backend/routes/paymentMethods.js");
    includes("backend/routes/paymentMethods.js", 'router.post("/payment-methods/:key/promptpay-qr"', "dynamic PromptPay endpoint must exist.");
    includes("backend/routes/paymentMethods.js", "PaymentMethod.findOne", "endpoint must resolve PaymentMethod from database.");
    includes("backend/routes/paymentMethods.js", "ManualPaymentAttempt.findOne", "endpoint must resolve server-owned manual payment attempt.");
    includes("backend/routes/paymentMethods.js", "createPromptPayQr({", "endpoint must use centralized QR service.");
    includes("backend/routes/paymentMethods.js", "orderReference: attempt.reference", "endpoint must encode server-owned attempt reference, not arbitrary browser reference.");
    includes("backend/routes/paymentMethods.js", "amount: attempt.finalAmount || attempt.canonicalAmount || req.body.amount", "endpoint must prefer server-owned finalized amount.");
    includes("backend/routes/paymentMethods.js", "currency: attempt.canonicalCurrency || req.body.currency", "endpoint must prefer server-owned currency.");
    includes("backend/routes/paymentMethods.js", "\"instructions.dynamicQr.encodedReference\": result.encodedReference", "endpoint must snapshot encoded reference onto attempt.");
    includes("backend/models/ManualPaymentAttempt.js", "encodedReference", "ManualPaymentAttempt must persist encoded QR reference.");
    includes("backend/models/Order.js", "encodedReference", "Order manualPaymentQr snapshot must persist encoded QR reference.");
    assert(!/promptPayRecipient(Value|Type)\s*:\s*req\.body/.test(route), "endpoint must not accept PromptPay recipient from client input.");
    assert(!/orderReference:\s*req\.body\.orderReference/.test(route), "endpoint must not pass browser-supplied reference into QR payload generation.");
}

function verifyFrontendFlow() {
    includes("frontend/js/payment/payment-checkout-sheet.js", "requestDynamicPromptPayQr", "checkout sheet must generate QR after finalized amount/reference.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "qrMode === \"aziel_promptpay_dynamic\"", "checkout sheet must identify AZIEL dynamic PromptPay QR mode.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "setQrLoading(true)", "checkout sheet must show QR loading state.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "azPaymentSheetRetryQr", "checkout sheet must provide retry state.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "sessionStorage.setItem", "checkout state must persist in sessionStorage.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "sameCheckoutIdentity", "checkout restore must validate amount, method, currency, reference, and QR mode.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "DYNAMIC_PROMPTPAY_QR_VERSION", "checkout restore must version-bust old dynamic QR payloads.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "setQrImage(data.qrImage, \"dynamic_response\", data.qrPayload)", "dynamic generation success must render the current response QR image and payload.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Please choose your payment receipt first.", "receipt remains required.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Please generate the payment QR before submitting your receipt.", "dynamic QR generation is required before submit.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "window.PaymentQrSaver", "Save QR must reuse Blob/Web Share/download implementation.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "resolveAppLaunchTarget", "Open App must use capability-owned launcher URLs.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Bank app could not be opened.", "Open App failure must be non-blocking.");
    assert(/const qr = dynamicQr\s*\?\s*""\s*:\s*normalizeUrl\(options\.qrImageUrl/.test(read("frontend/js/payment/payment-checkout-sheet.js")), "Dynamic mode must not fall back to configured static QR before generation.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "paymentStatus: \"paid\"", "checkout sheet must not mark payments paid.");
}

function verifyManualSubmission() {
    includes("backend/routes/payment.js", "MANUAL_DYNAMIC_QR_REQUIRED", "manual slip submission must require generated QR for dynamic PromptPay attempts.");
    includes("backend/routes/payment.js", "status: ORDER_STATES.PENDING_PAYMENT", "manual slip creates pending order only.");
    includes("backend/routes/payment.js", "paymentStatus: PAYMENT_STATES.PENDING", "manual slip creates pending payment only.");
    includes("backend/routes/payment.js", "manualPaymentQr", "order must preserve generated QR reference snapshot.");
}

function verifyStaticAndGatewayPreserved() {
    includes("frontend/js/payment/payment-engine.js", "PaymentPromptPay.show", "PromptPay gateway flow must remain available.");
    includes("frontend/js/payment/payment-engine.js", "PaymentWallet.pay", "Wallet flow must remain available.");
    includes("backend/routes/paymentMethods.js", "uploaded_static", "static QR mode must remain available.");
    includes("backend/routes/paymentMethods.js", "provider_generated", "provider-generated QR mode must remain available.");
}

async function main() {
    await verifyQrPayload();
    verifyReadiness();
    verifyBackendRoute();
    verifyFrontendFlow();
    verifyManualSubmission();
    verifyStaticAndGatewayPreserved();
    console.log("Manual dynamic PromptPay flow verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
