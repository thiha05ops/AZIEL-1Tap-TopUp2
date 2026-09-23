"use strict";

const { parseDingerTimestamp } = require("./dingerApiClient");

const TRANSACTION_STATUSES = Object.freeze(["SUCCESS", "ERROR", "CANCELLED", "TIMEOUT", "DECLINED", "SYSTEM_ERROR"]);

class DingerCallbackContractError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "DingerCallbackContractError";
        this.code = code;
        this.stage = options.stage || "callback_contract";
        this.field = options.field || "";
    }
}

function text(value) { return String(value || "").trim(); }
function invalid(field, message) { return new DingerCallbackContractError("DINGER_CALLBACK_RESULT_INVALID", message, { field }); }

function parseDingerCallbackResult(input) {
    let value = input;
    if (typeof input === "string") {
        try { value = JSON.parse(input); } catch (_) { throw invalid("paymentResult", "Decrypted Dinger callback result must be valid JSON."); }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("paymentResult", "Decrypted Dinger callback result must be an object.");
    const totalAmount = Number(value.totalAmount);
    const transactionStatus = text(value.transactionStatus).toUpperCase();
    const methodName = text(value.methodName);
    const merchantOrderId = text(value.merchantOrderId);
    const transactionId = text(value.transactionId);
    const providerName = text(value.providerName);
    const customerName = text(value.customerName);
    if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) throw invalid("totalAmount", "Dinger callback totalAmount must be a non-negative integer.");
    if (!TRANSACTION_STATUSES.includes(transactionStatus)) throw invalid("transactionStatus", "Dinger callback transactionStatus is unsupported.");
    if (!methodName) throw invalid("methodName", "Dinger callback methodName is required.");
    if (!merchantOrderId) throw invalid("merchantOrderId", "Dinger callback merchantOrderId is required.");
    if (!transactionId) throw invalid("transactionId", "Dinger callback transactionId is required.");
    if (!providerName) throw invalid("providerName", "Dinger callback providerName is required.");
    if (!customerName) throw invalid("customerName", "Dinger callback customerName is required.");
    let createdAt;
    try { createdAt = parseDingerTimestamp(value.createdAt, "callback.createdAt"); }
    catch (_) { throw invalid("createdAt", "Dinger callback createdAt must use a valid yyyyMMdd HHmmss value."); }
    return Object.freeze({
        totalAmount,
        createdAt: createdAt.raw,
        transactionStatus,
        methodName,
        merchantOrderId,
        transactionId,
        customerName,
        providerName
    });
}

module.exports = Object.freeze({ TRANSACTION_STATUSES, DingerCallbackContractError, parseDingerCallbackResult });
