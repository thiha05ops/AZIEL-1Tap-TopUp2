const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const PendingRegistration = require("../models/PendingRegistration");
const User = require("../models/User");
const { sendVerifyOTP } = require("./mail");

const PASSWORD_MIN_LENGTH = 8;
const REGISTER_OTP_MAX_ATTEMPTS = Number(process.env.REGISTRATION_OTP_MAX_ATTEMPTS || 5);
const REGISTER_OTP_TTL_MS = Number(process.env.REGISTRATION_OTP_TTL_MS || 10 * 60 * 1000);
const REGISTER_OTP_COOLDOWN_MS = Number(process.env.REGISTRATION_OTP_COOLDOWN_MS || 60 * 1000);
const DEV_REGISTRATION_OTP_PEPPER = "aziel-development-registration-otp-pepper-change-for-production";

class RegistrationError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "RegistrationError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}

function normalizeOtp(otp) {
    return String(otp || "").trim();
}

function isValidGmail(email) {
    return /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(normalizeEmail(email));
}

function getOtpPepper(env = process.env) {
    const value = String(env.REGISTRATION_OTP_PEPPER || "").trim();

    if (value) return value;
    if (env.NODE_ENV === "production") {
        throw new RegistrationError(
            "REGISTRATION_OTP_CONFIG_INVALID",
            "Registration verification is temporarily unavailable.",
            500
        );
    }

    return DEV_REGISTRATION_OTP_PEPPER;
}

