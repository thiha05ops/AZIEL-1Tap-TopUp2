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

function verifyThemeOwnership() {
    const file = "frontend/css/payment/payment-checkout-sheet.css";
    includes(file, "body.theme-dark .az-payment-sheet", "checkout sheet must own dark-theme tokens.");
    includes(file, "body.theme-light .az-payment-sheet", "checkout sheet must own light-theme tokens.");
    includes(file, "--az-pay-sheet-title", "sheet title foreground token must exist.");
    includes(file, "--az-pay-sheet-amount", "sheet amount foreground token must exist.");
    includes(file, "--az-pay-sheet-subtitle", "sheet subtitle foreground token must exist.");
    includes(file, "--az-pay-sheet-label", "sheet label foreground token must exist.");
    includes(file, "--az-pay-sheet-value", "sheet value foreground token must exist.");
    includes(file, "--az-pay-sheet-instruction", "sheet instruction foreground token must exist.");
    includes(file, "--az-pay-sheet-accent-strong", "copy/upload foreground token must exist.");
    includes(file, "--az-pay-sheet-bg", "sheet background token must exist.");
    includes(file, "--az-pay-sheet-border", "sheet divider token must exist.");
}

function verifySelectorColors() {
    const file = "frontend/css/payment/payment-checkout-sheet.css";
    [
        ".az-payment-sheet__title",
        ".az-payment-sheet__amount",
        ".az-payment-sheet__subtitle",
        ".az-payment-sheet__row span",
        ".az-payment-sheet__row strong",
        ".az-payment-sheet__row button",
        ".az-payment-sheet__close",
        ".az-payment-sheet__instructions",
        ".az-payment-sheet__receipt-copy strong",
        ".az-payment-sheet__receipt-copy span",
        ".az-payment-sheet__upload",
        ".az-payment-sheet__upload span",
        ".az-payment-sheet__preview span",
        ".az-payment-sheet__submit"
    ].forEach(selector => includes(file, selector, `${selector} must have explicit sheet-scoped contrast ownership.`));
}

function verifyLayoutAndAccessibilityPreserved() {
    const file = "frontend/css/payment/payment-checkout-sheet.css";
    includes(file, "100dvh", "mobile viewport ownership must remain.");
    includes(file, "env(safe-area-inset", "safe-area ownership must remain.");
    includes(file, "position: sticky", "sticky submit action must remain.");
    includes(file, "scrollbar-gutter: stable", "internal scrollbar must not overlap content.");
    includes(file, "focus-visible", "visible focus states must exist.");
    includes(file, "prefers-reduced-motion: reduce", "reduced-motion handling must remain.");
    includes(file, ".az-payment-sheet__upload input", "custom upload control must continue to hide browser-default input.");
    notMatches(file, /\.az-payment-sheet\s+\*\s*\{\s*color:/, "checkout sheet must not use broad destructive color overrides.");
}

function verifyFrontendSurfacePreserved() {
    const file = "frontend/js/wallet.js";
    includes(file, "PaymentCheckoutSheet.show", "wallet must use shared checkout sheet.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "az-payment-sheet__row", "checkout sheet must preserve plain row structure.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Submit for Verification", "single primary action copy must remain.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "azPaymentSheetFileName", "selected filename display must remain.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "az-payment-sheet__upload", "custom upload control must remain.");
    notMatchesText(`${read(file)}\n${read("frontend/js/payment/payment-checkout-sheet.js")}`, /walletManualProvider|MANUAL\s*•|manual\s*·\s*deeplink/i, "technical provider text must not be reintroduced.");
    notMatches(file, /transfer-card/, "nested card-heavy checkout layout must not be reintroduced.");
}

function verifyBackendSemanticsUntouched() {
    const walletRoute = read("backend/routes/wallet.js");
    const intentModel = read("backend/models/WalletTopupIntent.js");

    assert(walletRoute.includes('router.post("/wallet/manual-intent"'), "manual intent endpoint must remain.");
    assert(walletRoute.includes('router.post("/wallet/manual-intent/:intentId/slip"'), "manual intent slip endpoint must remain.");
    assert(walletRoute.includes("MANUAL_TOPUP_REQUIRES_INTENT"), "manual create semantics must remain protected.");
    assert(walletRoute.includes("createPromptPayCharge"), "PromptPay auto semantics must remain present.");
    assert(intentModel.includes("expiresAt") && intentModel.includes("consumedAt"), "intent expiry/single-use ownership must remain.");
}

function main() {
    verifyThemeOwnership();
    verifySelectorColors();
    verifyLayoutAndAccessibilityPreserved();
    verifyFrontendSurfacePreserved();
    verifyBackendSemanticsUntouched();
    console.log("Wallet checkout contrast verification passed.");
}

main();
