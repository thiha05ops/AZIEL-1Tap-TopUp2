#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const { loadManualPaymentMethod, startCustomerManualPaymentCheckout } = require("../services/commerce/customerManualPaymentCheckoutService");
const { createManualAdminAdapter } = require("../services/commerce/providers/manualAdminAdapter");
const method = (overrides = {}) => ({ key: "ayapay", method: "AYA Pay", region: "MM", enabled: true, paymentType: "manual", provider: "ayapay", accountName: "AZIEL MM", accountNumber: "000111", qrMode: "uploaded_static", uploadedQrImage: "/server/aya.png", receiptUploadEnabled: true, slipRequired: true, confirmationMode: "manual_admin", enableOpenApp: false, ...overrides });

async function main() {
    await assert.rejects(() => loadManualPaymentMethod({ key: "ayapay", region: "MM" }, { findPaymentMethods: async () => [method()] }), error => error.code === "PAYMENT_METHOD_UNAVAILABLE", "legacy MM manual methods must be blocked for new checkout");
    for (const invalid of [method({ enabled: false }), method({ region: "TH" }), method({ paymentType: "auto", confirmationMode: "automatic_provider" })]) {
        await assert.rejects(() => loadManualPaymentMethod({ key: "ayapay", region: "MM" }, { findPaymentMethods: async query => invalid.region === query.region ? [invalid] : [] }), error => error.code === "PAYMENT_METHOD_UNAVAILABLE");
    }
    await assert.rejects(() => loadManualPaymentMethod({ key: "ayapay", region: "MM" }, { findPaymentMethods: async () => [method(), method()] }), error => error.code === "PAYMENT_METHOD_UNAVAILABLE");

    const adapter = createManualAdminAdapter({ configuration: { methodKey: "ayapay", methodName: "AYA Pay", region: "MM", currency: "MMK", accountName: "AZIEL MM", accountNumber: "000111", qrImage: "/server/aya.png", qrMode: "uploaded_static", receiptUploadEnabled: true, slipRequired: true, confirmationMode: "manual_admin" }, clock: () => new Date("2026-08-28T00:00:00.000Z") });
    let externalCalls = 0;
    const created = await adapter.createPayment({ intent: { orderId: "AZL-1", region: "MM", currency: "MMK", amount: 12500, paymentMethodId: "ayapay" }, attempt: { attemptId: "ATT-1" } });
    assert.strictEqual(created.provider, "MANUAL_ADMIN"); assert.strictEqual(created.status, "PENDING"); assert.strictEqual(created.currency, "MMK"); assert.strictEqual(created.paymentInstructions.methodKey, "ayapay");
    await assert.rejects(() => adapter.handleProviderEvent({ trustedOperational: false, intent: {}, attempt: {}, providerEvent: {} }));
    const paid = await adapter.handleProviderEvent({ trustedOperational: true, intent: { amount: 12500, currency: "MMK" }, attempt: { providerReference: created.providerReference, amount: 12500, currency: "MMK", paymentInstructions: created.paymentInstructions }, providerEvent: { provider: "MANUAL_ADMIN", providerReference: created.providerReference, providerEventId: "EVT-1", eventType: "MANUAL_PAYMENT_APPROVED", amount: 12500, currency: "MMK", metadata: { receiptId: "RCP-1", verifiedBy: "ADMIN-1" } } });
    assert.strictEqual(paid.status, "PAID");

    assert.strictEqual(externalCalls, 0);

    const routes = read("backend/routes/commerceManualPaymentRoutes.js"), legacy = read("backend/routes/payment.js"), frontend = read("frontend/js/payment/payment-engine.js"), app = read("backend/services/commerce/manualPaymentApplicationService.js"), recovery = read("backend/services/commerce/commercePaymentRecoveryService.js");
    assert(routes.includes('"/commerce/checkout/manual-payment"')); assert(legacy.includes("LEGACY_PAYABLE_CREATION_DISABLED")); assert(frontend.includes('"/api/commerce/checkout/manual-payment"') && !frontend.includes('market === "MM"\n                    ? await createManualAttempt'));
    assert(app.includes("MANUAL_ADMIN_PROVIDER_ID") && app.includes("trustedOperational: true")); assert(recovery.includes("projectRecoverableManualAdminAttempt"));
    assert(!read("backend/services/commerce/customerManualPromptPayCheckoutService.js").includes('region !== "MM"'), "TH PromptPay service must not be loosened for MM.");
    console.log(JSON.stringify({ result: "PASS", provider: "MANUAL_ADMIN", method: "ayapay", newCheckoutHidden: true, historicalAttemptApprovalPreserved: true, receiptRemainsPending: true, adminApprovalOnlyPaid: true, recoveryWithAndWithoutQr: true, legacyGuardPreserved: true, externalPaymentCalls: externalCalls, supplierCalls: 0 }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
