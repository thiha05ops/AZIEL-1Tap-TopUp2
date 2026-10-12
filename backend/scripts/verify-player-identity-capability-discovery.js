"use strict";

const assert = require("assert");
const { createFazerCardsAdapter, FazerCardsAdapterError } = require("../services/suppliers/fazercardsAdapter");
const { createPlayerIdentityCapabilityDiscovery } = require("../services/playerIdentityValidationService");

const payload = {
    ok: true,
    kind: "topup",
    items: [
        { category_id: "pubg_mobile", name: "PUBG Mobile", fields: [{ key: "player_id", label: "Player ID", type: "text" }] },
        { category_id: "free_fire", name: "Free Fire", fields: [{ key: "player_id", label: "Player ID", type: "text" }] },
        { category_id: "mobile_legends", name: "Mobile Legends", fields: [{ key: "player_id", label: "User ID", type: "text" }, { key: "zone_id", label: "Zone ID", type: "text" }] },
        { category_id: "magic_chess_gogo_global", name: "Magic Chess Go Go (Global)", fields: [{ key: "player_id", label: "User ID", type: "text" }, { key: "zone_id", label: "Zone ID", type: "text" }] },
        { category_id: "magic_chess_gogo_ru", name: "Magic Chess Go Go (RU)", fields: [{ key: "player_id", label: "User ID", type: "text" }, { key: "zone_id", label: "Zone ID", type: "text" }] }
    ]
};

async function main() {
    const normalizer = createFazerCardsAdapter({ env: { FAZERCARDS_API_KEY: "test-only-key" }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }) });
    const normalized = normalizer.normalizePlayerValidationCapabilities(payload);
    assert.deepStrictEqual(normalized.map(item => [item.categoryId, item.fields.map(field => field.key)]), [
        ["pubg_mobile", ["player_id"]],
        ["free_fire", ["player_id"]],
        ["mobile_legends", ["player_id", "zone_id"]],
        ["magic_chess_gogo_global", ["player_id", "zone_id"]],
        ["magic_chess_gogo_ru", ["player_id", "zone_id"]]
    ]);
    for (const invalid of [
        { ok: false, items: [] },
        { ok: true, items: [{ category_id: "bad id", name: "Bad", fields: [{ key: "player_id" }] }] },
        { ok: true, items: [{ category_id: "duplicate", name: "One", fields: [{ key: "player_id" }] }, { category_id: "duplicate", name: "Two", fields: [{ key: "player_id" }] }] },
        { ok: true, items: [{ category_id: "unsafe", name: "Unsafe", fields: [{ key: "__proto__" }] }] },
        { ok: true, items: [{ category_id: "duplicate_fields", name: "Duplicate fields", fields: [{ key: "player_id" }, { key: "player_id" }] }] }
    ]) {
        assert.throws(() => normalizer.normalizePlayerValidationCapabilities(invalid), error => error instanceof FazerCardsAdapterError && error.code === "FAZERCARDS_VALIDATION_CAPABILITY_RESPONSE_INVALID");
    }

    let now = 0;
    let providerCalls = 0;
    let fail = false;
    let release;
    const firstRequest = new Promise(resolve => { release = resolve; });
    const adapter = {
        getPlayerValidationCapabilities: async () => {
            providerCalls += 1;
            if (providerCalls === 1) await firstRequest;
            if (fail) throw new Error("offline fixture failure");
            return normalized;
        }
    };
    const discovery = createPlayerIdentityCapabilityDiscovery({ adapter, now: () => now, ttlMs: 10, maxStaleMs: 60, timeoutMs: 1000 });
    const concurrent = [discovery.getCapabilities(), discovery.getCapabilities(), discovery.getCapabilities()];
    release();
    const initial = await Promise.all(concurrent);
    assert.strictEqual(providerCalls, 1, "concurrent cache misses must share one provider request");
    assert(initial.every(result => result.available && !result.stale && result.categories.length === 5));
    await discovery.getCapabilities();
    assert.strictEqual(providerCalls, 1, "fresh cache must avoid provider requests");

    now = 11;
    fail = true;
    const stale = await discovery.getCapabilities();
    assert.deepStrictEqual({ available: stale.available, stale: stale.stale, count: stale.categories.length }, { available: true, stale: true, count: 5 });
    now = 61;
    const expired = await discovery.getCapabilities();
    assert.deepStrictEqual(expired, { available: false, stale: false, categories: [] }, "expired cache plus provider failure must fail safely unavailable");
    assert.strictEqual(providerCalls, 2, "failure retry cooldown must suppress repeated provider requests");

    let timeoutSignal;
    const timeoutDiscovery = createPlayerIdentityCapabilityDiscovery({
        adapter: { getPlayerValidationCapabilities: ({ signal }) => new Promise((resolve, reject) => { timeoutSignal = signal; signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); }) },
        timeoutMs: 5
    });
    assert.deepStrictEqual(await timeoutDiscovery.getCapabilities(), { available: false, stale: false, categories: [] });
    assert.strictEqual(timeoutSignal.aborted, true);

    console.log(JSON.stringify({ result: "PASS", categories: normalized.length, singleFlightCalls: 1, productionCalls: 0, databaseWrites: 0 }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
