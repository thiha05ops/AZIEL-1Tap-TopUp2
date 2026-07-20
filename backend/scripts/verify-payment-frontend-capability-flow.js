const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function main() {
    [
        "frontend/js/payment.js",
        "frontend/js/region-payment.js"
    ].forEach(file => {
        includes(file, ".__paymentMethod", "payment card must retain full PaymentMethod object");
        includes(file, "...originalMethod", "selected payment must preserve original PaymentMethod fields");
        includes(file, "receiptUploadEnabled", "selected payment must preserve receiptUploadEnabled");
        includes(file, "galleryScanSupported", "selected payment must preserve galleryScanSupported");
        includes(file, "checklistSteps: Array.isArray(originalMethod.checklistSteps)", "selected payment must preserve checklistSteps array");
    });

    includes("frontend/js/payment/payment-engine.js", "attemptSession.selectedPaymentMethod = selectedPayment", "manual attempt session must carry selected PaymentMethod");
    includes("frontend/js/payment/payment-engine.js", "paymentSession.selectedPaymentMethod = selectedPayment", "auto session must carry selected PaymentMethod");

    [
        "frontend/js/payment/payment-manual.js",
        "frontend/js/payment/payment-deeplink.js"
    ].forEach(file => {
        includes(file, "paymentSession.selectedPaymentMethod", "payment module must read selected PaymentMethod from session");
        includes(file, "...payment", "PaymentCheckoutSheet options must include full selected PaymentMethod object");
        includes(file, "enableSaveQr", "PaymentCheckoutSheet options must preserve enableSaveQr");
        includes(file, "enableOpenApp", "PaymentCheckoutSheet options must preserve enableOpenApp");
        includes(file, "enableChecklist", "PaymentCheckoutSheet options must preserve enableChecklist");
        includes(file, "appDisplayName", "PaymentCheckoutSheet options must preserve appDisplayName");
        includes(file, "deepLinkUrl", "PaymentCheckoutSheet options must preserve deepLinkUrl");
        includes(file, "galleryScanSupported", "PaymentCheckoutSheet options must preserve galleryScanSupported");
        includes(file, "receiptUploadEnabled", "PaymentCheckoutSheet options must preserve receiptUploadEnabled");
        includes(file, "checklistSteps", "PaymentCheckoutSheet options must preserve checklistSteps");
    });

    const sheet = read("frontend/js/payment/payment-checkout-sheet.js");
    [
        "options.enableSaveQr",
        "options.enableOpenApp",
        "options.deepLink",
        "options.appDisplayName",
        "options.checklistSteps",
        "renderChecklist",
        "updateChecklist(\"upload_receipt\")"
    ].forEach(snippet => assert(sheet.includes(snippet), `payment checkout sheet must consume ${snippet}`));

    console.log("Payment frontend capability flow verification passed.");
}

main();
