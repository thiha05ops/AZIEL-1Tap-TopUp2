"use strict";

const crypto = require("crypto");

const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "aziel_session";
const AUTH_COOKIE_MAX_AGE_MS = Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 15 * 24 * 60 * 60 * 1000);

function secret(env = process.env) {
    return env.AUTH_COOKIE_SECRET || env.SESSION_SECRET || env.JWT_SECRET || "aziel_secret";
}

function signature(value, env = process.env) {
    return crypto.createHmac("sha256", secret(env)).update(value).digest("base64url");
}

function encodeSessionCookie(sessionId, env = process.env) {
    const value = String(sessionId || "");
    return `${value}.${signature(value, env)}`;
}

function decodeSessionCookie(value, env = process.env) {
    const raw = String(value || "");
    const separator = raw.lastIndexOf(".");
    if (separator < 1) return "";
    const sessionId = raw.slice(0, separator);
    const supplied = raw.slice(separator + 1);
    const expected = signature(sessionId, env);
    if (supplied.length !== expected.length) return "";
    return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? sessionId : "";
}

function readCookie(req, name = AUTH_COOKIE_NAME) {
    const header = String(req?.headers?.cookie || "");
    for (const part of header.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch (_) { return ""; }
    }
    return "";
}

function cookieOptions(env = process.env) {
    const production = env.NODE_ENV === "production";
    const options = {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
        maxAge: AUTH_COOKIE_MAX_AGE_MS
    };
    if (env.AUTH_COOKIE_DOMAIN) options.domain = env.AUTH_COOKIE_DOMAIN;
    return options;
}

function setAuthCookie(res, sessionId, env = process.env) {
    res.cookie(AUTH_COOKIE_NAME, encodeSessionCookie(sessionId, env), cookieOptions(env));
}

function clearAuthCookie(res, env = process.env) {
    const options = cookieOptions(env);
    delete options.maxAge;
    res.clearCookie(AUTH_COOKIE_NAME, options);
}

function readSessionId(req, env = process.env) {
    return decodeSessionCookie(readCookie(req), env);
}

module.exports = {
    AUTH_COOKIE_MAX_AGE_MS,
    AUTH_COOKIE_NAME,
    clearAuthCookie,
    cookieOptions,
    decodeSessionCookie,
    encodeSessionCookie,
    readSessionId,
    setAuthCookie
};
