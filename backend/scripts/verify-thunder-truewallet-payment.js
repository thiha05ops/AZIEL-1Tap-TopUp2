"use strict";

const assert = require("assert");
const { createPaymentOrchestrator } = require("../services/commerce/paymentOrchestrator");
const { createThunderTrueWalletAdapter } = require("../services/commerce/providers/thunderTrueWalletAdapter");
const { createThunderTrueWalletVerificationService, ThunderTrueWalletVerificationError, normalizeThaiWalletAccount } = require("../services/commerce/thunderTrueWalletVerificationService");
const { createThunderApiClient, ThunderApiError } = require("../services/thunderApiClient");
const { toThbSatang } = require("../services/commerce/thbMinorUnits");
const { createTrueMoneyQrFromTemplate, parseEmvPayload, validatePromptPayPayloadCrc, qrImageMatchesPayload } = require("../services/promptPayQrService");
const PaymentAttempt = require("../models/PaymentAttempt");

const NOW = new Date("2026-09-15T03:00:00.000Z");
const OWNER = { type: "USER", userId: "U1", sessionId: "" };
const RECEIVER = "0812345678";
const TRUE_MONEY_QR_TEMPLATE = "00020101021129390016A00000067701011103151400006409729845802TH530376463048136";
const clone = value => structuredClone(value);

function fixture(id = "1") {
    return {
        attempt: { attemptId: `A${id}`, orderId: `O${id}`, ownerId: "U1", owner: OWNER, provider: "THUNDER_TRUEWALLET", providerType: "manual", paymentMethod: "truewallet", paymentMethodId: "truewallet", paymentChannel: "TRUE_MONEY_WALLET", confirmationMode: "thunder_truewallet_slip", status: "PENDING", amount: 125.25, currency: "THB", providerReference: `TMW-P${id}`, verifiedTransactionRef: "", eventHistory: [], createdAt: NOW },
        order: { orderId: `O${id}`, owner: OWNER, status: "pending_payment", paymentStatus: "pending", payment: { status: "pending", provider: "THUNDER_TRUEWALLET", paymentMethodId: "truewallet", paymentChannel: "TRUE_MONEY_WALLET", confirmationMode: "thunder_truewallet_slip" }, commercial: { totalAmount: 125.25, currency: "THB", region: "TH" }, createdAt: NOW }
    };
}

function harness(count = 1) {
    const attempts = new Map();
    const orders = new Map();
    for (let i = 1; i <= count; i += 1) { const item = fixture(String(i)); attempts.set(item.attempt.attemptId, item.attempt); orders.set(item.order.orderId, item.order); }
    let fulfillmentCalls = 0;
    const attemptPort = {
        findAttemptByIdForOwner: async ({ attemptId }) => clone(attempts.get(attemptId)),
        findAttemptByProviderReference: async ({ providerReference }) => clone([...attempts.values()].find(item => item.providerReference === providerReference)),
        bindVerifiedTransactionRef: async ({ attemptId, verifiedTransactionRef }) => {
            if ([...attempts.values()].some(item => item.attemptId !== attemptId && item.verifiedTransactionRef === verifiedTransactionRef)) {
                const error = new Error("duplicate transaction"); error.code = "PAYMENT_VERIFIED_TRANSACTION_EXISTS"; throw error;
            }
            const attempt = attempts.get(attemptId);
            if (attempt.status !== "PENDING") { const error = new Error("inactive"); error.code = "PAYMENT_INVALID_TRANSITION"; throw error; }
            attempt.verifiedTransactionRef = verifiedTransactionRef;
            return clone(attempt);
        },
        appendProviderEvent: async ({ attemptId, providerEvent }) => { attempts.get(attemptId).eventHistory.push(clone(providerEvent)); return clone(attempts.get(attemptId)); },
        updateAttemptStatus: async ({ attemptId, fromStatuses, toStatus }) => { const attempt = attempts.get(attemptId); if (!fromStatuses.includes(attempt.status)) throw new Error("status conflict"); attempt.status = toStatus; return clone(attempt); }
    };
    const orderRepository = {
        findOwnedOrderById: async ({ orderId }) => clone(orders.get(orderId)),
        findOrderById: async orderId => clone(orders.get(orderId)),
        updatePaymentStatus: async ({ orderId, fromStatuses, toStatus }) => { const order = orders.get(orderId); if (!fromStatuses.includes(order.paymentStatus)) throw new Error("payment status conflict"); order.paymentStatus = toStatus; order.payment.status = toStatus; return clone(order); },
        updateOrderStatus: async ({ orderId, fromStatuses, toStatus }) => { const order = orders.get(orderId); if (!fromStatuses.includes(order.status)) throw new Error("order status conflict"); order.status = toStatus; return clone(order); }
    };
    const adapter = createThunderTrueWalletAdapter({ configuration: { enabled: true }, clock: () => new Date(NOW) });
    const orchestrator = createPaymentOrchestrator({ orderRepository, paymentAttemptPort: attemptPort, providerResolver: async () => adapter, clock: () => new Date(NOW), transactionRunner: async callback => callback({ mongoSession: { id: "test" } }), paidFulfillmentHandler: async () => { fulfillmentCalls += 1; return { created: true }; } });
    return { attempts, orders, attemptPort, orderRepository, orchestrator, fulfillmentCalls: () => fulfillmentCalls };
}

