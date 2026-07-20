const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertIncludes(source, needle, label) {
    if (!source.includes(needle)) {
        throw new Error(`${label}: missing ${needle}`);
    }
}

function assertNotIncludes(source, needle, label) {
    if (source.includes(needle)) {
        throw new Error(`${label}: unexpected ${needle}`);
    }
}

function main() {
    const model = read("backend/models/PaymentMethod.js");
    [
        "appDisplayName",
        "deepLinkUrl",
        "appStoreUrl",
        "playStoreUrl",
        "enableSaveQr",
        "enableOpenApp",
        "enableChecklist",
        "dynamicQrSupported",
        "amountPrefillSupported",
        "referenceSupported",
        "galleryScanSupported",
        "slipRequired",
        "autoVerificationSupported",
        "webhookSupported",
        "checklistSteps",
        "sortOrder"
    ].forEach(field => assertIncludes(model, field, "PaymentMethod capability schema"));

    const routes = read("backend/routes/paymentMethods.js");
    assertIncludes(routes, 'router.get("/payment-methods"', "public payment methods route");
    assertIncludes(routes, 'router.get("/admin/payment-methods"', "admin payment methods route");
    assertIncludes(routes, 'router.post("/admin/payment-methods"', "admin create payment method route");
    assertIncludes(model, "providerConfig", "payment method model still owns provider config");
    assertIncludes(routes, "capabilityProjection", "safe customer capability projection");
    assertIncludes(routes, "formatAdminMethod", "dedicated admin projection");
    assertNotIncludes(routes.match(/function formatMethod[\s\S]*?function formatAdminMethod/)?.[0] || "", "providerConfig", "public projection excludes provider secrets");
    assertIncludes(routes, "safeUrl(body[key], { deeplink: true })", "deeplink validation");
    assertIncludes(routes, "CHECKLIST_ACTIONS", "checklist action allow-list");
    [
        'key: "promptpay"',
        'key: "scb"',
        'key: "bangkok_bank"',
        'key: "kplus"',
        'key: "krungsri"',
        'key: "wallet"',
        'enabled: item.enabled === true'
    ].forEach(token => assertIncludes(routes, token, "Thailand payment method seed ownership"));

    const admin = read("frontend/js/admin-payments.js");
    [
        "Add Payment Method",
        "Method Overview",
        "Customer Display",
        "Receiving Account",
        "QR Payment",
        "Bank App",
        "Customer Actions",
        "Verification",
        "Checklist",
        "Availability",
        "Advanced / System Information",
        "pm-app-name",
        "pm-deeplink",
        "pm-app-store",
        "pm-play-store",
        "pm-enable-save-qr",
        "pm-enable-open-app",
        "pm-enable-checklist",
        "pm-dynamic-qr",
        "pm-amount-prefill",
        "pm-reference",
        "pm-gallery-scan",
        "pm-slip-required",
        "pm-checklist-steps",
        "pm-add-checklist-step",
        "pm-step-action",
        "pm-step-label",
        "pm-step-up",
        "pm-step-down",
        "collectChecklistSteps",
        "/api/admin/payment-methods"
    ].forEach(token => assertIncludes(admin, token, "admin payment capabilities UI"));

    const paymentJs = read("frontend/js/payment.js");
    [
        "isPublicPaymentMethodUsable",
        "sortPaymentMethods",
        "getConfiguredThaiBankApps",
        "window.AZIEL_TH_BANK_APPS",
        "dataset.enableSaveQr",
        "dataset.enableOpenApp",
        "dataset.enableChecklist",
        "dataset.checklistSteps",
        "deepLinkUrl",
        "onerror=\"this.src='assets/payment/payment-neutral.svg'\""
    ].forEach(token => assertIncludes(paymentJs, token, "public payment method rendering"));

    const wallet = read("frontend/js/wallet.js");
    [
        "enableSaveQr",
        "enableOpenApp",
        "enableChecklist",
        "checklistSteps",
        "PaymentCheckoutSheet.show"
    ].forEach(token => assertIncludes(wallet, token, "wallet payment sheet capabilities"));

    const promptPay = read("frontend/js/payment/payment-promptpay.js");
    [
        "promptPayGuideState",
        "renderPromptPayGuidance",
        "promptPaySaveQr",
        "data-promptpay-open-app",
        "getPromptPayBankApps",
        "completeGuideStep(\"wait_for_confirmation\")"
    ].forEach(token => assertIncludes(promptPay, token, "PromptPay guided auto checkout"));
    assertNotIncludes(promptPay, "upload_receipt", "PromptPay does not request receipt upload");

    const sheet = read("frontend/js/payment/payment-checkout-sheet.js");
    [
        "azPaymentSheetSaveQr",
        "azPaymentSheetOpenBankApp",
        "azPaymentSheetChecklist",
        "downloadQr",
        "openPaymentApp",
        "updateChecklist(\"upload_receipt\")",
        "knownChecklistAction",
        "appStoreUrl",
        "playStoreUrl"
    ].forEach(token => assertIncludes(sheet, token, "shared checkout sheet capabilities"));

    const css = read("frontend/css/payment/payment-checkout-sheet.css");
    [
        ".az-payment-sheet__actions",
        ".az-payment-sheet__checklist",
        ".az-payment-sheet__fallback",
        "@media (max-width: 520px)"
    ].forEach(token => assertIncludes(css, token, "payment sheet responsive capability styling"));

    const gameCss = read("frontend/css/game/payment-grid.css");
    [
        ".promptpay-guide-actions",
        ".promptpay-guide-action",
        ".promptpay-guide-checklist",
        ".promptpay-app-fallback"
    ].forEach(token => assertIncludes(gameCss, token, "PromptPay guided payment styling"));

    console.log("verify-payment-ux-architecture: PASS");
}

main();