function generateOtp() {
    return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(otp, email, env = process.env) {
    return crypto
        .createHmac("sha256", getOtpPepper(env))
        .update(`${normalizeEmail(email)}:${normalizeOtp(otp)}`)
        .digest("hex");
}

function validateRegistrationInput(input = {}) {
    const username = normalizeUsername(input.username);
    const email = normalizeEmail(input.email);
    const password = String(input.password || "");

    if (!username || !email || !password) {
        throw new RegistrationError(
            "REGISTRATION_INPUT_REQUIRED",
            "Username, Gmail and password required"
        );
    }

    if (username.length < 3) {
        throw new RegistrationError(
            "REGISTRATION_USERNAME_INVALID",
            "Username must be at least 3 characters"
        );
    }

    if (!isValidGmail(email)) {
        throw new RegistrationError(
            "REGISTRATION_EMAIL_INVALID",
            "Valid Gmail address required"
        );
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
        throw new RegistrationError(
            "REGISTRATION_PASSWORD_INVALID",
            `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
        );
    }

    return { username, email, password };
}

async function ensureNoUserConflict({ username, email }, deps) {
    const UserModel = deps.UserModel;
    const existingUser = await UserModel.findOne({
        $or: [
            { username },
            { email }
        ]
    });

    if (existingUser) {
        throw new RegistrationError(
            existingUser.username === username
                ? "REGISTRATION_USERNAME_TAKEN"
                : "REGISTRATION_EMAIL_REGISTERED",
            existingUser.username === username
                ? "Username already taken"
                : "Gmail already registered"
        );
    }
}

async function ensureNoActivePendingUsernameConflict({ username, email }, now, deps) {
    const PendingModel = deps.PendingRegistrationModel;
    const existingPending = await PendingModel.findOne({
        username,
        email: { $ne: email },
        consumedAt: null,
        otpExpiresAt: { $gt: now }
    });

    if (existingPending) {
        throw new RegistrationError(
            "REGISTRATION_USERNAME_PENDING",
            "Username already taken"
        );
    }
}

function isCooldownActive(pending, now) {
    return Boolean(
        pending?.resendAvailableAt &&
        pending.resendAvailableAt > now &&
        pending.consumedAt === null &&
        pending.otpExpiresAt > now
    );
}

async function beginRegistration(input, options = {}) {
    const deps = {
        PendingRegistrationModel: options.PendingRegistrationModel || PendingRegistration,
        UserModel: options.UserModel || User,
        sendVerifyOTP: options.sendVerifyOTP || sendVerifyOTP,
        env: options.env || process.env
    };
    const now = options.now || new Date();
    const normalized = validateRegistrationInput(input);

    await ensureNoUserConflict(normalized, deps);
    await ensureNoActivePendingUsernameConflict(normalized, now, deps);

    const existingPending = await deps.PendingRegistrationModel.findOne({
        email: normalized.email,
        consumedAt: null,
        otpExpiresAt: { $gt: now }
    });

    if (isCooldownActive(existingPending, now)) {
        return {
            success: false,
            code: "OTP_RESEND_COOLDOWN",
            message: "Please wait before requesting another OTP.",
            retryAt: existingPending.resendAvailableAt
        };
    }

    const otp = generateOtp();
    const passwordHash = await bcrypt.hash(normalized.password, 10);
    const otpExpiresAt = new Date(now.getTime() + REGISTER_OTP_TTL_MS);
    const resendAvailableAt = new Date(now.getTime() + REGISTER_OTP_COOLDOWN_MS);
    const challengeData = {
        email: normalized.email,
        username: normalized.username,
        passwordHash,
        displayName: normalized.username,
        otpHash: hashOtp(otp, normalized.email, deps.env),
        otpExpiresAt,
        otpAttempts: 0,
        resendAvailableAt,
        consumedAt: null,
        expiresAt: otpExpiresAt
    };

    let challenge;

    try {
        challenge = await deps.PendingRegistrationModel.findOneAndUpdate(
            { email: normalized.email },
            { $set: challengeData },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true
            }
        );

        await deps.sendVerifyOTP(normalized.email, otp);
    } catch (error) {
        if (challenge?._id || normalized.email) {
            await deps.PendingRegistrationModel.deleteOne({
                email: normalized.email,
                otpHash: challengeData.otpHash
            }).catch(() => {});
        }

        if (error instanceof RegistrationError) throw error;

        throw new RegistrationError(
            "REGISTRATION_EMAIL_SEND_FAILED",
            "Could not send verification OTP. Please try again later.",
            503
        );
    }

    return {
        success: true,
        message: "Verification OTP sent",
        email: normalized.email
    };
}

async function incrementFailedAttempt(challenge, deps) {
    const nextAttempts = Number(challenge.otpAttempts || 0) + 1;

    if (nextAttempts >= REGISTER_OTP_MAX_ATTEMPTS) {
        await deps.PendingRegistrationModel.deleteOne({ _id: challenge._id });

        throw new RegistrationError(
            "OTP_ATTEMPTS_EXCEEDED",
            "Too many invalid attempts. Please register again."
        );
    }

    await deps.PendingRegistrationModel.updateOne(
        { _id: challenge._id },
        { $set: { otpAttempts: nextAttempts } }
    );

    throw new RegistrationError("OTP_INVALID", "Invalid OTP");
}

async function verifyRegistrationOtp(input, options = {}) {
    const deps = {
        PendingRegistrationModel: options.PendingRegistrationModel || PendingRegistration,
        UserModel: options.UserModel || User,
        env: options.env || process.env
    };
    const now = options.now || new Date();
    const email = normalizeEmail(input.email);
    const otp = normalizeOtp(input.otp);

    if (!email || !/^\d{6}$/.test(otp)) {
        throw new RegistrationError("OTP_INVALID", "Invalid OTP");
    }

    const challenge = await deps.PendingRegistrationModel.findOne({
        email,
        consumedAt: null
    });

    if (!challenge) {
        throw new RegistrationError(
            "REGISTRATION_PENDING_NOT_FOUND",
            "Verification session expired. Please register again."
        );
    }

    if (challenge.otpExpiresAt <= now) {
        await deps.PendingRegistrationModel.deleteOne({ _id: challenge._id });

        throw new RegistrationError("OTP_EXPIRED", "OTP expired. Please register again.");
    }

    if (Number(challenge.otpAttempts || 0) >= REGISTER_OTP_MAX_ATTEMPTS) {
        await deps.PendingRegistrationModel.deleteOne({ _id: challenge._id });

        throw new RegistrationError(
            "OTP_ATTEMPTS_EXCEEDED",
            "Too many invalid attempts. Please register again."
        );
    }

    if (challenge.otpHash !== hashOtp(otp, email, deps.env)) {
        await incrementFailedAttempt(challenge, deps);
    }

    const consumed = await deps.PendingRegistrationModel.findOneAndUpdate(
        {
            _id: challenge._id,
            consumedAt: null,
            otpExpiresAt: { $gt: now },
            otpAttempts: { $lt: REGISTER_OTP_MAX_ATTEMPTS }
        },
        { $set: { consumedAt: now } },
        { new: true }
    );

    if (!consumed) {
        throw new RegistrationError(
            "REGISTRATION_PENDING_CONSUMED",
            "Verification session expired. Please register again."
        );
    }

    try {
        await ensureNoUserConflict({
            username: consumed.username,
            email: consumed.email
        }, deps);

        const verifiedAt = now;
        const user = await deps.UserModel.create({
            username: consumed.username,
            email: consumed.email,
            password: consumed.passwordHash,
            displayName: consumed.displayName || consumed.username,
            isVerified: true,
            emailVerified: true,
            emailVerifiedAt: verifiedAt,
            authProvider: "local",
            region: "MM",
            wallet: {
                MMK: 0,
                THB: 0
            },
            currentSessionToken: "",
            sessionUpdatedAt: null,
            lastActiveAt: verifiedAt
        });

        await deps.PendingRegistrationModel.deleteOne({ _id: consumed._id });

        return {
            success: true,
            message: "Email verified and account created",
            user
        };
    } catch (error) {
        if (error instanceof RegistrationError || error?.code === 11000) {
            await deps.PendingRegistrationModel.deleteOne({ _id: consumed._id }).catch(() => {});

            throw new RegistrationError(
                "REGISTRATION_ACCOUNT_EXISTS",
                "Account already exists"
            );
        }

        await deps.PendingRegistrationModel.updateOne(
            { _id: consumed._id },
            { $set: { consumedAt: null } }
        ).catch(() => {});

        throw error;
    }
}

function toRegistrationResponse(error) {
    if (error instanceof RegistrationError) {
        return {
            statusCode: error.statusCode,
            body: {
                success: false,
                code: error.code,
                message: error.message
            }
        };
    }

    return {
        statusCode: 500,
        body: {
            success: false,
            message: error.message || "Server error"
        }
    };
}

module.exports = {
    REGISTER_OTP_COOLDOWN_MS,
    REGISTER_OTP_MAX_ATTEMPTS,
    REGISTER_OTP_TTL_MS,
    RegistrationError,
    beginRegistration,
    generateOtp,
    hashOtp,
    normalizeEmail,
    normalizeOtp,
    normalizeUsername,
    toRegistrationResponse,
    verifyRegistrationOtp
};
