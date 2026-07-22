const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const {
    computeRecoverableExpiresAt,
    evaluateRecoverability,
    getAttemptOwnerQuery,
    projectRecoverableAttempt
} = require("../services/pendingPaymentRecoveryService");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

const NOW = new Date("2026-07-22T10:00:00.000Z");

function minutes(n) {
    return new Date(NOW.getTime() + n * 60 * 1000);
}

function attempt(overrides = {}) {
    return {
        attemptId: "MPA_TEST_001",
        reference: "AZL-20260722-001",
        username: "alice",
        customerUserId: "user-alice",
        productCode: "mlbb",
        productName: "Mobile Legends",
        packageCode: "diamonds-1490",
        packageName: "7740+1548 Diamonds",
        gameUserData: {
            userId: "123456",
            zoneId: "789"
        },
        region: "TH",
        canonicalAmount: 1490,
        finalAmount: 1490,
        originalAmount: 1490,
        discountAmount: 0,
        canonicalCurrency: "THB",
        paymentMethod: "promptpay",
        paymentType: "manual",
        provider: "promptpay",
        status: "active",
        createdAt: minutes(-2),
        expiresAt: minutes(15),
        recoverableExpiresAt: null,
        receiptSubmittedAt: null,
        consumedAt: null,
        orderId: "",
        evidence: {},
        instructions: {
            method: "PromptPay QR",
            key: "promptpay",
            qrMode: "aziel_promptpay_dynamic",
            confirmationMode: "manual_admin",
            enableSaveQr: true,
            enableOpenApp: true,
            enableChecklist: true,
            dynamicQrSupported: true,
            amountPrefillSupported: true,
            referenceSupported: true,
            galleryScanSupported: true,
            receiptUploadEnabled: true,
            slipRequired: true,
            openAppMode: "bank_chooser",
            appLaunchMode: "APP_ONLY",
            checklistSteps: [
                { key: "save_qr", action: "save_qr", enabled: true, sortOrder: 10 },
                { key: "upload_receipt", action: "upload_receipt", enabled: true, sortOrder: 40 }
            ],
            bankLaunchers: [],
            dynamicQr: {
                orderReference: "AZL-20260722-001",
                encodedReference: "AZL-20260722-001",
                qrPayload: "000201010212",
                qrImage: "data:image/png;base64,ZmFrZQ==",
                expiresAt: minutes(12)
            }
        },
        ...overrides
    };
}

function verifyServiceRules() {
    const active = attempt();
    const evaluation = evaluateRecoverability(active, { now: NOW });
    assert.strictEqual(evaluation.resumable, true, "active owned dynamic PromptPay attempt should be resumable.");
    assert.strictEqual(evaluation.remainingSeconds, 12 * 60, "remainingSeconds must be derived from server-side earliest expiry.");

    const projectedListItem = projectRecoverableAttempt(active, evaluation, { includeQr: false });
    assert.strictEqual(projectedListItem.attemptId, active.attemptId, "recoverable list must include the same attempt ID.");
    assert.strictEqual(projectedListItem.attemptReference, active.reference, "recoverable list must include the attempt reference.");
    assert.strictEqual(projectedListItem.dynamicQr, undefined, "recoverable list must not expose dynamic QR internals.");

    const projectedResume = projectRecoverableAttempt(active, evaluation, { includeQr: true });
    assert.strictEqual(projectedResume.dynamicQr.qrImage, active.instructions.dynamicQr.qrImage, "resume must return the exact stored dynamic QR image.");
    assert.strictEqual(projectedResume.dynamicQr.orderReference, active.instructions.dynamicQr.orderReference, "resume must return the same QR reference.");
    assert.strictEqual(projectedResume.dynamicQr.qrPayload, undefined, "resume response must not expose raw QR payload.");

    const legacy = attempt({ recoverableExpiresAt: null });
    assert.strictEqual(
        computeRecoverableExpiresAt(legacy).toISOString(),
        minutes(12).toISOString(),
        "legacy attempts without recoverableExpiresAt must derive earliest valid expiry safely."
    );

    assert.strictEqual(evaluateRecoverability(attempt({ expiresAt: minutes(-1) }), { now: NOW }).resumable, false, "expired attempt must not be resumable.");
    assert.strictEqual(evaluateRecoverability(attempt({ status: "consumed" }), { now: NOW }).resumable, false, "submitted/consumed attempt must not be resumable.");
    assert.strictEqual(evaluateRecoverability(attempt({ receiptSubmittedAt: minutes(-1) }), { now: NOW }).resumable, false, "receipt-submitted attempt must not be resumable.");
    assert.strictEqual(evaluateRecoverability(attempt({ orderId: "AZL_ORDER" }), { now: NOW }).resumable, false, "attempt with orderId must not be resumable.");
    assert.strictEqual(evaluateRecoverability(attempt(), { now: NOW, linkedOrderExists: true }).resumable, false, "attempt linked to an existing Order must not be resumable.");
    assert.strictEqual(evaluateRecoverability(attempt({
        instructions: {
            ...attempt().instructions,
            dynamicQr: {
                ...attempt().instructions.dynamicQr,
                qrImage: ""
            }
        }
    }), { now: NOW }).resumable, false, "attempt without stored QR image must not be silently regenerated.");

    const ownerQuery = getAttemptOwnerQuery({ _id: "user-alice", username: "alice" }, { attemptId: "MPA_TEST_001" });
    assert.strictEqual(ownerQuery.attemptId, "MPA_TEST_001", "owner query must preserve requested attempt filter.");
    assert(ownerQuery.$or.some(item => item.customerUserId === "user-alice"), "owner query must use authenticated user id.");
    assert(ownerQuery.$or.some(item => item.username === "alice"), "owner query must support legacy username ownership.");
}

