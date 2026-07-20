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

function count(source, needle) {
    return source.split(needle).length - 1;
}

function verifyProviderRegistry() {
    const registry = read("backend/services/paymentProviderRegistry.js");
    [
        "promptpay",
        "scb",
        "bangkok_bank",
        "kplus",
        "krungsri",
        "kbzpay",
        "wavepay",
        "ayapay",
        "mmqr",
        "manual_bank",
        "wallet"
    ].forEach(key => assert(registry.includes(`${key}:`) || registry.includes(`"${key}"`), `registry missing provider ${key}`));

    includes("backend/services/paymentProviderRegistry.js", "TH: {", "registry must define Thailand provider rules");
    includes("backend/services/paymentProviderRegistry.js", "MM: {", "registry must define Myanmar provider rules");
    includes("backend/services/paymentProviderRegistry.js", "auto: [\"promptpay\"]", "Thailand auto must only allow PromptPay");
    includes("backend/services/paymentProviderRegistry.js", "deeplink: [\"scb\", \"bangkok_bank\", \"kplus\", \"krungsri\"]", "Thailand deeplink must exclude Myanmar providers");
    includes("backend/services/paymentProviderRegistry.js", "manual: [\"kbzpay\", \"wavepay\", \"ayapay\", \"mmqr\", \"manual_bank\"]", "Myanmar manual must exclude Thai banks");
    includes("backend/services/paymentProviderRegistry.js", "omise: \"promptpay\"", "legacy Omise provider must normalize to PromptPay");
}

function verifyBackendSeedAndProjection() {
    const routes = read("backend/routes/paymentMethods.js");
    [
        'key: "promptpay"',
        'provider: "promptpay"',
        'key: "scb"',
        'provider: "scb"',
        'key: "bangkok_bank"',
        'provider: "bangkok_bank"',
        'key: "kplus"',
        'provider: "kplus"',
        'key: "krungsri"',
        'provider: "krungsri"',
        'key: "wallet"',
        'provider: "wallet"'
    ].forEach(snippet => assert(routes.includes(snippet), `seed/projection missing ${snippet}`));

    includes("backend/routes/paymentMethods.js", "paymentMethodReadiness", "public projection must expose readiness");
    includes("backend/routes/paymentMethods.js", "missingConfiguration", "public/admin projection must explain missing config");
    includes("backend/routes/paymentMethods.js", "logoUrl: safePublicAssetUrl(obj.logoUrl) || getPaymentLogo", "projection must use dedicated logo field before fallback");
    includes("backend/models/PaymentMethod.js", "logoUrl", "PaymentMethod must have dedicated card logo field");
}

function verifyAdminProviderFiltering() {
    const admin = read("frontend/js/admin-payments.js");
    includes("frontend/js/admin-payments.js", "ADMIN_PAYMENT_PROVIDERS", "admin must own canonical provider registry");
    includes("frontend/js/admin-payments.js", "ADMIN_PROVIDER_BY_REGION_TYPE", "admin must filter providers by region/type");
    includes("frontend/js/admin-payments.js", "Internal provider:", "admin may only show provider as read-only system info");
    includes("frontend/js/admin-payments.js", "Provider is assigned automatically", "admin must explain provider auto-assignment");
    includes("frontend/js/admin-payments.js", "pm-logo-url", "admin must expose dedicated payment card logo URL");
    includes("frontend/js/admin-payments.js", "payment-config-warning", "admin must show missing configuration warning");
    notIncludes("frontend/js/admin-payments.js", '<select class="pm-provider"', "normal admin UI must not expose editable provider selector");
    notIncludes("frontend/js/admin-payments.js", '<option value="omise"', "admin must not show duplicate Omise PromptPay provider");
}

function verifyPublicRendering() {
    [
        "frontend/js/payment.js",
        "frontend/js/region-payment.js"
    ].forEach(file => {
        includes(file, "unique", "public renderers must dedupe payment cards");
        includes(file, "method.publicReady === false", "public renderers must hide incomplete draft methods");
        includes(file, "method.accountName && method.accountNumber", "bank methods must require account name and number");
        includes(file, "bank-neutral.svg", "bank cards must use neutral bank fallback");
        includes(file, "payment-neutral.svg", "generic methods must use neutral payment fallback");
        notIncludes(file, "assets/logo.png';", "bank cards must not fallback to AZIEL Wallet logo");
    });

    includes("frontend/js/payment-display.js", "kplus: \"K PLUS\"", "K PLUS must have display label");
    includes("frontend/js/payment-display.js", "krungsri: \"Krungsri\"", "Krungsri must have display label");
    includes("backend/services/paymentDisplayNameService.js", "kplus: \"K PLUS\"", "backend K PLUS display label missing");
    includes("backend/services/paymentDisplayNameService.js", "krungsri: \"Krungsri\"", "backend Krungsri display label missing");
}

function verifyWalletRendering() {
    includes("frontend/js/payment.js", "if (!methods.some(method => normalizePaymentKey(method.key) === \"wallet\"))", "synthetic wallet fallback must only run when backend wallet is absent");
    includes("frontend/js/wallet.js", "method.publicReady === false", "wallet top-up must hide incomplete draft methods");
    includes("frontend/js/wallet.js", "getWalletPaymentLogo", "wallet top-up must use dedicated logo helper");
    includes("frontend/js/wallet.js", "provider === \"promptpay\"", "wallet top-up must recognize canonical PromptPay provider");
}

function main() {
    verifyProviderRegistry();
    verifyBackendSeedAndProjection();
    verifyAdminProviderFiltering();
    verifyPublicRendering();
    verifyWalletRendering();
    console.log("Payment provider integrity verification passed.");
}

main();
