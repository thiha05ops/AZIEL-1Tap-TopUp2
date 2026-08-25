const defaultFetch = require("node-fetch");
const crypto = require("crypto");
const { sanitizeProviderMetadata } = require("../supplierAdapterRegistry");

const DEFAULT_BASE_URL = "https://api.fzr.cards/api/v2";
const clean = value => String(value == null ? "" : value).trim();

class FazerCardsAdapterError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "FazerCardsAdapterError";
        this.code = code;
        this.statusCode = details.statusCode || 502;
        this.retryable = Boolean(details.retryable);
        this.submissionUncertain = Boolean(details.submissionUncertain);
        this.providerMetadata = sanitizeProviderMetadata(details.providerMetadata || {});
    }
}

function normalizeStatus(payload = {}, reference = "") {
    const raw = clean(payload.status || payload.order_status || payload.data?.status).toLowerCase();
    const supplierReference = clean(reference || payload.id || payload.order_id || payload.data?.id || payload.data?.order_id);
    const metadata = sanitizeProviderMetadata({ status: raw || "missing", refunded: raw === "refunded", provider: payload.data || payload });
    if (["completed", "complete", "succeeded", "success"].includes(raw)) return result("SUCCEEDED", "COMPLETED", supplierReference, metadata, "FazerCards confirmed completion.");
    if (["failed", "failure", "cancelled", "canceled"].includes(raw)) return result("FAILED", "FAILED", supplierReference, metadata, "FazerCards reported fulfillment failure.");
    if (raw === "refunded") return result("FAILED", "REFUNDED", supplierReference, metadata, "FazerCards reported a refunded order; manual financial review is required.");
    if (["pending", "processing", "created", "queued", "in_progress"].includes(raw)) return result("PENDING", raw.toUpperCase(), supplierReference, metadata, "FazerCards is processing the order.");
    return result("PENDING", "UNKNOWN_PROVIDER_STATUS", supplierReference, metadata, "FazerCards returned an unknown non-terminal status; manual attention is required.");
}

function result(status, providerStatus, supplierReference = "", rawMetadata = {}, safeMessage = "") {
    return { status, supplierReference, supplierCode: "FAZERCARDS", providerStatus, failureCode: status === "FAILED" ? `FAZERCARDS_${providerStatus}` : "", safeMessage, rawMetadata };
}

