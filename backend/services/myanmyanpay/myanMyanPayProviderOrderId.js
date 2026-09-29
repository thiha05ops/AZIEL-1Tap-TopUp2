"use strict";

const crypto = require("crypto");

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PROVIDER_ORDER_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

function createMyanMyanPayProviderOrderId(randomBytes = crypto.randomBytes) {
    const entropy = randomBytes(10);
    if (!Buffer.isBuffer(entropy) || entropy.length !== 10) throw new Error("MyanMyanPay provider order ID entropy is invalid.");
    let value = BigInt(`0x${entropy.toString("hex")}`);
    let result = "";
    for (let index = 0; index < 16; index += 1) {
        result = ALPHABET[Number(value & 31n)] + result;
        value >>= 5n;
    }
    if (!PROVIDER_ORDER_ID_PATTERN.test(result)) throw new Error("MyanMyanPay provider order ID generation failed.");
    return result;
}

function isMyanMyanPayProviderOrderId(value) {
    return PROVIDER_ORDER_ID_PATTERN.test(String(value || "").trim());
}

module.exports = Object.freeze({ createMyanMyanPayProviderOrderId, isMyanMyanPayProviderOrderId, PROVIDER_ORDER_ID_PATTERN });
