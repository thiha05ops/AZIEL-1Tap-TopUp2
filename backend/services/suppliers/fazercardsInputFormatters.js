const PLAYER_ID_PATTERN = /^\d{5,32}$/;
const { gameFamilyForProduct } = require("../commerce/canonicalGameInputContract");

class FazerCardsInputError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "FazerCardsInputError";
        this.code = code;
    }
}

function normalizedInput(input = {}) {
    const accountFields = Array.isArray(input.accountFields) ? input.accountFields : [];
    const accountValue = (...keys) => String(accountFields.find(field => keys.includes(String(field?.key || "").trim()))?.value || "");
    return {
        playerId: String(input.playerId || input.player_id || input.userId || accountValue("playerId", "userId") || "").trim(),
        zoneId: String(input.zoneId || input.zone_id || accountValue("zoneId", "serverId") || "").trim(),
        riotId: String(input.riotId || input.riot_id || accountValue("riotId") || "").trim()
    };
}

function buildFazerCardsOrderFields(productCode, input = {}) {
    const product = gameFamilyForProduct(productCode).toLowerCase();
    const { playerId, zoneId, riotId } = normalizedInput(input);
    if (product === "mlbb") {
        if (!playerId || !zoneId) throw new FazerCardsInputError("FAZERCARDS_MLBB_INPUT_INVALID", "MLBB User ID and Zone ID are required.");
        return { player_id: playerId, server_id: zoneId };
    }
    if (product === "freefire") {
        if (!playerId) throw new FazerCardsInputError("FAZERCARDS_FREEFIRE_PLAYER_ID_INVALID", "Free Fire Player ID is required.");
        return { player_id: playerId };
    }
    if (product === "hok") {
        if (!playerId) throw new FazerCardsInputError("FAZERCARDS_HOK_PLAYER_ID_INVALID", "Honor of Kings Player ID is required.");
        return { player_id: playerId };
    }
    if (product === "valorant") {
        if (!riotId) throw new FazerCardsInputError("FAZERCARDS_VALORANT_RIOT_ID_INVALID", "Valorant Riot ID is required.");
        return { riot_id: riotId };
    }
    if (product !== "pubg") throw new FazerCardsInputError("FAZERCARDS_INPUT_CONTRACT_NOT_CONFIGURED", "FazerCards input contract is not configured for this product.");
    if (!PLAYER_ID_PATTERN.test(playerId)) throw new FazerCardsInputError("FAZERCARDS_PUBG_PLAYER_ID_INVALID", "PUBG Player ID must be numeric.");
    return { player_id: playerId };
}

function buildFazerCardsValidationFields(productCode, input = {}) {
    const product = gameFamilyForProduct(productCode).toLowerCase();
    const { playerId, zoneId } = normalizedInput(input);
    if (product === "mlbb") {
        if (!playerId || !zoneId) throw new FazerCardsInputError("FAZERCARDS_MLBB_INPUT_INVALID", "MLBB User ID and Zone ID are required.");
        return { player_id: playerId, zone_id: zoneId };
    }
    if (product === "freefire") return buildFazerCardsOrderFields(product, input);
    if (product === "hok") return buildFazerCardsOrderFields(product, input);
    return buildFazerCardsOrderFields(product, input);
}

const buildFazerCardsFields = buildFazerCardsOrderFields;

function maskFazerCardsFields(fields = {}) {
    const mask = value => { const text = String(value || ""); return text.length <= 4 ? "****" : `${text.slice(0, 2)}***${text.slice(-2)}`; };
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, mask(value)]));
}

module.exports = { buildFazerCardsFields, buildFazerCardsOrderFields, buildFazerCardsValidationFields, maskFazerCardsFields, FazerCardsInputError };
