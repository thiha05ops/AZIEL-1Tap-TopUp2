"use strict";

const crypto = require("crypto");
const AuthHandoff = require("../models/AuthHandoff");

const HANDOFF_TTL_MS = 2 * 60 * 1000;

function hashCode(code) {
    return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

function createGoogleAuthHandoffService(options = {}) {
    const Handoff = options.Handoff || AuthHandoff;
    const randomBytes = options.randomBytes || crypto.randomBytes;
    const clock = options.clock || (() => new Date());

    return {
        async create(issued) {
            if (!issued?.token || !issued?.user) throw new Error("GOOGLE_HANDOFF_INPUT_INVALID");
            const code = randomBytes(32).toString("base64url");
            const now = clock();
            await Handoff.create({
                codeHash: hashCode(code),
                token: issued.token,
                user: issued.user,
                expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS)
            });
            return code;
        },

        async consume(code) {
            if (!code || String(code).length > 256) return null;
            const now = clock();
            const record = await Handoff.findOneAndUpdate(
                {
                    codeHash: hashCode(code),
                    consumedAt: null,
                    expiresAt: { $gt: now }
                },
                { $set: { consumedAt: now } },
                { new: true }
            ).lean();
            if (!record) return null;
            return { token: record.token, user: record.user };
        }
    };
}

const service = createGoogleAuthHandoffService();

module.exports = { HANDOFF_TTL_MS, createGoogleAuthHandoffService, hashCode, service };
