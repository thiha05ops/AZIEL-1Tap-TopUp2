"use strict";

const { inspectMyanMyanPayConfiguration } = require("./myanMyanPayConfiguration");
const METHOD = "myanmyanpay_mmqr";
const PROVIDER = "MYANMYANPAY";
const text = value => String(value || "").trim();
function isMyanMyanPayMethod(method = {}) { return text(method.key || method.paymentMethodId).toLowerCase() === METHOD; }
function userId(user = {}) { return text(user.id || user._id || user.userId); }
function myanMyanPayAccessDecision(method = {}, user = {}, env = process.env) {
    const readiness = inspectMyanMyanPayConfiguration(env);
    const authorized = Boolean(userId(user)) && (method.myanMyanPayAuthorizedTestUserIds || []).some(id => text(id) === userId(user));
    const state = text(method.myanMyanPayActivationState).toUpperCase() || "DISABLED";
    const testApproved = readiness.environment === "PRODUCTION" ? method.myanMyanPayProductionTestApproved === true : method.myanMyanPaySandboxTestApproved === true;
    const testOnlyAllowed = state === "TEST_ONLY" && testApproved && authorized;
    const publicAllowed = state === "PUBLIC" && readiness.environment === "PRODUCTION" && method.myanMyanPayProductionTestApproved === true && method.myanMyanPayProductionTestVerified === true && method.myanMyanPayGoLiveApproved === true;
    const allowed = isMyanMyanPayMethod(method) && method.enabled === true && readiness.enabled && readiness.configured && (testOnlyAllowed || publicAllowed);
    return Object.freeze({ allowed, state, environment: readiness.environment, authorized, testApproved, publicReady: readiness.environment === "PRODUCTION" && readiness.configured && method.myanMyanPayProductionTestApproved === true && method.myanMyanPayProductionTestVerified === true && method.myanMyanPayGoLiveApproved === true, readiness, reason: allowed ? "" : state === "DISABLED" ? "disabled" : state === "TEST_ONLY" && !authorized ? "test_user_required" : state === "PUBLIC" ? "public_not_ready" : "technical_readiness" });
}
module.exports = Object.freeze({ METHOD, PROVIDER, isMyanMyanPayMethod, myanMyanPayAccessDecision });
