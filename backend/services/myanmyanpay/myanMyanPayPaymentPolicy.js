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
    const allowed = isMyanMyanPayMethod(method) && method.enabled === true && state === "TEST_ONLY" && method.myanMyanPaySandboxTestApproved === true && authorized && readiness.enabled && readiness.configured;
    return Object.freeze({ allowed, state, readiness, reason: allowed ? "" : state !== "TEST_ONLY" ? "disabled" : !authorized ? "test_user_required" : "technical_readiness" });
}
module.exports = Object.freeze({ METHOD, PROVIDER, isMyanMyanPayMethod, myanMyanPayAccessDecision });
