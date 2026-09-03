#!/usr/bin/env node
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createFazerCardsAdapter, normalizeProviderOrder, normalizeStatus } = require("../services/suppliers/fazercardsAdapter");
const { buildFazerCardsFields, buildFazerCardsOrderFields, buildFazerCardsValidationFields } = require("../services/suppliers/fazercardsInputFormatters");
const { validateFazerCardsMapping, supportsFazerCardsMapping, createFazerCardsFulfillmentProcessor } = require("../services/suppliers/fazercardsFulfillmentProcessor");

async function main() {
    const requests = [];
    const env = { FAZERCARDS_API_KEY: "test-only", FAZERCARDS_AUTO_FULFILLMENT_ENABLED: "false", FAZERCARDS_WEBHOOK_SECRET: "webhook-test" };
    const adapter = createFazerCardsAdapter({ env, fetchImpl: async (url, options) => { requests.push({ url, method: options.method, headers: options.headers }); return { ok: true, json: async () => ({ balance: "10.0000", currency: "USD" }) }; } });
    assert.deepStrictEqual(buildFazerCardsFields("pubg", { playerId: "123456789" }), { player_id: "123456789" });
    assert.deepStrictEqual(buildFazerCardsOrderFields("mlbb", { userId: " 123456789 ", zoneId: " 1234 " }), { player_id: "123456789", server_id: "1234" });
    assert.deepStrictEqual(buildFazerCardsValidationFields("mlbb", { userId: " 123456789 ", zoneId: " 1234 " }), { player_id: "123456789", zone_id: "1234" });
    assert.throws(() => buildFazerCardsValidationFields("mlbb", { userId: "123456789", server_id: "1234" }), error => error.code === "FAZERCARDS_MLBB_INPUT_INVALID");
    assert.deepStrictEqual(buildFazerCardsOrderFields("freefire", { userId: " FF-PLAYER-01 " }), { player_id: "FF-PLAYER-01" });
    assert.deepStrictEqual(buildFazerCardsValidationFields("freefire", { userId: " FF-PLAYER-01 " }), { player_id: "FF-PLAYER-01" });
    assert.deepStrictEqual(buildFazerCardsOrderFields("hok", { userId: " 123456789 ", zoneId: "ignored", region: "ignored" }), { player_id: "123456789" });
    assert.throws(() => buildFazerCardsOrderFields("hok", { userId: "   " }), error => error.code === "FAZERCARDS_HOK_PLAYER_ID_INVALID");
    assert.throws(() => buildFazerCardsOrderFields("hok", {}), error => error.code === "FAZERCARDS_HOK_PLAYER_ID_INVALID");
    assert.deepStrictEqual(buildFazerCardsOrderFields("valorant", { riotId: "  PlayerName#TH1  " }), { riot_id: "PlayerName#TH1" });
    assert.deepStrictEqual(buildFazerCardsOrderFields("valorant", { accountFields: [{ key: "riotId", label: "Riot ID", value: "  PlayerName#TH1  " }] }), { riot_id: "PlayerName#TH1" });
    assert.throws(() => buildFazerCardsOrderFields("valorant", { riotId: "   " }), error => error.code === "FAZERCARDS_VALORANT_RIOT_ID_INVALID");
    await adapter.getBalance();
    assert.strictEqual(requests.length, 1); assert.strictEqual(requests[0].method, "GET");
    const dryRun = adapter.dryRunTopup({ categoryId: "pubg_mobile_auto", offerId: "60_uc", fields: { player_id: "123456789" }, idempotencyKey: "stable-intent-key" });
    assert.deepStrictEqual(dryRun.payload, { category_id: "pubg_mobile_auto", offer_id: "60_uc", fields: { player_id: "12***89" } });
    assert.deepStrictEqual(adapter.buildValidationPayload({ validationCategoryId: "pubg_mobile", fields: { player_id: "123456789" } }), { category_id: "pubg_mobile", fields: { player_id: "123456789" } });
    assert.deepStrictEqual(adapter.buildTopupPayload({ categoryId: "mobile_legends_global", offerId: "42_diamonds", fields: buildFazerCardsOrderFields("mlbb", { userId: "123456789", zoneId: "1234" }) }), { category_id: "mobile_legends_global", offer_id: "42_diamonds", fields: { player_id: "123456789", server_id: "1234" } });
    assert.deepStrictEqual(adapter.buildValidationPayload({ validationCategoryId: "mobile_legends", fields: buildFazerCardsValidationFields("mlbb", { userId: "123456789", zoneId: "1234" }) }), { category_id: "mobile_legends", fields: { player_id: "123456789", zone_id: "1234" } });
    assert.deepStrictEqual(adapter.buildTopupPayload({ categoryId: "free_fire_th", offerId: "33_diamonds", fields: buildFazerCardsOrderFields("freefire", { userId: "FF-PLAYER-01", zoneId: "ignored" }) }), { category_id: "free_fire_th", offer_id: "33_diamonds", fields: { player_id: "FF-PLAYER-01" } });
    assert.deepStrictEqual(adapter.buildValidationPayload({ validationCategoryId: "free_fire", fields: buildFazerCardsValidationFields("freefire", { userId: "FF-PLAYER-01", zoneId: "ignored" }) }), { category_id: "free_fire", fields: { player_id: "FF-PLAYER-01" } });
    assert.deepStrictEqual(adapter.buildTopupPayload({ categoryId: "honor_of_kings", offerId: "16_tokens", fields: buildFazerCardsOrderFields("hok", { userId: " 123456789 ", zoneId: "ignored", region: "ignored" }) }), { category_id: "honor_of_kings", offer_id: "16_tokens", fields: { player_id: "123456789" } });
    assert.deepStrictEqual(adapter.buildTopupPayload({ categoryId: "valorant_th", offerId: "475_vp", fields: buildFazerCardsOrderFields("valorant", { riotId: "  PlayerName#TH1  " }) }), { category_id: "valorant_th", offer_id: "475_vp", fields: { riot_id: "PlayerName#TH1" } });
    assert.throws(() => adapter.buildTopupPayload({ categoryId: "mobile_legends_global", offerId: "42_diamonds", fields: { player_id: "123456789", zone_id: "1234" } }), error => error.code === "FAZERCARDS_ORDER_CONTRACT_INVALID");
    assert.throws(() => adapter.buildValidationPayload({ validationCategoryId: "mobile_legends", fields: { player_id: "123456789", server_id: "1234" } }), error => error.code === "FAZERCARDS_VALIDATION_CONTRACT_INVALID");
    assert.deepStrictEqual(adapter.normalizeValidation({ valid: true, player_name: "Player", player_id: "123456789", region: "Global" }), { valid: true, providerStatus: "VALID", playerName: "Player", playerId: "123456789", region: "Global", safeMessage: "FazerCards confirmed the player ID.", rawMetadata: { valid: true, player_name: "Player", player_id: "123456789", region: "Global" } });
    assert.strictEqual(adapter.normalizeValidation({ valid: false, message: "invalid" }, { player_id: "123456789" }).providerStatus, "INVALID");
    const validationRequests = [];
    const validationAdapter = createFazerCardsAdapter({ env, fetchImpl: async (url, options) => { validationRequests.push({ url, method: options.method, body: JSON.parse(options.body) }); return { ok: false, status: 422, json: async () => ({ valid: false, message: "Player not found" }) }; } });
    const invalidValidation = await validationAdapter.validatePlayerId({ validationCategoryId: "pubg_mobile", fields: { player_id: "123456789" } });
    assert.deepStrictEqual(validationRequests[0], { url: "https://api.fzr.cards/api/v2/topups/validate-id", method: "POST", body: { category_id: "pubg_mobile", fields: { player_id: "123456789" } } });
    assert.strictEqual(invalidValidation.providerStatus, "INVALID");
    await assert.rejects(() => adapter.submitTopup({ categoryId: "pubg_mobile_auto", offerId: "60_uc", fields: { player_id: "123456789" }, idempotencyKey: "FUL-1", productCode: "pubg" }), error => error.code === "SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    assert.strictEqual(requests.length, 1, "gate-off submission must make zero transport calls");
    const mapping = { enabled: true, supplierCode: "FAZERCARDS", productCode: "pubg", region: "TH", executionMode: "API", supplierProductCode: "pubg_mobile_auto", supplierPackageCode: "60_uc", fulfillmentEligibility: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["TH"], evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY", evidenceSource: "isolated verifier", verifiedAt: new Date(), version: 1 }, mappingMetadata: { readiness: { supplierMapped: true, inputReady: true, pricingReady: true, fulfillmentReady: true } } };
    assert.strictEqual(validateFazerCardsMapping(mapping), mapping);
    [
        ["mlbb", "mobile_legends_global"], ["freefire", "free_fire_th"], ["hok", "honor_of_kings"], ["valorant", "valorant_th"]
    ].forEach(([productCode, supplierProductCode]) => {
        const exact = { ...mapping, productCode, supplierProductCode, supplierPackageCode: "provider-offer" };
        assert(supportsFazerCardsMapping(exact));
        assert.strictEqual(validateFazerCardsMapping(exact), exact);
    });
    assert(!supportsFazerCardsMapping({ productCode: "freefire", supplierProductCode: "free_fire_global" }));
    for (const productCode of ["mlbb", "freefire", "hok", "valorant"]) {
        assert.strictEqual(adapter.isAutoFulfillmentEnabled(productCode), false);
        await assert.rejects(() => adapter.submitTopup({ categoryId: "blocked", offerId: "blocked", fields: { player_id: "123456789" }, idempotencyKey: `BLOCKED-${productCode}`, productCode }), error => error.code === "SUPPLIER_AUTO_FULFILLMENT_DISABLED");
    }
    assert.strictEqual(requests.length, 1, "all product gates OFF must make zero order transport calls");
    assert.strictEqual(normalizeStatus({ status: "processing" }, "F-1").status, "PENDING");
    assert.strictEqual(normalizeStatus({ status: "completed" }, "F-1").status, "SUCCEEDED");
    assert.strictEqual(normalizeStatus({ status: "failed" }, "F-1").status, "FAILED");
    assert.strictEqual(normalizeStatus({ order: { id: "ord-9002", kind: "topup", status: "processing" } }).supplierReference, "ord-9002");
    assert.strictEqual(normalizeStatus({ order: { id: "ord-9002", kind: "topup", status: "processing" } }).providerStatus, "PROCESSING");
    assert.strictEqual(normalizeStatus({ order: { id: "ord-9002", status: "completed" } }).status, "SUCCEEDED");
    assert.strictEqual(normalizeStatus({ order: { id: "ord-9002", status: "failed" } }).status, "FAILED");
    assert.strictEqual(normalizeStatus({ order: { id: "ord-9002", status: "refund" } }).providerStatus, "REFUNDED");
    assert.strictEqual(normalizeStatus({ status: "refunded" }, "F-1").providerStatus, "REFUNDED");
    assert.strictEqual(normalizeStatus({ status: "mystery" }, "F-1").providerStatus, "UNKNOWN_PROVIDER_STATUS");
    [
        [{ id: "legacy-id", status: "created" }, "legacy-id"],
        [{ order_id: "legacy-order-id", order_status: "processing" }, "legacy-order-id"],
        [{ data: { id: "legacy-data-id", status: "completed" } }, "legacy-data-id"],
        [{ data: { order_id: "legacy-data-order-id", status: "failed" } }, "legacy-data-order-id"]
    ].forEach(([payload, expected]) => assert.strictEqual(normalizeProviderOrder(payload).supplierReference, expected));
    const webhookSource = fs.readFileSync(path.resolve(__dirname, "../routes/fazercardsWebhook.js"), "utf8");
    assert(webhookSource.includes("normalizeProviderOrder(orderPayload, event.order_id)"), "Webhook identity must use the shared FazerCards normalizer.");
    assert(webhookSource.includes("normalizeStatus(orderPayload, providerOrderId)"), "Webhook status must use the shared FazerCards normalizer.");
    const raw = Buffer.from('{"event_id":"evt-1"}'); const signature = `sha256=${crypto.createHmac("sha256", env.FAZERCARDS_WEBHOOK_SECRET).update(raw).digest("hex")}`;
    assert(adapter.verifyWebhookSignature(raw, signature)); assert(!adapter.verifyWebhookSignature(Buffer.from("changed"), signature));
    const attempt = { _id: "a1", fulfillmentId: "FUL-1", orderId: "o1", supplierMappingId: "m1", supplierCodeSnapshot: "FAZERCARDS", status: "IN_PROGRESS", idempotencyKey: "stable-intent-key", supplierReference: "", supplierRequest: {}, async save() { return this; } };
    const order = { _id: "o1", orderId: "AZL-1", status: "processing", fulfilment: { status: "processing", input: { userId: "123456789" } } };
    const submitted = [];
    const processor = createFazerCardsFulfillmentProcessor({
        Attempt: { async findById() { return attempt; }, async findOne(query) { return query.status === "IN_PROGRESS" && attempt.status === "IN_PROGRESS" ? attempt : null; } },
        Order: { async findById() { return order; } }, Mapping: { async findById() { return mapping; } },
        adapter: { async submitTopup(payload) { submitted.push(payload); return normalizeStatus({ status: "processing" }, "FC-1"); }, async checkStatus() { return normalizeStatus({ status: "completed" }, "FC-1"); }, isAutoFulfillmentEnabled() { return false; } },
        transitionOrder: async () => {}, schedule: () => {}
    });
    await processor.submit("a1");
    assert.strictEqual(attempt.supplierReference, "FC-1", "provider order ID persists immediately");
    assert.strictEqual(submitted[0].idempotencyKey, "stable-intent-key", "canonical idempotency key is forwarded unchanged");
    await processor.submit("a1"); assert.strictEqual(submitted.length, 1, "same accepted FulfillmentAttempt cannot intentionally submit twice");
    await processor.poll("a1", 0); assert.strictEqual(attempt.status, "SUCCEEDED", "polling converges to success");
    assert.strictEqual(await processor.reconcileProviderStatus("FC-1", normalizeStatus({ status: "completed" }, "FC-1")), null, "terminal webhook replay is idempotently ignored");

    function freshAttempt(id) {
        return { _id: id, fulfillmentId: `FUL-${id}`, orderId: "o1", supplierMappingId: "m1", supplierCodeSnapshot: "FAZERCARDS", status: "IN_PROGRESS", idempotencyKey: `intent-${id}`, supplierReference: "", supplierRequest: {}, supplierResult: {}, async save() { return this; } };
    }
    const documentedResponse = { ok: true, order: { id: "ord-9002", kind: "topup", status: "processing" } };
    const acceptedAttempt = freshAttempt("documented-pending");
    const scheduled = [];
    const acceptedAdapter = createFazerCardsAdapter({
        env: { FAZERCARDS_API_KEY: "fixture", FAZERCARDS_AUTO_FULFILLMENT_ENABLED: "true" },
        fetchImpl: async () => ({ ok: true, status: 200, async json() { return documentedResponse; } })
    });
    const acceptedProcessor = createFazerCardsFulfillmentProcessor({
        Attempt: { async findById() { return acceptedAttempt; } }, Order: { async findById() { return order; } }, Mapping: { async findById() { return mapping; } },
        adapter: acceptedAdapter, transitionOrder: async () => {}, schedule: (fn, delay) => {
            assert.strictEqual(acceptedAttempt.supplierReference, "ord-9002", "Reference must be durable before polling is scheduled.");
            assert.strictEqual(acceptedAttempt.supplierRequest.submissionState, "ACCEPTED", "Accepted state must be durable before polling is scheduled.");
            scheduled.push({ fn, delay });
        }
    });
    await acceptedProcessor.submit(acceptedAttempt._id);
    assert.strictEqual(acceptedAttempt.supplierReference, "ord-9002", "Documented order.id persists as supplierReference.");
    assert.strictEqual(acceptedAttempt.supplierResult.providerStatus, "PROCESSING");
    assert.strictEqual(acceptedAttempt.supplierRequest.submissionState, "ACCEPTED");
    assert.strictEqual(scheduled.length, 1, "Accepted non-terminal submission becomes eligible for existing polling.");

    const statusAdapter = createFazerCardsAdapter({
        env: { FAZERCARDS_API_KEY: "fixture" },
        fetchImpl: async () => ({ ok: true, status: 200, async json() { return { ok: true, order: { id: "ord-9002", kind: "topup", status: "completed" } }; } })
    });
    const polledStatus = await statusAdapter.checkStatus({ orderId: "ord-9002" });
    assert.strictEqual(polledStatus.supplierReference, "ord-9002", "Status lookup uses the same documented identity normalization.");
    assert.strictEqual(polledStatus.status, "SUCCEEDED");

    const completedAttempt = freshAttempt("documented-completed");
    const transitions = [];
    const completedAdapter = createFazerCardsAdapter({
        env: { FAZERCARDS_API_KEY: "fixture", FAZERCARDS_AUTO_FULFILLMENT_ENABLED: "true" },
        fetchImpl: async () => ({ ok: true, status: 200, async json() { return { ok: true, order: { id: "ord-terminal", kind: "topup", status: "completed" } }; } })
    });
    const completedProcessor = createFazerCardsFulfillmentProcessor({
        Attempt: { async findById() { return completedAttempt; } }, Order: { async findById() { return order; } }, Mapping: { async findById() { return mapping; } },
        adapter: completedAdapter, transitionOrder: async (_order, target) => transitions.push(target), schedule: () => { throw new Error("terminal result must not poll"); }
    });
    await completedProcessor.submit(completedAttempt._id);
    assert.strictEqual(completedAttempt.supplierReference, "ord-terminal");
    assert.strictEqual(completedAttempt.status, "SUCCEEDED");
    assert(completedAttempt.completedAt instanceof Date);
    assert.deepStrictEqual(transitions, ["completed"]);

    let missingIdentityCalls = 0;
    const uncertainAttempt = freshAttempt("missing-identity");
    const uncertainAdapter = createFazerCardsAdapter({
        env: { FAZERCARDS_API_KEY: "fixture", FAZERCARDS_AUTO_FULFILLMENT_ENABLED: "true" },
        fetchImpl: async () => { missingIdentityCalls += 1; return { ok: true, status: 200, async json() { return { ok: true, order: { kind: "topup", status: "processing" } }; } }; }
    });
    const uncertainProcessor = createFazerCardsFulfillmentProcessor({
        Attempt: { async findById() { return uncertainAttempt; } }, Order: { async findById() { return order; } }, Mapping: { async findById() { return mapping; } },
        adapter: uncertainAdapter, transitionOrder: async () => {}, schedule: () => { throw new Error("uncertain submission must not poll"); }
    });
    await uncertainProcessor.submit(uncertainAttempt._id);
    assert.strictEqual(uncertainAttempt.supplierRequest.submissionState, "SUBMISSION_UNCERTAIN");
    assert.strictEqual(uncertainAttempt.supplierResult.failureCode, "FAZERCARDS_ORDER_REFERENCE_MISSING");
    await uncertainProcessor.submit(uncertainAttempt._id);
    assert.strictEqual(missingIdentityCalls, 1, "Missing identity remains fail-closed and is never automatically resubmitted.");
    console.log("FazerCards Supplier B verification passed: live order calls 0, documented response identity/status, polling, uncertainty, signature, and input contracts PASS.");
}
main().catch(error => { console.error("FazerCards Supplier B verification failed:", error.message); process.exitCode = 1; });
