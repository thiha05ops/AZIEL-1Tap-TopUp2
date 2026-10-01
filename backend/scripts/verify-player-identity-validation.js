"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
    buildFazerCardsOrderFields,
    buildFazerCardsValidationFields,
    FazerCardsInputError
} = require("../services/suppliers/fazercardsInputFormatters");
const {
    createFazerCardsAdapter,
    FazerCardsAdapterError
} = require("../services/suppliers/fazercardsAdapter");
const {
    playerIdentityValidationCapability,
    validatePlayerIdentity
} = require("../services/playerIdentityValidationService");
const { inputContractForProduct } = require("../services/commerce/canonicalGameInputContract");
const { resolveCanonicalProductRoute } = require("../catalog/canonicalOperationalCatalog");
const { PAGE_ROUTES, PRODUCT_RENDERERS } = require("../config/storefrontRouteContract");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

function providerResult(overrides = {}) {
    return { valid: true, playerName: "Verified Player", playerId: "12345678", region: "SEA", providerStatus: "VALID", safeMessage: "Verified", ...overrides };
}

function assertInitializerContract(source, { initializer, productCode, resolvedIdentity = false }) {
    assert(source.includes("AZIEL_GAME_FLOW?.init({"), `${initializer} must initialize the shared game flow`);
    if (resolvedIdentity) {
        assert(source.includes(`\"${productCode}\"`), `${initializer} must recognize ${productCode}`);
        assert(source.includes("gameKey: productCode") && source.includes("productCode,"), `${initializer} must pass the exact resolved variant identity`);
        assert(source.includes("forProduct(productCode)?.accountFields"), `${initializer} must pass the exact variant's canonical account fields`);
        return;
    }
    assert(source.includes(`gameKey: \"${productCode}\"`), `${initializer} must preserve ${productCode} as gameKey`);
    assert(source.includes(`forProduct(\"${productCode}\")?.accountFields`), `${initializer} must pass ${productCode}'s canonical account fields`);
}