function verifyModelsAndRoutes() {
    includes("backend/models/ManualPaymentAttempt.js", "recoverableExpiresAt", "ManualPaymentAttempt must persist normalized recovery expiry.");
    includes("backend/models/ManualPaymentAttempt.js", "receiptSubmittedAt", "ManualPaymentAttempt must persist receipt submission marker.");
    includes("backend/models/ManualPaymentAttempt.js", "qrImage", "ManualPaymentAttempt dynamic QR snapshot must persist the QR image.");
    includes("backend/models/ManualPaymentAttempt.js", "customerUserId: 1, status: 1, recoverableExpiresAt: 1", "ManualPaymentAttempt must index recovery by authenticated user id/status/expiry.");
    includes("backend/models/Order.js", "manualPaymentAttemptId: 1", "Order must keep unique manual attempt linkage.");
    includes("backend/models/Order.js", "unique: true", "Order manual attempt linkage must be unique.");
    includes("backend/routes/payment.js", 'router.get("/payment/manual/recoverable"', "recoverable list endpoint must exist.");
    includes("backend/routes/payment.js", 'router.get("/payment/manual/recoverable/:attemptId"', "recoverable detail endpoint must exist.");
    includes("backend/routes/payment.js", 'router.post("/payment/manual/recoverable/:attemptId/resume"', "recoverable resume endpoint must exist.");
    includes("backend/routes/payment.js", "getAttemptOwnerQuery(req.user", "recovery endpoints must derive ownership from authenticated user.");
    includes("backend/routes/payment.js", "projectRecoverableAttempt(attempt, evaluation, { includeQr: true })", "detail/resume must return existing stored QR snapshot.");
    includes("backend/routes/payment.js", "receiptSubmittedAt: evidence.uploadedAt", "receipt submit must mark receipt submission on attempts.");
    includes("backend/routes/paymentMethods.js", "\"instructions.dynamicQr.qrImage\": result.qrImage", "dynamic QR endpoint must snapshot returned QR image onto attempt.");
    includes("backend/routes/paymentMethods.js", "recoverableExpiresAt", "dynamic QR endpoint must persist authoritative recovery expiry.");

    const paymentRoutes = read("backend/routes/payment.js");
    const resumeRoute = paymentRoutes.slice(paymentRoutes.indexOf('router.post("/payment/manual/recoverable/:attemptId/resume"'));
    assert(!/createManualAttemptRecord|createPromptPayQr|Order\.create|notificationService\.createUserNotification/.test(resumeRoute.split("// MANUAL / DEEPLINK PAYMENT SLIP SUBMIT")[0]), "resume route must not create attempts, QR, orders, or notifications.");
    assert(!/req\.(body|query)\.userId/.test(resumeRoute.split("// MANUAL / DEEPLINK PAYMENT SLIP SUBMIT")[0]), "recovery ownership must not accept userId from request body/query.");
}

verifyServiceRules();
verifyModelsAndRoutes();

console.log("Pending payment recovery foundation verifier passed.");
