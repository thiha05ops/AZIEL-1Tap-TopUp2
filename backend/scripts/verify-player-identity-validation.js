"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
    createFazerCardsAdapter,
    FazerCardsAdapterError
} = require("../services/suppliers/fazercardsAdapter");
const {
    REVIEWED_VALIDATION_MAPPING_BY_PRODUCT,
    playerIdentityValidationCapability,
    validatePlayerIdentity
} = require("../services/playerIdentityValidationService");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const categories = Object.freeze([
    { categoryId: "pubg_mobile", name: "PUBG Mobile", fields: [{ key: "player_id", label: "Player ID", type: "text" }] },
    { categoryId: "free_fire", name: "Free Fire", fields: [{ key: "player_id", label: "Player ID", type: "text" }] },
    { categoryId: "mobile_legends", name: "Mobile Legends", fields: [{ key: "player_id", label: "User ID", type: "text" }, { key: "zone_id", label: "Zone ID", type: "text" }] },
    { categoryId: "magic_chess_gogo_global", name: "Magic Chess Go Go (Global)", fields: [{ key: "player_id", label: "User ID", type: "text" }, { key: "zone_id", label: "Zone ID", type: "text" }] },
    { categoryId: "magic_chess_gogo_ru", name: "Magic Chess Go Go (RU)", fields: [{ key: "player_id", label: "User ID", type: "text" }, { key: "zone_id", label: "Zone ID", type: "text" }] }
]);
const discovery = Object.freeze({ getCapabilities: async () => ({ available: true, stale: false, categories }) });
const providerResult = overrides => ({ valid: true, playerName: "Verified Player", playerId: "12345678", region: "SEA", providerStatus: "VALID", safeMessage: "Verified", ...overrides });

