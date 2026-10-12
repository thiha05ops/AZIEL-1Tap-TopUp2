const fazercardsAdapter = require("./suppliers/fazercardsAdapter");
const { buildFazerCardsValidationFields, FazerCardsInputError } = require("./suppliers/fazercardsInputFormatters");

const CAPABILITY_CACHE_TTL_MS = 10 * 60 * 1000;
const CAPABILITY_CACHE_MAX_STALE_MS = 60 * 60 * 1000;
const CAPABILITY_DISCOVERY_TIMEOUT_MS = 8000;
const CAPABILITY_FAILURE_RETRY_MS = 30 * 1000;

// Owner-reviewed compatibility evidence. Similar catalog names and generated
// product codes must never become validation authority automatically.
const REVIEWED_VALIDATION_MAPPING_BY_PRODUCT = Object.freeze({
    mlbb: Object.freeze({ categoryId: "mobile_legends", accountFieldKeys: Object.freeze(["userId", "zoneId"]), providerFieldKeys: Object.freeze(["player_id", "zone_id"]) }),
    "mlbb-twilight-weekly-pass": Object.freeze({ categoryId: "mobile_legends", accountFieldKeys: Object.freeze(["userId", "zoneId"]), providerFieldKeys: Object.freeze(["player_id", "zone_id"]) }),
    freefire: Object.freeze({ categoryId: "free_fire", accountFieldKeys: Object.freeze(["userId"]), providerFieldKeys: Object.freeze(["player_id"]) }),
    "freefire-pass-membership": Object.freeze({ categoryId: "free_fire", accountFieldKeys: Object.freeze(["userId"]), providerFieldKeys: Object.freeze(["player_id"]) }),
    pubg: Object.freeze({ categoryId: "pubg_mobile", accountFieldKeys: Object.freeze(["userId"]), providerFieldKeys: Object.freeze(["player_id"]) }),
    pubgrp: Object.freeze({ categoryId: "pubg_mobile", accountFieldKeys: Object.freeze(["userId"]), providerFieldKeys: Object.freeze(["player_id"]) }),
    // Exact owner-created canonical identity for reviewed FazerCards product
    // pubg_mobile_fast. Validation uses the generic PUBG player_id contract;
    // this does not select or alter the package fulfillment supplier route.
    "pubg-mobile-fast-7fbcc7684d": Object.freeze({ categoryId: "pubg_mobile", inputContractProductCode: "pubg", accountFieldKeys: Object.freeze(["userId"]), providerFieldKeys: Object.freeze(["player_id"]) })
});

const VALIDATION_CATEGORY_BY_GAME = Object.freeze({ mlbb: "mobile_legends", freefire: "free_fire", pubg: "pubg_mobile" });

class PlayerIdentityValidationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PlayerIdentityValidationError";
        this.code = code;
        this.statusCode = details.statusCode || 400;
        this.retryable = Boolean(details.retryable);
    }
}

function clean(value) { return String(value == null ? "" : value).trim(); }
function reviewedValidationMapping(productCode) { return REVIEWED_VALIDATION_MAPPING_BY_PRODUCT[clean(productCode).toLowerCase()] || null; }
function validationCategoryForProduct(productCode) { return reviewedValidationMapping(productCode)?.categoryId || ""; }
function supportsPlayerIdentityValidation(productCode) { return Boolean(reviewedValidationMapping(productCode)); }
function sameFieldSet(left = [], right = []) {
    if (left.length !== right.length) return false;
    const sortedRight = [...right].sort();
    return [...left].sort().every((value, index) => value === sortedRight[index]);
}

function createPlayerIdentityCapabilityDiscovery({
    adapter = fazercardsAdapter,
    now = () => Date.now(),
    ttlMs = CAPABILITY_CACHE_TTL_MS,
    maxStaleMs = CAPABILITY_CACHE_MAX_STALE_MS,
    timeoutMs = CAPABILITY_DISCOVERY_TIMEOUT_MS,
    failureRetryMs = CAPABILITY_FAILURE_RETRY_MS
} = {}) {
    let cached = null;
    let inFlight = null;
    let retryAt = 0;

    async function refresh() {
        if (inFlight) return inFlight;
        inFlight = (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const categories = await adapter.getPlayerValidationCapabilities({ signal: controller.signal });
                const loadedAt = now();
                cached = Object.freeze({
                    categories: Object.freeze(categories.slice()),
                    freshUntil: loadedAt + ttlMs,
                    staleUntil: loadedAt + maxStaleMs
                });
                retryAt = 0;
                return { available: true, stale: false, categories: cached.categories };
            } catch (_) {
                const currentTime = now();
                retryAt = currentTime + failureRetryMs;
                if (cached && currentTime <= cached.staleUntil) {
                    return { available: true, stale: true, categories: cached.categories };
                }
                return { available: false, stale: false, categories: [] };
            } finally {
                clearTimeout(timeout);
                inFlight = null;
            }
        })();
        return inFlight;
    }

    async function getCapabilities() {
        const currentTime = now();
        if (cached && currentTime <= cached.freshUntil) return { available: true, stale: false, categories: cached.categories };
        if (currentTime < retryAt) {
            if (cached && currentTime <= cached.staleUntil) return { available: true, stale: true, categories: cached.categories };
            return { available: false, stale: false, categories: [] };
        }
        return refresh();
    }

    return Object.freeze({ getCapabilities, refresh });
}

