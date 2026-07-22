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
    assert(startIndex >= 0, `${file}: missing block start ${start}`);
    const endIndex = end ? source.indexOf(end, startIndex) : source.length;
    return source.slice(startIndex, endIndex >= 0 ? endIndex : source.length);
}

function verifyNotificationModelAndService() {
    includes("backend/models/Notification.js", "\"payment_recovery\"", "Notification type enum must support payment recovery.");
    includes("backend/models/Notification.js", "\"metadata.manualPaymentAttemptId\": 1", "Notification must index recovery by attempt ID.");
    includes("backend/models/Notification.js", "source: \"manual_payment_recovery\"", "Recovery notification index must be scoped by source.");

    includes("backend/services/notificationService.js", "ensurePaymentRecoveryNotification", "Notification service must expose idempotent recovery notification creation.");
    includes("backend/services/notificationService.js", "resolvePaymentRecoveryNotification", "Notification service must expose recovery notification resolution.");
    includes("backend/services/notificationService.js", "expirePaymentRecoveryNotifications", "Notification service must expire stale recovery notifications.");
    includes("backend/services/notificationService.js", "resume_manual_payment", "Recovery notification must carry a command action.");
    includes("backend/services/notificationService.js", "pendingPaymentNotificationTitle", "Recovery notification must carry i18n title metadata.");
    includes("backend/services/notificationService.js", "pendingPaymentNotificationMessage", "Recovery notification must carry i18n message metadata.");
    includes("backend/services/notificationService.js", "pendingPaymentNotificationAction", "Recovery notification must carry i18n action metadata.");

    const metadataBlock = block("backend/services/notificationService.js", "function sanitizeMetadata", "function userContextFromAuth");
    assert(metadataBlock.includes("\"manualPaymentAttemptId\""), "Recovery metadata must allow the safe attempt identifier.");
    assert(metadataBlock.includes("\"attemptReference\""), "Recovery metadata must allow the safe customer reference.");
    assert(!metadataBlock.includes("\"qrPayload\""), "Recovery notification metadata must not expose QR payload internals.");
    assert(!metadataBlock.includes("\"qrImage\""), "Recovery notification metadata must not expose QR image internals.");

    const ensureBlock = block("backend/services/notificationService.js", "async function ensurePaymentRecoveryNotification", "async function expirePaymentRecoveryNotifications");
    assert(ensureBlock.includes("$setOnInsert"), "Recovery notification creation must be idempotent and not recreate existing records.");
    assert(ensureBlock.includes("upsert: true"), "Recovery notification creation must use an upsert.");
    assert(ensureBlock.includes("result.upsertedCount > 0"), "Realtime notification emission must be reserved for newly inserted records.");
}

function verifyRecoveryRoutes() {
    includes("backend/routes/paymentMethods.js", "ensurePaymentRecoveryNotification", "Dynamic QR generation must create the recovery notification after QR snapshot.");
    includes("backend/routes/paymentMethods.js", "projectRecoverableAttempt(notificationAttempt, recoveryEvaluation, { includeQr: false })", "Recovery notification creation must use a projection without QR internals.");
    includes("backend/routes/payment.js", "expirePaymentRecoveryNotifications(req.user)", "Recoverable lookup must lazily expire stale recovery notifications.");
    includes("backend/routes/payment.js", "ensurePaymentRecoveryNotification", "Recoverable lookup must lazily sync legacy active attempts.");
    includes("backend/routes/payment.js", "resolvePaymentRecoveryNotification", "Payment submission/unavailability must resolve recovery notifications.");

    const resumeBlock = block(
        "backend/routes/payment.js",
        "router.post(\"/payment/manual/recoverable/:attemptId/resume\"",
        "// MANUAL / DEEPLINK PAYMENT SLIP SUBMIT"
    );
    assert(!resumeBlock.includes("Order.create"), "Resume route must not create orders.");
    assert(!resumeBlock.includes("createManualAttemptRecord"), "Resume route must not create new attempts.");
    assert(!resumeBlock.includes("createPromptPayQr"), "Resume route must not generate a second QR.");
    assert(!resumeBlock.includes("createUserNotification"), "Resume route must not create duplicate generic notifications.");
}

function verifyFrontendEntry() {
    includes("frontend/js/pwa-fix.js", "\"notifications.html\"", "Recovery runtime loader must be available on the Notifications page.");
    includes("frontend/js/payment/pending-payment-recovery.js", "\"notifications.html\"", "Recovery module must consider Notifications an eligible page.");
    includes("frontend/js/payment/pending-payment-recovery.js", "resumeAttempt,", "Recovery module must export resumeAttempt for notification actions.");
    includes("frontend/js/notifications-page.js", "data-resume-payment", "Notification center must render a recovery command button.");
    includes("frontend/js/notifications-page.js", "window.AZIEL_PENDING_PAYMENT_RECOVERY", "Notification center must reuse the existing recovery runtime.");
    includes("frontend/js/notification-live.js", "getRecoveryAttemptId", "Legacy dropdown adapter must recognize recovery notifications.");

    ["frontend/lang/en.js", "frontend/lang/my.js", "frontend/lang/th.js"].forEach(file => {
        includes(file, "pendingPaymentNotificationTitle", "Recovery notification title must be translated.");
        includes(file, "pendingPaymentNotificationMessage", "Recovery notification message must be translated.");
        includes(file, "pendingPaymentNotificationAction", "Recovery notification action must be translated.");
    });
}

verifyNotificationModelAndService();
verifyRecoveryRoutes();
verifyFrontendEntry();

console.log("Pending payment recovery notification verifier passed.");
