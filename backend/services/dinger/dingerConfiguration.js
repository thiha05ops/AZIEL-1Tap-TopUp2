"use strict";

const { dingerRsaPublicKey } = require("./dingerCryptoService");

const ENVIRONMENT = Object.freeze({ STAGING: "STAGING", LIVE: "LIVE" });
const ENV_NAMES = Object.freeze([
    "DINGER_ENVIRONMENT", "DINGER_STAGING_BASE_URL", "DINGER_LIVE_BASE_URL",
    "DINGER_STAGING_PROJECT_NAME", "DINGER_STAGING_API_KEY", "DINGER_STAGING_MERCHANT_NAME",
    "DINGER_STAGING_PUBLIC_KEY", "DINGER_STAGING_CALLBACK_KEY", "DINGER_STAGING_CALLBACK_URL",
    "DINGER_LIVE_PROJECT_NAME", "DINGER_LIVE_API_KEY", "DINGER_LIVE_MERCHANT_NAME",
    "DINGER_LIVE_PUBLIC_KEY", "DINGER_LIVE_CALLBACK_KEY", "DINGER_LIVE_CALLBACK_URL",
    "DINGER_TOKEN_TIMEOUT_MS", "DINGER_PAY_TIMEOUT_MS", "DINGER_TOKEN_TIMESTAMP_UTC_OFFSET_MINUTES", "DINGER_ENABLED",
    "DINGER_LIVE_TOKEN_URL", "DINGER_LIVE_PAY_URL", "DINGER_LIVE_WAVE_FORM_URL",
    "DINGER_LIVE_PAY_REQUEST_CONTRACT_CONFIRMED", "DINGER_LIVE_AYA_QR_RESPONSE_CONTRACT_CONFIRMED",
    "DINGER_LIVE_WAVE_REDIRECT_CONTRACT_CONFIRMED", "DINGER_LIVE_CALLBACK_VERIFICATION_CONTRACT_CONFIRMED",
    "DINGER_LIVE_PUBLIC_KEY_IDENTITY_CONFIRMED", "DINGER_LIVE_PAY_RESPONSE_SIGNATURE_CONTRACT_CONFIRMED",
    "DINGER_LIVE_CALLBACK_SETTLEMENT_ENABLED"
]);

class DingerConfigurationError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "DingerConfigurationError";
        this.code = code;
        this.stage = options.stage || "configuration";
        this.metadata = Object.freeze({ ...(options.metadata || {}) });
    }
}

function text(value) { return String(value || "").trim(); }
function enabled(value) { return String(value || "").trim().toLowerCase() === "true"; }
function timeout(value, fallback) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1000 && parsed <= 60000 ? parsed : fallback;
}
function validHttpsUrl(value) {
    try { return new URL(value).protocol === "https:"; } catch (_) { return false; }
}
function validPublicKey(value) {
    try { dingerRsaPublicKey(value); return true; } catch (_) { return false; }
}

function integer(value, fallback) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function scopedValue(env, environment, name) {
    return text(env[`DINGER_${environment}_${name}`]);
}