const defaultCapabilityDiscovery = createPlayerIdentityCapabilityDiscovery();

async function playerIdentityValidationCapability(productCode, dependencies = {}) {
    const mapping = reviewedValidationMapping(productCode);
    if (!mapping) return { supported: false, available: true, accountFieldKeys: [] };
    const snapshot = await (dependencies.discovery || defaultCapabilityDiscovery).getCapabilities();
    if (!snapshot.available) return { supported: true, available: false, accountFieldKeys: [...mapping.accountFieldKeys] };
    const category = snapshot.categories.find(item => item.categoryId === mapping.categoryId);
    const compatible = Boolean(category) && sameFieldSet(category.fields.map(field => field.key), mapping.providerFieldKeys);
    return { supported: compatible, available: true, accountFieldKeys: compatible ? [...mapping.accountFieldKeys] : [] };
}

async function validatePlayerIdentity({ productCode, userId, zoneId, accountFields = [] } = {}, dependencies = {}) {
    const normalizedProductCode = clean(productCode).toLowerCase();
    if (!normalizedProductCode) throw new PlayerIdentityValidationError("PLAYER_VALIDATION_PRODUCT_REQUIRED", "Product code is required.");

    const capability = await playerIdentityValidationCapability(normalizedProductCode, dependencies);
    if (!capability.supported || !capability.available) {
        return {
            supported: capability.supported,
            available: false,
            valid: false,
            playerName: "",
            region: "",
            providerStatus: capability.available ? "UNSUPPORTED" : "UNAVAILABLE"
        };
    }

    const validationCategoryId = validationCategoryForProduct(normalizedProductCode);
    let fields;
    try {
        const mapping = reviewedValidationMapping(normalizedProductCode);
        fields = buildFazerCardsValidationFields(mapping?.inputContractProductCode || normalizedProductCode, { userId, zoneId, accountFields });
    } catch (error) {
        if (error instanceof FazerCardsInputError) throw new PlayerIdentityValidationError(error.code || "PLAYER_VALIDATION_INPUT_INVALID", error.message, { statusCode: 400 });
        throw error;
    }

    try {
        const adapter = dependencies.adapter || fazercardsAdapter;
        const result = await adapter.validatePlayerId({ validationCategoryId, fields });
        return {
            supported: true,
            available: true,
            valid: result.valid === true,
            playerName: clean(result.playerName),
            playerId: clean(result.playerId),
            region: clean(result.region),
            providerStatus: clean(result.providerStatus),
            message: clean(result.safeMessage)
        };
    } catch (error) {
        const providerUnavailable = error?.code === "FAZERCARDS_NOT_CONFIGURED" ||
            error?.code === "FAZERCARDS_TRANSPORT_ERROR" ||
            error?.code === "FAZERCARDS_VALIDATION_RESPONSE_INVALID" ||
            /^FAZERCARDS_HTTP_(401|403|429|5\d\d)$/.test(clean(error?.code));
        if (providerUnavailable) {
            return { supported: true, available: false, valid: false, playerName: "", region: "", providerStatus: "UNAVAILABLE", message: "Player verification is temporarily unavailable." };
        }
        throw new PlayerIdentityValidationError(error?.code || "PLAYER_VALIDATION_FAILED", error?.message || "Player validation failed.", {
            statusCode: Number(error?.statusCode) || 502,
            retryable: Boolean(error?.retryable)
        });
    }
}

module.exports = {
    PlayerIdentityValidationError,
    VALIDATION_CATEGORY_BY_GAME,
    REVIEWED_VALIDATION_MAPPING_BY_PRODUCT,
    CAPABILITY_CACHE_TTL_MS,
    CAPABILITY_CACHE_MAX_STALE_MS,
    CAPABILITY_DISCOVERY_TIMEOUT_MS,
    CAPABILITY_FAILURE_RETRY_MS,
    createPlayerIdentityCapabilityDiscovery,
    validationCategoryForProduct,
    supportsPlayerIdentityValidation,
    playerIdentityValidationCapability,
    validatePlayerIdentity
};
