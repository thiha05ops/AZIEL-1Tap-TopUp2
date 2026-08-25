const { buildWonddMlbbGameId, WonddAdapterError } = require("./wonddAdapter");

const FORMATTERS = Object.freeze({
    mlbb(input = {}) {
        return buildWonddMlbbGameId(input.userId || input.playerId, input.zoneId || input.serverId);
    }
});

function hasWonddGameIdFormatter(productCode = "") {
    return typeof FORMATTERS[String(productCode).trim().toLowerCase()] === "function";
}

function buildWonddGameId(productCode, input = {}) {
    const formatter = FORMATTERS[String(productCode || "").trim().toLowerCase()];
    if (!formatter) {
        throw new WonddAdapterError("WONDD_INPUT_CONTRACT_NOT_CONFIGURED", "WonDD player input contract is not configured.", { category: "CONFIGURATION" });
    }
    return formatter(input);
}

module.exports = { buildWonddGameId, hasWonddGameIdFormatter };
