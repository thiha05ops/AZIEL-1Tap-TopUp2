const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notIncludes(file, snippet, message) {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
}

function loadAndroidHelper() {
    const sandbox = {
        window: {
            navigator: {
                userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
                platform: "Linux armv8l",
                maxTouchPoints: 5
            }
        },
        URL
    };
    vm.createContext(sandbox);
    vm.runInContext(read("frontend/js/payment/android-app-launch.js"), sandbox);
    return sandbox.window.AZIEL_ANDROID_APP_LAUNCH;
}

function main() {
    const helper = loadAndroidHelper();
    assert(helper, "Android launch helper must register globally.");

    assert.strictEqual(helper.isAndroidPackageName("com.kasikorn.retail.mbanking.wap"), true, "K PLUS package must validate.");
    assert.strictEqual(helper.isAndroidPackageName("com.bbl.mobilebanking"), true, "Bangkok Bank package must validate.");
    assert.strictEqual(helper.isAndroidPackageName("ktbcs.netbank"), true, "Krungthai package must validate.");
    assert.strictEqual(helper.isAndroidPackageName("kplus://"), false, "URL schemes must not validate as package names.");
    assert.strictEqual(helper.isAndroidPackageName("bad package"), false, "Malformed package names must be rejected.");
    assert.strictEqual(helper.isHttpsUrl("https://play.google.com/store/apps/details?id=com.bbl.mobilebanking"), true, "Play Store HTTPS fallback must validate.");
    assert.strictEqual(helper.isHttpsUrl("javascript:alert(1)"), false, "Unsafe fallback URLs must be rejected.");

    const intent = helper.buildAndroidIntentUrl({
        androidPackageName: "com.bbl.mobilebanking",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=com.bbl.mobilebanking"
    });
    assert(intent.startsWith("intent://open#Intent;"), "Package-only Android intent should use Chrome intent URI format.");
    assert(intent.includes("package=com.bbl.mobilebanking"), "Intent must include package name.");
    assert(intent.includes("S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.bbl.mobilebanking"), "Fallback URL must be URL-encoded.");
    assert(intent.endsWith(";end"), "Intent must terminate with ;end.");

    const schemeIntent = helper.buildAndroidIntentUrl({
        androidPackageName: "ktbcs.netbank",
        androidAppLaunchUrl: "ktbnext://",
        playStoreFallbackUrl: "https://play.google.com/store/apps/details?id=ktbcs.netbank"
    });
    assert(schemeIntent.includes("scheme=ktbnext"), "Scheme-backed intent must preserve verified Krungthai scheme.");
    assert(schemeIntent.includes("package=ktbcs.netbank"), "Scheme-backed intent must include package.");

    includes("backend/models/PaymentMethod.js", "androidPackageName", "PaymentMethod must store Android package identity.");
    includes("backend/models/ManualPaymentAttempt.js", "androidPackageName", "Manual attempt instructions must snapshot Android package identity.");
    includes("backend/routes/paymentMethods.js", "safeAndroidPackageName", "Admin writes must validate Android package names.");
    includes("backend/routes/paymentMethods.js", "com.kasikorn.retail.mbanking.wap", "K PLUS package default missing.");
    includes("backend/routes/paymentMethods.js", "com.bbl.mobilebanking", "Bangkok Bank package default missing.");
    includes("backend/routes/paymentMethods.js", "com.krungsri.kma", "Krungsri package default missing.");
    includes("backend/routes/paymentMethods.js", "ktbcs.netbank", "Krungthai package default missing.");
    includes("backend/routes/paymentMethods.js", "Android app opening requires a Play Store fallback URL.", "Android direct mode must require Play Store fallback when Android config is present.");
    includes("backend/services/paymentProviderRegistry.js", "Play Store fallback URL", "Readiness must report missing Play Store fallback.");

    includes("frontend/js/admin-payments.js", "pm-android-package-name", "Admin editor must expose Android package field.");
    includes("frontend/js/admin-payments.js", "pm-android-intent-preview", "Admin editor must expose generated intent preview.");
    includes("frontend/js/payment.js", "androidPackageName", "Public payment selection must preserve Android package identity.");
    includes("frontend/js/region-payment.js", "androidPackageName", "Region payment selection must preserve Android package identity.");
    includes("frontend/js/payment/payment-manual.js", "androidPackageName", "Manual checkout session must preserve Android package identity.");
    includes("frontend/js/payment/payment-deeplink.js", "androidPackageName", "Deeplink checkout session must preserve Android package identity.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "AZIEL_ANDROID_APP_LAUNCH", "Checkout must use the shared Android launch helper.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "android_intent", "Checkout must classify Android intent launch source.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "Open / Install", "Store-only iOS behavior must not claim direct open.");
    includes("frontend/js/payment/payment-checkout-sheet.js", ': "";', "Desktop launch resolution must not pretend to be Android.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "paymentStatus", "Open app checkout logic must not mutate payment status.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "markWalletTopupPaid", "Open app checkout logic must not mark wallet top-ups paid.");
    notIncludes("frontend/js/payment/android-app-launch.js", "kplus://", "Shared Android helper must not invent bank schemes.");
    notIncludes("frontend/js/payment/android-app-launch.js", "bangkokbank://", "Shared Android helper must not invent Bangkok Bank schemes.");

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
        "frontend/wallet.html",
        "frontend/admin.html"
    ].forEach(file => {
        includes(file, "/js/payment/android-app-launch.js", "shared Android launch helper must be loaded.");
    });

    console.log("Android bank app launch verification passed.");
}

main();
