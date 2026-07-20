const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function main() {
    [
        "backend/models/PaymentMethod.js",
        "backend/routes/paymentMethods.js"
    ].forEach(file => {
        [
            "logoUrl",
            "shortDescription",
            "badgeText",
            "recipientLabel",
            "referenceInstructions",
            "qrMode",
            "receiptUploadEnabled",
            "confirmationMode",
            "availabilitySchedule"
        ].forEach(snippet => includes(file, snippet, "final payment method field missing"));
    });

    includes("backend/routes/paymentMethods.js", "canonicalProviderForMethod", "backend must auto-assign provider from method identity");
    includes("backend/routes/paymentMethods.js", "applyCompatibilityModes", "backend must prevent incompatible PromptPay/wallet/manual combinations");
    includes("backend/routes/paymentMethods.js", '"/admin/upload-payment-logo"', "dedicated logo upload route missing");
    includes("backend/routes/paymentMethods.js", "paymentMethodReadiness", "readiness validation must remain backend-owned");

    const admin = "frontend/js/admin-payments.js";
    [
        "Method Overview",
        "Customer Display",
        "Receiving Account",
        "QR Payment",
        "Bank App",
        "Customer Actions",
        "Verification",
        "Availability",
        "Advanced / System Information",
        "payment-method-editor",
        "admin-payment-card-preview",
        "showAdminPaymentPreview",
        "adminPaymentPreviewModal",
        "Use Manual Bank Preset",
        "Use PromptPay Auto Preset",
        "Clear Steps",
        "collectAdminPaymentFormState",
        "getMethodChoices",
        "already exists for"
    ].forEach(snippet => includes(admin, snippet, "admin final UX contract missing"));

    notIncludes(admin, '<select class="pm-provider"', "normal admin UI must not expose provider selector");
    notIncludes(admin, ">Omise<", "normal admin UI must not mention Omise/OPN");

    [
        "frontend/js/payment.js",
        "frontend/js/region-payment.js"
    ].forEach(file => {
        includes(file, "shortDescription", "customer cards must render short description");
        includes(file, "badgeText", "customer cards must render optional badge");
        includes(file, "method.publicReady === false", "customer cards must hide incomplete methods");
        notIncludes(file, "Omise", "customer payment code must not render Omise label");
        notIncludes(file, "OPN", "customer payment code must not render OPN label");
    });

    [
        "frontend/css/admin/admin.css",
        "frontend/css/game/payment-grid.css"
    ].forEach(file => {
        includes(file, "payment", "payment UX styles must be present");
    });

    console.log("Payment Methods Admin UX verification passed.");
}

main();