async function run() {
    assert.deepStrictEqual(buildFazerCardsValidationFields("mlbb", { accountFields: [{ key: "userId", value: "12345678" }, { key: "zoneId", value: "1234" }] }), { player_id: "12345678", zone_id: "1234" });
    assert.deepStrictEqual(buildFazerCardsValidationFields("mlbb-twilight-weekly-pass", { userId: "12345678", zoneId: "1234" }), { player_id: "12345678", zone_id: "1234" });
    assert.deepStrictEqual(buildFazerCardsValidationFields("freefire-pass-membership", { accountFields: [{ key: "userId", value: "87654321" }] }), { player_id: "87654321" });
    assert.deepStrictEqual(buildFazerCardsValidationFields("pubgrp", { accountFields: [{ key: "userId", value: "23456789" }] }), { player_id: "23456789" });
    assert.throws(() => buildFazerCardsValidationFields("hok", { userId: "12345678" }), error => error instanceof FazerCardsInputError && error.code === "FAZERCARDS_VALIDATION_CONTRACT_NOT_CONFIGURED");
    assert.throws(() => buildFazerCardsValidationFields("valorant", { accountFields: [{ key: "riotId", value: "Name#TAG" }] }), error => error instanceof FazerCardsInputError && error.code === "FAZERCARDS_VALIDATION_CONTRACT_NOT_CONFIGURED");
    assert.deepStrictEqual(buildFazerCardsOrderFields("hok-pass-cards", { userId: "12345678" }), { player_id: "12345678" }, "HOK fulfillment input must remain unchanged");
    assert.deepStrictEqual(buildFazerCardsOrderFields("valorant", { accountFields: [{ key: "riotId", value: "Name#TAG" }] }), { riot_id: "Name#TAG" }, "Valorant fulfillment input must remain unchanged");
    assert.deepStrictEqual(inputContractForProduct("mlbb").required, ["userId", "zoneId"]);
    assert.deepStrictEqual(inputContractForProduct("freefire").required, ["userId"]);
    assert.deepStrictEqual(inputContractForProduct("pubg").required, ["userId"]);
    assert.deepStrictEqual(inputContractForProduct("hok").required, ["userId"]);
    assert.deepStrictEqual(inputContractForProduct("valorant").required, ["riotId"]);

    for (const productCode of ["mlbb", "mlbb-twilight-weekly-pass", "freefire", "freefire-pass-membership", "pubg", "pubgrp"]) {
        assert.strictEqual(playerIdentityValidationCapability(productCode).supported, true, `${productCode} must use the confirmed validation contract`);
    }
    for (const productCode of ["hok", "hok-pass-cards", "valorant", "unknown-game"]) {
        assert.strictEqual(playerIdentityValidationCapability(productCode).supported, false, `${productCode} must remain disabled without provider validation evidence`);
    }

    let calls = 0;
    const unsupported = await validatePlayerIdentity({ productCode: "hok", accountFields: [{ key: "userId", value: "12345678" }] }, { adapter: { validatePlayerId: async () => { calls += 1; } } });
    assert.deepStrictEqual({ supported: unsupported.supported, available: unsupported.available, valid: unsupported.valid }, { supported: false, available: false, valid: false });
    assert.strictEqual(calls, 0, "unsupported products must not call FazerCards");

    const validAdapter = { validatePlayerId: async input => { calls += 1; assert.strictEqual(input.validationCategoryId, "mobile_legends"); return providerResult(); } };
    const both = await validatePlayerIdentity({ productCode: "mlbb", userId: "12345678", zoneId: "1234" }, { adapter: validAdapter });
    assert.deepStrictEqual({ valid: both.valid, playerName: both.playerName, region: both.region }, { valid: true, playerName: "Verified Player", region: "SEA" });
    const nameOnly = await validatePlayerIdentity({ productCode: "freefire", userId: "12345678" }, { adapter: { validatePlayerId: async () => providerResult({ region: "" }) } });
    assert.strictEqual(nameOnly.playerName, "Verified Player");
    const regionOnly = await validatePlayerIdentity({ productCode: "pubg", userId: "12345678" }, { adapter: { validatePlayerId: async () => providerResult({ playerName: "" }) } });
    assert.strictEqual(regionOnly.region, "SEA");
    const noMetadata = await validatePlayerIdentity({ productCode: "freefire", userId: "12345678" }, { adapter: { validatePlayerId: async () => providerResult({ playerName: "", region: "" }) } });
    assert.strictEqual(noMetadata.valid, true);
    const invalid = await validatePlayerIdentity({ productCode: "pubg", userId: "12345678" }, { adapter: { validatePlayerId: async () => providerResult({ valid: false, playerName: "", region: "", providerStatus: "INVALID" }) } });
    assert.deepStrictEqual({ available: invalid.available, valid: invalid.valid }, { available: true, valid: false });

    for (const code of ["FAZERCARDS_NOT_CONFIGURED", "FAZERCARDS_TRANSPORT_ERROR", "FAZERCARDS_VALIDATION_RESPONSE_INVALID", "FAZERCARDS_HTTP_401", "FAZERCARDS_HTTP_403", "FAZERCARDS_HTTP_429", "FAZERCARDS_HTTP_500", "FAZERCARDS_HTTP_503"]) {
        const unavailable = await validatePlayerIdentity({ productCode: "freefire", userId: "12345678" }, { adapter: { validatePlayerId: async () => { throw new FazerCardsAdapterError(code, "provider detail", { statusCode: Number(code.match(/\d{3}$/)?.[0]) || 502 }); } } });
        assert.deepStrictEqual({ supported: unavailable.supported, available: unavailable.available, valid: unavailable.valid, providerStatus: unavailable.providerStatus }, { supported: true, available: false, valid: false, providerStatus: "UNAVAILABLE" }, `${code} must fail open as unavailable`);
    }

    let malformedCalls = 0;
    await assert.rejects(
        validatePlayerIdentity({ productCode: "mlbb", accountFields: [{ key: "userId", value: "12345678" }] }, { adapter: { validatePlayerId: async () => { malformedCalls += 1; } } }),
        error => error.code === "FAZERCARDS_MLBB_INPUT_INVALID" && error.statusCode === 400
    );
    assert.strictEqual(malformedCalls, 0, "invalid canonical input must fail before provider transport");

    const malformedAdapter = createFazerCardsAdapter({ env: { FAZERCARDS_API_KEY: "test-only-key" }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ unexpected: true }) }) });
    const malformedResponse = await validatePlayerIdentity({ productCode: "freefire", userId: "12345678" }, { adapter: malformedAdapter });
    assert.strictEqual(malformedResponse.available, false, "malformed provider success must not become invalid account");
    let subscriptionRequest = null;
    const inactiveSubscriptionAdapter = createFazerCardsAdapter({
        env: { FAZERCARDS_API_KEY: "test-only-key" },
        fetchImpl: async (url, options) => {
            subscriptionRequest = { url, method: options.method, body: JSON.parse(options.body) };
            return { ok: false, status: 403, json: async () => ({ ok: false, code: "subscription_inactive", error: "Subscription is not active." }) };
        }
    });
    const inactiveSubscription = await validatePlayerIdentity({ productCode: "freefire", userId: "12345678" }, { adapter: inactiveSubscriptionAdapter });
    assert.strictEqual(inactiveSubscription.available, false, "subscription-inactive 403 must be unavailable, not invalid");
    assert.strictEqual(inactiveSubscription.valid, false);
    assert(subscriptionRequest.url.endsWith("/topups/validate-id") && subscriptionRequest.method === "POST", "validation must call only the provider validation endpoint");
    assert.deepStrictEqual(subscriptionRequest.body, { category_id: "free_fire", fields: { player_id: "12345678" } });

    const supportedStorefrontPaths = [
        { productCode: "mlbb", route: "/games/mlbb", shell: "mlbb.html", initializer: "mlbb.js", category: "mobile_legends", resolvedIdentity: true },
        { productCode: "mlbb-twilight-weekly-pass", route: "/products/mlbb-twilight-weekly-pass", shell: "mlbb.html", initializer: "mlbb.js", category: "mobile_legends", resolvedIdentity: true },
        { productCode: "freefire", route: "/games/freefire", shell: "freefire.html", initializer: "freefire.js", category: "free_fire", resolvedIdentity: true },
        { productCode: "freefire-pass-membership", route: "/products/freefire-pass-membership", shell: "freefire.html", initializer: "freefire.js", category: "free_fire", resolvedIdentity: true },
        { productCode: "pubg", route: "/games/pubg", shell: "pubg.html", initializer: "pubg.js", category: "pubg_mobile" },
        { productCode: "pubgrp", route: "/games/pubg-rp", shell: "pubg-rp.html", initializer: "pubg-rp.js", category: "pubg_mobile" }
    ];
    const pageByRoute = new Map(PAGE_ROUTES.map(entry => [entry.route, entry.file]));

    for (const expected of supportedStorefrontPaths) {
        assert.strictEqual(resolveCanonicalProductRoute(expected.productCode), expected.route, `${expected.productCode} must resolve to its canonical storefront route`);
        const routedShell = expected.route.startsWith("/products/")
            ? PRODUCT_RENDERERS[expected.productCode] || "product.html"
            : pageByRoute.get(expected.route);
        assert.strictEqual(routedShell, expected.shell, `${expected.productCode} must use ${expected.shell}`);

        const html = read(`frontend/${expected.shell}`);
        assert(html.includes("/js/game-flow.js?"), `${expected.shell} must load the shared game flow`);
        assert(html.includes(`/js/${expected.initializer}?`), `${expected.shell} must load ${expected.initializer}`);
        assert(html.includes("/js/canonical-game-input-contracts.js?"), `${expected.shell} must load canonical input contracts`);
        assert(html.indexOf("/js/canonical-game-input-contracts.js?") < html.indexOf(`/js/${expected.initializer}?`), `${expected.shell} must load canonical contracts before its initializer`);

        const initializer = read(`frontend/js/${expected.initializer}`);
        assertInitializerContract(initializer, expected);
        const capability = playerIdentityValidationCapability(expected.productCode);
        assert.strictEqual(capability.supported, true, `${expected.productCode} must be validation capable`);
        assert.deepStrictEqual(capability.accountFieldKeys, inputContractForProduct(expected.productCode).required, `${expected.productCode} capability fields must match its canonical contract`);

        let providerInput = null;
        const accountFields = capability.accountFieldKeys.map(key => ({ key, value: key === "zoneId" ? "2409" : "12345678" }));
        const validation = await validatePlayerIdentity({ productCode: expected.productCode, accountFields }, {
            adapter: { validatePlayerId: async input => { providerInput = input; return providerResult(); } }
        });
        assert.strictEqual(validation.available, true, `${expected.productCode} must reach the validation adapter`);
        assert.strictEqual(providerInput.validationCategoryId, expected.category, `${expected.productCode} must map to its intended FazerCards category`);
        assert(accountFields.every(field => !Object.prototype.hasOwnProperty.call(field, "category_id")), "browser account fields must not supply a provider category");
    }

    const route = read("backend/routes/playerIdentityValidation.js");
    const frontend = read("frontend/js/game-flow.js");
    const readiness = frontend.slice(frontend.indexOf("function getReadiness"), frontend.indexOf("function updateSummary"));
    const cachePredicateSource = frontend.slice(
        frontend.indexOf("function shouldCachePlayerValidationResult"),
        frontend.indexOf("function getPlayerValidationFields")
    );
    const cachePredicateContext = {};
    vm.runInNewContext(`${cachePredicateSource}; this.shouldCache = shouldCachePlayerValidationResult;`, cachePredicateContext);
    assert.strictEqual(cachePredicateContext.shouldCache({ ok: true }, { success: true }, { available: true, valid: true }), true, "available valid results may be cached as completed");
    assert.strictEqual(cachePredicateContext.shouldCache({ ok: true }, { success: true }, { available: true, valid: false }), true, "available genuine invalid results may be cached as completed");
    assert.strictEqual(cachePredicateContext.shouldCache({ ok: true }, { success: true }, { available: false, valid: false }), false, "unavailable results must remain retryable");
    assert(frontend.includes("if (shouldCachePlayerValidationResult(response, data, validation))"), "completed signature assignment must use the authoritative-result predicate");
    assert(route.includes("playerValidationLimiter"), "public capability and validation routes must remain rate limited");
    assert(route.includes('router.get(\n    "/player-identity/capability"'), "frontend capability must come from the server mapping");
    assert(!route.includes("providerStatus: clean(result.providerStatus)"), "public response must not expose raw provider status");
    assert(frontend.includes("/api/player-identity/capability?productCode="), "frontend must ask server whether validation is supported");
    assert(frontend.includes("flow.config.productCode || flow.config.gameKey"), "capability and validation must use the initializer's exact product identity");
    assert(frontend.includes("accountFields"), "frontend must submit canonical account fields");
    assert(!frontend.includes("category_id"), "browser must never choose a FazerCards category");
    assert(frontend.includes("AbortController") && frontend.includes("sequence !== flow.playerValidation.sequence"), "abort and sequence stale-request protection must remain present");
    assert(frontend.includes("flow.playerValidation.signature !== signature"), "response signature protection must remain present");
    assert(frontend.includes("✓ ${playerName} · Region: ${region}") && frontend.includes("✓ Player verified · Region: ${region}") && frontend.includes('"✓ Player verified"'), "all safe verified metadata presentations must exist");
    assert(frontend.includes("Player ID or account information is invalid."), "invalid response must use concise generic copy");
    assert(!/playerValidation|player-identity/.test(readiness), "checkout readiness must not depend on provider validation");
    for (const page of ["aov-id", "freefire", "genshin", "hok", "mlbb", "product", "pubg-rp", "pubg", "roblox", "telegram"]) {
        const html = read(`frontend/${page}.html`);
        assert(html.includes('/js/game-flow.js?v=20261001-player-validation-1'), `${page} must load the current shared validation runtime`);
        assert(html.includes('/css/game/product-detail-desktop.css?v=20261001-player-validation-1'), `${page} must load current validation presentation styles`);
    }

    const server = read("backend/server.js");
    assert(server.indexOf('require("./middleware/customerCsrfMiddleware")') < server.indexOf('require("./routes/playerIdentityValidation")'), "customer CSRF middleware must precede validation routes");

    console.log("Player identity validation verification passed.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
