const Omise = require("omise");

class OmisePaymentError extends Error {
    constructor(code, message, statusCode = 400, options = {}) {
        super(message);
        this.name = "OmisePaymentError";
        this.code = code;
        this.statusCode = statusCode;
        this.retryable = Boolean(options.retryable);
    }
}

function normalizeMode(value, env = process.env) {
    const raw = String(value || env.OMISE_MODE || (env.NODE_ENV === "production" ? "live" : "test"))
        .trim()
        .toLowerCase();

    if (!["test", "live"].includes(raw)) {
        throw new OmisePaymentError(
            "OMISE_MODE_INVALID",
            "Omise payment mode must be test or live.",
            500
        );
    }

    return raw;
}

function expectedLivemode(mode = normalizeMode()) {
    return mode === "live";
}

function createOmiseClient(env = process.env) {
    const secretKey = String(env.OMISE_SECRET_KEY || "").trim();

    if (!secretKey) {
        throw new OmisePaymentError(
            "OMISE_SECRET_KEY_MISSING",
            "Omise secret key is required for provider verification.",
            503,
            { retryable: true }
        );
    }

    return Omise({
        publicKey: env.OMISE_PUBLIC_KEY,
        secretKey
    });
}

function normalizeCharge(rawCharge = {}, mode = normalizeMode()) {
    const chargeId = String(rawCharge.id || "").trim();

    if (!chargeId) {
        throw new OmisePaymentError(
            "OMISE_CHARGE_INVALID",
            "Provider charge response is missing a charge ID.",
            502,
            { retryable: true }
        );
    }

    const status = String(rawCharge.status || "").trim().toLowerCase();
    const amountMinor = Number(rawCharge.amount);
    const currency = String(rawCharge.currency || "").trim().toUpperCase();
    const livemode = Boolean(rawCharge.livemode);
    const metadata = rawCharge.metadata && typeof rawCharge.metadata === "object"
        ? rawCharge.metadata
        : {};

    return {
        provider: "omise",
        chargeId,
        status,
        paid: Boolean(rawCharge.paid) || status === "successful",
        amountMinor,
        currency,
        livemode,
        metadata,
        providerUpdatedAt: rawCharge.updated_at || rawCharge.paid_at || rawCharge.created_at || null,
        mode,
        expectedLivemode: expectedLivemode(mode)
    };
}

async function retrieveVerifiedCharge(chargeId, options = {}) {
    const safeChargeId = String(chargeId || "").trim();

    if (!safeChargeId) {
        throw new OmisePaymentError(
            "OMISE_CHARGE_ID_MISSING",
            "Webhook is missing provider charge ID.",
            400
        );
    }

    const mode = normalizeMode(options.mode, options.env || process.env);
    const client = options.client || createOmiseClient(options.env || process.env);

    try {
        const rawCharge = await client.charges.retrieve(safeChargeId);
        const charge = normalizeCharge(rawCharge, mode);

        if (charge.chargeId !== safeChargeId) {
            throw new OmisePaymentError(
                "OMISE_CHARGE_ID_MISMATCH",
                "Provider charge ID does not match requested charge ID.",
                409
            );
        }

        return charge;
    } catch (error) {
        if (error instanceof OmisePaymentError) throw error;

        const statusCode = Number(error?.statusCode || error?.status || 0);
        const code = statusCode === 404
            ? "OMISE_CHARGE_NOT_FOUND"
            : "OMISE_PROVIDER_UNAVAILABLE";

        throw new OmisePaymentError(
            code,
            code === "OMISE_CHARGE_NOT_FOUND"
                ? "Provider charge was not found."
                : "Provider charge verification failed.",
            code === "OMISE_CHARGE_NOT_FOUND" ? 404 : 503,
            { retryable: code !== "OMISE_CHARGE_NOT_FOUND" }
        );
    }
}

function assertChargeMode(charge) {
    if (Boolean(charge.livemode) !== Boolean(charge.expectedLivemode)) {
        throw new OmisePaymentError(
            "OMISE_MODE_MISMATCH",
            "Provider charge mode does not match configured Omise mode.",
            409
        );
    }
}

function assertChargePaid(charge) {
    if (!charge.paid || charge.status !== "successful") {
        throw new OmisePaymentError(
            "OMISE_CHARGE_NOT_PAID",
            "Provider charge is not successful.",
            409
        );
    }
}

function amountToMinorUnits(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
        throw new OmisePaymentError(
            "OMISE_AMOUNT_INVALID",
            "Invalid canonical payment amount.",
            500
        );
    }

    return Math.round(value * 100);
}

function assertChargeMatchesRecord(charge, record, options = {}) {
    const referenceType = options.referenceType || "order";
    const recordId = referenceType === "wallet_topup"
        ? record?.topupId
        : record?.orderId;

    if (!record) {
        throw new OmisePaymentError(
            referenceType === "wallet_topup" ? "WALLET_TOPUP_NOT_FOUND" : "ORDER_NOT_FOUND",
            "Payment reference was not found.",
            404
        );
    }

    if (String(charge.chargeId) !== String(record.transactionId || "")) {
        throw new OmisePaymentError(
            "OMISE_CHARGE_REFERENCE_MISMATCH",
            "Provider charge does not match persisted transaction reference.",
            409
        );
    }

    assertChargeMode(charge);
    assertChargePaid(charge);

    if (Number(charge.amountMinor) !== amountToMinorUnits(record.amount)) {
        throw new OmisePaymentError(
            "OMISE_AMOUNT_MISMATCH",
            "Provider charge amount does not match persisted payment amount.",
            409
        );
    }

    if (String(charge.currency || "").toUpperCase() !== String(record.currency || "").toUpperCase()) {
        throw new OmisePaymentError(
            "OMISE_CURRENCY_MISMATCH",
            "Provider charge currency does not match persisted payment currency.",
            409
        );
    }

    const metadata = charge.metadata || {};

    if (referenceType === "wallet_topup") {
        if (metadata.type && metadata.type !== "wallet_topup") {
            throw new OmisePaymentError(
                "OMISE_METADATA_MISMATCH",
                "Provider charge metadata type does not match wallet top-up.",
                409
            );
        }

        if (metadata.topupId && String(metadata.topupId) !== String(recordId || "")) {
            throw new OmisePaymentError(
                "OMISE_METADATA_MISMATCH",
                "Provider charge top-up reference does not match persisted top-up.",
                409
            );
        }

        return;
    }

    if (metadata.type && metadata.type !== "game_order") {
        throw new OmisePaymentError(
            "OMISE_METADATA_MISMATCH",
            "Provider charge metadata type does not match order payment.",
            409
        );
    }

    if (metadata.orderId && String(metadata.orderId) !== String(recordId || "")) {
        throw new OmisePaymentError(
            "OMISE_METADATA_MISMATCH",
            "Provider charge order reference does not match persisted order.",
            409
        );
    }
}

module.exports = {
    OmisePaymentError,
    amountToMinorUnits,
    assertChargeMatchesRecord,
    assertChargeMode,
    assertChargePaid,
    createOmiseClient,
    expectedLivemode,
    normalizeCharge,
    normalizeMode,
    retrieveVerifiedCharge
};
