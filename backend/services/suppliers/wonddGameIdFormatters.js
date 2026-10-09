const { buildWonddMlbbGameId, WonddAdapterError } = require("./wonddAdapter");
const { gameFamilyForProduct } = require("../commerce/canonicalGameInputContract");

const FORMATTERS = Object.freeze({
    mlbb(input = {}) {
        return buildWonddMlbbGameId(input.userId || input.playerId, input.zoneId || input.serverId);
    },
    freefire(input = {}) {
        const playerId = String(input.userId ?? input.playerId ?? "").trim();
        if (!playerId) {
            throw new WonddAdapterError("WONDD_FREEFIRE_PLAYER_ID_REQUIRED", "Free Fire Player ID is required.", { category: "CONFIGURATION" });
        }
        return playerId;
    }
});

function hasWonddGameIdFormatter(productCode = "") {
    return typeof FORMATTERS[gameFamilyForProduct(productCode).toLowerCase()] === "function";
}

function buildWonddGameId(productCode, input = {}) {
    const formatter = FORMATTERS[gameFamilyForProduct(productCode).toLowerCase()];
    if (!formatter) {
        throw new WonddAdapterError("WONDD_INPUT_CONTRACT_NOT_CONFIGURED", "WonDD player input contract is not configured.", { category: "CONFIGURATION" });
    }
    return formatter(input);
}

module.exports = { buildWonddGameId, hasWonddGameIdFormatter };
