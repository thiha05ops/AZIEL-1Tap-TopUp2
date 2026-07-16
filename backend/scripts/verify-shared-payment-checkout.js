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

function notMatchesText(source, pattern, message) {
    assert(!pattern.test(source), message);
}

function verifySharedComponent() {
    const js = "frontend/js/payment/payment-checkout-sheet.js";
    const css = "frontend/css/payment/payment-checkout-sheet.css";

    includes(js, "window.PaymentCheckoutSheet", "shared checkout component must be globally available.");
    includes(js, "methodName", "shared component must accept normalized method name.");
    includes(js, "amount", "shared component must accept amount.");
    includes(js, "currency", "shared component must accept currency.");
    includes(js, "accountName", "shared component must accept account name.");
    includes(js, "accountNumber", "shared component must accept account number.");
    includes(js, "reference", "shared component must accept reference.");
    includes(js, "qrImageUrl", "shared component must accept QR image.");
    includes(js, "requiresSlip", "shared component must support optional receipt upload.");
    includes(js, "deepLink", "shared component must support canonical deep links.");
    includes(js, "onSubmit", "shared component must delegate submit behavior to callers.");
    includes(js, "onClose", "shared component must delegate close behavior to callers.");
    includes(js, "azPaymentSheetSlipInput", "shared component must own custom receipt input.");
    includes(js, "azPaymentSheetFileName", "shared component must show selected filename.");
    includes(js, "Escape", "shared component must support Escape close.");
    notMatches(js, /providerConfig|OMISE_SECRET|JWT_SECRET|SESSION_SECRET|localhost|127\.0\.0\.1/i, "shared component must not expose secrets or local URLs.");

    includes(css, ".az-payment-sheet", "shared checkout CSS must exist.");
    includes(css, "body.theme-dark .az-payment-sheet", "shared checkout must own dark theme.");
    includes(css, "body.theme-light .az-payment-sheet", "shared checkout must own light theme.");
    includes(css, "100dvh", "shared checkout must support mobile dynamic viewport.");
    includes(css, "env(safe-area-inset", "shared checkout must support safe areas.");
    includes(css, "position: sticky", "shared checkout must keep primary action reachable.");
    includes(css, ".az-payment-sheet__upload input", "browser-default file input must be hidden behind custom upload UI.");
    includes(css, "prefers-reduced-motion: reduce", "shared checkout must respect reduced motion.");
    notMatches(css, /\.az-payment-sheet\s+\*\s*\{\s*color:/, "shared checkout must not use broad destructive color overrides.");
}

function verifyConsumers() {
    includes("frontend/js/payment/payment-manual.js", "PaymentCheckoutSheet.show", "game manual payments must consume shared checkout sheet.");
    includes("frontend/js/payment/payment-deeplink.js", "PaymentCheckoutSheet.show", "game deep-link payments must consume shared checkout sheet.");
    includes("frontend/js/wallet.js", "PaymentCheckoutSheet.show", "wallet manual top-up must consume shared checkout sheet.");
    includes("frontend/js/payment/payment-promptpay.js", "PaymentUtils.prepareModal", "automatic PromptPay flow must remain separate.");
    includes("frontend/js/payment/payment-wallet.js", "PaymentWallet", "wallet balance payment flow must remain separate.");
}

function verifyNoActiveLegacyManualMarkup() {
    const manual = read("frontend/js/payment/payment-manual.js");
    const deepLink = read("frontend/js/payment/payment-deeplink.js");
    const wallet = read("frontend/js/wallet.js");
    const combined = `${manual}\n${deepLink}\n${wallet}`;

    assert(!combined.includes("transfer-card"), "active payment callers must not render nested transfer cards.");
    assert(!combined.includes("manualSlipPreviewBox"), "active payment callers must not render legacy manual slip preview markup.");
    assert(!combined.includes("manualPaymentSlip"), "active payment callers must not render legacy browser file input.");
    assert(!combined.includes("walletManualModal"), "wallet must not render a separate manual modal.");
    assert(!combined.includes("walletManualSlipName"), "wallet must use shared selected filename ownership.");
    notMatchesText(combined, /MANUAL\s*•|manual\s*·\s*deeplink|walletManualProvider/i, "technical provider labels must not be customer-facing.");
    notMatchesText(combined, /wavepay:\/\/|kbzpay:\/\/|ayapay:\/\/|scbeasy:\/\//i, "callers must not invent provider deep links.");
}

function verifyPageIncludes() {
    [
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html",
        "frontend/genshin.html",
        "frontend/roblox.html",
        "frontend/wallet.html"
    ].forEach(file => {
        includes(file, "/css/payment/payment-checkout-sheet.css", "page must load shared checkout CSS.");
        includes(file, "/js/payment/payment-checkout-sheet.js", "page must load shared checkout JS.");
    });
}

function verifySemanticsPreserved() {
    includes("backend/routes/wallet.js", 'router.post("/wallet/manual-intent"', "WalletTopupIntent create semantics must remain.");
    includes("backend/routes/wallet.js", 'router.post("/wallet/manual-intent/:intentId/slip"', "WalletTopupIntent slip semantics must remain.");
    includes("backend/routes/payment.js", 'router.post("/payment/manual/attempt"', "game manual attempt semantics must remain.");
    includes("backend/routes/payment.js", 'router.post("/payment/manual/attempt/:attemptId/slip"', "game manual slip semantics must remain.");
    includes("backend/routes/payment.js", "retrieveVerifiedCharge", "Omise webhook/charge verification semantics must remain.");
    includes("frontend/js/payment/payment-engine.js", "PaymentPromptPay.show", "PromptPay automatic route must remain.");
    includes("frontend/js/payment/payment-engine.js", "PaymentWallet.pay", "wallet payment route must remain.");
}

function main() {
    verifySharedComponent();
    verifyConsumers();
    verifyNoActiveLegacyManualMarkup();
    verifyPageIncludes();
    verifySemanticsPreserved();
    console.log("Shared payment checkout verification passed.");
}

main();
