"use strict";

const crypto = require("crypto");
const GoogleOAuthCallback = require("../models/GoogleOAuthCallback");

const CLAIM_TTL_MS = 10 * 60 * 1000;
const WAIT_TIMEOUT_MS = 30 * 1000;
const WAIT_INTERVAL_MS = 25;

function replaySecret(env = process.env) {
    return env.GOOGLE_OAUTH_REPLAY_SECRET || env.AUTH_COOKIE_SECRET || env.SESSION_SECRET || env.JWT_SECRET || "aziel_secret";
}

function digest(value, env = process.env) {
    return crypto.createHmac("sha256", replaySecret(env)).update(String(value || "")).digest("hex");
}

function keys(input, env) {
    return {
        callbackKey: digest(`code:${input.code}`, env),
        bindingKey: digest(`session:${input.expressSessionId}\nstate:${input.state}`, env)
    };
}

function sameKey(left, right) {
    const a = Buffer.from(String(left || ""));
    const b = Buffer.from(String(right || ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function defaultRepository() {
    return {
        async create(document) {
            await GoogleOAuthCallback.init();
            return GoogleOAuthCallback.create(document);
        },
        find(callbackKey) {
            return GoogleOAuthCallback.findOne({ callbackKey }).lean();
        },
        complete(callbackKey, bindingKey, sessionId) {
            return GoogleOAuthCallback.findOneAndUpdate(
                { callbackKey, bindingKey, status: "processing" },
                { $set: { status: "completed", sessionId } },
                { new: true }
            ).lean();
        },
        fail(callbackKey, bindingKey) {
            return GoogleOAuthCallback.findOneAndUpdate(
                { callbackKey, bindingKey, status: "processing" },
                { $set: { status: "failed" } },
                { new: true }
            ).lean();
        }
    };
}

function duplicateKey(error) {
    return error?.code === 11000 || error?.code === 11001;
}

function createGoogleOAuthCallbackReplayService(options = {}) {
    const env = options.env || process.env;
    const repository = options.repository || defaultRepository();
    const now = options.now || Date.now;
    const delay = options.delay || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const waitTimeoutMs = options.waitTimeoutMs || WAIT_TIMEOUT_MS;
    const waitIntervalMs = options.waitIntervalMs || WAIT_INTERVAL_MS;

    async function claim(input) {
        if (!input?.code || !input?.state || !input?.expressSessionId) return { owner: true, unmanaged: true };
        const identity = keys(input, env);
        try {
            await repository.create({ ...identity, status: "processing", sessionId: "", expiresAt: new Date(now() + CLAIM_TTL_MS) });
            return { owner: true, ...identity };
        } catch (error) {
            if (!duplicateKey(error)) throw error;
            const existing = await repository.find(identity.callbackKey);
            if (!existing || !sameKey(existing.bindingKey, identity.bindingKey)) {
                const mismatch = new Error("GOOGLE_OAUTH_CALLBACK_REPLAY_BINDING_MISMATCH");
                mismatch.code = "GOOGLE_OAUTH_CALLBACK_REPLAY_BINDING_MISMATCH";
                throw mismatch;
            }
            return { owner: false, ...identity };
        }
    }

    async function waitForResult(claimed) {
        const deadline = now() + waitTimeoutMs;
        while (now() <= deadline) {
            const existing = await repository.find(claimed.callbackKey);
            if (!existing || !sameKey(existing.bindingKey, claimed.bindingKey)) return { status: "failed" };
            if (existing.status !== "processing") return { status: existing.status, sessionId: existing.sessionId || "" };
            await delay(waitIntervalMs);
        }
        return { status: "failed" };
    }

    async function complete(claimed, sessionId) {
        if (claimed.unmanaged) return { status: "completed", sessionId };
        const completed = await repository.complete(claimed.callbackKey, claimed.bindingKey, sessionId);
        if (!completed) throw new Error("GOOGLE_OAUTH_CALLBACK_COMPLETION_FAILED");
        return completed;
    }

    async function fail(claimed) {
        if (!claimed || claimed.unmanaged || !claimed.owner) return;
        await repository.fail(claimed.callbackKey, claimed.bindingKey);
    }

    return { claim, complete, fail, waitForResult };
}

module.exports = {
    CLAIM_TTL_MS,
    createGoogleOAuthCallbackReplayService,
    googleOAuthCallbackReplayService: createGoogleOAuthCallbackReplayService()
};
