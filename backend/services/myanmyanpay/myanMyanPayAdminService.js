"use strict";

const mongoose = require("mongoose");
const User = require("../../models/User");
const { inspectMyanMyanPayConfiguration, inspectMyanMyanPayEnvironments } = require("./myanMyanPayConfiguration");

const CUSTOMER_ID_PATTERN = /^AZU-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
const CUSTOMER_ID_SEARCH_PATTERN = /^AZU-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{0,10}$/;
const MAX_AUTHORIZED_TESTERS = 25;

class MyanMyanPayAdminError extends Error {
    constructor(code, message, statusCode = 400, metadata = {}) {
        super(message);
        this.name = "MyanMyanPayAdminError";
        this.code = code;
        this.statusCode = statusCode;
        this.metadata = Object.freeze({ ...metadata });
    }
}

function normalizeCustomerId(value = "") {
    return String(value || "").trim().toUpperCase();
}

function canonicalIdentity(method = {}) {
    const checks = Object.freeze({
        key: String(method.key || "").trim().toLowerCase() === "myanmyanpay_mmqr",
        provider: String(method.provider || "").trim().toLowerCase() === "myanmyanpay_mmqr",
        paymentChannel: String(method.paymentChannel || "").trim().toUpperCase() === "MYANMYANPAY_MMQR",
        region: String(method.region || "").trim().toUpperCase() === "MM",
        paymentType: String(method.paymentType || "").trim().toLowerCase() === "auto"
    });
    return Object.freeze({ valid: Object.values(checks).every(Boolean), checks });
}

function testerSummary(user = {}) {
    return Object.freeze({
        customerId: normalizeCustomerId(user.customerId),
        username: String(user.username || ""),
        email: String(user.email || "")
    });
}

async function findTesterCandidates(query, options = {}) {
    const UserModel = options.UserModel || User;
    const customerId = normalizeCustomerId(query);
    if (!CUSTOMER_ID_SEARCH_PATTERN.test(customerId) || customerId.length < 5) {
        throw new MyanMyanPayAdminError("MYANMYANPAY_TESTER_SEARCH_INVALID", "Enter an AZIEL customer ID beginning with AZU-.");
    }
    const users = await UserModel.find({ customerId: { $regex: `^${customerId}`, $options: "i" } })
        .select("customerId username email")
        .sort({ customerId: 1 })
        .limit(10)
        .lean();
    return users.map(testerSummary);
}

async function resolveTesterCustomerIds(values, options = {}) {
    const UserModel = options.UserModel || User;
    if (!Array.isArray(values)) {
        throw new MyanMyanPayAdminError("MYANMYANPAY_TESTERS_REQUIRED", "Authorized tester customer IDs must be an array.");
    }
    if (values.length > MAX_AUTHORIZED_TESTERS) {
        throw new MyanMyanPayAdminError("MYANMYANPAY_TESTER_LIMIT", `No more than ${MAX_AUTHORIZED_TESTERS} authorized testers are allowed.`);
    }
    const customerIds = [...new Set(values.map(normalizeCustomerId))];
    const malformed = customerIds.filter(value => !CUSTOMER_ID_PATTERN.test(value));
    if (malformed.length) {
        throw new MyanMyanPayAdminError("MYANMYANPAY_TESTER_CUSTOMER_ID_INVALID", "Every authorized tester must have a valid AZIEL customer ID.");
    }
    if (!customerIds.length) return Object.freeze({ customerIds: [], internalIds: [], testers: [] });

    const users = await UserModel.find({ customerId: { $in: customerIds } })
        .select("_id customerId username email")
        .lean();
    const byCustomerId = new Map(users.map(user => [normalizeCustomerId(user.customerId), user]));
    const unresolved = customerIds.filter(customerId => !byCustomerId.has(customerId));
    if (unresolved.length) {
        throw new MyanMyanPayAdminError(
            "MYANMYANPAY_TESTER_NOT_FOUND",
            "One or more authorized tester accounts could not be resolved.",
            400,
            { unresolvedCount: unresolved.length }
        );
    }
    const ordered = customerIds.map(customerId => byCustomerId.get(customerId));
    return Object.freeze({
        customerIds,
        internalIds: ordered.map(user => String(user._id)),
        testers: ordered.map(testerSummary)
    });
}

async function resolveStoredTesters(values, options = {}) {
    const UserModel = options.UserModel || User;
    const unique = [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))];
    const validIds = unique.filter(value => mongoose.isValidObjectId(value));
    const users = validIds.length
        ? await UserModel.find({ _id: { $in: validIds } }).select("_id customerId username email").lean()
        : [];
    const byId = new Map(users.map(user => [String(user._id), user]));
    return Object.freeze({
        testers: validIds.filter(id => byId.has(id)).map(id => testerSummary(byId.get(id))),
        missingTesterCount: unique.length - users.length
    });
}

async function projectMyanMyanPaySettings(method, options = {}) {
    const env = options.env || process.env;
    const configuration = inspectMyanMyanPayConfiguration(env);
    const environments = inspectMyanMyanPayEnvironments(env);
    const identity = canonicalIdentity(method);
    const stored = await resolveStoredTesters(method.myanMyanPayAuthorizedTestUserIds, options);
    const sandboxApproval = method.myanMyanPaySandboxTestApproved === true;
    const productionApproval = method.myanMyanPayProductionTestApproved === true;
    const productionTestVerified = method.myanMyanPayProductionTestVerified === true;
    const approval = configuration.environment === "PRODUCTION" ? productionApproval : sandboxApproval;
    const goLiveApproved = method.myanMyanPayGoLiveApproved === true;
    const blockers = [];
    if (!identity.valid) blockers.push("canonical payment method identity");
    const label = configuration.environment === "PRODUCTION" ? "production" : "sandbox";
    if (!configuration.appIdConfigured) blockers.push(`${label} App ID`);
    if (!configuration.publishableKeyConfigured) blockers.push(`${label} publishable key`);
    if (!configuration.secretKeyConfigured) blockers.push(`${label} secret key`);
    if (!configuration.apiBaseUrlConfigured) blockers.push(`${label} HTTPS API base URL`);
    if (!approval) blockers.push(`${label} test approval`);
    if (!stored.testers.length) blockers.push("authorized tester");
    if (stored.missingTesterCount) blockers.push("unresolved stored tester");
    return Object.freeze({
        environment: configuration.environment,
        identity,
        activationState: String(method.myanMyanPayActivationState || "DISABLED"),
        sandboxTestApproved: sandboxApproval,
        productionTestApproved: productionApproval,
        productionTestVerified,
        goLiveApproved,
        configuration,
        environments,
        callback: Object.freeze({
            method: "POST",
            url: configuration.callbackUrl,
            routeImplemented: true,
            authenticationRequired: true,
            serverCallbackAuthoritative: true
        }),
        authorizedTesters: stored.testers,
        missingTesterCount: stored.missingTesterCount,
        testOnlyReady: blockers.length === 0,
        publicReady: identity.valid && environments.production.configured && productionApproval && productionTestVerified && goLiveApproved,
        blockers: Object.freeze(blockers)
    });
}

const projectSandboxSettings = projectMyanMyanPaySettings;

module.exports = Object.freeze({
    CUSTOMER_ID_PATTERN,
    CUSTOMER_ID_SEARCH_PATTERN,
    MAX_AUTHORIZED_TESTERS,
    MyanMyanPayAdminError,
    normalizeCustomerId,
    canonicalIdentity,
    findTesterCandidates,
    resolveTesterCustomerIds,
    resolveStoredTesters,
    projectMyanMyanPaySettings,
    projectSandboxSettings
});
