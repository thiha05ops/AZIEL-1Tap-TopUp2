"use strict";

const fs = require("fs");
const path = require("path");

const MODE_VALUE = "true";
const CONFIRM_VALUE = "ISOLATED_AZIEL_E2E_ONLY";
const TEST_PREFIX = "aziel_e2e_";

class E2ESafetyError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "E2ESafetyError";
        this.code = code;
    }
}

function normalizedScope(env = process.env) {
    return String(env.AZIEL_E2E_TEST_SCOPE || "").trim().toLowerCase();
}

function isValidScope(scope) {
    return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(String(scope || ""));
}

function isE2EMode(env = process.env) {
    return String(env.AZIEL_E2E_TEST_MODE || "").toLowerCase() === MODE_VALUE &&
        String(env.AZIEL_E2E_TEST_CONFIRM || "") === CONFIRM_VALUE &&
        isValidScope(normalizedScope(env)) &&
        String(env.NODE_ENV || "development").toLowerCase() !== "production";
}

function assertE2EMode(env = process.env) {
    if (isE2EMode(env)) return { scope: normalizedScope(env) };
    throw new E2ESafetyError(
        "AZIEL_E2E_GATE_CLOSED",
        "E2E mode requires AZIEL_E2E_TEST_MODE=true, a valid AZIEL_E2E_TEST_SCOPE, " +
        `AZIEL_E2E_TEST_CONFIRM=${CONFIRM_VALUE}, and NODE_ENV must not be production.`
    );
}

function customerUsername(scope) {
    if (!isValidScope(scope)) throw new E2ESafetyError("AZIEL_E2E_SCOPE_INVALID", "Invalid E2E scope.");
    return `${TEST_PREFIX}customer_${scope}`;
}

function adminUsername(scope) {
    if (!isValidScope(scope)) throw new E2ESafetyError("AZIEL_E2E_SCOPE_INVALID", "Invalid E2E scope.");
    return `${TEST_PREFIX}operations_${scope}`;
}

function isTestUsername(value, scope = "") {
    const username = String(value || "").trim().toLowerCase();
    if (!username.startsWith(TEST_PREFIX)) return false;
    if (!scope) return true;
    const normalized = String(scope).toLowerCase();
    return username === customerUsername(normalized) || username === adminUsername(normalized);
}

function isTestEmail(value, scope = "") {
    const email = String(value || "").trim().toLowerCase();
    return email === `${customerUsername(scope)}@example.invalid`;
}

function sinkPath(env = process.env) {
    const configured = String(env.AZIEL_E2E_EVENT_SINK || "").trim();
    return configured || path.join(process.cwd(), ".aziel-e2e", "events.jsonl");
}

function recordSuppressedEvent(channel, payload = {}, env = process.env) {
    const { scope } = assertE2EMode(env);
    const target = sinkPath(env);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const safe = {
        at: new Date().toISOString(),
        scope,
        channel: String(channel || "unknown"),
        event: String(payload.event || payload.operation || ""),
        recipient: payload.recipient ? "E2E_TEST_RECIPIENT" : "",
        status: "TRIGGERED_AND_SUPPRESSED"
    };
    fs.appendFileSync(target, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
    return safe;
}

function suppressTestEmail(to, env = process.env) {
    if (!isE2EMode(env)) return false;
    return isTestEmail(to, normalizedScope(env));
}

function suppressTestRealtime(username, env = process.env) {
    if (!isE2EMode(env)) return false;
    return isTestUsername(username, normalizedScope(env));
}

module.exports = Object.freeze({
    CONFIRM_VALUE,
    E2ESafetyError,
    TEST_PREFIX,
    adminUsername,
    assertE2EMode,
    customerUsername,
    isE2EMode,
    isTestEmail,
    isTestUsername,
    normalizedScope,
    recordSuppressedEvent,
    suppressTestEmail,
    suppressTestRealtime
});
