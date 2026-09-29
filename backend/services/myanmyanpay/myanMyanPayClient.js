"use strict";

const crypto = require("crypto");
const { MMPaySDK } = require("mmpay-node-sdk");

function text(value) { return String(value || "").trim(); }
function clientError(code, message, httpStatus = 502) { return Object.assign(new Error(message), { code, httpStatus }); }

function createMyanMyanPayClient(configuration, options = {}) {
    const sdk = options.sdk || MMPaySDK({
        appId: configuration.appId,
        publishableKey: configuration.publishableKey,
        secretKey: configuration.secretKey,
        apiBaseUrl: configuration.apiBaseUrl
    });

    async function pay(payload) {
        const response = await sdk.pay(payload);
        if (!response || typeof response !== "object" || response.status !== "PENDING" || !text(response.orderId) || !text(response.qr)) {
            throw clientError("MYANMYANPAY_CREATE_RESPONSE_INVALID", "MyanMyanPay returned an invalid payment response.");
        }
        return response;
    }

    async function verifyAndListen(payload, nonce, signature) {
        const expected = text(sdk._generateSignature(payload, nonce));
        const supplied = text(signature);
        const expectedBuffer = Buffer.from(expected, "utf8");
        const suppliedBuffer = Buffer.from(supplied, "utf8");
        if (!nonce || !supplied || expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
            throw clientError("MYANMYANPAY_CALLBACK_SIGNATURE_INVALID", "MyanMyanPay callback authentication failed.", 401);
        }
        let verified = false;
        const mark = () => { verified = true; };
        sdk.once("tx:create", mark).once("tx:success", mark).once("tx:failed", mark).once("tx:refunded", mark)
            .once("tx:cancel", mark).once("tx:expire", mark).once("tx:heartbeat", mark).once("tx:unknown", mark);
        sdk.once("error", () => {});
        await sdk.listen(payload, nonce, supplied);
        if (!verified) throw clientError("MYANMYANPAY_CALLBACK_VERIFICATION_FAILED", "MyanMyanPay callback verification failed.", 401);
        return JSON.parse(payload);
    }

    return Object.freeze({ pay, get: input => sdk.get(input), cancel: input => sdk.cancel(input), verifyAndListen });
}

module.exports = Object.freeze({ createMyanMyanPayClient });
