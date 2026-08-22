"use strict";

const assert = require("assert");
const path = require("path");
const Module = require("module");

const ROOT = path.resolve(__dirname, "../..");
const originalLoad = Module._load;
const handlers = new Map();
let deliveredOtp = "";

const user = {
    username: "reset-user",
    email: "reset.user@gmail.com",
    password: "old-hash",
    authProvider: "local",
    resetOTP: "",
    resetOTPHash: "",
    resetOTPExpire: null,
    resetOTPVerified: false,
    resetOTPVerifiedAt: null,
    resetOTPAttempts: 0,
    resetOTPResendAvailableAt: null,
    async save() { return this; }
};

const expressMock = {
    Router() {
        return {
            post(route, handler) { handlers.set(route, handler); }
        };
    }
};

Module._load = function patchedLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (request === "express") return expressMock;
    if (request === "bcryptjs") return { hash: async value => `hashed:${value}` };
    if (resolved === path.join(ROOT, "backend/models/User.js")) return { findOne: async query => query.email === user.email ? user : null };
    if (resolved === path.join(ROOT, "backend/services/mail.js")) return { sendResetOTP: async (_email, otp) => { deliveredOtp = otp; } };
    if (resolved === path.join(ROOT, "backend/services/authSessionService.js")) return {
        createSecurityNotification: async () => {}, recordSecurityEvent: async () => {}, revokeAllUserSessions: async () => {}
    };
    return originalLoad.apply(this, arguments);
};

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

async function invoke(route, body) {
    const res = response();
    await handlers.get(route)({ body }, res);
    return res;
}

async function main() {
    require("../routes/password");
    let result = await invoke("/send-otp", { email: user.email });
    assert.strictEqual(result.body.success, true);
    assert(/^\d{6}$/.test(deliveredOtp));

    result = await invoke("/verify-otp", { email: user.email, otp: "000000" });
    assert.strictEqual(result.body.success, false);
    assert.strictEqual(result.body.message, "Invalid OTP");

    user.resetOTPExpire = new Date(Date.now() - 1000);
    result = await invoke("/verify-otp", { email: user.email, otp: deliveredOtp });
    assert.strictEqual(result.body.message, "OTP expired. Please request again.");

    user.resetOTPResendAvailableAt = null;
    result = await invoke("/send-otp", { email: user.email });
    assert.strictEqual(result.body.success, true);
    result = await invoke("/verify-otp", { email: user.email, otp: deliveredOtp });
    assert.strictEqual(result.body.success, true);

    result = await invoke("/reset", { email: user.email, newPassword: "NewPassword123!" });
    assert.strictEqual(result.body.success, true);
    assert.strictEqual(user.password, "hashed:NewPassword123!");

    result = await invoke("/reset", { email: user.email, newPassword: "AnotherPassword123!" });
    assert.strictEqual(result.body.success, false);
    assert.strictEqual(result.body.message, "OTP verification required");
    console.log("Password reset OTP verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
}).finally(() => {
    Module._load = originalLoad;
});
