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

function verifyLoader() {
    includes("frontend/js/pwa-fix.js", "loadPendingPaymentRecoveryOverlay();", "PWA runtime must load the recovery overlay once.");
    includes("frontend/js/pwa-fix.js", "eligiblePages", "loader must use an explicit customer page allow-list.");
    includes("frontend/js/pwa-fix.js", "\"home.html\"", "home must be eligible.");
    includes("frontend/js/pwa-fix.js", "\"mlbb.html\"", "game pages must be eligible.");
    includes("frontend/js/pwa-fix.js", "\"wallet.html\"", "wallet must be eligible.");
    includes("frontend/js/pwa-fix.js", "\"tracking.html\"", "tracking/orders page must be eligible.");
    includes("frontend/js/pwa-fix.js", "azHeaderMount", "loader must require shared header mount.");
    includes("frontend/js/pwa-fix.js", "/css/payment/pending-payment-recovery.css", "loader must include shared overlay CSS.");
    includes("frontend/js/pwa-fix.js", "/js/payment/pending-payment-recovery.js", "loader must include shared overlay JS.");
    const loader = read("frontend/js/pwa-fix.js");
    const pageSet = loader.slice(loader.indexOf("const eligiblePages"), loader.indexOf("if (!eligiblePages.has(page))"));
    assert(!pageSet.includes("\"login.html\""), "login must not be eligible.");
    assert(!pageSet.includes("\"register.html\""), "register must not be eligible.");
    assert(!pageSet.includes("\"admin.html\""), "admin must not be eligible.");
}

function verifyOverlayModule() {
    const js = read("frontend/js/payment/pending-payment-recovery.js");

    includes("frontend/js/payment/pending-payment-recovery.js", "/api/payment/manual/recoverable", "overlay must fetch server-authoritative recoverable attempts.");
    includes("frontend/js/payment/pending-payment-recovery.js", "/api/payment/manual/recoverable/${encodeURIComponent(id)}/resume", "continue must call resume with exact attempt ID.");
    includes("frontend/js/payment/pending-payment-recovery.js", "aziel:resume-payment", "continue must dispatch stable Phase 2.4 handoff event.");
    includes("frontend/js/payment/pending-payment-recovery.js", "sessionStorage.setItem(dismissKey", "dismissal must be session-scoped presentation state.");
    includes("frontend/js/payment/pending-payment-recovery.js", "isPaymentSheetOpen", "overlay must suppress while payment sheet is open.");
    includes("frontend/js/payment/pending-payment-recovery.js", "#azPaymentCheckoutSheet.show", "overlay must detect active checkout sheet.");
    includes("frontend/js/payment/pending-payment-recovery.js", "remainingSeconds", "overlay must consume server-provided remainingSeconds.");
    includes("frontend/js/payment/pending-payment-recovery.js", "recoverableExpiresAt", "overlay must use server-provided recovery expiry.");
    includes("frontend/js/payment/pending-payment-recovery.js", "aziel:languageChanged", "overlay must rerender on locale changes.");
    includes("frontend/js/payment/pending-payment-recovery.js", "aziel:userChanged", "overlay must remove itself on logout/auth change.");
    includes("frontend/js/payment/pending-payment-recovery.js", "aziel:shopRegionChanged", "overlay must reconcile when region changes.");
    includes("frontend/js/payment/pending-payment-recovery.js", "state.attempts.length - 1", "multiple attempts must render one overlay with +N indicator.");
    includes("frontend/js/payment/pending-payment-recovery.js", "sort((a, b) => new Date(b.createdAt", "newest attempt must be chosen first.");
    includes("frontend/js/payment/pending-payment-recovery.js", "ensureRecoveryCheckoutRuntime", "continue must load the shared checkout runtime before handoff.");
    includes("frontend/js/payment/pending-payment-recovery.js", "PaymentCheckoutSheet?.openRecoveredPayment", "overlay must require the recovered checkout initializer.");
    assert(!js.includes("Recovery details ready"), "temporary recovery preview must not render in customer flow.");
    assert(!js.includes("Full recovery checkout opens in the next phase."), "temporary Phase 2.2 preview hint must be removed.");

    assert(!/localStorage\.(getItem|setItem)\([^)]*PendingPaymentDismissed/.test(js), "dismissal must not use permanent localStorage.");
    assert(!/createPromptPayQr|payment-methods\/.*promptpay-qr|payment\/manual\/attempt["'`)]/.test(js), "overlay must not create attempts or regenerate QR.");
    assert(!/Order|notificationService|createUserNotification/.test(js), "overlay must not create Orders or notifications.");
    assert(!/qrPayload/.test(js), "overlay must not place raw QR payload handling in the frontend entry layer.");
    assert(!/document\.body\.classList\.add\(["'].*lock|overflow\s*=\s*["']hidden/.test(js), "overlay must not lock page scrolling.");
}

function verifyCss() {
    includes("frontend/css/payment/pending-payment-recovery.css", ".az-pending-payment", "overlay CSS namespace must exist.");
    includes("frontend/css/payment/pending-payment-recovery.css", "position: fixed", "overlay must float compactly over public pages.");
    includes("frontend/css/payment/pending-payment-recovery.css", "pointer-events: none", "overlay owner must not block the full page.");
    includes("frontend/css/payment/pending-payment-recovery.css", "@media (max-width: 720px)", "mobile layout must be explicitly bounded.");
    includes("frontend/css/payment/pending-payment-recovery.css", "width: calc(100vw - 24px)", "mobile width must avoid horizontal overflow.");
    includes("frontend/css/payment/pending-payment-recovery.css", "prefers-reduced-motion", "motion must respect reduced motion.");
    includes("frontend/css/payment/pending-payment-recovery.css", "focus-visible", "controls must keep keyboard focus indicators.");
}

function verifyI18n() {
    const keys = [
        "resumePaymentTitle",
        "resumePaymentSubtitle",
        "resumePaymentAction",
        "resumePaymentRemaining",
        "resumePaymentMore",
        "resumePaymentClose",
        "resumePaymentReadyTitle",
        "resumePaymentReference",
        "resumePaymentPhase24Hint"
    ];

    ["frontend/lang/en.js", "frontend/lang/my.js", "frontend/lang/th.js"].forEach(file => {
        keys.forEach(key => includes(file, key, `${key} must be translated.`));
    });

    includes("frontend/lang/en.js", "Payment Not Completed", "English title must match product copy.");
    includes("frontend/lang/my.js", "ငွေပေးချေမှု မပြီးသေးပါ", "Myanmar title must match product copy.");
    includes("frontend/lang/th.js", "การชำระเงินยังไม่เสร็จสิ้น", "Thai title must match product copy.");
}

verifyLoader();
verifyOverlayModule();
verifyCss();
verifyI18n();

console.log("Pending payment resume overlay verifier passed.");
