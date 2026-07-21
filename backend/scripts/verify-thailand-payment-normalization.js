const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function main() {
    const paymentJs = read("frontend/js/payment.js");
    const regionPaymentJs = read("frontend/js/region-payment.js");
    const checkout = read("frontend/js/payment/payment-checkout-sheet.js");
    const paymentMethodsRoute = read("backend/routes/paymentMethods.js");

    includes("backend/models/PaymentMethod.js", 'enum: ["direct", "bank_chooser", "disabled"]', "PaymentMethod must define openAppMode.");
    includes("backend/models/PaymentMethod.js", '"provider_webhook"', "PaymentMethod must support provider_webhook confirmation mode.");
    includes("backend/models/ManualPaymentAttempt.js", "openAppMode", "ManualPaymentAttempt must snapshot openAppMode.");
    includes("backend/models/ManualPaymentAttempt.js", "confirmationMode", "ManualPaymentAttempt must snapshot confirmationMode.");
    includes("backend/models/Order.js", "paymentExecutionPolicy", "Order must snapshot payment execution policy.");

    includes("backend/services/manualPaymentAttemptService.js", "confirmationMode: method.confirmationMode || \"manual_admin\"", "Manual attempts must snapshot confirmation mode.");
    includes("backend/services/manualPaymentAttemptService.js", "openAppMode: method.enableOpenApp === true ? (method.openAppMode || \"direct\") : \"disabled\"", "Manual attempts must snapshot open app mode.");
    includes("backend/routes/payment.js", "paymentExecutionPolicy", "Manual receipt order creation must persist execution policy snapshot.");

    includes("backend/routes/paymentMethods.js", "validatePaymentMethodConfiguration", "Admin payment method writes must validate mode combinations.");
    includes("backend/routes/paymentMethods.js", "Enabled Thailand manual Dynamic PromptPay methods must use the same AZIEL receiving account", "Enabled Thailand manual banks must be guarded against conflicting recipients.");
    includes("backend/routes/paymentMethods.js", "method.confirmationMode !== \"manual_admin\"", "Dynamic QR endpoint must require manual confirmation mode.");
    includes("backend/services/paymentStateService.js", "MANUAL_PAYMENT_REQUIRES_ADMIN_APPROVAL", "Provider payment application must not auto-pay manual admin orders.");

    includes("backend/services/paymentProviderRegistry.js", "krungthai", "Provider registry must include Krungthai NEXT.");
    includes("frontend/js/admin-payments.js", "pm-open-app-mode", "Admin editor must expose openAppMode.");
    includes("frontend/js/admin-payments.js", "Provider Webhook Confirmation", "Admin editor must expose provider webhook confirmation.");

    includes("frontend/js/payment.js", "openAppMode", "Public payment selector must preserve openAppMode.");
    includes("frontend/js/region-payment.js", "openAppMode", "Region payment selector must preserve openAppMode.");
    notIncludes("frontend/js/payment.js", 'key === "scb"', "Public payment selector must not route by SCB key.");
    assert(!/key\s*===\s*["']scb["'][\s\S]{0,120}paymentType\s*=\s*["']deeplink["']/.test(paymentJs), "SCB paymentType routing must be configuration-driven.");
    assert(regionPaymentJs.includes("getConfiguredRegionThaiBankApps"), "Region payment selector must publish bank app profiles.");

    includes("frontend/js/payment/payment-checkout-sheet.js", "showBankChooser", "Shared checkout sheet must own bank chooser behavior.");
    includes("frontend/js/payment/payment-checkout-sheet.js", 'openAppMode === "bank_chooser"', "Shared checkout sheet must branch on bank_chooser mode.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "launchBankProfile", "Bank chooser must launch selected app profile only.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Open your banking app and import the saved QR", "Bank chooser must provide safe fallback instructions.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", 'paymentStatus: "paid"', "Checkout sheet must not mark manual payments paid.");

    assert(paymentMethodsRoute.includes('qrMode: "aziel_promptpay_dynamic"'), "Thailand bank defaults must support AZIEL dynamic PromptPay mode.");
    assert(paymentMethodsRoute.includes('confirmationMode: "provider_webhook"'), "Provider-generated PromptPay mode must use provider webhook confirmation.");

    console.log("Thailand payment normalization verification passed.");
}

main();
