"use strict";

const { createDingerApiClient } = require("../services/dinger/dingerApiClient");
const { encryptDingerPayPayloadBase64 } = require("../services/dinger/dingerCryptoService");

const MIN_AMOUNT_MMK = 500;
const MAX_AMOUNT_MMK = 10000;
const PAY_CONFIRMATION = "I_CONFIRM_DINGER_REAL_MONEY_TEST";
const DINGER_PRODUCTION_TIMESTAMP_UTC_OFFSET_MINUTES = 390;
const DOCUMENTED_PAY_FIELDS = Object.freeze({
    totalAmount: "number",
    createdAt: "string",
    transactionStatus: "string",
    methodName: "string",
    merchantOrderId: "string",
    transactionId: "string",
    customerName: "string",
    providerName: "string"
});
const SAFE_STRUCTURAL_FIELDS = new Set([
    "code", "response", "data", "status", "transactionStatus", "totalAmount", "createdAt",
    "methodName", "merchantOrderId", "merchOrderId", "orderId", "transactionId",
    "transactionNum", "providerName", "amount", "currency", "errorCode"
]);
const DOCUMENTED_TRANSACTION_STATUSES = new Set(["SUCCESS", "ERROR", "CANCELLED", "TIMEOUT", "DECLINED", "SYSTEM_ERROR"]);