function providerResponse(overrides = {}) {
    const dataOverrides = overrides.data || {};
    return {
        success: overrides.success === undefined ? true : overrides.success,
        data: {
            isDuplicate: false,
            matchedAccount: { bank: { code: "TRUEMONEYWALLET", shortCode: "TRUEWALLET" }, bankNumber: RECEIVER },
            amountInOrder: 125.25,
            amountInSlip: "125.25",
            isAmountMatched: true,
            rawSlip: { transactionId: "TMW-TX-1", date: NOW.toISOString(), amount: 125.25, sender: { name: "private" }, receiver: { name: "private", phone: "xxx" } },
            ...dataOverrides
        }
    };
}

function service(h, response, error = null) {
    return createThunderTrueWalletVerificationService({ paymentAttemptRepository: h.attemptPort, orderRepository: h.orderRepository, paymentOrchestrator: h.orchestrator, receiverAccount: RECEIVER, clock: () => new Date(NOW), logger: { info() {}, warn() {}, error() {}, log() {} }, thunderClient: { verifyTrueWallet: async () => { if (error) throw error; return clone(response); } } });
}

async function rejectsUnpaid(h, promise, code, attemptId = "A1", expectedFulfillmentCalls = 0) {
    await assert.rejects(promise, error => error instanceof ThunderTrueWalletVerificationError && error.code === code);
    assert.notStrictEqual(h.attempts.get(attemptId).status, "PAID");
    assert.notStrictEqual(h.orders.get(h.attempts.get(attemptId).orderId).paymentStatus, "paid");
    assert.strictEqual(h.fulfillmentCalls(), expectedFulfillmentCalls);
}