function inspectDingerEnvironment(env = process.env) {
    const environment = text(env.DINGER_ENVIRONMENT || ENVIRONMENT.STAGING).toUpperCase();
    const environmentValid = Object.values(ENVIRONMENT).includes(environment);
    const selectedBaseUrl = environment === ENVIRONMENT.LIVE
        ? text(env.DINGER_LIVE_BASE_URL)
        : text(env.DINGER_STAGING_BASE_URL);
    const live = environment === ENVIRONMENT.LIVE;
    const required = {
        baseUrl: validHttpsUrl(selectedBaseUrl),
        tokenUrl: !live || validHttpsUrl(scopedValue(env, environment, "TOKEN_URL")),
        payUrl: !live || validHttpsUrl(scopedValue(env, environment, "PAY_URL")),
        projectName: Boolean(scopedValue(env, environment, "PROJECT_NAME")),
        apiKey: Boolean(scopedValue(env, environment, "API_KEY")),
        merchantName: Boolean(scopedValue(env, environment, "MERCHANT_NAME")),
        publicKey: validPublicKey(scopedValue(env, environment, "PUBLIC_KEY")),
        callbackKey: Boolean(scopedValue(env, environment, "CALLBACK_KEY")),
        callbackUrl: validHttpsUrl(scopedValue(env, environment, "CALLBACK_URL"))
    };
    const missing = Object.entries(required).filter(([, present]) => !present).map(([field]) => field);
    if (!environmentValid) missing.unshift("environment");
    return Object.freeze({
        environment: environmentValid ? environment : ENVIRONMENT.STAGING,
        enabled: enabled(env.DINGER_ENABLED),
        configured: missing.length === 0,
        missing: Object.freeze(missing),
        publicKeyConfigured: required.publicKey,
        apiKeyConfigured: required.apiKey,
        callbackKeyConfigured: required.callbackKey,
        merchantConfigured: required.projectName && required.merchantName,
        callbackUrlConfigured: required.callbackUrl
    });
}

function loadDingerConfiguration(env = process.env) {
    const readiness = inspectDingerEnvironment(env);
    if (readiness.enabled && !readiness.configured) {
        throw new DingerConfigurationError("DINGER_CONFIGURATION_INVALID", "Dinger configuration is incomplete.", {
            metadata: { missing: readiness.missing }
        });
    }
    const baseUrl = readiness.environment === ENVIRONMENT.LIVE
        ? text(env.DINGER_LIVE_BASE_URL)
        : text(env.DINGER_STAGING_BASE_URL);
    return Object.freeze({
        enabled: readiness.enabled,
        environment: readiness.environment,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        projectName: scopedValue(env, readiness.environment, "PROJECT_NAME"),
        apiKey: scopedValue(env, readiness.environment, "API_KEY"),
        merchantName: scopedValue(env, readiness.environment, "MERCHANT_NAME"),
        publicKey: scopedValue(env, readiness.environment, "PUBLIC_KEY"),
        callbackKey: scopedValue(env, readiness.environment, "CALLBACK_KEY"),
        callbackUrl: scopedValue(env, readiness.environment, "CALLBACK_URL"),
        tokenUrl: scopedValue(env, readiness.environment, "TOKEN_URL"),
        payUrl: scopedValue(env, readiness.environment, "PAY_URL"),
        waveFormUrl: scopedValue(env, readiness.environment, "WAVE_FORM_URL"),
        tokenTimestampUtcOffsetMinutes: integer(env.DINGER_TOKEN_TIMESTAMP_UTC_OFFSET_MINUTES, 390),
        tokenTimeoutMs: timeout(env.DINGER_TOKEN_TIMEOUT_MS, 10000),
        payTimeoutMs: timeout(env.DINGER_PAY_TIMEOUT_MS, 15000),
        requestEncryptionVerified: true,
        payRequestContractConfirmed: enabled(env.DINGER_LIVE_PAY_REQUEST_CONTRACT_CONFIRMED),
        ayaQrResponseContractConfirmed: enabled(env.DINGER_LIVE_AYA_QR_RESPONSE_CONTRACT_CONFIRMED),
        waveRedirectContractConfirmed: enabled(env.DINGER_LIVE_WAVE_REDIRECT_CONTRACT_CONFIRMED),
        callbackChecksumVerified: enabled(env.DINGER_LIVE_CALLBACK_VERIFICATION_CONTRACT_CONFIRMED),
        callbackSettlementEnabled: enabled(env.DINGER_LIVE_CALLBACK_SETTLEMENT_ENABLED)
    });
}

module.exports = Object.freeze({
    ENVIRONMENT,
    ENV_NAMES,
    DingerConfigurationError,
    inspectDingerEnvironment,
    loadDingerConfiguration
});
