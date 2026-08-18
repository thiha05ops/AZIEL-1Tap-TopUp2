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

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function verifyIntentModel() {
    const file = "backend/models/WalletTopupIntent.js";
    includes(file, "intentId", "manual checkout intent must have a server-owned id.");
    includes(file, "username", "manual checkout intent must be user-owned.");
    includes(file, "amount", "manual checkout intent must own amount.");
    includes(file, "currency", "manual checkout intent must own currency.");
    includes(file, "region", "manual checkout intent must own region.");
    includes(file, "paymentMethod", "manual checkout intent must own canonical payment method.");
    includes(file, "expiresAt", "manual checkout intent must expire.");
    includes(file, "consumedAt", "manual checkout intent must be single-use.");
    includes(file, "methodSnapshot", "manual checkout intent must carry safe presentation instructions.");
    includes(file, "expireAfterSeconds", "manual checkout intents must have TTL cleanup.");
}

function verifyBackendSemantics() {
    const file = "backend/routes/wallet.js";
    includes(file, "const WalletTopupIntent = require(\"../models/WalletTopupIntent\")", "wallet route must use WalletTopupIntent.");
    includes(file, "router.post(\"/wallet/manual-intent\"", "manual instructions must use an intent endpoint.");
    includes(file, "MANUAL_TOPUP_REQUIRES_INTENT", "manual top-ups must not be created by /wallet/create.");
    includes(file, "router.post(\"/wallet/manual-intent/:intentId/slip\"", "manual slip submission must consume the intent.");
    includes(file, "assertManualIntentUsable(intent)", "slip submission must reject expired or consumed intents.");
    includes(file, "resolveWalletPaymentMethod({", "slip submission must re-read canonical Admin Payment Method.");
    includes(file, "isManualLikePaymentMethod(configuredMethod)", "slip submission must keep automatic providers out of manual semantics.");
    includes(file, "WalletTopup.findOne({ topupIntentId: intent.intentId })", "duplicate slip submissions must be checked.");
    includes(file, "topupIntentId: intent.intentId", "durable top-up must link to the consumed intent.");
    includes(file, "paymentSnapshot: snapshot", "durable top-up must persist safe payment presentation snapshot.");
    includes(file, "status: \"pending\"", "durable manual top-up must enter the existing review-pending state.");
    includes(file, "Payment slip uploaded. Waiting for admin verification.", "submitted top-up must keep admin-review semantics.");
    includes(file, "createPromptPayCharge", "automatic PromptPay path must remain present.");
    includes(file, "provider: \"omise\"", "PromptPay Omise semantics must remain intact.");
}

function verifyHistoryAdminLedgerExclusion() {
    const walletRoute = read("backend/routes/wallet.js");
    const historyBlock = walletRoute.slice(walletRoute.indexOf("router.get(\"/wallet/:username\""), walletRoute.indexOf("// ======================\n// WALLET TOPUP STATUS"));
    const adminBlock = walletRoute.slice(walletRoute.indexOf("router.get(\"/admin/wallet/topups\""), walletRoute.indexOf("router.get(\"/admin/wallet/topups/:id/context\""));
    const ledgerBlock = read("backend/services/walletService.js");

    assert(
        /WalletTopup\.find\(\s*\{\s*username,\s*currency\s*\}\s*\)/m.test(historyBlock),
        "wallet history must continue to query durable WalletTopup records scoped to the requested currency."
    );
    assert(
        historyBlock.includes(".limit(limit)"),
        "wallet history must enforce the requested bounded history limit."
    );
    assert(!historyBlock.includes("WalletTopupIntent"), "wallet history must exclude temporary intents.");
    assert(adminBlock.includes("WalletTopup.find"), "admin review must continue to query durable WalletTopup records.");
    assert(!adminBlock.includes("WalletTopupIntent"), "admin review must exclude temporary intents.");
    assert(!ledgerBlock.includes("WalletTopupIntent"), "wallet ledger must not use temporary checkout intents.");
}

