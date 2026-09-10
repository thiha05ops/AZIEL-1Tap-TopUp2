"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PaymentMethod = require("../models/PaymentMethod");
const paymentMethodsRoute = require("../routes/paymentMethods");

const ROOT = path.resolve(__dirname, "../..");
const adminSource = fs.readFileSync(path.join(ROOT, "frontend/js/admin-payments.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(ROOT, "frontend/admin.html"), "utf8");
const routeSource = fs.readFileSync(path.join(ROOT, "backend/routes/paymentMethods.js"), "utf8");
const { applyPaymentMethodPatch, formatAdminMethod, formatMethod, normalizePaymentMethodKey } = paymentMethodsRoute._test;

function main() {
    assert(adminSource.includes('key: "tmw_promptpay", label: "TMW PromptPay (Automatic)"'), "Thailand wizard must expose a separate TMW automatic PromptPay choice");
    assert(adminHtml.includes("admin-payments.js?v=20260910-tmw-admin-presentation"), "Admin must load the updated payment wizard asset");
    assert(adminSource.includes('provider: "tmw", qrMode: "provider_generated", confirmationMode: "provider_webhook"'), "TMW wizard preset must select the canonical provider flow");

    const tmw = {
        method: "TMW PromptPay",
        key: normalizePaymentMethodKey("tmw_promptpay"),
        region: "TH",
        enabled: false,
        paymentType: "auto",
        provider: "tmw"
    };
    applyPaymentMethodPatch(tmw, {
        enabled: false,
        paymentType: "auto",
        provider: "tmw",
        qrMode: "provider_generated",
        confirmationMode: "provider_webhook",
        slipRequired: false,
        receiptUploadEnabled: false,
        autoVerificationSupported: true,
        webhookSupported: true,
        shortDescription: "Pay using the K PLUS mobile app",
        badgeText: "Bank App"
    });
    assert.deepStrictEqual({
        key: tmw.key,
        region: tmw.region,
        enabled: tmw.enabled,
        paymentType: tmw.paymentType,
        provider: tmw.provider,
        qrMode: tmw.qrMode,
        confirmationMode: tmw.confirmationMode,
        slipRequired: tmw.slipRequired,
        receiptUploadEnabled: tmw.receiptUploadEnabled,
        autoVerificationSupported: tmw.autoVerificationSupported,
        webhookSupported: tmw.webhookSupported,
        shortDescription: tmw.shortDescription,
        badgeText: tmw.badgeText
    }, {
        key: "tmw_promptpay",
        region: "TH",
        enabled: false,
        paymentType: "auto",
        provider: "tmw",
        qrMode: "provider_generated",
        confirmationMode: "provider_webhook",
        slipRequired: false,
        receiptUploadEnabled: false,
        autoVerificationSupported: true,
        webhookSupported: true,
        shortDescription: "PromptPay with automatic confirmation",
        badgeText: "Automatic"
    });

    const manual = applyPaymentMethodPatch({
        method: "PromptPay QR",
        key: "promptpay",
        region: "TH",
        enabled: true,
        paymentType: "manual",
        provider: "promptpay",
        qrMode: "aziel_promptpay_dynamic"
    }, {});
    assert.strictEqual(manual.key, "promptpay");
    assert.strictEqual(manual.paymentType, "manual");
    assert.strictEqual(manual.qrMode, "aziel_promptpay_dynamic");
    assert.strictEqual(manual.slipRequired, true);
    assert.strictEqual(manual.receiptUploadEnabled, true);
    assert.strictEqual(manual.confirmationMode, "manual_admin");
    assert.strictEqual(manual.webhookSupported, false);

    assert.strictEqual(normalizePaymentMethodKey("tmw_promptpay"), "tmw_promptpay");
    assert.strictEqual(normalizePaymentMethodKey("tmw-promptpay"), "tmw_promptpay");
    assert.strictEqual(PaymentMethod.schema.path("key").options.unique, true, "canonical TMW key must remain database-unique");
    assert(routeSource.includes("if (error?.code === 11000)"), "duplicate payment-method keys must return the existing conflict response");

    const controlledNames = ["TMW_USERNAME", "TMW_PASSWORD", "TMW_CON_ID", "TMW_API_KEY", "TMW_PROMPTPAY_ID", "TMW_PROMPTPAY_TYPE", "TMW_PROVIDER_ENABLED", "TMW_WEBHOOK_URL", "TMW_API_BASE_URL", "TMW_ALLOW_INSECURE_HTTP"];
    const previous = Object.fromEntries(controlledNames.map(name => [name, process.env[name]]));
    controlledNames.forEach(name => delete process.env[name]);
    try {
        const customer = formatMethod({ ...tmw, enabled: true, shortDescription: "", badgeText: "" });
        const admin = formatAdminMethod({ ...tmw, shortDescription: "", badgeText: "" });
        assert.strictEqual(customer.publicReady, false);
        assert.strictEqual(customer.customerVisible, false, "TMW must remain customer-hidden when provider readiness is false");
        assert.strictEqual(admin.shortDescription, "PromptPay with automatic confirmation");
        assert.strictEqual(admin.badgeText, "Automatic");
        const serialized = JSON.stringify(admin);
        controlledNames.forEach(name => assert(!serialized.includes(name), `Admin projection must not expose ${name}`));
    } finally {
        controlledNames.forEach(name => previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]));
    }

    console.log("TMW Admin payment method verification passed.");
}

main();
