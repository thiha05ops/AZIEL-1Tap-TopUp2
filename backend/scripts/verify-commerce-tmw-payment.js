"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { createTmwPromptPayAdapter, parseTmwSatang } = require("../services/commerce/providers/tmwPromptPayAdapter");
const { configurationFromEnvironment, TmwEasyApiError } = require("../services/tmwEasyApiClient");
const { createTmwPaymentWebhookService, verifyTmwWebhookSignature, parseTmwWebhookPayload, tmwWebhookEventId, parseTmwAmountToSatang } = require("../services/commerce/tmwPaymentWebhookService");
const { createTmwPaymentApplicationService } = require("../services/commerce/tmwPaymentApplicationService");
const { validatePaymentCatalogEligibility } = require("../services/commerce/paymentCatalogEligibilityService");
const { canonicalSerialize } = require("../services/commerce/pricingQuoteRuntime");

function context(overrides = {}) {
    return { intent: { orderId: "AZL-1", amount: 19, currency: "THB", clientIp: "203.0.113.10" }, attempt: { attemptId: "PAY-1", orderId: "AZL-1", amount: 19, currency: "THB", status: "INITIATING", ...overrides } };
}
const qr = Buffer.from("fake png").toString("base64");

async function main() {
    let creates = 0, details = 0, cancels = 0;
    const client = {
        async createPay(input) { creates += 1; assert.deepStrictEqual(input, { amount: 19, ref1: "PAY-1", ip: "203.0.113.10" }); return { status: 1, id_pay: "754349" }; },
        async detailPay({ idPay }) { details += 1; assert.strictEqual(idPay, "754349"); return { status: 1, ref1: "PAY-1", amount_check: "1900", qr_image_base64: qr, time_out: "60" }; },
        async cancelPay() { cancels += 1; return { status: 1 }; }
    };
    const adapter = createTmwPromptPayAdapter({ client, clock: () => new Date("2026-09-10T00:00:00.000Z") });
    assert.strictEqual(adapter.providerId, "TMW");
    assert(adapter.supportsCapability("WEBHOOK"));
    assert(!adapter.supportsCapability("MANUAL_APPROVAL"));
    assert(!adapter.supportsCapability("QUERY_PAYMENT"));
    const created = await adapter.createPayment(context());
    assert.strictEqual(created.providerReference, "754349");
    assert.strictEqual(created.providerTransactionId, "754349");
    assert.strictEqual(created.status, "PENDING");
    assert.strictEqual(created.qr.mode, "provider_generated");
    assert(created.qr.image.startsWith("data:image/png;base64,"));
    assert.strictEqual(created.expiresAt, "2026-09-10T00:01:00.000Z");
    await assert.rejects(() => adapter.createPayment({ ...context(), intent: { ...context().intent, currency: "MMK" } }), /THB only/);
    await assert.rejects(() => adapter.createPayment({ ...context(), intent: { ...context().intent, amount: 19.01 } }), /integer THB/);
    await assert.rejects(() => adapter.createPayment({ ...context(), intent: { ...context().intent, clientIp: "" } }), /IP is required/);
    await adapter.refreshPayment(context({ providerReference: "754349", providerTransactionId: "754349", status: "PENDING" }));
    assert.strictEqual(creates, 1, "refresh must not create another provider payment");
    assert.strictEqual(details, 2);
    await adapter.createPayment(context({ providerReference: "754349", providerTransactionId: "754349", status: "PENDING" }));
    assert.strictEqual(creates, 1, "createPayment must refresh rather than call create_pay when id_pay already exists");
    const delayedDetailAdapter = createTmwPromptPayAdapter({ client: { async createPay() { return { status: 1, id_pay: "754350" }; }, async detailPay() { throw new TmwEasyApiError("TMW_TRANSPORT_ERROR", "temporary detail failure", { retryable: true }); } } });
    const delayedDetail = await delayedDetailAdapter.createPayment(context());
    assert.strictEqual(delayedDetail.providerReference, "754350", "id_pay must survive an ambiguous detail_pay failure");
    assert.strictEqual(delayedDetail.status, "PENDING");
    assert.strictEqual(delayedDetail.safeMetadata.detailPending, true);
    const invalidDetailAdapter = detail => createTmwPromptPayAdapter({ client: { async createPay() { return { status: 1, id_pay: "754351" }; }, async detailPay() { return detail; } } });
    await assert.rejects(
        () => invalidDetailAdapter({ status: 1, ref1: "OTHER", amount_check: "1900", qr_image_base64: qr, time_out: "60" }).createPayment(context()),
        /reference does not match/
    );
    await assert.rejects(
        () => invalidDetailAdapter({ status: 1, ref1: "PAY-1", amount_check: "1901", qr_image_base64: qr, time_out: "60" }).createPayment(context()),
        /amount does not match/
    );
    await assert.rejects(
        () => invalidDetailAdapter({ status: 1, ref1: "PAY-1", amount_check: "not-satang", qr_image_base64: qr, time_out: "invalid" }).createPayment(context()),
        /amount_check is invalid/
    );
    await assert.rejects(() => adapter.cancelPayment(context({ providerReference: "754349", status: "PENDING" })), /only be cancelled after/);
    assert.strictEqual(cancels, 0);
    const expiredClient = { ...client, async detailPay() { return { status: 1, ref1: "PAY-1", amount_check: "1900", qr_image_base64: qr, time_out: "-1" }; } };
    const expiredAdapter = createTmwPromptPayAdapter({ client: expiredClient, clock: () => new Date("2026-09-10T00:00:00.000Z") });
    assert.strictEqual((await expiredAdapter.refreshPayment(context({ providerReference: "754349" }))).status, "EXPIRED");
    assert.strictEqual((await expiredAdapter.cancelPayment(context({ providerReference: "754349" }))).status, "CANCELLED");
    assert.strictEqual(cancels, 1);
    await assert.rejects(() => adapter.handleProviderEvent({ ...context({ providerReference: "754349" }), trusted: false, providerEvent: {} }), /not trusted/);
    const webhookResult = await adapter.handleProviderEvent({ ...context({ providerReference: "754349" }), trusted: true, providerEvent: { provider: "TMW", providerReference: "754349", providerEventId: "evt", ref1: "PAY-1", amountCheck: "1900" } });
    assert.strictEqual(webhookResult.status, "PAID");
    await assert.rejects(() => adapter.handleProviderEvent({ ...context({ providerReference: "754349" }), trusted: true, providerEvent: { provider: "TMW", providerReference: "754349", providerEventId: "evt", ref1: "OTHER", amountCheck: "1900" } }), /ref1/);
    assert.strictEqual(parseTmwSatang("1901"), 1901);
    assert.strictEqual(parseTmwAmountToSatang("19.01"), 1901);
    const data = JSON.stringify({ id_pay: "754349", ref1: "PAY-1", amount_check: "1900", amount: "19.00", date_pay: "2026-09-10 07:00" });
    const key = "test-key";
    const signature = crypto.createHash("md5").update(`${data}:${key}`).digest("hex");
    assert(verifyTmwWebhookSignature(data, signature, key));
    assert(!verifyTmwWebhookSignature(data, "0".repeat(32), key));
    assert.strictEqual(parseTmwWebhookPayload(data).id_pay, "754349");
    assert.throws(() => parseTmwWebhookPayload("{"), /data is invalid/);
    assert.strictEqual(tmwWebhookEventId(JSON.parse(data)), tmwWebhookEventId(JSON.parse(data)));
    let webhookReceipt = null;
    let appliedEvents = 0;
    const webhookEventModel = {
        async findOne(query) { return webhookReceipt?.eventId === query.eventId ? webhookReceipt : null; },
        async create(value) {
            webhookReceipt = { ...value, processingStatus: "RECEIVED", async save() { return this; } };
            return webhookReceipt;
        }
    };
    const webhookService = createTmwPaymentWebhookService({
        configuration: { apiKey: key },
        webhookEventModel,
        paymentAttemptRepository: { async findAttemptByProviderReference() { return { attemptId: "PAY-1", orderId: "AZL-1", provider: "TMW", providerReference: "754349", amount: 19, currency: "THB" }; } },
        orderRepository: { async findOrderById() { return { orderId: "AZL-1", commercial: { totalAmount: 19, currency: "THB" }, payment: { provider: "TMW" } }; } },
        application: { orchestrator: { async handleProviderEvent() { appliedEvents += 1; return { metadata: { duplicate: false }, status: "PAID" }; } } }
    });
    const firstWebhook = await webhookService.processWebhook({ data, signature });
    const duplicateWebhook = await webhookService.processWebhook({ data, signature });
    assert.strictEqual(firstWebhook.accepted, true);
    assert.strictEqual(duplicateWebhook.duplicate, true);
    assert.strictEqual(appliedEvents, 1, "duplicate webhooks must not reapply paid side effects");
    const method = { key: "tmw_promptpay", method: "TMW PromptPay", region: "TH", enabled: true, paymentType: "auto", provider: "tmw", qrMode: "provider_generated", confirmationMode: "provider_webhook" };
    function checkoutQuote({ gameCode = "mlbb-twilight-weekly-pass", packageCode = "MLBB_ONE_TIME_WEEKLY_PASS", packageName = "One-Time Weekly Pass", amount = 53, region = "TH", currency = "THB" } = {}) {
        const issuedAt = new Date();
        const expiresAt = new Date(Date.now() + 60000);
        const packageId = "6a8d5b2806e43181e513ee31";
        const quote = {
            quoteId: `AZQ-${packageCode}-${amount}`,
            status: "ISSUED",
            owner: { userId: "U-1", sessionId: "" },
            packageSnapshot: { packageId, packageCode, packageRef: packageId, packageName, gameId: gameCode, gameCode, gameName: gameCode, categoryId: "game", categoryCode: "game", quantity: 1 },
            commercialSnapshot: { region, currency, originalPrice: amount, discountAmount: 0, quotedUnitPrice: amount, quotedTotalAmount: amount, quantity: 1 },
            lifecycle: { status: "ISSUED", issuedAt, expiresAt }
        };
        const canonicalCommercialData = { quoteId: quote.quoteId, owner: quote.owner, packageIdentity: { packageId, packageCode, packageRef: packageId }, region, currency, originalPrice: amount, discountAmount: 0, quotedUnitPrice: amount, quantity: 1, quotedTotalAmount: amount, pricing: {}, promotion: null, coupon: null, issuedAt, expiresAt, payloadVersion: "1" };
        quote.integrityPayload = { canonicalCommercialData, canonicalSerialized: canonicalSerialize(canonicalCommercialData) };
        return quote;
    }
    function catalogDependencies(quote, overrides = {}) {
        return {
            loadProduct: async () => ({ productCode: quote.packageSnapshot.gameCode, enabled: true, deletedAt: null, publicDiscoveryEnabled: true, commerceState: "PURCHASABLE", lifecycleStatus: "ACTIVE", supportedRegions: ["TH"] }),
            loadPackage: async () => ({ _id: quote.packageSnapshot.packageId, productCode: quote.packageSnapshot.gameCode, packageCode: quote.packageSnapshot.packageCode, enabled: true, deletedAt: null, prices: { TH: { amount: 53, currency: "THB", enabled: true } } }),
            loadPublication: async () => ({ published: true }),
            ...overrides
        };
    }
    async function verifyCheckoutPackage(quote, catalogOverrides = {}) {
        let outboundTmwCreates = 0;
        const app = createTmwPaymentApplicationService({
            configuration: { ready: true }, adapter: {},
            findOwnedQuote: async () => quote,
            findPaymentMethod: async () => method,
            catalogEligibilityDependencies: catalogDependencies(quote, catalogOverrides),
            resolveCheckoutRouteSnapshot: async () => { throw new Error("TMW payment checkout must not resolve supplier readiness."); },
            resolveLegacyCheckoutRouteSnapshot: async () => { throw new Error("TMW payment checkout must not select a manual fulfillment route."); },
            checkoutFromQuote: async (input, dependencies) => {
                const packageResult = await dependencies.validateOperationalPackageState({ quote });
                assert.strictEqual(packageResult.allowed, true);
                assert.strictEqual(packageResult.supplierRouteSnapshot, null);
                const paymentResult = await dependencies.validatePaymentMethod({ quote });
                assert.strictEqual(paymentResult.paymentSnapshot.provider, "TMW");
                return { checkout: { orderId: `AZL-${quote.packageSnapshot.packageCode}`, quoteId: quote.quoteId, amount: quote.commercialSnapshot.quotedTotalAmount, currency: "THB", region: "TH", packageName: quote.packageSnapshot.packageName } };
            },
            reserveCommercePromotion: async () => null,
            orchestrator: {
                async initiatePayment() { outboundTmwCreates += 1; return { attemptId: `PAY-${quote.packageSnapshot.packageCode}`, amount: quote.commercialSnapshot.quotedTotalAmount, currency: "THB", status: "PENDING", qr: { image: "data:image/png;base64,ZmFrZQ==" } }; },
                async refreshPayment() {}, async getPaymentResult() {}
            }
        });
        const result = await app.startCheckout({ reviewQuoteId: quote.quoteId, checkoutKey: `KEY-${quote.packageSnapshot.packageCode}`, userId: "123", zoneId: "456", productCode: quote.packageSnapshot.gameCode }, { user: { id: "U-1" }, clientIp: "203.0.113.10" });
        assert.strictEqual(result.checkout.packageName, quote.packageSnapshot.packageName);
        assert.strictEqual(result.payment.amount, quote.commercialSnapshot.quotedTotalAmount);
        assert.strictEqual(outboundTmwCreates, 1);
    }
    const passQuote = checkoutQuote();
    await verifyCheckoutPackage(passQuote); // Supplier gate/offer state is deliberately absent from payment eligibility.
    const normalQuote = checkoutQuote({ gameCode: "mlbb", packageCode: "MC_MLBB_1860_335_DIAMONDS_02E38F5B", packageName: "1860 + 335 Diamonds", amount: 968 });
    await verifyCheckoutPackage(normalQuote, { loadPackage: async () => ({ _id: normalQuote.packageSnapshot.packageId, productCode: "mlbb", packageCode: normalQuote.packageSnapshot.packageCode, enabled: true, deletedAt: null, prices: { TH: { amount: 968, currency: "THB", enabled: true } } }) });
    for (const [reason, overrides] of [
        ["PACKAGE_DISABLED", { loadPackage: async () => ({ enabled: false, deletedAt: null, prices: { TH: { amount: 53, currency: "THB", enabled: true } } }) }],
        ["PACKAGE_DELETED", { loadPackage: async () => ({ enabled: true, deletedAt: new Date(), prices: { TH: { amount: 53, currency: "THB", enabled: true } } }) }],
        ["PACKAGE_NOT_PUBLISHED", { loadPublication: async () => null }]
    ]) {
        assert.strictEqual((await validatePaymentCatalogEligibility({ quote: passQuote }, catalogDependencies(passQuote, overrides))).reasonCode, reason);
    }
    assert.strictEqual((await validatePaymentCatalogEligibility({ quote: checkoutQuote({ region: "MM", currency: "MMK" }) }, catalogDependencies(checkoutQuote({ region: "MM", currency: "MMK" })))).allowed, false);
    assert.strictEqual((await validatePaymentCatalogEligibility({ quote: { ...passQuote, packageSnapshot: { ...passQuote.packageSnapshot, packageCode: "OTHER" } } }, catalogDependencies(passQuote))).reasonCode, "QUOTE_INTEGRITY_MISMATCH");
    assert.strictEqual((await validatePaymentCatalogEligibility({ quote: { ...passQuote, commercialSnapshot: { ...passQuote.commercialSnapshot, quotedTotalAmount: 54 } } }, catalogDependencies(passQuote))).reasonCode, "QUOTE_INTEGRITY_MISMATCH");
    await assert.rejects(() => verifyCheckoutPackage(checkoutQuote({ amount: 53.18 })), /whole-number THB/);
    const notReady = configurationFromEnvironment({ NODE_ENV: "production", TMW_USERNAME: "u", TMW_PASSWORD: "p", TMW_CON_ID: "c", TMW_API_KEY: "k", TMW_PROMPTPAY_ID: "x", TMW_PROMPTPAY_TYPE: "01", TMW_PROVIDER_ENABLED: "true", TMW_WEBHOOK_URL: "https://shop.example/webhook" });
    assert.strictEqual(notReady.ready, false);
    assert(notReady.missing.includes("production_transport_approval"));
    const missing = configurationFromEnvironment({});
    assert.strictEqual(missing.ready, false);
    assert(!JSON.stringify(missing.missing).includes("test-key"));
    console.log("TMW payment verification passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
