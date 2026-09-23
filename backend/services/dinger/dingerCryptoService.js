"use strict";

const crypto = require("crypto");

const DINGER_RSA_SEGMENT_BYTES = 64;

const ERROR_CODES = Object.freeze({
    INVALID_INPUT: "DINGER_CRYPTO_INVALID_INPUT",
    INVALID_KEY: "DINGER_CRYPTO_INVALID_KEY",
    ENCRYPTION_FAILED: "DINGER_CRYPTO_ENCRYPTION_FAILED",
    INVALID_BASE64: "DINGER_CRYPTO_INVALID_BASE64",
    DECRYPTION_FAILED: "DINGER_CRYPTO_DECRYPTION_FAILED",
    PROTOCOL_UNCONFIRMED: "DINGER_PROTOCOL_UNCONFIRMED"
});

class DingerCryptoError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "DingerCryptoError";
        this.code = code;
        this.stage = options.stage || "crypto";
    }
}

function requireBuffer(value, field) {
    const buffer = Buffer.isBuffer(value) ? Buffer.from(value) : (typeof value === "string" ? Buffer.from(value, "utf8") : null);
    if (!buffer?.length) throw new DingerCryptoError(ERROR_CODES.INVALID_KEY, `${field} must be non-empty bytes.`, { stage: "key" });
    return buffer;
}

function decodeBase64Strict(value) {
    const encoded = String(value || "").trim();
    if (!encoded || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
        throw new DingerCryptoError(ERROR_CODES.INVALID_BASE64, "Encrypted callback is not valid Base64.", { stage: "decode" });
    }
    const decoded = Buffer.from(encoded, "base64");
    if (!decoded.length || decoded.toString("base64") !== encoded) {
        throw new DingerCryptoError(ERROR_CODES.INVALID_BASE64, "Encrypted callback is not canonical Base64.", { stage: "decode" });
    }
    return decoded;
}

function aesAlgorithmForKey(key) {
    if (![16, 24, 32].includes(key.length)) {
        throw new DingerCryptoError(ERROR_CODES.INVALID_KEY, "AES key must contain 16, 24, or 32 bytes.", { stage: "key" });
    }
    return `aes-${key.length * 8}-ecb`;
}

function decryptAesEcbPkcs7({ encryptedBase64, keyBytes }) {
    const key = requireBuffer(keyBytes, "keyBytes");
    const encrypted = decodeBase64Strict(encryptedBase64);
    const algorithm = aesAlgorithmForKey(key);
    try {
        const decipher = crypto.createDecipheriv(algorithm, key, null);
        decipher.setAutoPadding(true);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (_) {
        throw new DingerCryptoError(ERROR_CODES.DECRYPTION_FAILED, "Dinger callback decryption failed.", { stage: "decrypt" });
    }
}

function calculateSha256(value) {
    if (typeof value !== "string") throw new DingerCryptoError(ERROR_CODES.INVALID_INPUT, "Checksum input must be the exact JSON text.", { stage: "checksum" });
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function verifySha256({ exactJsonText, checksum }) {
    const expected = calculateSha256(exactJsonText);
    const supplied = String(checksum || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

function dingerRsaPublicKey(publicKey) {
    const source = String(publicKey || "").trim().replace(/\\n/g, "\n");
    let keyObject;
    try {
        if (/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(source)) {
            keyObject = crypto.createPublicKey(source);
        } else {
            const compact = source.replace(/\s+/g, "");
            if (!compact || compact.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
                throw new Error("invalid SPKI encoding");
            }
            const der = Buffer.from(compact, "base64");
            if (!der.length || der.toString("base64") !== compact) throw new Error("non-canonical SPKI encoding");
            keyObject = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
        }
    } catch (_) {
        throw new DingerCryptoError(ERROR_CODES.INVALID_KEY, "Dinger public key must be valid RSA SPKI PEM or Base64 DER.", { stage: "key" });
    }
    if (keyObject.asymmetricKeyType !== "rsa") {
        throw new DingerCryptoError(ERROR_CODES.INVALID_KEY, "Dinger public key must be an RSA key.", { stage: "key" });
    }
    return keyObject;
}

function encryptRsaRequestBase64({ plaintext, publicKey }) {
    if (typeof plaintext !== "string" || !plaintext) throw new DingerCryptoError(ERROR_CODES.INVALID_INPUT, "RSA plaintext is required.", { stage: "encrypt" });
    const keyObject = dingerRsaPublicKey(publicKey);
    try {
        return crypto.publicEncrypt({ key: keyObject, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(plaintext, "utf8")).toString("base64");
    } catch (_) {
        throw new DingerCryptoError(ERROR_CODES.ENCRYPTION_FAILED, "Dinger RSA PKCS#1 v1.5 request encryption failed.", { stage: "encrypt" });
    }
}

function encryptDingerPayPayloadBase64({ plaintext, publicKey }) {
    if (typeof plaintext !== "string" || !plaintext) throw new DingerCryptoError(ERROR_CODES.INVALID_INPUT, "Dinger Pay plaintext is required.", { stage: "encrypt" });
    const keyObject = dingerRsaPublicKey(publicKey);
    const plaintextBytes = Buffer.from(plaintext, "utf8");
    const encryptedBlocks = [];
    try {
        for (let offset = 0; offset < plaintextBytes.length; offset += DINGER_RSA_SEGMENT_BYTES) {
            encryptedBlocks.push(crypto.publicEncrypt({
                key: keyObject,
                padding: crypto.constants.RSA_PKCS1_PADDING
            }, plaintextBytes.subarray(offset, offset + DINGER_RSA_SEGMENT_BYTES)));
        }
        return Buffer.concat(encryptedBlocks).toString("base64");
    } catch (_) {
        throw new DingerCryptoError(ERROR_CODES.ENCRYPTION_FAILED, "Dinger segmented RSA PKCS#1 v1.5 Pay encryption failed.", { stage: "encrypt" });
    }
}

function verifyCallbackChecksum({ exactJsonText, checksum, contract }) {
    if (!contract || contract.confirmed !== true || contract.input !== "DECRYPTED_JSON_TEXT" || contract.encoding !== "HEX_LOWER") {
        throw new DingerCryptoError(ERROR_CODES.PROTOCOL_UNCONFIRMED, "Dinger checksum canonicalization is not confirmed.", { stage: "protocol" });
    }
    return verifySha256({ exactJsonText, checksum });
}

module.exports = Object.freeze({
    ERROR_CODES,
    DingerCryptoError,
    decodeBase64Strict,
    decryptAesEcbPkcs7,
    calculateSha256,
    verifySha256,
    encryptRsaRequestBase64,
    encryptDingerPayPayloadBase64,
    DINGER_RSA_SEGMENT_BYTES,
    verifyCallbackChecksum
});
