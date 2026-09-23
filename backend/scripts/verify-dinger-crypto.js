"use strict";

const assert = require("assert");
const crypto = require("crypto");
const {
    DingerCryptoError,
    decryptAesEcbPkcs7,
    calculateSha256,
    verifySha256,
    verifyCallbackChecksum,
    encryptRsaRequestBase64,
    encryptDingerPayPayloadBase64,
    DINGER_RSA_SEGMENT_BYTES
} = require("../services/dinger/dingerCryptoService");

function encryptLocalVector(plaintext, key) {
    const cipher = crypto.createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
}

(() => {
    const key = Buffer.from("0123456789abcdef", "utf8");
    const plaintext = '{"transactionStatus":"SUCCESS","totalAmount":1000}';
    const encryptedBase64 = encryptLocalVector(plaintext, key);
    assert.strictEqual(decryptAesEcbPkcs7({ encryptedBase64, keyBytes: key }), plaintext);

    const checksum = calculateSha256(plaintext);
    assert.strictEqual(verifySha256({ exactJsonText: plaintext, checksum }), true);
    assert.strictEqual(verifySha256({ exactJsonText: `${plaintext} `, checksum }), false, "checksum must preserve exact text semantics");

    assert.throws(() => decryptAesEcbPkcs7({ encryptedBase64: "not-base64", keyBytes: key }), error => error instanceof DingerCryptoError && error.code === "DINGER_CRYPTO_INVALID_BASE64");
    assert.throws(() => decryptAesEcbPkcs7({ encryptedBase64, keyBytes: Buffer.from("short") }), error => error instanceof DingerCryptoError && error.code === "DINGER_CRYPTO_INVALID_KEY");
    const corrupt = Buffer.from(encryptedBase64, "base64");
    corrupt[corrupt.length - 1] ^= 0xff;
    assert.throws(() => decryptAesEcbPkcs7({ encryptedBase64: corrupt.toString("base64"), keyBytes: key }), error => error instanceof DingerCryptoError && error.code === "DINGER_CRYPTO_DECRYPTION_FAILED");

    assert.throws(() => verifyCallbackChecksum({ exactJsonText: plaintext, checksum }), error => error.code === "DINGER_PROTOCOL_UNCONFIRMED");

    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    assert(publicKey.startsWith("-----BEGIN PUBLIC KEY-----"), "test vector must use documented PUBLIC KEY format");
    const rsaCiphertext = encryptRsaRequestBase64({ plaintext, publicKey });
    const decryptedRequest = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(rsaCiphertext, "base64")).toString("utf8");
    assert.strictEqual(decryptedRequest, plaintext, "RSA request encryption must use PKCS#1 v1.5 padding");
    assert.throws(() => encryptRsaRequestBase64({ plaintext, publicKey: "invalid" }), error => error.code === "DINGER_CRYPTO_INVALID_KEY");

    const segmentedKeys = crypto.generateKeyPairSync("rsa", {
        modulusLength: 1024,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const publicDerBase64 = crypto.createPublicKey(segmentedKeys.publicKey).export({ type: "spki", format: "der" }).toString("base64");
    const decryptSegments = ciphertextBase64 => {
        const ciphertext = Buffer.from(ciphertextBase64, "base64");
        assert.strictEqual(ciphertext.length % 128, 0, "1024-bit RSA ciphertext must contain complete 128-byte blocks");
        const blocks = [];
        for (let offset = 0; offset < ciphertext.length; offset += 128) {
            blocks.push(crypto.privateDecrypt({ key: segmentedKeys.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, ciphertext.subarray(offset, offset + 128)));
        }
        return Buffer.concat(blocks);
    };
    const exactByteString = length => "x".repeat(length);
    for (const byteLength of [1, 64, 65, 117, 118, 193, 270]) {
        const value = exactByteString(byteLength);
        const encrypted = encryptDingerPayPayloadBase64({ plaintext: value, publicKey: publicDerBase64 });
        assert.strictEqual(Buffer.from(encrypted, "base64").length, Math.ceil(byteLength / DINGER_RSA_SEGMENT_BYTES) * 128);
        assert.deepStrictEqual(decryptSegments(encrypted), Buffer.from(value, "utf8"), `segmented round trip failed for ${byteLength} bytes`);
    }
    const ordered = Array.from({ length: 193 }, (_, index) => String.fromCharCode(33 + (index % 90))).join("");
    assert.deepStrictEqual(decryptSegments(encryptDingerPayPayloadBase64({ plaintext: ordered, publicKey: segmentedKeys.publicKey })), Buffer.from(ordered, "utf8"), "ciphertext blocks must preserve plaintext chunk order");
    const multibyte = "မြန်မာ-日本語-é-🙂".repeat(12);
    assert(Buffer.byteLength(multibyte, "utf8") > DINGER_RSA_SEGMENT_BYTES);
    assert.deepStrictEqual(decryptSegments(encryptDingerPayPayloadBase64({ plaintext: multibyte, publicKey: segmentedKeys.publicKey })), Buffer.from(multibyte, "utf8"), "segmentation must operate on UTF-8 bytes");
    assert.throws(() => encryptDingerPayPayloadBase64({ plaintext: "test", publicKey: "invalid" }), error => error.code === "DINGER_CRYPTO_INVALID_KEY");
    assert.throws(() => encryptDingerPayPayloadBase64({ plaintext: "test", publicKey: Buffer.from("not-spki").toString("base64") }), error => error.code === "DINGER_CRYPTO_INVALID_KEY");

    console.log("Dinger single-block and documented 64-byte segmented RSA PKCS#1 v1.5 verification passed; callback checksum canonicalization remains intentionally unverified.");
})();
