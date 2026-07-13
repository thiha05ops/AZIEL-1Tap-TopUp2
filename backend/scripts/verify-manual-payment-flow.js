const assert = require("assert");
const fs = require("fs");
const path = require("path");

const Order = require("../models/Order");
const ManualPaymentAttempt = require("../models/ManualPaymentAttempt");
const {
    DEFAULT_MANUAL_ATTEMPT_LIMIT,
    DEFAULT_MANUAL_ATTEMPT_TTL_MS,
    createAttemptId,
    createManualReference,
    getManualAttemptLimit,
    getManualAttemptTtlMs,
    normalizePaymentKey,
    projectPaymentInstructions
} = require("../services/manualPaymentAttemptService");
const { abandonedPendingQuery } = require("../services/pendingOrderPolicy");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "../..", relativePath), "utf8");
}

function assertIncludes(label, source, pattern) {
    assert(
        source.includes(pattern),
        `${label}: expected source to include ${pattern}`
    );
}

function assertRegex(label, source, pattern) {
    assert(
        pattern.test(source),
        `${label}: expected source to match ${pattern}`
    );
}

function verifySecureIdentity() {
    const attemptIds = new Set(Array.from({ length: 100 }, () => createAttemptId()));
    const references = new Set(Array.from({ length: 100 }, () => createManualReference()));

    assert.strictEqual(attemptIds.size, 100, "attempt IDs should be unique");
    assert.strictEqual(references.size, 100, "references should be unique");

    for (const id of attemptIds) {
        assert(/^MPA-[A-F0-9]{20}$/.test(id), `invalid attempt ID format: ${id}`);
    }

    for (const reference of references) {
        assert(/^AZL-[A-F0-9]{16}$/.test(reference), `invalid reference format: ${reference}`);
    }

    assert.strictEqual(getManualAttemptLimit({}), DEFAULT_MANUAL_ATTEMPT_LIMIT);
    assert.strictEqual(getManualAttemptTtlMs({}), DEFAULT_MANUAL_ATTEMPT_TTL_MS);
    assert.strictEqual(getManualAttemptLimit({ MAX_ACTIVE_MANUAL_PAYMENT_ATTEMPTS: "3" }), 3);
    assert.strictEqual(getManualAttemptTtlMs({ MANUAL_PAYMENT_ATTEMPT_TTL_MINUTES: "2" }), 120000);
}

function verifyProjection() {
    assert.strictEqual(normalizePaymentKey("SCB Easy"), "scbeasy");

    const projected = projectPaymentInstructions({
        method: "SCB",
        key: "scb",
        paymentType: "deeplink",
        provider: "scb",
        accountName: "AZIEL",
        accountNumber: "123",
        uploadedQrImage: "/uploads/payment-assets/scb.png",
        providerConfig: {
            apiKey: "secret"
        }
    }, "AZL-REFERENCE");

    assert.deepStrictEqual(projected, {
        method: "SCB",
        key: "scb",
        paymentType: "deeplink",
        provider: "scb",
        accountName: "AZIEL",
        accountNumber: "123",
        qrImage: "/uploads/payment-assets/scb.png",
        reference: "AZL-REFERENCE"
    });
}

function verifySchemas() {
    assert(ManualPaymentAttempt.schema.path("attemptId"), "attempt schema should include attemptId");
    assert(ManualPaymentAttempt.schema.path("expiresAt"), "attempt schema should include expiresAt");
    assert(ManualPaymentAttempt.schema.path("consumedAt"), "attempt schema should include consumedAt");
    assert(Order.schema.path("manualPaymentAttemptId"), "order schema should include manualPaymentAttemptId");

    const orderIndexes = Order.schema.indexes();
    assert(
        orderIndexes.some(([fields, options]) => (
            fields.manualPaymentAttemptId === 1 &&
            options?.unique === true &&
            options?.partialFilterExpression
        )),
        "order schema should have a unique partial manualPaymentAttemptId index"
    );

    const attemptIndexes = ManualPaymentAttempt.schema.indexes();
    assert(
        attemptIndexes.some(([fields]) => fields.username === 1 && fields.status === 1 && fields.expiresAt === 1),
        "attempt schema should index active user attempts"
    );
    assert(
        attemptIndexes.some(([fields, options]) => fields.expiresAt === 1 && options?.expireAfterSeconds),
        "attempt schema should have a cleanup TTL index"
    );
}

function verifyPendingPolicy() {
    const query = abandonedPendingQuery("alice", new Date("2026-01-01T00:00:00.000Z"));
    const serialized = JSON.stringify(query);

    assertIncludes("pending policy", serialized, "pending_payment");
    assertIncludes("pending policy", serialized, "paymentSlip");
    assertIncludes("pending policy", serialized, "paymentEvidence.url");
    assertIncludes("pending policy", serialized, "wallet");
}

function verifyRouteContracts() {
    const paymentRoute = read("backend/routes/payment.js");
    const orderRoute = read("backend/routes/order.js");

    assertIncludes("manual attempt endpoint", paymentRoute, '"/payment/manual/attempt"');
    assertIncludes("manual slip endpoint", paymentRoute, '"/payment/manual/attempt/:attemptId/slip"');
    assertIncludes("manual route auth", paymentRoute, "authMiddleware, manualAttemptLimiter");
    assertIncludes("manual slip auth", paymentRoute, "authMiddleware, upload.single(\"slip\")");
    assertIncludes("no order before slip", paymentRoute, "USE_MANUAL_PAYMENT_ATTEMPT");
    assertIncludes("slip evidence owner", paymentRoute, "category: \"paymentSlip\"");
    assertIncludes("manual order idempotency", paymentRoute, "manualPaymentAttemptId: attempt.attemptId");
    assertIncludes("manual order pending", paymentRoute, "status: ORDER_STATES.PENDING_PAYMENT");
    assertIncludes("manual order not paid", paymentRoute, "paymentStatus: PAYMENT_STATES.PENDING");
    assertIncludes("attempt ownership", paymentRoute, "username: req.user.username");
    assertIncludes("attempt expiry", paymentRoute, "MANUAL_PAYMENT_ATTEMPT_EXPIRED");
    assertIncludes("wrong user hidden", paymentRoute, "MANUAL_PAYMENT_ATTEMPT_NOT_FOUND");
    assertIncludes("legacy guard", orderRoute, "USE_MANUAL_PAYMENT_ATTEMPT");
}

function verifyFrontendContracts() {
    const engine = read("frontend/js/payment/payment-engine.js");
    const utils = read("frontend/js/payment/payment-utils.js");

    assertIncludes("frontend creates manual attempt", engine, "/api/payment/manual/attempt");
    assertIncludes("manual branch", engine, 'type === "manual" || type === "deeplink"');
    assertIncludes("manual slip endpoint", utils, "/api/payment/manual/attempt/");
    assertIncludes("manual success title", utils, "Slip Submitted");
    assertIncludes("manual verification copy", utils, "Waiting for Verification");
    assertRegex("manual branch before create session", engine, /createManualAttempt\(orderData\)[\s\S]+createPaymentSession\(orderData\)/);
}

function main() {
    verifySecureIdentity();
    verifyProjection();
    verifySchemas();
    verifyPendingPolicy();
    verifyRouteContracts();
    verifyFrontendContracts();

    console.log("Manual payment flow verification passed.");
}

main();
