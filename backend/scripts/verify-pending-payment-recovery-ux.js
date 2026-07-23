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

function block(file, start, end) {
    const source = read(file);
    const startIndex = source.indexOf(start);
    assert(startIndex >= 0, `${file}: missing ${start}`);
    const endIndex = end ? source.indexOf(end, startIndex) : source.length;
    return source.slice(startIndex, endIndex >= 0 ? endIndex : source.length);
}

function verifyCheckoutCloseContract() {
    includes("frontend/js/payment/payment-checkout-sheet.js", "function emitCheckoutClosed", "Checkout sheet must have one explicit close event helper.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "function checkoutCloseDetail", "Checkout sheet must capture close detail before teardown.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "aziel:payment-checkout-closed", "Checkout close event must be dispatched.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "mode: isRecoveryMode(state) ? \"recovery\" : \"new\"", "Close event must report new vs recovery mode.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "attemptId: state.attemptId || state.manualPaymentAttemptId || \"\"", "Close event must include the attempt ID when available.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "receiptSubmitted: submitted", "Close event must report receipt-submitted state.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "completed: submitted", "Close event must report completed state.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "cancelled: false", "Close event must not invent backend cancellation.");
    includes("frontend/js/payment/payment-manual.js", "attemptId: paymentSession.attemptId || orderData.manualPaymentAttemptId || \"\"", "Manual checkout must pass the ManualPaymentAttempt ID to the sheet.");
    includes("frontend/js/payment/payment-deeplink.js", "attemptId: paymentSession?.attemptId || orderData.manualPaymentAttemptId || \"\"", "Deeplink checkout must pass the ManualPaymentAttempt ID to the sheet.");

    includes("frontend/js/payment/payment-checkout-sheet.js", "window.__AZIEL_PENDING_PAYMENT_CLOSE_EVENT__", "Checkout close must leave a one-time handoff for late recovery listener registration.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "CHECKOUT_CLOSE_1", "Checkout close tracing must include first checkpoint.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "CHECKOUT_CLOSE_2", "Checkout close tracing must include post-close checkpoint.");
    includes("frontend/js/payment/payment-checkout-sheet.js", "CHECKOUT_CLOSE_EVENT_DISPATCHED", "Checkout close tracing must include dispatch checkpoint.");

    const closeBlock = block("frontend/js/payment/payment-checkout-sheet.js", "function close(reason = \"programmatic\")", "window.PaymentCheckoutSheet =");
    assert(closeBlock.includes("const closeDetail = checkoutCloseDetail(reason, activeState)"), "Normal checkout close must capture close detail before clearing state.");
    assert(closeBlock.indexOf("modal?.classList.remove(\"show\")") < closeBlock.indexOf("emitCheckoutClosed(closeDetail)"), "Normal checkout close must dispatch after the sheet is marked closed.");
    assert(closeBlock.indexOf("document.body.classList.remove(\"az-payment-sheet-open\")") < closeBlock.indexOf("emitCheckoutClosed(closeDetail)"), "Normal checkout close must dispatch after body open flag is cleared.");
    assert(closeBlock.includes("emitCheckoutClosed(closeDetail)"), "Normal checkout close must emit captured detail before state is cleared.");

    const recoveryCloseBlock = block("frontend/js/payment/payment-checkout-sheet.js", "function closeMinimalRecoverySheet", "function expireRecoverySheet");
    assert(recoveryCloseBlock.includes("const closeDetail = checkoutCloseDetail(reason, activeState)"), "Recovery checkout close must capture close detail before clearing state.");
    assert(recoveryCloseBlock.includes("emitCheckoutClosed(closeDetail)"), "Recovery checkout close must use the same generic event contract.");
}

function verifyImmediateOverlayRefresh() {
    const recovery = read("frontend/js/payment/pending-payment-recovery.js");
    includes("frontend/js/payment/pending-payment-recovery.js", "scheduleCheckoutCloseRefresh", "Recovery overlay must own close-triggered refresh.");
    includes("frontend/js/payment/pending-payment-recovery.js", "window.addEventListener(\"aziel:payment-checkout-closed\"", "Recovery overlay must listen to checkout close.");
    includes("frontend/js/payment/pending-payment-recovery.js", "consumePendingCheckoutCloseEvent", "Recovery overlay must consume a one-time pending close handoff if loaded after close.");
    includes("frontend/js/payment/pending-payment-recovery.js", "window.__AZIEL_PENDING_PAYMENT_CLOSE_EVENT__", "Recovery overlay must read the late-listener pending close handoff.");
    includes("frontend/js/payment/pending-payment-recovery.js", "function waitForLanguageRuntime", "Recovery overlay must wait for site i18n before initial render.");
    includes("frontend/js/payment/pending-payment-recovery.js", "await waitForLanguageRuntime()", "Recovery overlay init must not race the language runtime.");
    includes("frontend/js/payment/pending-payment-recovery.js", "window.AZIEL_I18N?.getLang?.()", "Recovery overlay must use the site i18n language getter.");
    includes("frontend/js/payment/pending-payment-recovery.js", "translateForLang", "Recovery overlay must render from one locale snapshot.");
    includes("frontend/js/payment/pending-payment-recovery.js", "detail.mode !== \"new\"", "Recovery overlay must ignore recovery checkout close events.");
    includes("frontend/js/payment/pending-payment-recovery.js", "detail.receiptSubmitted || detail.completed || detail.cancelled", "Recovery overlay must skip submitted/completed/cancelled closes.");
    includes("frontend/js/payment/pending-payment-recovery.js", "forceAttemptId: detail.attemptId", "Close refresh must preserve the just-closed attempt ID.");
    includes("frontend/js/payment/pending-payment-recovery.js", "attempt < 2", "Close refresh must be bounded to one retry.");
    includes("frontend/js/payment/pending-payment-recovery.js", "window.setTimeout(() => run(attempt + 1), 350)", "Close refresh retry must be delayed and bounded.");
    includes("frontend/js/payment/pending-payment-recovery.js", "RECOVERY_CLOSE_EVENT_RECEIVED", "Recovery overlay must trace close event receipt in development.");
    includes("frontend/js/payment/pending-payment-recovery.js", "RECOVERY_REFRESH_STARTED", "Recovery overlay must trace refresh start in development.");
    includes("frontend/js/payment/pending-payment-recovery.js", "RECOVERY_REFRESH_RESULT", "Recovery overlay must trace refresh results in development.");
    includes("frontend/js/payment/pending-payment-recovery.js", "RECOVERY_OVERLAY_RENDERED", "Recovery overlay must trace rendered overlay in development.");
    assert(!/location\.(reload|replace)|window\.location\.href/.test(recovery), "Recovery overlay must not use navigation or reload to show after close.");
    assert(!/setInterval\([^)]*fetchRecoverable/.test(recovery), "Recovery overlay must not poll recoverable attempts.");
}

function verifyCheckoutCacheBusters() {
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
        includes(file, "payment-checkout-sheet.js?v=20260723-recovery-runtime", "Game checkout page must load the close-event checkout sheet.");
        includes(file, "payment-deeplink.js?v=20260723-close-event", "Game checkout page must load the attempt-aware deeplink bridge.");
        includes(file, "payment-manual.js?v=20260723-close-event", "Game checkout page must load the attempt-aware manual bridge.");
        includes(file, "pwa-fix.js?v=20260723-recovery-runtime", "Game checkout page must load the recovery close-event loader.");
    });
}