function createFazerCardsAdapter(options = {}) {
    const fetchImpl = options.fetchImpl || defaultFetch;
    const env = options.env || process.env;
    const baseUrl = clean(options.baseUrl || env.FAZERCARDS_API_URL) || DEFAULT_BASE_URL;
    const apiKey = () => clean(env.FAZERCARDS_API_KEY);
    const isConfigured = () => Boolean(apiKey());
    const PRODUCT_GATE_KEYS = Object.freeze({ pubg: "FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED", mlbb: "FAZERCARDS_MLBB_AUTO_FULFILLMENT_ENABLED", freefire: "FAZERCARDS_FREEFIRE_AUTO_FULFILLMENT_ENABLED", hok: "FAZERCARDS_HOK_AUTO_FULFILLMENT_ENABLED", valorant: "FAZERCARDS_VALORANT_AUTO_FULFILLMENT_ENABLED" });
    const isAutoFulfillmentEnabled = product => {
        const key = PRODUCT_GATE_KEYS[clean(product).toLowerCase()];
        return Boolean(key) && clean(env[key]).toLowerCase() === "true";
    };

    async function request(path, options = {}) {
        if (!isConfigured()) throw new FazerCardsAdapterError("FAZERCARDS_NOT_CONFIGURED", "FazerCards credentials are not configured.", { statusCode: 409 });
        let response;
        try {
            response = await fetchImpl(`${baseUrl}${path}`, { method: options.method || "GET", headers: { Accept: "application/json", "X-API-Key": apiKey(), ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
        } catch {
            throw new FazerCardsAdapterError("FAZERCARDS_TRANSPORT_ERROR", "FazerCards request outcome could not be confirmed.", { retryable: true, submissionUncertain: options.submission === true });
        }
        let payload = {};
        try { payload = await response.json(); } catch { payload = {}; }
        if (!response.ok) throw new FazerCardsAdapterError(`FAZERCARDS_HTTP_${response.status}`, clean(payload.message || payload.error) || "FazerCards returned an HTTP error.", { statusCode: response.status, retryable: response.status >= 500, submissionUncertain: options.submission === true && response.status >= 500, providerMetadata: payload });
        return payload;
    }

    const getAccount = () => request("/me");
    async function getBalance() {
        const payload = await request("/balance");
        const value = payload.balance ?? payload.data?.balance;
        const balance = Number(value);
        if (!Number.isFinite(balance) || balance < 0) throw new FazerCardsAdapterError("FAZERCARDS_INVALID_BALANCE", "FazerCards returned an invalid balance.");
        return result("SUCCEEDED", "BALANCE_OK", "", { balance, currency: clean(payload.currency || payload.data?.currency || "USD").toUpperCase() }, "FazerCards balance fetched successfully.");
    }
    const getTopupCategories = (cursor = "") => request(`/topups${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    const getTopupOffers = categoryId => request(`/topups/offers?category_id=${encodeURIComponent(clean(categoryId))}`);
    const getOrder = orderId => request(`/orders/${encodeURIComponent(clean(orderId))}`);
    function buildValidationPayload({ validationCategoryId, fields }) {
        const categoryId = clean(validationCategoryId);
        if (!categoryId || !clean(fields?.player_id)) throw new FazerCardsAdapterError("FAZERCARDS_VALIDATION_CONTRACT_INVALID", "FazerCards validation category and Player ID are required.", { statusCode: 409 });
        if (categoryId === "mobile_legends" && !clean(fields?.zone_id)) throw new FazerCardsAdapterError("FAZERCARDS_VALIDATION_CONTRACT_INVALID", "FazerCards MLBB validation requires User ID and Zone ID.", { statusCode: 409 });
        return { category_id: categoryId, fields: categoryId === "mobile_legends" ? { player_id: clean(fields.player_id), zone_id: clean(fields.zone_id) } : { player_id: clean(fields.player_id) } };
    }

    function normalizeValidation(payload = {}, fallback = {}) {
        const data = payload.data || payload;
        const valid = data.valid === true;
        return {
            valid,
            providerStatus: valid ? "VALID" : "INVALID",
            playerName: clean(data.player_name),
            playerId: clean(data.player_id || fallback.player_id),
            region: clean(data.region),
            safeMessage: valid ? "FazerCards confirmed the player ID." : clean(data.message || data.error) || "FazerCards did not validate the player ID.",
            rawMetadata: sanitizeProviderMetadata({ valid: data.valid, player_name: data.player_name, player_id: data.player_id, region: data.region })
        };
    }

    async function validatePlayerId({ validationCategoryId, fields }) {
        const body = buildValidationPayload({ validationCategoryId, fields });
        try { return normalizeValidation(await request("/topups/validate-id", { method: "POST", body }), body.fields); }
        catch (error) {
            if (error.statusCode === 422) return normalizeValidation({ ...error.providerMetadata, valid: false }, body.fields);
            throw error;
        }
    }

    function buildTopupPayload({ categoryId, offerId, fields }) {
        const normalizedCategory = clean(categoryId);
        const orderFields = normalizedCategory === "mobile_legends_global"
            ? { player_id: clean(fields?.player_id), server_id: clean(fields?.server_id) }
            : normalizedCategory === "valorant_th"
                ? { riot_id: clean(fields?.riot_id) }
                : { player_id: clean(fields?.player_id) };
        const payload = { category_id: normalizedCategory, offer_id: clean(offerId), fields: orderFields };
        if (!payload.category_id || !payload.offer_id || !Object.values(payload.fields).every(Boolean)) throw new FazerCardsAdapterError("FAZERCARDS_ORDER_CONTRACT_INVALID", "FazerCards order authority and required customer fields are required.", { statusCode: 409 });
        if (normalizedCategory === "mobile_legends_global" && !payload.fields.server_id) throw new FazerCardsAdapterError("FAZERCARDS_ORDER_CONTRACT_INVALID", "FazerCards MLBB order requires User ID and Zone ID.", { statusCode: 409 });
        return payload;
    }

    function dryRunTopup({ categoryId, offerId, fields, idempotencyKey }) {
        const payload = buildTopupPayload({ categoryId, offerId, fields });
        if (!clean(idempotencyKey)) throw new FazerCardsAdapterError("FAZERCARDS_IDEMPOTENCY_KEY_REQUIRED", "FazerCards Idempotency-Key is required.", { statusCode: 409 });
        const mask = value => value.length <= 4 ? "****" : `${value.slice(0, 2)}***${value.slice(-2)}`;
        return { status: "DRY_RUN_VALID", liveEnabled: false, idempotencyKeyConfigured: true, payload: { ...payload, fields: Object.fromEntries(Object.entries(payload.fields).map(([key, value]) => [key, mask(value)])) } };
    }

    async function submitTopup({ categoryId, offerId, fields, idempotencyKey, productCode }) {
        if (!isAutoFulfillmentEnabled(productCode)) throw new FazerCardsAdapterError("FAZERCARDS_AUTO_FULFILLMENT_DISABLED", "Live FazerCards fulfillment is disabled for this product.", { statusCode: 409 });
        const orderPayload = buildTopupPayload({ categoryId, offerId, fields });
        if (!clean(idempotencyKey)) throw new FazerCardsAdapterError("FAZERCARDS_IDEMPOTENCY_KEY_REQUIRED", "FazerCards Idempotency-Key is required.", { statusCode: 409 });
        const payload = await request("/topups/order", { method: "POST", body: orderPayload, idempotencyKey: clean(idempotencyKey), submission: true });
        const reference = clean(payload.id || payload.order_id || payload.data?.id || payload.data?.order_id);
        if (!reference) throw new FazerCardsAdapterError("FAZERCARDS_ORDER_REFERENCE_MISSING", "FazerCards accepted an order without a provider order ID.", { submissionUncertain: true });
        return normalizeStatus(payload, reference);
    }

    async function checkStatus({ orderId }) { return normalizeStatus(await getOrder(orderId), orderId); }
    function verifyWebhookSignature(rawBody, signature, secret = clean(env.FAZERCARDS_WEBHOOK_SECRET)) {
        if (!secret || !Buffer.isBuffer(rawBody)) return false;
        const supplied = clean(signature).replace(/^sha256=/i, "");
        if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
        const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
        return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
    }
    return { isConfigured, isAutoFulfillmentEnabled, getAccount, getBalance, getTopupCategories, getTopupOffers, getOrder, buildValidationPayload, normalizeValidation, validatePlayerId, buildTopupPayload, dryRunTopup, submitTopup, checkStatus, verifyWebhookSignature };
}

const adapter = createFazerCardsAdapter();
module.exports = { ...adapter, createFazerCardsAdapter, normalizeStatus, FazerCardsAdapterError, DEFAULT_BASE_URL };