function text(value) { return String(value || "").trim(); }
function requireValues(env, names) {
    const missing = names.filter(name => !text(env[name]));
    if (missing.length) throw Object.assign(new Error("Required production-test configuration is missing."), { code: "DINGER_PRODUCTION_PROBE_CONFIG_MISSING", missing });
}
function exactHttpsUrl(value, field) {
    try {
        const url = new URL(text(value));
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("unsafe");
        return url.toString();
    } catch (_) {
        throw Object.assign(new Error(`${field} must be an exact HTTPS endpoint supplied by Dinger; no path is inferred.`), { code: "DINGER_PRODUCTION_ENDPOINT_UNCONFIRMED", field });
    }
}
function productionProbeConfiguration(env = process.env, options = {}) {
    const allowPay = text(env.DINGER_PRODUCTION_TEST_ALLOW_PAY).toLowerCase() === "true";
    requireValues(env, [
        "DINGER_PRODUCTION_TEST_TOKEN_URL", "DINGER_PRODUCTION_TEST_PROJECT_NAME",
        "DINGER_PRODUCTION_TEST_API_KEY", "DINGER_PRODUCTION_TEST_MERCHANT_NAME"
    ]);
    const configuration = {
        enabled: true,
        environment: "LIVE",
        tokenUrl: exactHttpsUrl(env.DINGER_PRODUCTION_TEST_TOKEN_URL, "DINGER_PRODUCTION_TEST_TOKEN_URL"),
        projectName: text(env.DINGER_PRODUCTION_TEST_PROJECT_NAME),
        apiKey: text(env.DINGER_PRODUCTION_TEST_API_KEY),
        merchantName: text(env.DINGER_PRODUCTION_TEST_MERCHANT_NAME),
        tokenTimestampUtcOffsetMinutes: DINGER_PRODUCTION_TIMESTAMP_UTC_OFFSET_MINUTES,
        tokenTimeoutMs: 10000,
        payTimeoutMs: 15000
    };
    if (!allowPay) return Object.freeze({ mode: "TOKEN_ONLY", configuration: Object.freeze(configuration) });
    if (text(env.DINGER_PRODUCTION_TEST_REAL_MONEY_CONFIRMATION) !== PAY_CONFIRMATION) {
        throw Object.assign(new Error("Real-money confirmation is missing."), { code: "DINGER_PRODUCTION_REAL_MONEY_CONFIRMATION_REQUIRED" });
    }
    requireValues(env, [
        "DINGER_PRODUCTION_TEST_PAY_URL", "DINGER_PRODUCTION_TEST_PUBLIC_KEY",
        "DINGER_PRODUCTION_TEST_AMOUNT", "DINGER_PRODUCTION_TEST_ORDER_ID",
        "DINGER_PRODUCTION_TEST_CUSTOMER_PHONE", "DINGER_PRODUCTION_TEST_CUSTOMER_NAME"
    ]);
    const amount = Number(env.DINGER_PRODUCTION_TEST_AMOUNT);
    if (!Number.isSafeInteger(amount) || amount < MIN_AMOUNT_MMK || amount > MAX_AMOUNT_MMK) {
        throw Object.assign(new Error("Production-test amount must be an integer from 500 to 10,000 MMK."), { code: "DINGER_PRODUCTION_AMOUNT_INVALID" });
    }
    const orderId = text(env.DINGER_PRODUCTION_TEST_ORDER_ID);
    if (!/^DINGERTEST-[A-Za-z0-9._-]+$/.test(orderId) || orderId.length > 50) {
        throw Object.assign(new Error("Production-test order ID must be a valid DINGERTEST- identifier of at most 50 characters."), { code: "DINGER_PRODUCTION_ORDER_ID_INVALID" });
    }
    configuration.payUrl = exactHttpsUrl(env.DINGER_PRODUCTION_TEST_PAY_URL, "DINGER_PRODUCTION_TEST_PAY_URL");
    configuration.publicKey = text(env.DINGER_PRODUCTION_TEST_PUBLIC_KEY).replace(/\\n/g, "\n");
    return Object.freeze({
        mode: "PAY",
        configuration: Object.freeze(configuration),
        payment: Object.freeze({ amount, orderId, customerPhone: text(env.DINGER_PRODUCTION_TEST_CUSTOMER_PHONE), customerName: text(env.DINGER_PRODUCTION_TEST_CUSTOMER_NAME) })
    });
}
function fieldType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}
function safeObjectShape(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({ fields: [], excludedFieldCount: 0 });
    const names = Object.keys(value);
    const fields = names.filter(name => SAFE_STRUCTURAL_FIELDS.has(name)).sort().map(name => Object.freeze({ name, type: fieldType(value[name]), present: true }));
    return Object.freeze({ fields: Object.freeze(fields), excludedFieldCount: names.length - fields.length });
}
function documentedPayResponse(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    if (!Object.entries(DOCUMENTED_PAY_FIELDS).every(([field, expectedType]) => Object.prototype.hasOwnProperty.call(parsed, field) && fieldType(parsed[field]) === expectedType)) return false;
    if (!Number.isSafeInteger(parsed.totalAmount) || parsed.totalAmount < 0) return false;
    if (!/^\d{8} \d{6}$/.test(parsed.createdAt)) return false;
    if (!DOCUMENTED_TRANSACTION_STATUSES.has(text(parsed.transactionStatus).toUpperCase())) return false;
    return ["methodName", "merchantOrderId", "transactionId", "customerName", "providerName"].every(field => Boolean(text(parsed[field])));
}
function classifyPayResponse(parsed, responseContext = {}) {
    const context = {
        httpStatus: Number(responseContext.httpStatus || 0),
        bodyNonempty: responseContext.bodyNonempty === true,
        jsonParsed: responseContext.jsonParsed === true
    };
    if (documentedPayResponse(parsed)) {
        return Object.freeze({
            classification: "DOCUMENTED_PAY_RESPONSE",
            paymentStatus: "UNCONFIRMED",
            qrCreationStatus: "UNCONFIRMED",
            ...context
        });
    }
    const topLevel = safeObjectShape(parsed);
    const nested = [];
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const parent of ["response", "data"]) {
            if (parsed[parent] && typeof parsed[parent] === "object" && !Array.isArray(parsed[parent])) {
                nested.push(Object.freeze({ parent, ...safeObjectShape(parsed[parent]) }));
            }
        }
    }
    return Object.freeze({
        classification: "UNKNOWN_HTTP_SUCCESS",
        paymentStatus: "UNCONFIRMED",
        qrCreationStatus: "UNCONFIRMED",
        ...context,
        topLevel,
        nested: Object.freeze(nested)
    });
}
function failureClassification(error) {
    if (error?.stage === "pay" && error?.code === "DINGER_HTTP_ERROR") return "HTTP_REJECTION";
    if (error?.stage === "pay" && error?.submissionUncertain === true) return "SUBMISSION_UNCERTAIN";
    return "PROBE_FAILURE";
}
function reportError(error, logger = console) {
    logger.error("Dinger production probe: FAIL");
    logger.error(`responseClassification: ${failureClassification(error)}`);
    logger.error(`errorCode: ${text(error?.code || error?.name || "DINGER_PRODUCTION_PROBE_FAILED")}`);
    logger.error(`errorStage: ${text(error?.stage || "probe")}`);
    if (error?.httpStatus) logger.error(`httpStatus: ${Number(error.httpStatus)}`);
    if (error?.submissionUncertain === true) logger.error("submissionUncertain: true (do not retry automatically)");
    if (Array.isArray(error?.missing)) logger.error(`missingConfiguration: ${error.missing.join(",")}`);
    const diagnostics = error?.safeDiagnostics;
    if (diagnostics && typeof diagnostics === "object") {
        logger.error(`failureCategory: ${text(error.failureCategory || "UNCLASSIFIED")}`);
        logger.error(`httpStatus: ${Number(diagnostics.httpStatus || 0)}`);
        logger.error(`bodyNonempty: ${diagnostics.bodyNonempty === true}`);
        logger.error(`jsonParsed: ${diagnostics.jsonParsed === true}`);
        logger.error(`providerCode: ${text(diagnostics.providerCode || "[ABSENT]")}`);
        logger.error(`codePresent: ${diagnostics.codePresent === true}`);
        logger.error(`messagePresent: ${diagnostics.messagePresent === true}`);
        logger.error(`responsePresent: ${diagnostics.responsePresent === true}`);
        logger.error(`paymentTokenPresent: ${diagnostics.paymentTokenPresent === true}`);
        logger.error(`expireInPresent: ${diagnostics.expireInPresent === true}`);
    }
}
async function runProductionProbe(options = {}) {
    const env = options.env || process.env;
    const logger = options.logger || console;
    const probe = productionProbeConfiguration(env);
    const client = createDingerApiClient({
        configuration: probe.configuration,
        fetchImpl: options.fetchImpl,
        encryptRequest: plaintext => encryptDingerPayPayloadBase64({ plaintext, publicKey: probe.configuration.publicKey }),
        parsePayResponse: (parsed, responseContext) => classifyPayResponse(parsed, responseContext)
    });
    if (probe.mode === "TOKEN_ONLY") {
        await client.getToken();
        logger.log("Dinger production token probe: PASS");
        logger.log("mode: TOKEN_ONLY");
        logger.log("paymentToken: [REDACTED]");
        return { mode: probe.mode };
    }
    const result = await client.createPayment({
        providerName: "AYA Pay",
        methodName: "QR",
        totalAmount: probe.payment.amount,
        orderId: probe.payment.orderId,
        customerPhone: probe.payment.customerPhone,
        customerName: probe.payment.customerName,
        items: [{ name: "Dinger controlled production test", quantity: 1, amount: probe.payment.amount }],
        currency: "MMK"
    });
    logger.log("Dinger controlled production Pay probe: RESPONSE RECEIVED; PAYMENT AND QR STATUS UNCONFIRMED");
    logger.log("provider: AYA Pay");
    logger.log("method: QR");
    logger.log(`responseShape: ${JSON.stringify(result)}`);
    return { mode: probe.mode, responseShape: result };
}

if (require.main === module) {
    runProductionProbe().catch(error => {
        reportError(error);
        process.exitCode = 1;
    });
}

module.exports = Object.freeze({
    MIN_AMOUNT_MMK,
    MAX_AMOUNT_MMK,
    PAY_CONFIRMATION,
    productionProbeConfiguration,
    classifyPayResponse,
    failureClassification,
    reportError,
    runProductionProbe
});
