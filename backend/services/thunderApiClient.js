"use strict";

const BASE_URL = "https://api.thunder.in.th/v2";

class ThunderApiError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = "ThunderApiError";
        this.code = code;
        this.retryable = options.retryable === true;
        this.statusCode = options.statusCode || 0;
    }
}

function createThunderApiClient(options = {}) {
    const apiKey = String(options.apiKey || process.env.THUNDER_API_KEY || "").trim();
    const fetchImpl = options.fetch || globalThis.fetch;
    const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 10000, 30000));

    async function verifyBank(input = {}) {
        if (!apiKey) throw new ThunderApiError("THUNDER_NOT_CONFIGURED", "Payment verification is unavailable.");
        if (typeof fetchImpl !== "function") throw new ThunderApiError("THUNDER_UNAVAILABLE", "Payment verification is unavailable.");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(`${BASE_URL}/verify/bank`, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    payload: String(input.payload || ""),
                    remark: String(input.remark || "").slice(0, 100),
                    matchAccount: true,
                    matchAmount: Number(input.matchAmount),
                    checkDuplicate: true
                }),
                signal: controller.signal
            });
            let body;
            try { body = await response.json(); } catch (_) {
                throw new ThunderApiError("THUNDER_INVALID_RESPONSE", "The slip verifier returned an invalid response.");
            }
            if (!response.ok) {
                const pending = String(body?.code || body?.status || body?.error?.code || "").toUpperCase() === "SLIP_PENDING";
                if (pending) return { status: "SLIP_PENDING" };
                throw new ThunderApiError("THUNDER_REJECTED", "The slip could not be verified.", { statusCode: response.status, retryable: response.status >= 500 });
            }
            return body;
        } catch (error) {
            if (error instanceof ThunderApiError) throw error;
            if (error?.name === "AbortError") throw new ThunderApiError("THUNDER_TIMEOUT", "Payment verification timed out. Please retry.", { retryable: true });
            throw new ThunderApiError("THUNDER_UNAVAILABLE", "Payment verification is temporarily unavailable.", { retryable: true });
        } finally {
            clearTimeout(timer);
        }
    }

    return Object.freeze({ verifyBank });
}

module.exports = Object.freeze({ BASE_URL, ThunderApiError, createThunderApiClient });
