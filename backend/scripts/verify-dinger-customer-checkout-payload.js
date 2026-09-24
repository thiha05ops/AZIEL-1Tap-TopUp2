"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { resolveDingerCustomer } = require("../services/commerce/customerManualPaymentCheckoutService");
const { createDingerAdapter } = require("../services/commerce/providers/dingerAdapter");
const { normalizePayPayload } = require("../services/dinger/dingerApiClient");
const { normalizeDingerMyanmarPhone } = require("../services/dinger/dingerCustomerPhone");

(async () => {
    let lookupUserId = "";
    const customer = await resolveDingerCustomer({
        owner: { userId: "customer-1" },
        user: { id: "customer-1", username: "checkout-user" }
    }, {
        findCustomerById: async userId => {
            lookupUserId = userId;
            return { phone: "09999999999", username: "checkout-user" };
        }
    });
    assert.strictEqual(lookupUserId, "customer-1");
    assert.deepStrictEqual(customer, { phone: "09999999999", name: "checkout-user" });

    assert.strictEqual(normalizeDingerMyanmarPhone("+95 9 999 999 999"), "09999999999");
    assert.strictEqual(normalizeDingerMyanmarPhone("95-9-999-999-999"), "09999999999");
    assert.throws(() => normalizeDingerMyanmarPhone("081234567"), error => error.code === "DINGER_CUSTOMER_PHONE_INVALID");

    const updates = [];
    const firstTime = await resolveDingerCustomer({
        owner: { userId: "customer-first" }, user: { id: "customer-first", username: "first" },
        submittedPhone: "09 777 777 777", allowPhoneUpdate: true
    }, {
        findCustomerById: async () => ({ phone: "", username: "first" }),
        updateCustomerPhone: async (userId, phone, invalidation) => {
            updates.push({ userId, phone, invalidation });
            return { phone, username: "first" };
        }
    });
    assert.strictEqual(firstTime.phone, "09777777777");
    assert.deepStrictEqual(updates[0], { userId: "customer-first", phone: "09777777777", invalidation: { phoneVerifiedAt: null, phoneVerificationMethod: "" } });

    let reuseUpdates = 0;
    const reused = await resolveDingerCustomer({
        owner: { userId: "customer-reuse" }, user: { id: "customer-reuse", username: "reuse" }, allowPhoneUpdate: true
    }, {
        findCustomerById: async () => ({ phone: "09666666666", username: "reuse" }),
        updateCustomerPhone: async () => { reuseUpdates += 1; }
    });
    assert.strictEqual(reused.phone, "09666666666");
    assert.strictEqual(reuseUpdates, 0, "saved phone reuse must not rewrite or invalidate verification state");

    let isolatedUserId = "";
    const edited = await resolveDingerCustomer({
        owner: { userId: "authenticated-user" }, user: { id: "authenticated-user", username: "owner" },
        submittedPhone: "09555555555", allowPhoneUpdate: true
    }, {
        findCustomerById: async userId => ({ phone: userId === "authenticated-user" ? "09444444444" : "", username: "owner" }),
        updateCustomerPhone: async (userId, phone) => { isolatedUserId = userId; return { phone, username: "owner" }; }
    });
    assert.strictEqual(edited.phone, "09555555555");
    assert.strictEqual(isolatedUserId, "authenticated-user", "phone update must use authenticated owner ID only");

    let submitted = null;
    const adapter = createDingerAdapter({
        configuration: { enabled: true, environment: "STAGING" },
        apiClient: {
            createPayment: async payload => {
                submitted = normalizePayPayload(payload);
                return {
                    code: "000",
                    message: "mock",
                    time: "20260924 120000",
                    response: { merchOrderId: payload.orderId, transactionNum: "MOCK-TRX", formToken: "MOCK-FORM" }
                };
            }
        }
    });
    await adapter.createPayment({
        intent: {
            amount: 500,
            currency: "MMK",
            paymentMethodId: "dinger_wavepay_pin",
            customer,
            items: [{ name: "Real order package", amount: 500, quantity: 1 }]
        },
        attempt: { attemptId: "paymentAttempt-1758686400000-1234abcd" }
    });
    assert.strictEqual(submitted.customerPhone, "09999999999");
    assert.strictEqual(submitted.providerName, "Wave Pay");
    assert.strictEqual(submitted.methodName, "PIN");
    assert.strictEqual(submitted.totalAmount, 500);
    assert.strictEqual(JSON.parse(submitted.items)[0].amount, 500);

    await assert.rejects(resolveDingerCustomer({ owner: { userId: "customer-2" }, user: { id: "customer-2" } }, {
        findCustomerById: async () => ({ phone: "" })
    }), error => error.code === "INVALID_INPUT" && error.statusCode === 422);

    const root = path.resolve(__dirname, "../..");
    const ui = fs.readFileSync(path.join(root, "frontend/js/payment/dinger-checkout-phone.js"), "utf8");
    const checkout = fs.readFileSync(path.join(root, "frontend/js/product-checkout.js"), "utf8");
    const methodPage = fs.readFileSync(path.join(root, "frontend/js/payment-method-page.js"), "utf8");
    const profileRoute = fs.readFileSync(path.join(root, "backend/routes/profile.js"), "utf8");
    assert(ui.includes('type="tel"') && ui.includes("Your Wave Pay PIN is entered only on Dinger."));
    assert(ui.includes('/api/profile/me') && ui.includes('dinger_wavepay_pin'));
    assert(checkout.includes("customerPhone") && methodPage.includes("customerPhone"));
    assert(profileRoute.includes("user.phoneVerifiedAt = null") && profileRoute.includes('user.phoneVerificationMethod = ""'));

    console.log("Dinger real-order Wave Pay customer payload regression verification passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
