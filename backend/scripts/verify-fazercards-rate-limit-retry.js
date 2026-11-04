"use strict";

const assert = require("assert");
const {
    createFazerCardsAdapter,
    retryAfterMs,
    RATE_LIMIT_MAX_RETRIES,
    RATE_LIMIT_MAX_DELAY_MS
} = require("../services/suppliers/fazercardsAdapter");
const catalog = require("../services/supplierCatalog/providers/fazerCardsCatalogIngestionService");

const headers = value => ({ get: name => name.toLowerCase() === "retry-after" ? value : null });
const response = (status, payload = {}, retryAfter = "") => ({ ok: status >= 200 && status < 300, status, headers: headers(retryAfter), json: async () => payload });
const env = { FAZERCARDS_API_KEY: "isolated-test-key" };

async function main() {
    assert.strictEqual(retryAfterMs("2", 0), 2000);
    assert.strictEqual(retryAfterMs("Thu, 01 Jan 1970 00:00:03 GMT", 1000), 2000);
    assert.strictEqual(retryAfterMs("invalid", 0), null);

    let calls = 0, now = 1000;
    const sleeps = [];
    const successful = createFazerCardsAdapter({
        env,
        clock: () => now,
        random: () => 0.5,
        sleep: async delay => { sleeps.push(delay); now += delay; },
        fetchImpl: async () => (++calls === 1 ? response(429, { message: "rate limited" }, "2") : response(200, { offers: [{ offer_id: "60_uc" }] }))
    });
    assert.deepStrictEqual((await successful.getTopupOffers("pubg_mobile_auto")).offers, [{ offer_id: "60_uc" }]);
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(sleeps, [2000], "valid Retry-After seconds must be honored");

    calls = 0; now = Date.parse("2030-01-01T00:00:00Z"); sleeps.length = 0;
    const retryDate = new Date(now + 3000).toUTCString();
    const dated = createFazerCardsAdapter({ env, clock: () => now, random: () => 0.5, sleep: async delay => { sleeps.push(delay); now += delay; }, fetchImpl: async () => (++calls === 1 ? response(429, {}, retryDate) : response(200, { items: [] })) });
    await dated.getTopupCategories();
    assert.deepStrictEqual(sleeps, [3000], "valid Retry-After HTTP dates must be honored");

    calls = 0; now = 0; sleeps.length = 0;
    const backedOff = createFazerCardsAdapter({ env, clock: () => now, random: () => 0.5, sleep: async delay => { sleeps.push(delay); now += delay; }, fetchImpl: async () => (++calls <= 3 ? response(429, {}, "invalid") : response(200, { offers: [] })) });
    await backedOff.getTopupOffers("backoff");
    assert.deepStrictEqual(sleeps, [500, 1000, 2000], "missing or invalid Retry-After must use bounded exponential backoff with jitter");

    calls = 0; now = 0; sleeps.length = 0;
    const exhausted = createFazerCardsAdapter({ env, clock: () => now, random: () => 0.5, sleep: async delay => { sleeps.push(delay); now += delay; }, fetchImpl: async () => { calls += 1; return response(429, { message: "still limited" }, "999"); } });
    await assert.rejects(() => exhausted.getTopupOffers("limited"), error => error.code === "FAZERCARDS_HTTP_429" && error.retryable === true);
    assert.strictEqual(calls, RATE_LIMIT_MAX_RETRIES + 1, "retry budget must be finite");
    assert(sleeps.every(delay => delay === RATE_LIMIT_MAX_DELAY_MS), "provider delay must be capped");

    let retrySleepsInFlight = 0, maximumRetrySleeps = 0;
    const perCategoryCalls = new Map();
    const serialized = createFazerCardsAdapter({
        env,
        random: () => 0.5,
        sleep: async () => { retrySleepsInFlight += 1; maximumRetrySleeps = Math.max(maximumRetrySleeps, retrySleepsInFlight); await new Promise(resolve => setImmediate(resolve)); retrySleepsInFlight -= 1; },
        fetchImpl: async url => { const key = new URL(url).searchParams.get("category_id"); const count = (perCategoryCalls.get(key) || 0) + 1; perCategoryCalls.set(key, count); return count === 1 ? response(429, {}, "0") : response(200, { offers: [] }); }
    });
    await Promise.all([serialized.getTopupOffers("one"), serialized.getTopupOffers("two")]);
    assert.strictEqual(maximumRetrySleeps, 1, "rate-limited retry sequences must be serialized");

    const controller = new AbortController();
    let cancellationCalls = 0;
    const cancelled = createFazerCardsAdapter({ env, fetchImpl: async () => { cancellationCalls += 1; return response(429, {}, "1"); }, sleep: async (_delay, signal) => { controller.abort(); if (signal.aborted) throw Object.assign(new Error("cancelled"), { code: "FAZERCARDS_REQUEST_ABORTED" }); } });
    await assert.rejects(() => cancelled.getTopupOffers("cancelled", { signal: controller.signal }), error => error.code === "FAZERCARDS_REQUEST_ABORTED");
    assert.strictEqual(cancellationCalls, 1, "cancelled waits must not issue another request");

    const timedOutController = new AbortController();
    timedOutController.abort();
    const timedOut = createFazerCardsAdapter({ env, fetchImpl: async (_url, options) => { const error = new Error("aborted"); error.name = options.signal.aborted ? "AbortError" : "Error"; throw error; } });
    await assert.rejects(() => timedOut.getTopupOffers("timeout", { signal: timedOutController.signal }), error => error.code === "FAZERCARDS_REQUEST_ABORTED");

    calls = 0; now = 0;
    const partialAdapter = createFazerCardsAdapter({ env, clock: () => now, random: () => 0.5, sleep: async delay => { now += delay; }, fetchImpl: async url => { calls += 1; return url.endsWith("/topups") ? response(200, { items: [{ category_id: "missing", name: "Missing", note: "Region: GLOBAL" }], meta: {} }) : response(429, {}, "0"); } });
    const stage = await catalog.stageCatalog({ reader: catalog.createCatalogReader(partialAdapter), supplierId: "supplier", observedAt: new Date() });
    const plan = catalog.planMutations(stage);
    assert.strictEqual(stage.coverageState, "PARTIAL");
    assert.strictEqual(plan.runStatus, "SUCCEEDED_PARTIAL");
    assert.strictEqual(plan.coverageState, "PARTIAL");
    assert.strictEqual(stage.errors[0].code, "FAZERCARDS_HTTP_429");

    console.log(JSON.stringify({ result: "PASS", retryAfterSeconds: true, retryAfterHttpDate: true, exponentialBackoffWithJitter: true, finiteRetryBudget: RATE_LIMIT_MAX_RETRIES, delayCapMs: RATE_LIMIT_MAX_DELAY_MS, serializedRetries: true, cancellation: true, timeout: true, partialFailClosed: true, supplierCalls: 0, productionWrites: 0 }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
