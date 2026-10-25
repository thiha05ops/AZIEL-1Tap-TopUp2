const User = require("../models/User");
const { issueUserSession, projectUser, recordSecurityEvent } = require("./authSessionService");
const { normalizeUsername, verifyRegistrationOtp } = require("./registrationService");

function normalizeLoginIdentifier(value) {
    return String(value || "").trim().toLowerCase();
}

function isEmailIdentifier(value) {
    return value.includes("@");
}

async function findCustomerForLogin(identifier, options = {}) {
    const UserModel = options.UserModel || User;
    const loginId = normalizeLoginIdentifier(identifier);

    if (!loginId) {
        return { user: null, loginId, matchType: "none" };
    }

    const emailLogin = isEmailIdentifier(loginId);
    const exactQuery = emailLogin ? { email: loginId } : { username: loginId };
    const exactUser = await UserModel.findOne(exactQuery);

    if (exactUser) {
        return { user: exactUser, loginId, matchType: "exact" };
    }

    // Registration removes all whitespace from usernames. Keep exact lookup first
    // so a legacy username containing whitespace can never be shadowed by fallback.
    if (emailLogin) {
        return { user: null, loginId, matchType: "none" };
    }

    const canonicalUsername = normalizeUsername(loginId);
    if (!canonicalUsername || canonicalUsername === loginId) {
        return { user: null, loginId, matchType: "none" };
    }

    const fallbackUser = await UserModel.findOne({ username: canonicalUsername });
    return {
        user: fallbackUser,
        loginId,
        matchType: fallbackUser ? "canonical_username" : "none"
    };
}

async function verifyRegistrationAndIssueSession(input, req, options = {}) {
    const verify = options.verifyRegistrationOtp || verifyRegistrationOtp;
    const recordEvent = options.recordSecurityEvent || recordSecurityEvent;
    const issueSession = options.issueUserSession || issueUserSession;
    const serializeUser = options.projectUser || projectUser;

    const result = await verify(input);
    const user = result.user;

    let issued;
    try {
        await recordEvent(user, {
            type: "email.verified",
            title: "Email verified"
        });

        issued = await issueSession(user, req, {
            provider: user.authProvider || "local",
            eventType: "login.success",
            eventTitle: "New sign-in"
        });
    } catch (error) {
        error.registrationCompleted = true;
        throw error;
    }

    return {
        message: result.message,
        session: issued.session,
        user: issued.user || serializeUser(user)
    };
}

module.exports = {
    findCustomerForLogin,
    isEmailIdentifier,
    normalizeLoginIdentifier,
    verifyRegistrationAndIssueSession
};