function verifyDismissalRules() {
    includes("frontend/js/payment/pending-payment-recovery.js", "state.forceShowAttemptId", "Dismissal override must be attempt-specific.");
    includes("frontend/js/payment/pending-payment-recovery.js", "attempt?.attemptId === state.forceShowAttemptId", "Newly closed attempt must not be hidden by a previous attempt dismissal.");
    includes("frontend/js/payment/pending-payment-recovery.js", "sessionStorage.setItem(dismissKey", "Dismissal must remain session and attempt scoped.");
    assert(!read("frontend/js/payment/pending-payment-recovery.js").includes("localStorage.setItem(dismissKey"), "Dismissal must not become permanent.");
}

function verifyRecoveryLocalization() {
    const overlay = read("frontend/js/payment/pending-payment-recovery.js");
    includes("frontend/js/payment/pending-payment-recovery.js", "function currentLanguage", "Recovery overlay must read the current locale at render time.");
    includes("frontend/js/payment/pending-payment-recovery.js", "window.localStorage?.getItem(\"azielLanguage\")", "Recovery overlay must fall back to persisted AZIEL language.");
    includes("frontend/js/payment/pending-payment-recovery.js", "localized[key] || english[key]", "Recovery overlay must read dictionaries directly from one locale snapshot.");
    includes("frontend/js/payment/pending-payment-recovery.js", "window.addEventListener(\"aziel:languageChanged\"", "Recovery overlay must rerender when the global language changes.");
    [
        "resumePaymentTitle",
        "resumePaymentSubtitle",
        "resumePaymentAction",
        "resumePaymentRemaining",
        "resumePaymentMore",
        "resumePaymentClose"
    ].forEach(key => {
        includes("frontend/js/payment/pending-payment-recovery.js", key, `Recovery overlay must use ${key}.`);
    });
    assert(!/Payment Not Completed<\/strong>|Continue Payment<\/button>|Time remaining<\/span>/.test(overlay), "Recovery overlay must not render fixed English labels without i18n.");

    includes("frontend/js/notifications-page.js", "window.AZIEL_LANG?.[lang]?.[key]", "Notification recovery action must follow current locale fallback.");
    includes("frontend/js/notification-live.js", "formatNotificationText", "Legacy notification dropdown/popup must localize recovery notification text.");
    includes("frontend/js/notification-live.js", "window.AZIEL_LANG?.[lang]?.[key]", "Legacy notification dropdown/popup must follow current locale fallback.");
}