async function main() {
    assert.strictEqual(toThbSatang(125.25), 12525);
    assert.strictEqual(toThbSatang("125.2"), 12520);
    for (const invalid of [NaN, Infinity, "1.234", "1e2", -1, {}, ""]) assert.throws(() => toThbSatang(invalid));
    assert.strictEqual(normalizeThaiWalletAccount("+66 81-234-5678"), RECEIVER);
    assert.strictEqual(normalizeThaiWalletAccount("66812345678"), RECEIVER);
    assert.strictEqual(normalizeThaiWalletAccount("081234567"), "");
    const verifiedReferenceIndex = PaymentAttempt.schema.indexes().find(([keys]) => keys.verifiedTransactionRef === 1);
    assert(verifiedReferenceIndex, "verifiedTransactionRef index must be declared");
    assert.strictEqual(verifiedReferenceIndex[1].unique, true);
    assert.deepStrictEqual(verifiedReferenceIndex[1].partialFilterExpression, { verifiedTransactionRef: { $exists: true, $gt: "" } });

    for (const [amount, expected] of [[10, "10.00"], [10.5, "10.50"], [10.05, "10.05"]]) {
        let generated;
        const qrAdapter = createThunderTrueWalletAdapter({
            configuration: { enabled: true, receivingAccount: RECEIVER, customerAccountName: "AZIEL", customerAccountNumber: RECEIVER, trueMoneyQrTemplate: TRUE_MONEY_QR_TEMPLATE },
            clock: () => new Date(NOW),
            qrService: async input => { generated = await createTrueMoneyQrFromTemplate(input); return generated; }
        });
        const created = await qrAdapter.createPayment({
            intent: { orderId: `O-${amount}`, amount, currency: "THB" },
            attempt: { attemptId: `A-${amount}`, amount, currency: "THB" },
            input: { amount: 999999 }
        });
        assert.strictEqual(created.provider, "THUNDER_TRUEWALLET");
        assert.strictEqual(created.qr.mode, "truemoney_template_dynamic");
        assert.strictEqual(created.qr.encodedAmount, expected);
        assert.strictEqual(created.providerPayableAmountSatang, toThbSatang(amount));
        assert.strictEqual(created.paymentInstructions.accountNumber, RECEIVER);
        assert.strictEqual(created.qr.payload, undefined, "TrueMoney customer QR must not expose raw EMV payload");
        const templateFields = parseEmvPayload(TRUE_MONEY_QR_TEMPLATE);
        const generatedFields = parseEmvPayload(generated.qrPayload);
        const template29 = templateFields.find(field => field.id === "29")?.value;
        const generated29 = generatedFields.find(field => field.id === "29")?.value;
        const generated01 = generatedFields.find(field => field.id === "01")?.value;
        const generated54 = generatedFields.find(field => field.id === "54")?.value;

        assert.strictEqual(created.qr.type, "TRUE_MONEY_WALLET_QR");
        assert.strictEqual(created.paymentInstructions.qrMode, "truemoney_template_dynamic");
        assert.strictEqual(created.qr.qrPayload, undefined, "TrueMoney customer QR must not expose internal QR payload");
        assert.strictEqual(generated01, "12");
        assert.strictEqual(generated54, expected);
        assert.strictEqual(generated29, template29, "TrueMoney tag 29 must remain unchanged");
        assert.strictEqual(validatePromptPayPayloadCrc(TRUE_MONEY_QR_TEMPLATE), true);
        assert.strictEqual(validatePromptPayPayloadCrc(generated.qrPayload), true);
        assert.strictEqual(qrImageMatchesPayload(generated.qrImage, generated.qrPayload), true);
    }
    const authorityAdapter = createThunderTrueWalletAdapter({ configuration: { enabled: true, receivingAccount: RECEIVER, customerAccountNumber: RECEIVER, trueMoneyQrTemplate: TRUE_MONEY_QR_TEMPLATE } });
    await assert.rejects(authorityAdapter.createPayment({ intent: { orderId: "O", amount: 11, currency: "THB" }, attempt: { attemptId: "A", amount: 10, currency: "THB" }, input: { amount: 11 } }), error => error.stage === "amount");
    await assert.rejects(authorityAdapter.createPayment({ intent: { orderId: "O", amount: 1.234, currency: "THB" }, attempt: { attemptId: "A", amount: 1.234, currency: "THB" } }), error => error.stage === "amount");
    await assert.rejects(createThunderTrueWalletAdapter({ configuration: { enabled: true, receivingAccount: RECEIVER, customerAccountNumber: "0899999999", trueMoneyQrTemplate: TRUE_MONEY_QR_TEMPLATE } }).createPayment({ intent: { orderId: "O", amount: 10, currency: "THB" }, attempt: { attemptId: "A", amount: 10, currency: "THB" } }), error => error.stage === "configuration");

    let sent;
    let client = createThunderApiClient({ apiKey: "SECRET", fetch: async (url, options) => { sent = { url, options, body: JSON.parse(options.body) }; return { ok: true, status: 200, json: async () => providerResponse() }; }, logger: { info() {}, warn() {}, error() {}, log() {} } });
    await client.verifyTrueWallet({ base64: "SLIP", matchAmount: 125.25, remark: "AZIEL" });
    assert.strictEqual(sent.url, "https://api.thunder.in.th/v2/verify/truewallet");
    assert.strictEqual(sent.options.headers.Authorization, "Bearer SECRET");
    assert.deepStrictEqual(Object.keys(sent.body).filter(key => ["image", "base64", "url"].includes(key)), ["base64"]);
    assert.strictEqual(sent.body.matchAccount, true); assert.strictEqual(sent.body.checkDuplicate, true); assert.strictEqual(sent.body.matchAmount, 125.25);
    await assert.rejects(client.verifyTrueWallet({ base64: "A", url: "B", matchAmount: 1 }), error => error instanceof ThunderApiError && error.code === "THUNDER_SLIP_REJECTED");
    for (const [status, providerCode, expected] of [[400, "INVALID_IMAGE_TYPE", "THUNDER_SLIP_REJECTED"], [401, "INVALID_API_KEY", "THUNDER_AUTHENTICATION_FAILED"], [403, "IP_NOT_ALLOWED", "THUNDER_IP_RESTRICTED"], [429, "QUOTA_EXCEEDED", "THUNDER_QUOTA_EXCEEDED"], [500, "API_SERVER_ERROR", "THUNDER_PROVIDER_UNAVAILABLE"]]) {
        client = createThunderApiClient({ apiKey: "SECRET", fetch: async () => ({ ok: false, status, json: async () => ({ error: { code: providerCode } }) }), logger: { info() {}, warn() {}, error() {}, log() {} } });
        await assert.rejects(client.verifyTrueWallet({ base64: "A", matchAmount: 1 }), error => error.code === expected);
    }
    client = createThunderApiClient({ apiKey: "SECRET", fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }), logger: { info() {}, warn() {}, error() {}, log() {} } });
    await assert.rejects(client.verifyTrueWallet({ base64: "A", matchAmount: 1 }), error => error.code === "THUNDER_INVALID_RESPONSE");
    client = createThunderApiClient({ apiKey: "SECRET", fetch: async () => { throw new Error("offline"); }, logger: { info() {}, warn() {}, error() {}, log() {} } });
    await assert.rejects(client.verifyTrueWallet({ base64: "A", matchAmount: 1 }), error => error.code === "THUNDER_UNAVAILABLE");
    client = createThunderApiClient({ apiKey: "SECRET", fetch: async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; }, logger: { info() {}, warn() {}, error() {}, log() {} } });
    await assert.rejects(client.verifyTrueWallet({ base64: "A", matchAmount: 1 }), error => error.code === "THUNDER_TIMEOUT");

    let h = harness(); let result = await service(h, providerResponse()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("image") });
    assert.strictEqual(result.paymentStatus, "paid"); assert.strictEqual(h.attempts.get("A1").verifiedTransactionRef, "THUNDER_TRUEWALLET:TMW-TX-1"); assert.strictEqual(h.fulfillmentCalls(), 1);

    const cases = [
        [providerResponse({ data: { matchedAccount: null } }), "TRUEWALLET_RECEIVER_MISMATCH"],
        [providerResponse({ data: { matchedAccount: { bank: { code: "TRUEWALLET" }, bankNumber: "0899999999" } } }), "TRUEWALLET_RECEIVER_MISMATCH"],
        [providerResponse({ data: { matchedAccount: { bank: { code: "SCB" }, bankNumber: RECEIVER } } }), "TRUEWALLET_PROVIDER_MISMATCH"],
        [providerResponse({ data: { isAmountMatched: false } }), "TRUEWALLET_AMOUNT_MISMATCH"],
        [providerResponse({ data: { amountInSlip: 126 } }), "TRUEWALLET_AMOUNT_MISMATCH"],
        [providerResponse({ data: { rawSlip: { transactionId: "TMW-TX-1", date: NOW.toISOString(), amount: 126 } } }), "TRUEWALLET_AMOUNT_MISMATCH"],
        [providerResponse({ data: { amountInOrder: "125.251" } }), "TRUEWALLET_AMOUNT_INVALID"],
        [providerResponse({ data: { isDuplicate: true } }), "TRUEWALLET_PROVIDER_DUPLICATE"],
        [providerResponse({ data: { rawSlip: { transactionId: "", date: NOW.toISOString(), amount: 125.25 } } }), "TRUEWALLET_TRANSACTION_ID_MISSING"],
        [{ success: "true", data: {} }, "TRUEWALLET_RESPONSE_INVALID"]
    ];
    for (const [response, code] of cases) { h = harness(); await rejectsUnpaid(h, service(h, response).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("image") }), code); }

    for (const [errorCode, retryable] of [["THUNDER_TIMEOUT", true], ["THUNDER_QUOTA_EXCEEDED", true], ["THUNDER_PROVIDER_UNAVAILABLE", true]]) {
        h = harness(); const providerError = Object.assign(new Error("unavailable"), { code: errorCode, retryable }); await rejectsUnpaid(h, service(h, null, providerError).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("image") }), errorCode);
    }
    for (const mutation of [attempt => { attempt.status = "CANCELLED"; }, attempt => { attempt.status = "EXPIRED"; }, attempt => { attempt.currency = "USD"; }]) {
        h = harness(); mutation(h.attempts.get("A1")); const expected = h.attempts.get("A1").currency === "USD" ? "TRUEWALLET_CURRENCY_UNSUPPORTED" : "TRUEWALLET_PAYMENT_INACTIVE"; await rejectsUnpaid(h, service(h, providerResponse()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("image") }), expected);
    }
    h = harness(); h.orders.get("O1").status = "cancelled"; await rejectsUnpaid(h, service(h, providerResponse()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("image") }), "TRUEWALLET_PAYMENT_INACTIVE");
    h = harness(); h.attempts.get("A1").expiresAt = new Date(NOW.getTime() - 1).toISOString(); await rejectsUnpaid(h, service(h, providerResponse()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("image") }), "TRUEWALLET_PAYMENT_EXPIRED");
    h = harness(); await rejectsUnpaid(h, service(h, providerResponse()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.alloc((4 * 1024 * 1024) + 1) }), "TRUEWALLET_INVALID_IMAGE");

    const adapter = createThunderTrueWalletAdapter({ configuration: { enabled: true }, clock: () => new Date(NOW) });
    await assert.rejects(adapter.handleProviderEvent({ trustedOperational: true, attempt: fixture().attempt, intent: { amount: 125.25, currency: "THB" }, providerEvent: { provider: "THUNDER_TRUEWALLET", providerReference: "TMW-P1", eventType: "MANUAL_PAYMENT_APPROVED" } }));

    h = harness(2);
    const sameTransaction = providerResponse();
    await service(h, sameTransaction).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("one") });
    await rejectsUnpaid(h, service(h, sameTransaction).verify({ orderId: "O2", attemptId: "A2", owner: OWNER, fileBuffer: Buffer.from("two") }), "TRUEWALLET_TRANSACTION_REUSED", "A2", 1);
    assert.strictEqual(h.fulfillmentCalls(), 1);

    h = harness(2);
    const concurrent = await Promise.allSettled([
        service(h, sameTransaction).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("one") }),
        service(h, sameTransaction).verify({ orderId: "O2", attemptId: "A2", owner: OWNER, fileBuffer: Buffer.from("two") })
    ]);
    assert.strictEqual(concurrent.filter(item => item.status === "fulfilled").length, 1);
    assert.strictEqual([...h.attempts.values()].filter(item => item.status === "PAID").length, 1);
    assert.strictEqual(h.fulfillmentCalls(), 1);

    console.log("Thunder TrueMoney Wallet Phase 1 verification passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
