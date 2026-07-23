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

function verifyOverlayHandoff() {
    const overlay = read("frontend/js/payment/pending-payment-recovery.js");
    includes("frontend/js/payment/pending-payment-recovery.js", "/api/payment/manual/recoverable/${encodeURIComponent(id)}/resume", "Continue Payment must call resume endpoint with exact attempt ID.");
    includes("frontend/js/payment/pending-payment-recovery.js", "ensureRecoveryCheckoutRuntime", "overlay must load checkout runtime before event handoff.");
    includes("frontend/js/payment/pending-payment-recovery.js", "window.dispatchEvent(new CustomEvent(RECOVERY_EVENT", "overlay must dispatch the recovery event.");
    includes("frontend/js/payment/pending-payment-recovery.js", "removeOverlay();", "overlay must move out of the way before checkout opens.");
    assert(!overlay.includes("renderPreview"), "temporary Phase 2.2 preview renderer must be removed.");
    assert(!overlay.includes("Recovery details ready"), "customer-facing placeholder preview must not remain.");
    assert(!/payment\/manual\/attempt["'`)]/.test(overlay), "overlay must not create a new manual attempt.");
    assert(!/promptpay-qr/.test(overlay), "overlay must not generate a dynamic QR.");
}

function verifyCheckoutRecoveryMode() {
    const sheet = read("frontend/js/payment/payment-checkout-sheet.js");
    const openBlock = sheet.match(/function openRecoveredPayment\(recovery = \{\}\) \{[\s\S]*?\n    \}/)?.[0] || "";
    const dedicatedBlock = sheet.match(/function showMinimalRecoveredPayment\(options = \{\}\) \{[\s\S]*?\n    function openRecoveredPayment/)?.[0] || "";

    includes("frontend/js/payment/payment-checkout-sheet.js", "function isRecoveryMode", "checkout must have explicit recovery mode.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "mode: \"recovery\"", "recovered checkout state must carry mode=recovery.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "openRecoveredPayment", "shared checkout sheet must expose recovered payment initializer.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "window.addEventListener(\"aziel:resume-payment\"", "checkout must consume the recovery event handoff.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "normalizeRecovery", "checkout must normalize the safe recovery response.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "dynamicQr.qrImage", "checkout must read the stored recovered QR image.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "showMinimalRecoveredPayment", "recovery must use the dedicated stable renderer.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "azRecoveredPaymentMiniSheet", "dedicated recovery sheet instance must be explicit.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "isDynamicPromptPayMode(options) && !isRecoveryMode(options)", "recovery mode must bypass QR generation.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "/api/payment/manual/attempt/${encodeURIComponent(options.attemptId)}/slip", "receipt must submit against existing ManualPaymentAttempt.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "aziel:recovered-payment-submitted", "successful recovery submit must emit cleanup event.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "aziel:recovered-payment-expired", "recovery expiry must emit cleanup event.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "expireRecoverySheet", "dedicated recovery renderer must disable actions on expiry.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "renderRecoveryDesktopBanks", "desktop must render informational supported bank logos.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "showRecoveryBankChooser", "mobile must expose recovery-only bank chooser.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "updateRecoveryMobileStep", "mobile recovery must use direct Step 1 / Step 2 handlers.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "bindRecoveryFileInput", "recovery must own receipt file selection.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "bindRecoverySubmit", "recovery must own duplicate-safe receipt submission.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "saveDynamicQr(state.activeDynamicQr)", "Save QR must use the recovered dynamic QR helper.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "recoveryBankLaunchers", "bank chooser must use canonical recovery launcher collection.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "recoveryCanonicalLaunchers", "recovery bank chooser must have a canonical PromptPay launcher source.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "window.AZIEL_TH_BANK_APPS", "recovery bank chooser must use the public PromptPay launcher runtime collection.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "canonical_promptpay_runtime", "canonical PromptPay launchers must take precedence over recovery snapshots.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "async function ensurePromptPayLauncherRuntime", "recovery chooser must wait for PromptPay launcher runtime readiness.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "await window.loadPaymentMethods()", "recovery chooser must bootstrap canonical launcher runtime when needed.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "const ready = await ensurePromptPayLauncherRuntime()", "recovery chooser must not render shell before launchers are ready.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "sourceType: \"empty\"", "recovery chooser must not render rows from stale recovery snapshot launchers.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "cloneRecoveryLauncher", "recovery chooser must clone launchers instead of mutating canonical arrays.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "promptPayRuntime.map(cloneRecoveryLauncher)", "each recovery chooser open must use a fresh cloned canonical launcher list.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "RECOVERY_LAUNCHERS_SOURCE", "recovery launcher source diagnostics must exist.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "RECOVERY_LAUNCHERS_NORMALIZED", "recovery launcher normalized diagnostics must exist.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "RECOVERY_LAUNCHERS_RENDERED", "recovery launcher rendered diagnostics must exist.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "String(app.key || \"\").toLowerCase() !== \"kplus\"", "K PLUS must remain hidden.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "normalizeRecoveryLauncherKey(app.key || app.provider || app.displayName || app.appDisplayName || app.label) !== \"kplus\"", "recovery launcher filtering must explicitly hide K PLUS.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "id: normalizeRecoveryLauncherKey", "recovery launchers must normalize to compact objects with stable IDs.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "androidPackage: app.androidPackage || app.androidPackageName || \"\"", "recovery launchers must preserve Android package launch fields.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "function getCanonicalSiteLanguage", "recovery checkout must use a single canonical site language source.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "window.AZIEL_I18N?.getLang?.() || \"en\"", "canonical recovery language must come from the site i18n runtime.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "lang = getCanonicalSiteLanguage()", "recovery render must capture one locale snapshot.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "rt(activeState, \"recoveryResumePayment\"", "recovery title must use the captured locale.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "rt(state, \"payment_choose_banking_app\"", "recovery chooser must use the captured locale.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "rerenderActiveRecoveryCheckout", "language changes must rerender active recovery checkout.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "aziel:languageChanged", "recovery checkout must listen for site language changes.");
    assert(openBlock && !openBlock.includes("show({"), "openRecoveredPayment must not call the full shared show() renderer.");
    assert(openBlock.includes("showMinimalRecoveredPayment(options)"), "openRecoveredPayment must route valid recovery to the dedicated renderer.");
    assert(!openBlock.includes("requestDynamicPromptPayQr"), "recovered checkout must not call dynamic QR generation.");
    assert(!openBlock.includes("payment/manual/attempt"), "openRecoveredPayment must not create a new manual attempt.");
    assert(!openBlock.includes("Order.create"), "openRecoveredPayment must not create Orders directly.");
    assert(dedicatedBlock.includes("document.createElement(\"div\")"), "dedicated renderer must create its own stable shell.");
    assert(dedicatedBlock.includes("qrImage.src = qr"), "dedicated renderer must assign the exact server-owned QR image.");
    assert(dedicatedBlock.includes("id=\"azPaymentSheetSaveQr\""), "dedicated renderer must include Save QR.");
    assert(dedicatedBlock.includes("id=\"azPaymentSheetOpenBankApp\""), "dedicated renderer must include mobile Open Banking App.");
    assert(dedicatedBlock.includes("id=\"azPaymentSheetReceipt\""), "dedicated renderer must include receipt upload UI.");
    assert(dedicatedBlock.includes("id=\"azPaymentSheetSubmit\""), "dedicated renderer must include submit for verification.");
    assert(dedicatedBlock.includes("startRecoveryCountdown(activeState)"), "dedicated renderer must start one recovery countdown.");
    assert(!dedicatedBlock.includes("sessionStorage"), "dedicated recovery renderer must not persist QR state.");
    assert(!dedicatedBlock.includes("localStorage"), "dedicated recovery renderer must not persist QR state.");
    assert(!dedicatedBlock.includes("new MutationObserver"), "dedicated recovery renderer must not create MutationObservers.");
}

function verifyI18n() {
    const keys = [
        "recoveryResumePayment",
        "recoveryPaymentExpired",
        "recoveryQrUnavailable",
        "recoveryStartNewPayment",
        "recoveryBack",
        "payment_progress",
        "payment_receipt_file_hint",
        "payment_receipt_selected",
        "payment_choose_receipt_first",
        "payment_submitting_receipt",
        "payment_slip_submitted",
        "payment_submission_failed",
        "payment_qr_ready_to_save",
        "payment_qr_save_failed",
        "close",
        "remove"
    ];

    ["frontend/lang/en.js", "frontend/lang/my.js", "frontend/lang/th.js"].forEach(file => {
        keys.forEach(key => includes(file, key, `${key} must be translated.`));
    });

    includes("frontend/lang/en.js", "Resume Payment", "English recovery title must match requested copy.");
    includes("frontend/lang/my.js", "ငွေပေးချေမှုကို ဆက်လုပ်မည်", "Myanmar recovery title must match requested copy.");
    includes("frontend/lang/th.js", "ชำระเงินต่อ", "Thai recovery title must match requested copy.");
}

verifyOverlayHandoff();
verifyCheckoutRecoveryMode();
verifyI18n();

console.log("Pending payment recovery checkout verifier passed.");
