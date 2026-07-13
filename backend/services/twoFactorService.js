const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const {
    generate,
    generateSecret,
    generateURI,
    verify
} = require("otplib");

const TwoFactorChallenge = require("../models/TwoFactorChallenge");

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const SETUP_TTL_MS = 10 * 60 * 1000;
const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;
const TOTP_ISSUER = "AZIEL";
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

function getTotpOptions(secret) {
    return {
        secret,
        strategy: "totp",
        algorithm: "sha1",
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD_SECONDS
    };
}

function getEncryptionKey() {
    const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY || "";

    if (!raw) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("TWO_FACTOR_ENCRYPTION_KEY is required in production");
        }

        throw new Error("TWO_FACTOR_ENCRYPTION_KEY is required for two-factor setup");
    }

    const key = /^[a-f0-9]{64}$/i.test(raw)
        ? Buffer.from(raw, "hex")
        : Buffer.from(raw, "base64");

    if (key.length !== 32) {
        throw new Error("TWO_FACTOR_ENCRYPTION_KEY must be 32 bytes as hex or base64");
    }

    return key;
}

function encryptSecret(secret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(String(secret), "utf8"),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return [
        iv.toString("base64"),
        tag.toString("base64"),
        encrypted.toString("base64")
    ].join(".");
}

function decryptSecret(value) {
    const [ivRaw, tagRaw, encryptedRaw] = String(value || "").split(".");

    if (!ivRaw || !tagRaw || !encryptedRaw) {
        throw new Error("Invalid encrypted 2FA secret");
    }

    const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        getEncryptionKey(),
        Buffer.from(ivRaw, "base64")
    );

    decipher.setAuthTag(Buffer.from(tagRaw, "base64"));

    return Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, "base64")),
        decipher.final()
    ]).toString("utf8");
}

function createSetup(user) {
    const secret = generateSecret();
    const label = user.email || user.username || "AZIEL";

    user.pendingTwoFactorSecretEncrypted = encryptSecret(secret);
    user.pendingTwoFactorSetupExpiresAt = new Date(Date.now() + SETUP_TTL_MS);

    return {
        manualKey: secret,
        provisioningUri: generateURI({
            ...getTotpOptions(secret),
            issuer: TOTP_ISSUER,
            label
        })
    };
}

function normalizeTotpToken(token) {
    const value = String(token || "").trim();
    return /^\d{6}$/.test(value) ? value : "";
}

async function verifyTotp(secret, code) {
    const token = normalizeTotpToken(code);

    if (!token) return false;

    const result = await verify({
        ...getTotpOptions(secret),
        token,
        epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS
    });

    return Boolean(result?.valid);
}

async function generateTotpTokenForSmokeTest(secret) {
    return generate(getTotpOptions(secret));
}

async function verifyPendingSetup(user, code) {
    if (
        !user.pendingTwoFactorSecretEncrypted ||
        !user.pendingTwoFactorSetupExpiresAt ||
        user.pendingTwoFactorSetupExpiresAt < new Date()
    ) {
        return {
            success: false,
            message: "Two-factor setup expired. Please start again."
        };
    }

    const secret = decryptSecret(user.pendingTwoFactorSecretEncrypted);

    if (!(await verifyTotp(secret, code))) {
        return {
            success: false,
            message: "Invalid authenticator code"
        };
    }

    return {
        success: true,
        secret
    };
}

function generateRecoveryCodes() {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
        const first = crypto.randomBytes(4).toString("hex").toUpperCase();
        const second = crypto.randomBytes(4).toString("hex").toUpperCase();
        return `${first}-${second}`;
    });
}

async function hashRecoveryCodes(codes) {
    const records = [];

    for (const code of codes) {
        records.push({
            hash: await bcrypt.hash(normalizeRecoveryCode(code), 10),
            usedAt: null,
            createdAt: new Date()
        });
    }

    return records;
}

function normalizeRecoveryCode(code) {
    return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}

async function consumeRecoveryCode(user, code) {
    const normalized = normalizeRecoveryCode(code);

    for (const record of user.twoFactorRecoveryCodes || []) {
        if (record.usedAt || !record.hash) continue;

        if (await bcrypt.compare(normalized, record.hash)) {
            record.usedAt = new Date();
            return true;
        }
    }

    return false;
}

async function createLoginChallenge(user, metadata = {}) {
    return TwoFactorChallenge.create({
        challengeId: crypto.randomBytes(24).toString("hex"),
        userId: user._id,
        purpose: "login",
        attempts: 0,
        expiresAt: new Date(Date.now() + LOGIN_CHALLENGE_TTL_MS),
        metadata: sanitizeMetadata(metadata)
    });
}

async function verifyLoginChallenge(challengeId, user) {
    const challenge = await TwoFactorChallenge.findOne({
        challengeId: String(challengeId || ""),
        userId: user._id,
        purpose: "login",
        consumedAt: null
    });

    if (!challenge || challenge.expiresAt < new Date()) {
        return {
            success: false,
            message: "Two-factor challenge expired. Please sign in again."
        };
    }

    if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
        return {
            success: false,
            message: "Too many attempts. Please sign in again."
        };
    }

    return {
        success: true,
        challenge
    };
}

async function failChallenge(challenge) {
    challenge.attempts = Number(challenge.attempts || 0) + 1;
    await challenge.save();
}

async function consumeChallenge(challenge) {
    challenge.consumedAt = new Date();
    await challenge.save();
}

function sanitizeMetadata(metadata = {}) {
    const safe = {};

    Object.entries(metadata || {}).forEach(([key, value]) => {
        if (/password|token|secret|authorization|code/i.test(key)) return;
        safe[key] = value;
    });

    return safe;
}

module.exports = {
    consumeChallenge,
    consumeRecoveryCode,
    createLoginChallenge,
    createSetup,
    decryptSecret,
    encryptSecret,
    failChallenge,
    generateTotpTokenForSmokeTest,
    generateRecoveryCodes,
    hashRecoveryCodes,
    verifyLoginChallenge,
    verifyPendingSetup,
    verifyTotp
};
