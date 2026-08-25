const defaultFetch = require("node-fetch");

const DEFAULT_API_URL = "https://www.wondd.com/member/bot-game.php";
const WONDD_MLBB_SERVICE_CODE = "mlbb";
const PLAYER_ID_PATTERN = /^\d+$/;
const { CONFIRMED_SERVICE_CODES } = require("./wonddCatalogConfig");
const ERROR_MAP = Object.freeze({
    E00: { code: "WONDD_DATABASE_ERROR", category: "OPERATIONAL", retryable: true },
    E01: { code: "WONDD_ACCOUNT_CONFIGURATION_ERROR", category: "CONFIGURATION", retryable: false },
    E02: { code: "WONDD_METHOD_CONFIGURATION_ERROR", category: "CONFIGURATION", retryable: false },
    E03: { code: "WONDD_INSUFFICIENT_BALANCE", category: "OPERATIONAL", retryable: false },
    E04: { code: "WONDD_SERVICE_MAPPING_INVALID", category: "CONFIGURATION", retryable: false },
    E05: { code: "WONDD_SERVICE_UNAVAILABLE", category: "OPERATIONAL", retryable: true },
    E06: { code: "WONDD_ORDER_LOOKUP_ERROR", category: "OPERATIONAL", retryable: true },
    E07: { code: "WONDD_PACKAGE_MAPPING_INVALID", category: "CONFIGURATION", retryable: false },
    E08: { code: "WONDD_ORDER_REFERENCE_MISSING", category: "CONFIGURATION", retryable: false },
    E09: { code: "WONDD_IP_ALLOWLIST_ERROR", category: "CONFIGURATION", retryable: false }
});

class WonddAdapterError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "WonddAdapterError";
        this.code = code;
        this.category = details.category || "OPERATIONAL";
        this.retryable = Boolean(details.retryable);
        this.submissionUncertain = Boolean(details.submissionUncertain);
    }
}

const clean = value => String(value == null ? "" : value).trim();

function createWonddAdapter(options = {}) {
    const fetchImpl = options.fetchImpl || defaultFetch;
    const env = options.env || process.env;
    const apiUrl = clean(options.apiUrl || env.WONDD_API_URL) || DEFAULT_API_URL;
    const credentials = () => ({ username: clean(env.WONDD_USERNAME), password: clean(env.WONDD_PASSWORD) });
    const isConfigured = () => Boolean(credentials().username && credentials().password);
    const isMlbbAutoFulfillmentEnabled = () => clean(env.WONDD_MLBB_AUTO_FULFILLMENT_ENABLED).toLowerCase() === "true";
    const isAutoFulfillmentEnabled = productCode => {
        const product = clean(productCode).toLowerCase();
        if (product === "mlbb" && isMlbbAutoFulfillmentEnabled()) return true;
        return clean(env.WONDD_AUTO_FULFILLMENT_ENABLED_PRODUCTS).toLowerCase().split(",").map(item => item.trim()).filter(Boolean).includes(product);
    };

    async function postWonDD(params = {}, requestOptions = {}) {
        const auth = credentials();
        if (!auth.username || !auth.password) throw new WonddAdapterError("WONDD_NOT_CONFIGURED", "WonDD credentials are not configured.", { category: "CONFIGURATION" });
        const body = new URLSearchParams({ ...params, username: auth.username, password: auth.password });
        let response;
        try {
            response = await fetchImpl(apiUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), signal: requestOptions.signal });
        } catch {
            throw new WonddAdapterError("WONDD_TRANSPORT_ERROR", "WonDD request could not be confirmed.", { category: "OPERATIONAL", retryable: true, submissionUncertain: requestOptions.submission === true });
        }
        if (!response.ok) throw new WonddAdapterError(`WONDD_HTTP_${response.status}`, "WonDD returned an HTTP error.", { category: "OPERATIONAL", retryable: response.status >= 500, submissionUncertain: requestOptions.submission === true });
        try {
            return JSON.parse(await response.text());
        } catch {
            throw new WonddAdapterError("WONDD_INVALID_JSON", "WonDD returned an unreadable response.", { category: "OPERATIONAL", retryable: true, submissionUncertain: requestOptions.submission === true });
        }
    }

    async function getBalance() {
        const payload = await postWonDD({ method: "balance" });
        const failure = normalizeWonddError(payload);
        if (failure) return failure;
        const balance = Number(payload.balance);
        if (!Number.isFinite(balance) || balance < 0) throw new WonddAdapterError("WONDD_INVALID_BALANCE", "WonDD returned an invalid balance.");
        return supplierResult("SUCCEEDED", "BALANCE_OK", { balance, currency: "THB" }, "WonDD balance fetched successfully.");
    }

    function buildTopupPayload(input = {}) {
        const serviceCode = clean(input.serviceCode).toLowerCase();
        const packCode = clean(input.packCode);
        const gameId = clean(input.gameId);
        if (!Object.values(CONFIRMED_SERVICE_CODES).some(code => code.toLowerCase() === serviceCode)) throw new WonddAdapterError("WONDD_SERVICE_MAPPING_INVALID", "WonDD servicecode is not supplier-confirmed.", { category: "CONFIGURATION" });
        if (!packCode) throw new WonddAdapterError("WONDD_PACKAGE_MAPPING_MISSING", "A verified WonDD packcode mapping is required.", { category: "CONFIGURATION" });
        validateBuiltGameId(gameId);
        return { method: "topup", servicecode: WONDD_MLBB_SERVICE_CODE, packcode: packCode, gameid: gameId };
    }

    function dryRunTopup(input = {}) {
        const payload = buildTopupPayload(input);
        if (!isConfigured()) throw new WonddAdapterError("WONDD_NOT_CONFIGURED", "WonDD credentials are not configured.", { category: "CONFIGURATION" });
        return { status: "DRY_RUN_VALID", configured: true, liveEnabled: isMlbbAutoFulfillmentEnabled(), payload: { method: payload.method, servicecode: payload.servicecode, packcode: payload.packcode, gameid: maskGameId(payload.gameid) } };
    }

    async function submitTopup(input = {}) {
        const payload = buildTopupPayload(input);
        const productCode = clean(input.productCode || Object.keys(CONFIRMED_SERVICE_CODES).find(key => CONFIRMED_SERVICE_CODES[key].toLowerCase() === clean(input.serviceCode).toLowerCase()));
        if (!isAutoFulfillmentEnabled(productCode)) throw new WonddAdapterError("WONDD_AUTO_FULFILLMENT_DISABLED", "Live WonDD fulfillment is disabled for this product.", { category: "CONFIGURATION" });
        const response = await postWonDD(payload, { submission: true });
        const failure = normalizeWonddError(response);
        if (failure) return failure;
        const orderId = clean(response.orderid || response.orderId);
        if (!orderId) return supplierResult("FAILED", "WONDD_ACCEPTANCE_REFERENCE_MISSING", {}, "WonDD accepted the request without an order reference.", "", "CONFIGURATION", false);
        return supplierResult("PENDING", "ACCEPTED", { responseCode: "00", submittedAt: new Date().toISOString() }, "WonDD accepted the top-up for processing.", orderId);
    }

    async function checkStatus(input = {}) {
        const orderId = clean(input.orderId || input.orderid);
        if (!orderId) throw new WonddAdapterError("WONDD_ORDER_REFERENCE_MISSING", "WonDD orderid is required.", { category: "CONFIGURATION" });
        const response = await postWonDD({ method: "checkstatus", orderid: orderId });
        const failure = normalizeWonddError(response);
        return failure || normalizeWonddStatus(response, orderId);
    }

    return { isConfigured, isMlbbAutoFulfillmentEnabled, isAutoFulfillmentEnabled, getBalance, buildTopupPayload, dryRunTopup, submitTopup, checkStatus };
}

