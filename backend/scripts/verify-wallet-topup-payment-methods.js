const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function verifyFrontendWalletEligibility() {
    const file = "frontend/js/wallet.js";
    includes(file, "function isManualDynamicPromptPayWalletMethod", "Wallet frontend must explicitly recognize manual dynamic PromptPay eligibility.");
    includes(file, "String(method.qrMode || \"\") === \"aziel_promptpay_dynamic\"", "Dynamic PromptPay QR mode must be part of wallet eligibility.");
    includes(file, "method.dynamicQrSupported === true", "Dynamic QR support must preserve wallet eligibility.");
    includes(file, "method.amountPrefillSupported === true", "Amount-prefill support must preserve wallet eligibility.");
    includes(file, "method.receiptUploadEnabled !== false", "Receipt upload must remain required for manual wallet top-up.");
    includes(file, "method.confirmationMode === \"manual_admin\"", "Manual admin verification must remain the wallet manual dynamic PromptPay mode.");
    includes(file, "if (isManualDynamicPromptPayWalletMethod(method)) return true;", "Manual dynamic PromptPay must bypass the static QR/account requirement.");
    includes(file, "provider === \"omise\"", "Only Omise/provider-auto wallet payments should use the automatic wallet path.");
    notIncludes(file, "provider === \"promptpay\" ||", "Manual PromptPay provider must not force the automatic wallet endpoint.");
    notIncludes(file, "method.includes(\"promptpay\")", "PromptPay display text must not force the automatic wallet endpoint.");
    includes(file, "qrMode: activeCard?.dataset.qrMode", "Wallet selected method must preserve QR mode.");
    includes(file, "bankLaunchers: parseWalletBankLaunchers", "Wallet selected method must preserve bank launcher metadata.");
    includes(file, "qrMode: data.qrMode || data.method?.qrMode || payment.qrMode", "Wallet manual sheet handoff must pass QR mode.");
    includes(file, "dynamicQr: data.dynamicQr || data.method?.dynamicQr || null", "Wallet manual sheet handoff must pass generated dynamic QR metadata.");
}

function verifyBackendWalletEligibility() {
    const file = "backend/routes/wallet.js";
    includes(file, "const { createPromptPayQr } = require(\"../services/promptPayQrService\")", "Wallet backend must reuse the canonical PromptPay QR service.");
    includes(file, "function isManualDynamicPromptPayMethod", "Wallet backend must explicitly recognize manual dynamic PromptPay.");
    includes(file, "function isWalletFundingMethodEligible", "Wallet backend must centrally enforce wallet funding eligibility.");
    includes(file, "if (type === \"auto\") return isAutoPromptPayMethod(method);", "Automatic wallet methods must remain explicitly gated.");
    includes(file, "if (isManualDynamicPromptPayMethod(method)) return true;", "Manual dynamic PromptPay must be eligible without static QR/account.");
    includes(file, "return Boolean(getMethodQrImage(method)) && Boolean(method.accountName && method.accountNumber);", "Legacy manual methods must still require configured QR/account details.");
    includes(file, "dynamicQr = await createPromptPayQr", "Manual wallet intent must generate amount-specific dynamic PromptPay QR server-side.");
    includes(file, "orderReference: reference", "Wallet dynamic PromptPay QR must use the server-owned wallet intent reference.");
    includes(file, "methodPresentation.qrImage = dynamicQr.qrImage", "Wallet manual intent response must use the generated QR image.");
    includes(file, "qrMode: snapshot.qrMode", "Wallet manual intent response must expose QR mode.");
    includes(file, "dynamicQr: snapshot.dynamicQr", "Wallet manual intent response must expose dynamic QR metadata.");
}

function verifySnapshotPersistenceAndCheckoutCompatibility() {
    includes("backend/models/WalletTopupIntent.js", "dynamicQr", "Wallet intent must persist generated QR metadata until receipt upload.");
    includes("backend/models/WalletTopup.js", "dynamicQr", "Wallet top-up must preserve generated QR metadata after receipt upload.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "isDynamicPromptPayMode(options) && !isRecoveryMode(options)", "Recovery mode must continue to bypass dynamic QR generation.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "!options.qrImageUrl", "Pre-generated wallet dynamic QR must not trigger a second QR generation.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "setQrImage(qr, qrSourceType, options.dynamicQr?.qrPayload || \"\")", "Shared sheet must preserve generated wallet QR payload ownership.");
}

function verifyPublicCheckoutRemainsUnchanged() {
    const file = "backend/routes/paymentMethods.js";
    includes(file, "router.get(\"/payment-methods\"", "Public payment methods endpoint must remain.");
    includes(file, ".map(formatMethod)", "Standard order checkout projection must remain formatMethod-based.");
    includes(file, "isLegacyThailandBankMethod", "Legacy standalone Thai bank filtering must remain unchanged.");
}

verifyFrontendWalletEligibility();
verifyBackendWalletEligibility();
verifySnapshotPersistenceAndCheckoutCompatibility();
verifyPublicCheckoutRemainsUnchanged();

console.log("Wallet top-up payment method regression verification passed.");
