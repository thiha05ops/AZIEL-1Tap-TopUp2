const fetch = require("node-fetch");

const WONDD_API_URL =
    process.env.WONDD_API_URL ||
    "https://www.wondd.com/member/bot-game.php";

function isConfigured() {
    return Boolean(
        String(process.env.WONDD_USERNAME || "").trim() &&
        String(process.env.WONDD_PASSWORD || "").trim()
    );
}

async function postWonDD(params = {}) {
    if (!isConfigured()) {
        throw new Error("WONDD_NOT_CONFIGURED");
    }

    const body = new URLSearchParams({
        ...params,
        username: String(process.env.WONDD_USERNAME).trim(),
        password: String(process.env.WONDD_PASSWORD).trim()
    });

    const response = await fetch(WONDD_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
    });

    if (!response.ok) {
        throw new Error(`WONDD_HTTP_${response.status}`);
    }

    const text = await response.text();

    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error("WONDD_INVALID_JSON");
    }

    return payload;
}

async function getBalance() {
    const payload = await postWonDD({
        method: "balance"
    });

    if (String(payload?.errorcode || "") !== "00") {
        return {
            status: "FAILED",
            supplierReference: "",
            supplierCode: "WONDD",
            providerStatus: String(payload?.errorcode || "UNKNOWN"),
            failureCode: String(payload?.errorcode || "WONDD_ERROR"),
            safeMessage: String(
                payload?.errordetail || "WonDD balance request failed."
            ),
            rawMetadata: {
                errorcode: payload?.errorcode || "",
                errordetail: payload?.errordetail || ""
            }
        };
    }

    const balance = Number(payload.balance);

    if (!Number.isFinite(balance) || balance < 0) {
        throw new Error("WONDD_INVALID_BALANCE");
    }

    return {
        status: "SUCCEEDED",
        supplierReference: "",
        supplierCode: "WONDD",
        providerStatus: "BALANCE_OK",
        failureCode: "",
        safeMessage: "WonDD balance fetched successfully.",
        rawMetadata: {
            balance,
            currency: "THB"
        }
    };
}

module.exports = {
    isConfigured,
    getBalance
};