async function main() {
    assert.deepStrictEqual(Object.keys(REVIEWED_VALIDATION_MAPPING_BY_PRODUCT).sort(), ["freefire", "freefire-pass-membership", "mlbb", "mlbb-twilight-weekly-pass", "pubg", "pubg-mobile-fast-7fbcc7684d", "pubgrp"]);
    for (const productCode of Object.keys(REVIEWED_VALIDATION_MAPPING_BY_PRODUCT)) {
        const capability = await playerIdentityValidationCapability(productCode, { discovery });
        assert.strictEqual(capability.supported, true, `${productCode} must retain its reviewed mapping`);
        assert.strictEqual(capability.available, true);
    }
    for (const productCode of ["magic-chess-go-go", "magic-chess-gogo-ru", "hok", "valorant", "unknown-game"]) {
        const capability = await playerIdentityValidationCapability(productCode, { discovery });
        assert.deepStrictEqual(capability, { supported: false, available: true, accountFieldKeys: [] }, `${productCode} must not be enabled by similar names`);
    }

    const unavailable = await playerIdentityValidationCapability("mlbb", { discovery: { getCapabilities: async () => ({ available: false, stale: false, categories: [] }) } });
    assert.deepStrictEqual(unavailable, { supported: true, available: false, accountFieldKeys: ["userId", "zoneId"] });
    const wrongFields = await playerIdentityValidationCapability("mlbb", { discovery: { getCapabilities: async () => ({ available: true, categories: [{ categoryId: "mobile_legends", fields: [{ key: "player_id" }] }] }) } });
    assert.strictEqual(wrongFields.supported, false, "live field drift must fail closed");

    let calls = 0;
    const adapter = { validatePlayerId: async input => { calls += 1; assert.deepStrictEqual(input, { validationCategoryId: "mobile_legends", fields: { player_id: "12345678", zone_id: "1234" } }); return providerResult(); } };
    const valid = await validatePlayerIdentity({ productCode: "mlbb", accountFields: [{ key: "userId", value: "12345678" }, { key: "zoneId", value: "1234" }] }, { adapter, discovery });
    assert.deepStrictEqual({ valid: valid.valid, playerName: valid.playerName, region: valid.region }, { valid: true, playerName: "Verified Player", region: "SEA" });
    assert.strictEqual(calls, 1);
    await assert.rejects(
        validatePlayerIdentity({ productCode: "mlbb", accountFields: [{ key: "userId", value: "12345678" }] }, { adapter, discovery }),
        error => error.code === "FAZERCARDS_MLBB_INPUT_INVALID" && error.statusCode === 400
    );
    assert.strictEqual(calls, 1, "incomplete local input must fail before validation POST");

    let pubgFastPayload;
    const pubgFast = await validatePlayerIdentity({ productCode: "pubg-mobile-fast-7fbcc7684d", accountFields: [{ key: "userId", value: "12345678" }] }, { adapter: { validatePlayerId: async input => { calls += 1; pubgFastPayload = input; return providerResult(); } }, discovery });
    assert.deepStrictEqual({ supported: pubgFast.supported, available: pubgFast.available, valid: pubgFast.valid }, { supported: true, available: true, valid: true });
    assert.deepStrictEqual(pubgFastPayload, { validationCategoryId: "pubg_mobile", fields: { player_id: "12345678" } }, "reviewed PUBG Fast identity must use the generic PUBG validation contract");

    const unsupported = await validatePlayerIdentity({ productCode: "magic-chess-go-go", accountFields: [{ key: "userId", value: "12345678" }, { key: "zoneId", value: "1234" }] }, { adapter: { validatePlayerId: async () => { calls += 1; } }, discovery });
    assert.deepStrictEqual({ supported: unsupported.supported, available: unsupported.available, valid: unsupported.valid }, { supported: false, available: false, valid: false });
    assert.strictEqual(calls, 2, "unsupported products must not call validation POST");

    for (const code of ["FAZERCARDS_NOT_CONFIGURED", "FAZERCARDS_TRANSPORT_ERROR", "FAZERCARDS_VALIDATION_RESPONSE_INVALID", "FAZERCARDS_HTTP_401", "FAZERCARDS_HTTP_403", "FAZERCARDS_HTTP_429", "FAZERCARDS_HTTP_500"]) {
        const result = await validatePlayerIdentity({ productCode: "freefire", userId: "12345678" }, { discovery, adapter: { validatePlayerId: async () => { throw new FazerCardsAdapterError(code, "private provider error"); } } });
        assert.deepStrictEqual({ supported: result.supported, available: result.available, valid: result.valid }, { supported: true, available: false, valid: false }, `${code} must be unavailable, not invalid`);
    }

    const invalid = await validatePlayerIdentity({ productCode: "pubg", userId: "12345678" }, { discovery, adapter: { validatePlayerId: async () => providerResult({ valid: false, playerName: "", region: "" }) } });
    assert.deepStrictEqual({ available: invalid.available, valid: invalid.valid }, { available: true, valid: false });

    let discoveryRequest;
    const discoveryAdapter = createFazerCardsAdapter({
        env: { FAZERCARDS_API_KEY: "test-only-key" },
        fetchImpl: async (url, options) => {
            discoveryRequest = { url, method: options.method, hasBody: Boolean(options.body), hasKey: Boolean(options.headers["X-API-Key"]) };
            return { ok: true, status: 200, json: async () => ({ ok: true, kind: "topup", items: categories.map(item => ({ category_id: item.categoryId, name: item.name, fields: item.fields })) }) };
        }
    });
    assert.strictEqual((await discoveryAdapter.getPlayerValidationCapabilities()).length, 5);
    assert.deepStrictEqual(discoveryRequest, { url: "https://api.fzr.cards/api/v2/topups/validate-id", method: "GET", hasBody: false, hasKey: true });

    const route = read("backend/routes/playerIdentityValidation.js");
    const service = read("backend/services/playerIdentityValidationService.js");
    const frontend = read("frontend/js/game-flow.js");
    const readiness = frontend.slice(frontend.indexOf("function getReadiness"), frontend.indexOf("function updateSummary"));
    assert(route.includes("await playerIdentityValidationCapability"));
    assert(route.includes("available: capability.available === true"));
    assert(service.includes("REVIEWED_VALIDATION_MAPPING_BY_PRODUCT") && !service.includes("PackageSupplierSelection"));
    const formatterSource = frontend.slice(frontend.indexOf("function formatPlayerValidationMessage"), frontend.indexOf("function getPlayerValidationFields"));
    const formatterContext = {};
    vm.runInNewContext(`${formatterSource}; this.formatMessage = formatPlayerValidationMessage;`, formatterContext);
    assert.strictEqual(formatterContext.formatMessage({ playerName: "IGN", region: "SEA", server: "must-not-render" }), "✓ IGN · Region: SEA");
    assert.strictEqual(formatterContext.formatMessage({ playerName: "IGN" }), "✓ IGN");
    assert.strictEqual(formatterContext.formatMessage({ region: "SEA" }), "✓ Account Verified · Region: SEA");
    assert.strictEqual(formatterContext.formatMessage({ server: "must-not-render" }), "✓ Account Verified");
    assert(!frontend.includes("Server: ${"), "server metadata must not be invented");
    assert(frontend.includes("AbortController") && frontend.includes("sequence !== flow.playerValidation.sequence"));
    assert(frontend.includes("data?.capability?.available === true"));
    assert(!/playerValidation|player-identity/.test(readiness), "checkout readiness must remain independent of supplier verification");

    console.log(JSON.stringify({ result: "PASS", reviewedMappings: 7, liveFixtureCategories: 5, postCalls: calls, productionCalls: 0, databaseWrites: 0 }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