function verifyVisualHierarchy() {
    const css = read("frontend/css/payment/pending-payment-recovery.css");
    includes("frontend/js/payment/pending-payment-recovery.js", "az-pending-payment__identity", "Overlay markup must include a recovery identity group.");
    includes("frontend/js/payment/pending-payment-recovery.js", "az-pending-payment__product", "Overlay markup must include a product details group.");
    includes("frontend/js/payment/pending-payment-recovery.js", "az-pending-payment__thumb", "Overlay markup must include a game thumbnail.");
    includes("frontend/js/payment/pending-payment-recovery.js", "az-pending-payment__meta", "Overlay markup must include amount/countdown metadata.");
    includes("frontend/js/payment/pending-payment-recovery.js", "az-pending-payment__continue", "Overlay markup must include a strong continue action.");

    includes("frontend/css/payment/pending-payment-recovery.css", ".az-pending-payment__identity", "Desktop CSS must style the recovery identity group.");
    includes("frontend/css/payment/pending-payment-recovery.css", ".az-pending-payment__product", "Desktop CSS must style product details.");
    includes("frontend/css/payment/pending-payment-recovery.css", ".az-pending-payment__thumb", "Desktop CSS must style the game thumbnail.");
    includes("frontend/css/payment/pending-payment-recovery.css", "#azPendingPaymentCountdown", "Countdown must have a distinct visual owner.");
    includes("frontend/css/payment/pending-payment-recovery.css", "body.light .az-pending-payment__shell", "Light mode must have explicit shell contrast.");
    includes("frontend/css/payment/pending-payment-recovery.css", "@media (max-width: 720px)", "Mobile overlay layout must be explicit.");
    includes("frontend/css/payment/pending-payment-recovery.css", "width: 100%;", "Mobile continue button must support full-width layout.");
    includes("frontend/css/payment/pending-payment-recovery.css", "@media (prefers-reduced-motion: reduce)", "Overlay motion must respect reduced motion.");
    assert(css.includes("backdrop-filter"), "Overlay must retain approved glass treatment.");
    assert(!css.includes("position: absolute;\n    inset: 0"), "Overlay must not become a full-screen modal.");
}

verifyCheckoutCloseContract();
verifyImmediateOverlayRefresh();
verifyDismissalRules();
verifyRecoveryLocalization();
verifyVisualHierarchy();
verifyCheckoutCacheBusters();

console.log("Pending payment recovery UX verifier passed.");
