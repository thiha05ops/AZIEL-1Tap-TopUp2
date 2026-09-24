"use strict";

const assert = require("assert");
const { resolveDingerCustomer } = require("../services/commerce/customerManualPaymentCheckoutService");
const { createDingerAdapter } = require("../services/commerce/providers/dingerAdapter");
const { normalizePayPayload } = require("../services/dinger/dingerApiClient");

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

    console.log("Dinger real-order Wave Pay customer payload regression verification passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
