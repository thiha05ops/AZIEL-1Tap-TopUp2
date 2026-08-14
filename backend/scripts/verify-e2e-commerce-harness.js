"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const safety = require("../e2e/e2eSafety");
const { getPermissionsForRole, PERMISSIONS } = require("../services/adminAuthorizationService");

function read(relative) {
    return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function testGateClosed() {
    assert.strictEqual(safety.isE2EMode({}), false);
    assert.throws(() => safety.assertE2EMode({}), error => error.code === "AZIEL_E2E_GATE_CLOSED");
    assert.strictEqual(safety.isE2EMode({
        AZIEL_E2E_TEST_MODE: "true",
        AZIEL_E2E_TEST_SCOPE: "safe_scope",
        AZIEL_E2E_TEST_CONFIRM: safety.CONFIRM_VALUE,
        NODE_ENV: "production"
    }), false, "E2E mode must fail closed in production");
    const harness = read("backend/scripts/e2e-commerce-th.js");
    assert(harness.includes('process.env.AZIEL_E2E_MONGO_URI || ""'), "Harness must require a dedicated database URI");
    assert(!harness.includes("process.env.AZIEL_E2E_MONGO_URI || process.env.MONGO_URI"), "Harness must never fall back to the normal runtime database");
    assert(harness.includes('hostname === "azielplay.com"'), "Harness must reject the production storefront host");
}

function testIdentityAndCustomerIsolation() {
    assert.strictEqual(safety.customerUsername("safe_scope"), "aziel_e2e_customer_safe_scope");
    assert.strictEqual(safety.adminUsername("safe_scope"), "aziel_e2e_operations_safe_scope");
    assert(safety.isTestEmail("aziel_e2e_customer_safe_scope@example.invalid", "safe_scope"));
    assert(safety.isTestUsername("aziel_e2e_customer_safe_scope", "safe_scope"));
    assert(safety.isTestUsername("aziel_e2e_operations_safe_scope", "safe_scope"));
    assert(!safety.isTestUsername("aziel_e2e_unrelated_safe_scope", "safe_scope"), "Scoped E2E identity matching must be exact.");
    const harness = read("backend/scripts/e2e-commerce-th.js");
    assert(harness.includes('"owner.userId": manifest.customerId'), "inspection must bind quote/order queries to the exact E2E owner");
    assert(harness.includes("ownerId: manifest.customerId"), "inspection must bind payment queries to the exact E2E owner");
    assert(read("backend/routes/commerceManualPaymentRoutes.js").includes("authMiddleware"), "Commerce HTTP routes must retain customer auth");
    assert(read("backend/routes/order.js").includes("adminMiddleware"), "Admin order HTTP routes must retain Admin auth");
}

function testAdminPermissions() {
    const permissions = getPermissionsForRole("OPERATIONS");
    [PERMISSIONS.ORDERS_READ, PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.FULFILLMENT_READ, PERMISSIONS.FULFILLMENT_EXECUTE, PERMISSIONS.FULFILLMENT_RESOLVE]
        .forEach(permission => assert(permissions.includes(permission), `OPERATIONS lacks ${permission}`));
    assert(!permissions.includes(PERMISSIONS.ADMIN_ACCOUNTS_MANAGE));
    assert(!permissions.includes(PERMISSIONS.CATALOG_MANAGE));
}

function testMarkerIsolation() {
    const harness = read("backend/scripts/e2e-commerce-th.js");
    assert(harness.includes("manifest.scope !== cfg.scope"));
    assert(harness.includes("Manifest is outside the active E2E scope"));
    assert(!harness.includes("deleteMany("), "Harness must not contain broad deletion");
    assert(!harness.includes("findByIdAndUpdate"), "Harness must not directly mutate Commerce state");
}

function testNotificationSuppression() {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aziel-e2e-safety-"));
    const env = {
        AZIEL_E2E_TEST_MODE: "true",
        AZIEL_E2E_TEST_SCOPE: "safe_scope",
        AZIEL_E2E_TEST_CONFIRM: safety.CONFIRM_VALUE,
        AZIEL_E2E_EVENT_SINK: path.join(temp, "events.jsonl"),
        NODE_ENV: "test"
    };
    assert(safety.suppressTestEmail("aziel_e2e_customer_safe_scope@example.invalid", env));
    assert(!safety.suppressTestEmail("unrelated@example.com", env));
    assert(!safety.suppressTestEmail("aziel_e2e_customer_safe_scope@example.invalid", { NODE_ENV: "test" }));
    assert(safety.suppressTestRealtime("aziel_e2e_customer_safe_scope", env));
    assert(!safety.suppressTestRealtime("aziel_e2e_unrelated_safe_scope", env));
    safety.recordSuppressedEvent("email", { operation: "test", recipient: "test" }, env);
    const event = JSON.parse(fs.readFileSync(env.AZIEL_E2E_EVENT_SINK, "utf8").trim());
    assert.strictEqual(event.status, "TRIGGERED_AND_SUPPRESSED");
    assert.strictEqual(event.recipient, "E2E_TEST_RECIPIENT");
}

function testReceiptFixture() {
    const data = Buffer.from(read("backend/e2e/fixtures/receipt-fixture.base64.txt").trim(), "base64");
    assert(data.length > 16 && data.length < 1024, "Receipt fixture must remain harmless and small");
    assert.strictEqual(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Receipt fixture must be a valid PNG payload");
    assert(!data.toString("utf8").match(/account|bank|customer|payment/i), "Fixture must contain no payment/customer text");
    const controller = read("backend/controllers/commerceManualPaymentController.js");
    assert(controller.includes('category: "paymentSlip"') && controller.includes("uploadFile({"), "Harness upload must reach shared receipt storage boundary");
}

function main() {
    testGateClosed();
    testIdentityAndCustomerIsolation();
    testAdminPermissions();
    testMarkerIsolation();
    testNotificationSuppression();
    testReceiptFixture();
    console.log("AZIEL E2E Commerce harness safety verifier passed.");
}

main();