function verifyFrontendSemantics() {
    const file = "frontend/js/wallet.js";
    includes(file, "\"/api/wallet/manual-intent\"", "manual flow must request payment instructions without creating a durable top-up.");
    includes(file, "`/api/wallet/manual-intent/${encodeURIComponent(intentId)}/slip`", "manual receipt submission must use the intent slip endpoint.");
    includes(file, "await loadWallet();", "successful receipt submission must refresh durable wallet history.");
    includes(file, "activeWalletManualIntent = null", "closing the sheet must abandon the temporary intent client-side.");
    includes(file, "PaymentCheckoutSheet.show", "wallet manual flow must use the shared checkout sheet.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Submit for Verification", "sheet must expose one verification submit action.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Choose screenshot", "sheet must use custom upload copy.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "azPaymentSheetFileName", "sheet must show selected receipt filename.");
    includes(file, "This payment session has expired", "frontend must provide safe expired-intent messaging.");
    includes(file, "Transfer the amount and submit your payment receipt for verification.", "manual helper text must be method-aware.");
    includes(file, "Your wallet updates after payment is confirmed.", "automatic helper text must remain method-aware.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "Submit Payment Slip", "old generic slip button copy must not remain.");
    notIncludes(file, "walletManualProvider", "technical provider label must not be rendered in the checkout sheet.");
    notIncludes(file, "transfer-card", "wallet manual flow must not render nested transfer cards.");
    notMatches("frontend/js/payment/payment-checkout-sheet.js", /walletManualProvider|MANUAL\s*•|manual\s*·\s*deeplink/i, "checkout sheet must not show technical manual/deeplink labels.");
    notMatches(file, /wavepay:\/\/|kbzpay:\/\/|ayapay:\/\/|scbeasy:\/\//i, "wallet frontend must not restore legacy generic manual provider fallbacks.");
}

function verifyCheckoutCss() {
    const file = "frontend/css/payment/payment-checkout-sheet.css";
    includes(file, ".az-payment-sheet__panel", "checkout sheet must own one outer sheet surface.");
    includes(file, ".az-payment-sheet__row", "checkout sheet must use rows/dividers for information hierarchy.");
    includes(file, "100dvh", "mobile sheet must use dynamic viewport height.");
    includes(file, "env(safe-area-inset", "mobile sheet must respect safe-area insets.");
    includes(file, "position: sticky", "small-screen action area must be sticky-safe.");
    includes(file, ".az-payment-sheet__upload input", "browser-default file input must be visually hidden behind custom control.");
    includes(file, "prefers-reduced-motion: reduce", "checkout sheet must preserve reduced-motion behavior.");
    notMatches(file, /localhost|127\.0\.0\.1|OMISE_SECRET|JWT_SECRET|SESSION_SECRET|BREVO_API_KEY/i, "wallet checkout CSS must not expose secrets or local URLs.");
}

function verifyCopy() {
    includes("frontend/wallet.html", "Select amount and payment method to continue.", "wallet default helper copy must not claim no slip is required.");
    includes("frontend/lang/en.js", "Select amount and payment method to continue.", "English wallet copy must be corrected.");
    includes("frontend/lang/my.js", "ဆက်လုပ်ရန် amount နှင့် payment method ကိုရွေးပါ။", "Myanmar wallet copy must be corrected.");
    includes("frontend/lang/th.js", "เลือกจำนวนเงินและวิธีชำระเงินเพื่อดำเนินการต่อ", "Thai wallet copy must be corrected.");
    notMatches("frontend/wallet.html", /No slip upload required|Auto payment enabled/i, "wallet HTML must not contain stale manual/auto copy.");
    notMatches("frontend/lang/en.js", /No slip upload required|Auto payment enabled/i, "English wallet strings must not contain stale manual/auto copy.");
}

function main() {
    verifyIntentModel();
    verifyBackendSemantics();
    verifyHistoryAdminLedgerExclusion();
    verifyFrontendSemantics();
    verifyCheckoutCss();
    verifyCopy();
    console.log("Wallet submission checkout verification passed.");
}

main();
