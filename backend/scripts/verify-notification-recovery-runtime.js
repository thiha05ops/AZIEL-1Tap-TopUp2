const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const fail = message => {
    throw new Error(message);
};
const assertIncludes = (source, needle, label) => {
    if (!source.includes(needle)) fail(`${label} is missing: ${needle}`);
};

const pwaFix = read("frontend/js/pwa-fix.js");
const notificationLive = read("frontend/js/notification-live.js");
const notificationsPage = read("frontend/js/notifications-page.js");

assertIncludes(pwaFix, "window.ensurePendingPaymentRecoveryRuntime", "Shared recovery runtime initializer");
assertIncludes(pwaFix, "window.__AZIEL_PENDING_PAYMENT_RECOVERY_RUNTIME_PROMISE__", "Shared in-flight runtime promise");
assertIncludes(pwaFix, "await ensureAzielI18nReady()", "Runtime waits for i18n");
assertIncludes(pwaFix, "payment-checkout-sheet.js?v=20260723-context-bank-runtime", "Runtime loads checkout sheet once");
assertIncludes(pwaFix, "pending-payment-recovery.js?v=20260723-context-bank-runtime", "Runtime loads recovery overlay once");
assertIncludes(pwaFix, "window.AZIEL_PENDING_PAYMENT_RECOVERY?.resumeAttempt", "Runtime waits for resumeAttempt API");

assertIncludes(notificationLive, "await window.ensurePendingPaymentRecoveryRuntime?.()", "Bell notification resume waits for shared runtime");
assertIncludes(notificationsPage, "await window.ensurePendingPaymentRecoveryRuntime?.()", "Notification Center resume waits for shared runtime");

if (/AZIEL_PENDING_PAYMENT_RECOVERY\?\.resumeAttempt/.test(notificationLive) || /const recovery = window\.AZIEL_PENDING_PAYMENT_RECOVERY/.test(notificationsPage)) {
    fail("Notification modules must not directly probe the recovery global before using the shared runtime");
}

if (/setInterval\(|setTimeout\([^,]+,\s*0\)/.test(notificationLive + notificationsPage)) {
    fail("Notification resume modules must not add independent retry timers");
}

console.log("Notification recovery runtime verifier passed.");
