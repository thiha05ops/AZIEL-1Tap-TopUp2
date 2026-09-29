"use strict";

const ENVIRONMENT = "SANDBOX";
const CALLBACK_URL = "https://azielplay.com/api/webhooks/myanmyanpay/payment";

class MyanMyanPayConfigurationError extends Error {
    constructor(code, message, metadata = {}) { super(message); this.name = "MyanMyanPayConfigurationError"; this.code = code; this.metadata = Object.freeze({ ...metadata }); }
}

const text = value => String(value || "").trim();
const enabled = value => text(value).toLowerCase() === "true";
function httpsUrl(value) { try { return new URL(value).protocol === "https:"; } catch { return false; } }

function inspectMyanMyanPayConfiguration(env = process.env) {
    const required = {
        appId: Boolean(text(env.MYANMYANPAY_SANDBOX_APP_ID)),
        publishableKey: Boolean(text(env.MYANMYANPAY_SANDBOX_PUBLISHABLE_KEY)),
        secretKey: Boolean(text(env.MYANMYANPAY_SANDBOX_SECRET_KEY)),
        apiBaseUrl: httpsUrl(text(env.MYANMYANPAY_SANDBOX_API_BASE_URL))
    };
    return Object.freeze({
        environment: ENVIRONMENT,
        appIdConfigured: required.appId,
        publishableKeyConfigured: required.publishableKey,
        secretKeyConfigured: required.secretKey,
        apiBaseUrlConfigured: required.apiBaseUrl,
        enabled: Object.values(required).every(Boolean),
        configured: Object.values(required).every(Boolean),
        missing: Object.entries(required).filter(([, present]) => !present).map(([name]) => name),
        callbackUrl: CALLBACK_URL
    });
}

function loadMyanMyanPayConfiguration(env = process.env) {
    const readiness = inspectMyanMyanPayConfiguration(env);
    if (!readiness.configured) throw new MyanMyanPayConfigurationError(
        "MYANMYANPAY_SANDBOX_CONFIGURATION_INVALID",
        "MyanMyanPay sandbox is disabled or incomplete.",
        { missing: readiness.missing }
    );
    return Object.freeze({
        environment: ENVIRONMENT,
        enabled: true,
        appId: text(env.MYANMYANPAY_SANDBOX_APP_ID),
        publishableKey: text(env.MYANMYANPAY_SANDBOX_PUBLISHABLE_KEY),
        secretKey: text(env.MYANMYANPAY_SANDBOX_SECRET_KEY),
        apiBaseUrl: text(env.MYANMYANPAY_SANDBOX_API_BASE_URL).replace(/\/+$/, ""),
        callbackUrl: CALLBACK_URL
    });
}

module.exports = Object.freeze({ ENVIRONMENT, CALLBACK_URL, MyanMyanPayConfigurationError, inspectMyanMyanPayConfiguration, loadMyanMyanPayConfiguration });
