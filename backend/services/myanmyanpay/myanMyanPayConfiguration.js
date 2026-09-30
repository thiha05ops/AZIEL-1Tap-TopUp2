"use strict";

const ENVIRONMENTS = Object.freeze({ SANDBOX: "SANDBOX", PRODUCTION: "PRODUCTION" });
const ENVIRONMENT = ENVIRONMENTS.SANDBOX;
const CALLBACK_URL = "https://azielplay.com/api/webhooks/myanmyanpay/payment";
const SANDBOX_API_BASE_URL = "https://ezapi.myanmyanpay.com";
const PRODUCTION_API_BASE_URL = "https://api.myanmyanpay.com";
const API_BASE_URL = SANDBOX_API_BASE_URL;

class MyanMyanPayConfigurationError extends Error {
    constructor(code, message, metadata = {}) { super(message); this.name = "MyanMyanPayConfigurationError"; this.code = code; this.metadata = Object.freeze({ ...metadata }); }
}

const text = value => String(value || "").trim();
function normalizeEnvironment(value, fallback = ENVIRONMENTS.SANDBOX) {
    const normalized = text(value).toUpperCase();
    return Object.values(ENVIRONMENTS).includes(normalized) ? normalized : fallback;
}
function selectedEnvironment(env = process.env) {
    const supplied = text(env.MYANMYANPAY_ENVIRONMENT);
    return supplied ? normalizeEnvironment(supplied, "") : ENVIRONMENTS.SANDBOX;
}
function exactApiBaseUrl(value, environment) { return text(value) === (environment === ENVIRONMENTS.PRODUCTION ? PRODUCTION_API_BASE_URL : SANDBOX_API_BASE_URL); }
function credentialMatches(value, kind, environment) {
    const marker = environment === ENVIRONMENTS.PRODUCTION ? "live" : "test";
    return new RegExp(`^${kind}_${marker}_[A-Za-z0-9._-]+$`).test(text(value));
}
function variableNames(environment) {
    const prefix = environment === ENVIRONMENTS.PRODUCTION ? "MYANMYANPAY_PRODUCTION" : "MYANMYANPAY_SANDBOX";
    return Object.freeze({ appId: `${prefix}_APP_ID`, publishableKey: `${prefix}_PUBLISHABLE_KEY`, secretKey: `${prefix}_SECRET_KEY`, apiBaseUrl: `${prefix}_API_BASE_URL` });
}

function inspectMyanMyanPayConfiguration(env = process.env, options = {}) {
    const environment = options.environment ? normalizeEnvironment(options.environment, "") : selectedEnvironment(env);
    const environmentValid = Object.values(ENVIRONMENTS).includes(environment);
    const names = variableNames(environment);
    const required = {
        appId: Boolean(text(env[names.appId])),
        publishableKey: credentialMatches(env[names.publishableKey], "pk", environment),
        secretKey: credentialMatches(env[names.secretKey], "sk", environment),
        apiBaseUrl: exactApiBaseUrl(env[names.apiBaseUrl], environment)
    };
    const configured = environmentValid && Object.values(required).every(Boolean);
    return Object.freeze({
        environment,
        environmentValid,
        selectedEnvironment: selectedEnvironment(env),
        appIdConfigured: required.appId,
        publishableKeyConfigured: required.publishableKey,
        secretKeyConfigured: required.secretKey,
        apiBaseUrlConfigured: required.apiBaseUrl,
        credentialStructureValid: required.publishableKey && required.secretKey,
        apiContractConfigured: required.apiBaseUrl,
        enabled: configured,
        configured,
        missing: [...(!environmentValid ? ["environment"] : []), ...Object.entries(required).filter(([, present]) => !present).map(([name]) => name)],
        callbackUrl: CALLBACK_URL
    });
}

function inspectMyanMyanPayEnvironments(env = process.env) {
    return Object.freeze({
        selectedEnvironment: selectedEnvironment(env),
        sandbox: inspectMyanMyanPayConfiguration(env, { environment: ENVIRONMENTS.SANDBOX }),
        production: inspectMyanMyanPayConfiguration(env, { environment: ENVIRONMENTS.PRODUCTION })
    });
}

function loadMyanMyanPayConfiguration(env = process.env, options = {}) {
    const environment = options.environment ? normalizeEnvironment(options.environment, "") : selectedEnvironment(env);
    const readiness = inspectMyanMyanPayConfiguration(env, { environment });
    if (!readiness.configured) throw new MyanMyanPayConfigurationError(
        `MYANMYANPAY_${environment}_CONFIGURATION_INVALID`,
        `MyanMyanPay ${environment.toLowerCase()} configuration is disabled or incomplete.`,
        { environment, missing: readiness.missing }
    );
    const names = variableNames(environment);
    return Object.freeze({
        environment,
        enabled: true,
        appId: text(env[names.appId]),
        publishableKey: text(env[names.publishableKey]),
        secretKey: text(env[names.secretKey]),
        apiBaseUrl: environment === ENVIRONMENTS.PRODUCTION ? PRODUCTION_API_BASE_URL : SANDBOX_API_BASE_URL,
        callbackUrl: CALLBACK_URL
    });
}

module.exports = Object.freeze({
    ENVIRONMENT, ENVIRONMENTS, CALLBACK_URL, API_BASE_URL, SANDBOX_API_BASE_URL, PRODUCTION_API_BASE_URL,
    MyanMyanPayConfigurationError, normalizeEnvironment, selectedEnvironment, exactApiBaseUrl,
    inspectMyanMyanPayConfiguration, inspectMyanMyanPayEnvironments, loadMyanMyanPayConfiguration
});
