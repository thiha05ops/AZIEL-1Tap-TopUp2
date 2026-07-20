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

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function verifyPublicPaymentMethodProjection() {
    const file = "backend/routes/paymentMethods.js";
    includes(file, "safePublicAssetUrl", "Public payment method projection must sanitize asset URLs.");
    includes(file, "logoUrl: safePublicAssetUrl(obj.logoUrl) || getPaymentLogo", "Public projection must provide stable method logo URL.");
    includes(file, "qrImage", "Public projection must include QR image presentation field.");
    includes(file, "paymentType", "Public projection must include payment type.");
    includes(file, "provider", "Public projection must include provider identity.");
    notMatches(file, /\.\.\.obj/, "Public payment method projection must not spread full model data.");
    notMatches(file, /providerConfig[^=]/, "Public payment method projection must not expose providerConfig secrets.");
}

function verifyWalletFrontendOwnership() {
    const file = "frontend/js/wallet.js";
    includes(file, "/api/payment-methods?region=", "Wallet must consume canonical public payment methods endpoint.");
    includes(file, "loadWalletPaymentMethods", "Wallet payment method loader missing.");
    includes(file, "isWalletFundingMethodAvailable", "Wallet frontend must filter wallet funding method availability.");
    includes(file, "method.enabled !== true", "Wallet frontend must hide disabled methods.");
    includes(file, "String(method.maintenanceMessage", "Wallet frontend must respect maintenance state.");
    includes(file, "provider === \"wallet\"", "Wallet frontend must prevent AZIEL Wallet self-funding.");
    includes(file, "paymentMethod", "Wallet must submit selected method code.");
    includes(file, "data.qrImage || data.qrUrl || payment.qrImage", "Wallet manual modal must render canonical QR image.");
    includes(file, "data.accountName || payment.accountName", "Wallet manual modal must use backend/account presentation.");
    includes(file, "data.accountNumber || payment.accountNumber", "Wallet manual modal must use backend/account presentation.");
    includes(file, "slipRequired", "Wallet modal must respect canonical slip requirement.");
    includes(file, "deepLink", "Wallet Open App must depend on configured deep link.");
    notMatches(file, /APP_OPEN_METHODS|getWalletDeepLink|wavepay:\/\/|kbzpay:\/\/|ayapay:\/\/|scbeasy:\/\//, "Wallet frontend must not invent app deep links.");
}

function verifyWalletBackendValidation() {
    const file = "backend/routes/wallet.js";
    includes(file, "const PaymentMethod = require(\"../models/PaymentMethod\")", "Wallet backend must read PaymentMethod model.");
    includes(file, "resolveWalletPaymentMethod", "Wallet backend must centrally validate selected payment method.");
    includes(file, "PaymentMethod.find({", "Wallet backend must re-read Admin Payment Method records.");
    includes(file, "methods.find(item => normalizeMethod(item.key) === key)", "Wallet backend must resolve normalized Admin Payment Method keys.");
    includes(file, "key,", "Wallet backend must validate selected method code.");
    includes(file, "region: topupRegion", "Wallet backend must validate region.");
    includes(file, "method.enabled !== true", "Wallet backend must reject disabled methods.");
    includes(file, "isMethodInMaintenance", "Wallet backend must reject maintenance methods.");
    includes(file, "AZIEL Wallet cannot be used to top up AZIEL Wallet", "Wallet backend must reject self-funding.");
    includes(file, "paymentProvider: configuredMethod.provider", "WalletTopup must persist canonical provider.");
    includes(file, "paymentMethod: method", "WalletTopup must persist canonical method code.");
    includes(file, "projectWalletPaymentMethod", "Wallet backend must return safe method presentation snapshot.");
    includes(file, "createPromptPayCharge", "PromptPay automatic path must remain intact.");
    includes(file, "provider: \"omise\"", "PromptPay Omise provider path must remain intact.");
    notMatches(file, /WAVEPAY_ACCOUNT|KBZPAY_ACCOUNT|AYAPAY_ACCOUNT|DEFAULT_PAYMENT_ACCOUNT|promptpay-qr|getAccountByMethod|getQrByMethod/, "Wallet backend must not use hardcoded account or QR truth.");
}

function verifyWalletLedgerAndApprovalSemantics() {
    const walletRoute = read("backend/routes/wallet.js");
    [
        "creditTopup",
        "adjustWallet",
        "WalletTransaction",
        "emitCommittedWalletUpdate",
        "status: \"approved\"",
        "Payment slip uploaded. Waiting for admin verification."
    ].forEach(snippet => {
        assert(walletRoute.includes(snippet), `backend/routes/wallet.js: wallet ledger/approval semantic snippet missing: ${snippet}`);
    });
}

function verifyScopeSafety() {
    [
        "backend/routes/wallet.js",
        "backend/routes/paymentMethods.js",
        "frontend/css/account/wallet.css"
    ].forEach(file => {
        notMatches(file, /localhost|127\.0\.0\.1|OMISE_SECRET|JWT_SECRET|SESSION_SECRET|providerConfig\.apiKey|webhookSecret/i, "Wallet payment method ownership must not expose local URLs or secrets.");
    });
    notMatches("frontend/js/wallet.js", /OMISE_SECRET|JWT_SECRET|SESSION_SECRET|providerConfig\.apiKey|webhookSecret/i, "Wallet frontend must not expose secrets.");
}

function main() {
    verifyPublicPaymentMethodProjection();
    verifyWalletFrontendOwnership();
    verifyWalletBackendValidation();
    verifyWalletLedgerAndApprovalSemantics();
    verifyScopeSafety();
    console.log("Wallet payment method ownership verification passed.");
}

main();