function buildWonddMlbbGameId(userId, zoneId) {
    const user = clean(userId);
    const zone = clean(zoneId);
    if (!user) throw new WonddAdapterError("WONDD_MLBB_USER_ID_REQUIRED", "MLBB User ID is required.");
    if (!zone) throw new WonddAdapterError("WONDD_MLBB_ZONE_ID_REQUIRED", "MLBB Zone ID is required.");
    if (!PLAYER_ID_PATTERN.test(user)) throw new WonddAdapterError("WONDD_MLBB_USER_ID_INVALID", "MLBB User ID must be numeric.");
    if (!PLAYER_ID_PATTERN.test(zone)) throw new WonddAdapterError("WONDD_MLBB_ZONE_ID_INVALID", "MLBB Zone ID must be numeric.");
    return `${user} ${zone}`;
}

function validateBuiltGameId(value) {
    const parts = String(value || "").split(" ");
    if (parts.length !== 2 || !PLAYER_ID_PATTERN.test(parts[0]) || !PLAYER_ID_PATTERN.test(parts[1])) throw new WonddAdapterError("WONDD_MLBB_GAME_ID_INVALID", "WonDD MLBB gameid must contain numeric User ID and Zone ID separated by one space.");
}

function supplierResult(status, providerStatus, rawMetadata = {}, safeMessage = "", reference = "", category = "", retryable = false) {
    return { status, supplierReference: reference, supplierCode: "WONDD", providerStatus, failureCode: status === "FAILED" ? providerStatus : "", safeMessage, rawMetadata: { ...rawMetadata, category, retryable } };
}

function normalizeWonddError(payload = {}) {
    const providerCode = clean(payload.errorcode || payload.errorCode);
    if (!providerCode || providerCode === "00") return null;
    const mapped = ERROR_MAP[providerCode] || { code: "WONDD_PROVIDER_ERROR", category: "OPERATIONAL", retryable: false };
    return {
        ...supplierResult("FAILED", providerCode, { responseCode: providerCode, internalCode: mapped.code }, `WonDD request failed (${providerCode}).`, "", mapped.category, mapped.retryable),
        failureCode: mapped.code
    };
}

function normalizeWonddStatus(payload = {}, orderId = "") {
    const raw = clean(payload.transactionstatus || payload.trascationstatus || payload.trasactionstatus).toLowerCase();
    if (raw === "process") return supplierResult("PENDING", "PROCESSING", { responseCode: "00" }, "WonDD is processing the top-up.", orderId);
    if (raw === "complete") return supplierResult("SUCCEEDED", "COMPLETE", { responseCode: "00" }, "WonDD confirmed completion.", orderId);
    if (raw === "fail") return supplierResult("FAILED", "FAIL", { responseCode: "00" }, "WonDD reported fulfillment failure.", orderId, "TERMINAL", false);
    return supplierResult("PENDING", "UNKNOWN_PROVIDER_STATUS", { responseCode: "00", observedStatus: raw || "missing" }, "WonDD returned an unknown non-terminal status.", orderId);
}

function mask(value) { const text = clean(value); return text.length <= 4 ? "****" : `${text.slice(0, 2)}***${text.slice(-2)}`; }
function maskGameId(value) { return String(value || "").split(" ").map(mask).join(" "); }

const adapter = createWonddAdapter();
module.exports = { ...adapter, createWonddAdapter, buildWonddMlbbGameId, normalizeWonddError, normalizeWonddStatus, WonddAdapterError, WONDD_MLBB_SERVICE_CODE };
