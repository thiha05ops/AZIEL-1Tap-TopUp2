"use strict";

const { inspectDingerEnvironment } = require("./dingerConfiguration");

const DINGER_PROVIDER = "dinger";
const DINGER_METHODS = Object.freeze({
    dinger_ayapay_qr: Object.freeze({ providerName: "AYA Pay", methodName: "QR", presentation: "QR" }),
    dinger_wavepay_pin: Object.freeze({ providerName: "Wave Pay", methodName: "PIN", presentation: "REDIRECT" })
});
const ACTIVATION_STATES = Object.freeze({ DISABLED: "DISABLED", TEST_ONLY: "TEST_ONLY", PUBLIC: "PUBLIC" });

function text(value) { return String(value || "").trim(); }
function truthy(value) { return value === true || text(value).toLowerCase() === "true"; }
function methodKey(method = {}) { return text(method.key || method.paymentMethodId).toLowerCase(); }
function isDingerMethod(method = {}) { return Object.prototype.hasOwnProperty.call(DINGER_METHODS, methodKey(method)); }
function authenticatedUserId(user = {}) { return text(user.id || user._id || user.userId); }

function authorizedTestUser(method = {}, user = {}) {
    const id = authenticatedUserId(user);
    if (!id) return false;
    return Array.isArray(method.dingerAuthorizedTestUserIds) && method.dingerAuthorizedTestUserIds.some(value => text(value) === id);
}

function dingerTechnicalReadiness(method = {}, env = process.env) {
    const key = methodKey(method);
    const config = inspectDingerEnvironment(env);
    const common = config.enabled === true && config.configured === true && config.environment === "LIVE";
    const payUrlConfirmed = text(env.DINGER_LIVE_PAY_URL) === "https://api.dinger.asia/api/pay";
    const waveFormUrlConfirmed = key !== "dinger_wavepay_pin" || text(env.DINGER_LIVE_WAVE_FORM_URL) === "https://portal.dinger.asia/gateway/redirect";
    const callbackUrlConfirmed = text(env.DINGER_LIVE_CALLBACK_URL) === "https://azielplay.com/api/webhooks/dinger/payment";
    const publicKeyIdentityConfirmed = truthy(env.DINGER_LIVE_PUBLIC_KEY_IDENTITY_CONFIRMED);
    const requestContract = truthy(env.DINGER_LIVE_PAY_REQUEST_CONTRACT_CONFIRMED);
    const responseContract = key === "dinger_ayapay_qr"
        ? truthy(env.DINGER_LIVE_AYA_QR_RESPONSE_CONTRACT_CONFIRMED)
        : truthy(env.DINGER_LIVE_WAVE_REDIRECT_CONTRACT_CONFIRMED);
    const callbackContract = truthy(env.DINGER_LIVE_CALLBACK_VERIFICATION_CONTRACT_CONFIRMED);
    const callbackSettlementEnabled = truthy(env.DINGER_LIVE_CALLBACK_SETTLEMENT_ENABLED);
    const signatureContract = truthy(env.DINGER_LIVE_PAY_RESPONSE_SIGNATURE_CONTRACT_CONFIRMED);
    const callbackSettlementImplemented = true;
    const signatureVerifierImplemented = false;
    const missing = [];
    if (!config.enabled) missing.push("Dinger runtime enabled");
    if (!config.configured) missing.push(...config.missing.map(item => `Dinger ${item}`));
    if (config.environment !== "LIVE") missing.push("Dinger LIVE environment");
    if (!payUrlConfirmed) missing.push("exact confirmed production Pay URL");
    if (!waveFormUrlConfirmed) missing.push("exact confirmed production Wave hosted-form URL");
    if (!publicKeyIdentityConfirmed) missing.push("Dinger production encryption-key identity confirmation");
    if (!requestContract) missing.push("production Pay request contract confirmation");
    if (!responseContract) missing.push(key === "dinger_wavepay_pin" ? "production Wave hosted-form contract confirmation" : "production AYA QR response contract confirmation");
    if (!callbackContract) missing.push("production callback verification contract confirmation");
    if (!callbackUrlConfirmed) missing.push("exact production callback URL");
    if (!callbackSettlementEnabled) missing.push("production callback settlement runtime enabled");
    if (!signatureContract) missing.push("production Pay response signature verification contract confirmation");
    if (!callbackSettlementImplemented) missing.push("authenticated persistent callback settlement implementation");
    if (!signatureVerifierImplemented) missing.push("Pay response signature verifier implementation");
    return Object.freeze({
        initiationReady: common && payUrlConfirmed && waveFormUrlConfirmed && publicKeyIdentityConfirmed && requestContract && responseContract,
        settlementReady: common && callbackUrlConfirmed && callbackContract && callbackSettlementEnabled && callbackSettlementImplemented,
        publicReady: common && payUrlConfirmed && waveFormUrlConfirmed && callbackUrlConfirmed && publicKeyIdentityConfirmed && requestContract && responseContract && callbackContract && callbackSettlementEnabled && signatureContract && callbackSettlementImplemented && signatureVerifierImplemented,
        missing: Object.freeze([...new Set(missing)])
    });
}

function dingerAccessDecision(method = {}, user = {}, env = process.env) {
    if (!isDingerMethod(method)) return Object.freeze({ allowed: false, reason: "not_dinger", state: ACTIVATION_STATES.DISABLED, readiness: null });
    const state = Object.values(ACTIVATION_STATES).includes(text(method.dingerActivationState).toUpperCase())
        ? text(method.dingerActivationState).toUpperCase()
        : ACTIVATION_STATES.DISABLED;
    const readiness = dingerTechnicalReadiness(method, env);
    if (method.enabled !== true || state === ACTIVATION_STATES.DISABLED) return Object.freeze({ allowed: false, reason: "disabled", state, readiness });
    if (!readiness.initiationReady) return Object.freeze({ allowed: false, reason: "technical_readiness", state, readiness });
    if (state === ACTIVATION_STATES.TEST_ONLY) {
        const approved = method.dingerProductionTestApproved === true;
        return Object.freeze({ allowed: approved && authorizedTestUser(method, user), reason: approved ? "test_user_required" : "test_permission_required", state, readiness });
    }
    if (state === ACTIVATION_STATES.PUBLIC) {
        const approved = method.dingerGoLiveApproved === true;
        return Object.freeze({ allowed: approved && readiness.publicReady, reason: approved ? "technical_readiness" : "go_live_approval_required", state, readiness });
    }
    return Object.freeze({ allowed: false, reason: "disabled", state, readiness });
}

module.exports = Object.freeze({
    DINGER_PROVIDER,
    DINGER_METHODS,
    DINGER_ACTIVATION_STATES: ACTIVATION_STATES,
    isDingerMethod,
    authenticatedUserId,
    authorizedTestUser,
    dingerTechnicalReadiness,
    dingerAccessDecision
});
