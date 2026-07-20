const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const {
    PAYMENT_DISPLAY_LABELS,
    formatPaymentDisplayName,
    formatPaymentMethod,
    replacePaymentDisplayNames
} = require("../services/paymentDisplayNameService");

function assertBefore(file, first, second, message) {
    const content = read(file);
    const firstIndex = content.indexOf(first);
    const secondIndex = content.indexOf(second);
    assert(firstIndex >= 0, `${file}: missing ${first}`);
    assert(secondIndex >= 0, `${file}: missing ${second}`);
    assert(firstIndex < secondIndex, `${file}: ${message}`);
}

function main() {
    assert.deepStrictEqual(Object.values(PAYMENT_DISPLAY_LABELS).sort(), [
        "AYA Pay",
        "AZIEL Wallet",
        "AZIEL Wallet",
        "Bangkok Bank",
        "K PLUS",
        "KBZPay",
        "Krungsri",
        "MMQR",
        "Manual Bank Transfer",
        "PromptPay",
        "SCB",
        "WavePay"
    ].sort(), "Payment display labels changed unexpectedly.");

    [
        ["ayapay", "AYA Pay"],
        ["aya_pay", "AYA Pay"],
        ["aya-pay", "AYA Pay"],
        ["AYA PAY", "AYA Pay"],
        ["kbzpay", "KBZPay"],
        ["kbz_pay", "KBZPay"],
        ["wavepay", "WavePay"],
        ["wave_pay", "WavePay"],
        ["promptpay", "PromptPay"],
        ["prompt pay", "PromptPay"],
        ["wallet", "AZIEL Wallet"],
        ["aziel_wallet", "AZIEL Wallet"],
        ["scb", "SCB"],
        ["bangkok_bank", "Bangkok Bank"],
        ["kplus", "K PLUS"],
        ["krungsri", "Krungsri"],
        ["mmqr", "MMQR"],
        ["manual_bank", "Manual Bank Transfer"]
    ].forEach(([input, expected]) => {
        assert.strictEqual(formatPaymentDisplayName(input), expected, `${input} must render as ${expected}`);
    });

    assert.strictEqual(formatPaymentMethod({ key: "kbz_pay", method: "kbzpay" }), "KBZPay");
    assert.strictEqual(replacePaymentDisplayNames("paid with wave_pay via wallet"), "paid with WavePay via AZIEL Wallet");

    const frontendFormatter = read("frontend/js/payment-display.js");
    [
        "AYA Pay",
        "KBZPay",
        "WavePay",
        "PromptPay",
        "SCB",
        "Bangkok Bank",
        "K PLUS",
        "Krungsri",
        "MMQR",
        "Manual Bank Transfer",
        "AZIEL Wallet",
        "replaceInText"
    ].forEach(token => assert(frontendFormatter.includes(token), `Frontend formatter missing ${token}`));

    [
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html",
        "frontend/genshin.html",
        "frontend/roblox.html"
    ].forEach(file => assertBefore(file, "/js/payment-display.js", "/js/payment.js", "payment-display must load before checkout payment.js"));

    assertBefore("frontend/wallet.html", "/js/payment-display.js", "/js/region-payment.js", "payment-display must load before wallet payment methods.");
    assertBefore("frontend/wallet.html", "/js/payment-display.js", "/js/wallet.js", "payment-display must load before wallet.js.");
    assertBefore("frontend/tracking.html", "/js/payment-display.js", "/js/tracking.js", "payment-display must load before tracking.js.");
    assertBefore("frontend/notifications.html", "/js/payment-display.js", "/js/notification-store.js", "payment-display must load before notifications.");
    assertBefore("frontend/admin.html", "/js/payment-display.js", "/js/admin-orders.js", "payment-display must load before admin orders.");
    assertBefore("frontend/admin.html", "/js/payment-display.js", "/js/admin-wallet.js", "payment-display must load before admin wallet.");
    assertBefore("frontend/admin.html", "/js/payment-display.js", "/js/admin-settings.js", "payment-display must load before admin settings.");
    assertBefore("frontend/admin-wallet.html", "js/payment-display.js", "js/admin-wallet.js", "payment-display must load before standalone admin wallet.");
    assertBefore("frontend/admin-settings.html", "js/payment-display.js", "js/admin-settings.js", "payment-display must load before standalone admin settings.");
    assertBefore("frontend/old-admin-orders.html", "js/payment-display.js", "js/admin.js", "payment-display must load before legacy admin orders.");

    [
        "frontend/js/payment.js",
        "frontend/js/region-payment.js",
        "frontend/js/wallet.js",
        "frontend/js/tracking.js",
        "frontend/js/admin-orders.js",
        "frontend/js/admin-wallet.js",
        "frontend/js/admin.js",
        "frontend/js/admin-payments.js",
        "frontend/js/admin-settings.js",
        "frontend/js/notifications-page.js",
        "frontend/js/payment/payment-utils.js",
        "frontend/js/payment/payment-manual.js",
        "frontend/js/payment/payment-deeplink.js",
        "frontend/js/payment/payment-checkout-sheet.js",
        "frontend/js/payment-page.js",
        "frontend/js/payment-redirect.js"
    ].forEach(file => {
        assert(read(file).includes("AZIEL_PAYMENT_DISPLAY"), `${file}: must use frontend payment display formatter.`);
    });

    [
        "backend/routes/payment.js",
        "backend/routes/paymentMethods.js",
        "backend/routes/wallet.js",
        "backend/services/manualPaymentAttemptService.js",
        "backend/services/notificationService.js",
        "backend/services/orderEmailService.js",
        "backend/services/walletEmailService.js",
        "backend/services/walletService.js"
    ].forEach(file => {
        assert(read(file).includes("paymentDisplayNameService"), `${file}: must use backend payment display formatter.`);
    });

    const legacyPaymentPage = read("frontend/js/payment-page.js");
    ["K PLUS", "Krungthai NEXT", "Krungsri", "TTB Touch"].forEach(label => {
        assert(!legacyPaymentPage.includes(label), `Legacy payment page must not display unsupported label ${label}`);
    });

    console.log("Payment display label verification passed.");
}

main();
