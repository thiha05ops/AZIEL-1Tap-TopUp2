"use strict";

const dns = require("dns/promises");
const tls = require("tls");
const https = require("https");
const { API_BASE_URL } = require("./myanMyanPayConfiguration");

const TARGET = "MYANMYANPAY_SANDBOX";
const ORIGIN = API_BASE_URL;
const HOST = new URL(ORIGIN).hostname;
const DEFAULT_TIMEOUT_MS = 5000;
const SAFE_ERROR_CODES = Object.freeze(new Set([
    "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
    "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN",
    "ERR_TLS_CERT_ALTNAME_INVALID", "UND_ERR_CONNECT_TIMEOUT"
]));

function errorClass(error) {
    if (error?.name === "TypeError") return "TYPE_ERROR";
    if (error?.name === "AbortError") return "ABORT_ERROR";
    if (error?.name === "Error") return "ERROR";
    return "UNKNOWN_ERROR";
}

function errorCode(error) {
    const candidates = [error?.code, error?.cause?.code];
    return candidates.find(code => typeof code === "string" && SAFE_ERROR_CODES.has(code)) || "";
}

function timeoutError() {
    return Object.assign(new Error("Connectivity check timed out."), { code: "ETIMEDOUT" });
}

function withTimeout(promise, timeoutMs, dependencies = {}) {
    const setTimer = dependencies.setTimeout || setTimeout;
    const clearTimer = dependencies.clearTimeout || clearTimeout;
    let timer;
    return Promise.race([
        promise,
        new Promise((resolve, reject) => { timer = setTimer(() => reject(timeoutError()), timeoutMs); })
    ]).finally(() => clearTimer(timer));
}

async function checkDns(dependencies, timeoutMs) {
    try {
        const rows = await withTimeout(Promise.resolve().then(() => dependencies.dnsLookup(HOST, { all: true, verbatim: true })), timeoutMs, dependencies);
        const addresses = Array.isArray(rows) ? rows : rows ? [rows] : [];
        const families = [...new Set(addresses.map(row => Number(row?.family)).filter(value => value === 4 || value === 6))];
        return { ok: addresses.length > 0, family: families.length === 1 ? families[0] : 0, addressCount: Math.min(addresses.length, 32), errorClass: "", errorCode: "" };
    } catch (error) {
        return { ok: false, family: 0, addressCount: 0, errorClass: errorClass(error), errorCode: errorCode(error) };
    }
}

function checkTls(dependencies, timeoutMs) {
    return new Promise(resolve => {
        let settled = false;
        let socket;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket?.destroy?.(); } catch (_) { /* no-op */ }
            resolve(result);
        };
        const timer = setTimeout(() => finish({ ok: false, authorized: false, protocol: "", errorClass: "ERROR", errorCode: "ETIMEDOUT" }), timeoutMs);
        try {
            socket = dependencies.tlsConnect({ host: HOST, port: 443, servername: HOST, rejectUnauthorized: true });
            socket.once("secureConnect", () => {
                const protocol = ["TLSv1.2", "TLSv1.3"].includes(socket.getProtocol?.()) ? socket.getProtocol() : "";
                finish({ ok: socket.authorized === true, authorized: socket.authorized === true, protocol, errorClass: "", errorCode: "" });
            });
            socket.once("error", error => finish({ ok: false, authorized: false, protocol: "", errorClass: errorClass(error), errorCode: errorCode(error) }));
            socket.setTimeout?.(timeoutMs, () => finish({ ok: false, authorized: false, protocol: "", errorClass: "ERROR", errorCode: "ETIMEDOUT" }));
        } catch (error) {
            finish({ ok: false, authorized: false, protocol: "", errorClass: errorClass(error), errorCode: errorCode(error) });
        }
    });
}

function checkHttps(dependencies, timeoutMs) {
    return new Promise(resolve => {
        let settled = false;
        let request;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { request?.destroy?.(); } catch (_) { /* no-op */ }
            resolve(result);
        };
        const timer = setTimeout(() => finish({ ok: false, httpStatus: 0, responseReceived: false, errorClass: "ERROR", errorCode: "ETIMEDOUT" }), timeoutMs);
        try {
            request = dependencies.httpsRequest(`${ORIGIN}/`, { method: "HEAD", servername: HOST, rejectUnauthorized: true }, response => {
                const status = Number(response.statusCode || 0);
                response.resume?.();
                finish({ ok: true, httpStatus: status >= 100 && status <= 599 ? status : 0, responseReceived: true, errorClass: "", errorCode: "" });
            });
            request.once("error", error => finish({ ok: false, httpStatus: 0, responseReceived: false, errorClass: errorClass(error), errorCode: errorCode(error) }));
            request.setTimeout?.(timeoutMs, () => finish({ ok: false, httpStatus: 0, responseReceived: false, errorClass: "ERROR", errorCode: "ETIMEDOUT" }));
            request.end();
        } catch (error) {
            finish({ ok: false, httpStatus: 0, responseReceived: false, errorClass: errorClass(error), errorCode: errorCode(error) });
        }
    });
}

async function checkFetch(dependencies, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await dependencies.fetchImpl(`${ORIGIN}/`, { method: "HEAD", signal: controller.signal, redirect: "manual" });
        const status = Number(response?.status || 0);
        return { ok: true, httpStatus: status >= 100 && status <= 599 ? status : 0, responseReceived: true, errorClass: "", errorCode: "" };
    } catch (error) {
        const aborted = controller.signal.aborted;
        return { ok: false, httpStatus: 0, responseReceived: false, errorClass: aborted ? "ABORT_ERROR" : errorClass(error), errorCode: aborted ? "ETIMEDOUT" : errorCode(error) };
    } finally {
        clearTimeout(timer);
    }
}

async function checkMyanMyanPaySandboxConnectivity(options = {}) {
    const timeoutMs = Math.max(250, Math.min(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS), 10000));
    const dependencies = {
        dnsLookup: options.dnsLookup || dns.lookup,
        tlsConnect: options.tlsConnect || tls.connect,
        httpsRequest: options.httpsRequest || https.request,
        fetchImpl: options.fetchImpl || globalThis.fetch,
        setTimeout: options.setTimeout,
        clearTimeout: options.clearTimeout
    };
    if (typeof dependencies.fetchImpl !== "function") throw new Error("Native fetch is unavailable.");
    const dnsResult = await checkDns(dependencies, timeoutMs);
    const tlsResult = await checkTls(dependencies, timeoutMs);
    const httpsResult = await checkHttps(dependencies, timeoutMs);
    const fetchResult = await checkFetch(dependencies, timeoutMs);
    return Object.freeze({ success: true, target: TARGET, dns: dnsResult, tls: tlsResult, https: httpsResult, fetch: fetchResult });
}

module.exports = Object.freeze({ checkMyanMyanPaySandboxConnectivity, _test: Object.freeze({ TARGET, HOST, ORIGIN, SAFE_ERROR_CODES, errorClass, errorCode, timeoutError, withTimeout, checkDns, checkTls, checkHttps, checkFetch }) });
