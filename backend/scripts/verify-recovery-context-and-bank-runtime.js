const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const includes = (file, snippet, message) => {
    assert(read(file).includes(snippet), `${file}: ${message}`);
};
const notIncludes = (file, snippet, message) => {
    assert(!read(file).includes(snippet), `${file}: ${message}`);
};

function verifySharedBankRuntime() {
    includes("frontend/js/pwa-fix.js", "window.ensurePromptPayBankLauncherRuntime", "must expose the shared bank launcher runtime.");
    includes("frontend/js/pwa-fix.js", "window.__AZIEL_PROMPTPAY_BANK_LAUNCHER_RUNTIME_PROMISE__", "must use one shared in-flight bank runtime promise.");
    includes("frontend/js/pwa-fix.js", "compactAzielBankLaunchers", "must normalize launchers into compact local objects.");
    includes("frontend/js/pwa-fix.js", "new Set([\"scb\", \"bangkok_bank\", \"krungsri\", \"krungthai\"])", "must only support the approved Thai bank launchers.");
    includes("frontend/js/pwa-fix.js", "key === \"kplus\"", "must explicitly hide K PLUS.");
    includes("frontend/js/pwa-fix.js", "window.AZIEL_TH_BANK_APPS = promptPayLaunchers.map(app => ({ ...app }))", "must clone canonical launchers instead of mutating them.");
    includes("frontend/js/pwa-fix.js", "fetchPromptPayBankLaunchersDirectly", "must support Home/Notifications without game-page-only scripts.");
    includes("frontend/js/payment.js", "const hasPaymentGrid = Boolean(paymentGrid && paymentInput)", "payment method loader must work without a payment grid.");
    includes("frontend/js/payment.js", "window.dispatchEvent(new CustomEvent(\"aziel:promptpayBankLaunchersReady\"", "payment method loader must publish launcher readiness.");
}

function verifyCheckoutIntegration() {
    includes("frontend/js/payment/payment-checkout-sheet.js", "window.ensurePromptPayBankLauncherRuntime", "checkout must call the shared bank launcher runtime.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "state.bankLaunchers = window.ensurePromptPayBankLauncherRuntime", "recovery checkout must refresh launchers before rendering chooser.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "button.textContent = rt(activeState, \"loading\", \"Loading...\")", "Open Banking App button must show localized loading while launchers load.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "window.location.href = iosUrl", "iPhone Safari final bank row launch must remain synchronous.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "launcherByKey.get", "chooser rows must resolve launchers from a stable in-memory map.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "const launcherByKey = new Map()", "each chooser open must create a fresh launcher map.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "chooser.innerHTML =", "each chooser open must rebuild rows instead of reusing stale DOM.");
    includes("frontend/js/payment/payment-checkout-sheet.js", ".slice(0, 4)", "chooser must be capped to the four supported rows.");
    notIncludes("frontend/js/payment/payment-checkout-sheet.js", "cachedLauncherRows", "chooser must not cache launcher DOM rows between opens.");
}

function verifyContextFiltering() {
    includes("frontend/js/payment/pending-payment-recovery.js", "function getRecoveryPageContext()", "must have one recovery page context resolver.");
    includes("frontend/js/payment/pending-payment-recovery.js", "\"home.html\"", "must recognize Home context.");
    includes("frontend/js/payment/pending-payment-recovery.js", "\"notifications.html\"", "must recognize Notifications context.");
    includes("frontend/js/payment/pending-payment-recovery.js", "\"mlbb.html\": \"mlbb\"", "must map MLBB page.");
    includes("frontend/js/payment/pending-payment-recovery.js", "\"pubg.html\": \"pubg\"", "must map PUBG page.");
    includes("frontend/js/payment/pending-payment-recovery.js", "\"pubg-rp.html\": \"pubg-rp\"", "must keep PUBG RP separate from PUBG.");
    includes("frontend/js/payment/pending-payment-recovery.js", "\"aov-id.html\": \"aov\"", "must map AOV ID page to AOV.");
    includes("frontend/js/payment/pending-payment-recovery.js", "function normalizeAttemptGameKey", "must normalize attempt game identifiers.");
    includes("frontend/js/payment/pending-payment-recovery.js", "function filterAttemptsForPage", "must filter recoverable attempts before rendering.");
    includes("frontend/js/payment/pending-payment-recovery.js", "if (context.type === \"home\") return activeAttempts;", "Home must allow all active attempts.");
    includes("frontend/js/payment/pending-payment-recovery.js", "if (context.type === \"game\")", "Game pages must filter by page game key.");
    includes("frontend/js/payment/pending-payment-recovery.js", "return [];", "Notifications/other pages must not render the page-level overlay.");
    includes("frontend/js/pwa-fix.js", "\"notifications.html\"", "Notifications must still load the recovery runtime.");
    notIncludes("frontend/js/pwa-fix.js", "\"wallet.html\"", "Wallet must not load the page-level recovery overlay.");
    notIncludes("frontend/js/pwa-fix.js", "\"account.html\"", "Account must not load the page-level recovery overlay.");
    notIncludes("frontend/js/pwa-fix.js", "\"tracking.html\"", "Tracking must not load the page-level recovery overlay.");
    notIncludes("frontend/js/payment/pending-payment-recovery.js", "new MutationObserver", "Recovery overlay visibility must not rely on MutationObserver.");
}

function verifyCacheBusters() {
    [
        "frontend/home.html",
        "frontend/notifications.html",
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html",
        "frontend/genshin.html",
        "frontend/roblox.html"
    ].forEach(file => {
        includes(file, "pwa-fix.js?v=20260723-context-bank-runtime", "must load the fixed shared recovery runtime.");
    });

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
    ].forEach(file => {
        includes(file, "payment.js?v=20260723-bank-launcher-runtime", "game pages must load the launcher-capable payment method runtime.");
        includes(file, "payment-checkout-sheet.js?v=20260723-context-bank-runtime", "game pages must load the context-aware checkout sheet.");
    });
}

verifySharedBankRuntime();
verifyCheckoutIntegration();
verifyContextFiltering();
verifyCacheBusters();

console.log("Recovery context and bank runtime verifier passed.");
