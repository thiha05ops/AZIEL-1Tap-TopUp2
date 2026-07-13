// backend/routes/auth.js

const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const User = require("../models/User");
const TwoFactorChallenge = require("../models/TwoFactorChallenge");
const {
    issueUserSession,
    projectUser,
    recordSecurityEvent
} = require("../services/authSessionService");
const {
    RegistrationError,
    beginRegistration,
    toRegistrationResponse,
    verifyRegistrationOtp
} = require("../services/registrationService");
const {
    consumeChallenge,
    consumeRecoveryCode,
    createLoginChallenge,
    decryptSecret,
    failChallenge,
    verifyLoginChallenge,
    verifyTotp
} = require("../services/twoFactorService");

const router = express.Router();

const twoFactorLoginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_2FA_LOGIN || 12),
    standardHeaders: true,
    legacyHeaders: false
});

/* ======================================================
   REGISTER - SEND VERIFY OTP
====================================================== */

router.post("/register", async (req, res) => {
    try {
        const result = await beginRegistration(req.body);

        return res.json({
            success: result.success,
            code: result.code,
            message: result.message,
            retryAt: result.retryAt
        });
    } catch (error) {
        if (!(error instanceof RegistrationError)) {
            console.log("Register error:", error);
        }
        const response = toRegistrationResponse(error);

        return res.status(response.statusCode).json(response.body);
    }
});

/* ======================================================
   VERIFY EMAIL - CREATE USER
====================================================== */

router.post("/verify-email", async (req, res) => {
    try {
        const result = await verifyRegistrationOtp(req.body);
        const user = result.user;

        await recordSecurityEvent(user, {
            type: "email.verified",
            title: "Email verified"
        });

        return res.json({
            success: true,
            message: result.message,
            user: {
                username: user.username,
                email: user.email,
                displayName: user.displayName || user.username,
                region: user.region || "MM",
                role: user.role || "user"
            }
        });
    } catch (error) {
        if (!(error instanceof RegistrationError)) {
            console.log("Verify email error:", error);
        }
        const response = toRegistrationResponse(error);

        return res.status(response.statusCode).json(response.body);
    }
});

/* ======================================================
   LOGIN
====================================================== */

router.post("/login", async (req, res) => {
    try {
        const loginId = String(req.body.username || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (!loginId || !password) {
            return res.json({
                success: false,
                message: "Username/email and password required"
            });
        }

        const user = await User.findOne({
            $or: [
                { username: loginId },
                { email: loginId }
            ]
        });

        if (!user) {
            return res.json({
                success: false,
                message: "Wrong username/email or password"
            });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            await recordSecurityEvent(user, {
                type: "login.failed",
                title: "Failed sign-in",
                metadata: { reason: "bad_password" }
            });

            return res.json({
                success: false,
                message: "Wrong username/email or password"
            });
        }

        if (user.twoFactorEnabled) {
            const challenge = await createLoginChallenge(user, {
                loginId,
                provider: user.authProvider || "local"
            });

            return res.json({
                success: true,
                twoFactorRequired: true,
                challengeId: challenge.challengeId,
                message: "Two-factor verification required"
            });
        }

        const issued = await issueUserSession(user, req, {
            provider: user.authProvider || "local",
            eventType: "login.success",
            eventTitle: "New sign-in"
        });

        return res.json({
            success: true,
            token: issued.token,
            message: "Login success",
            user: projectUser(user)
        });
    } catch (error) {
        console.log("Login error:", error);

        return res.json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

router.post("/auth/2fa/verify", twoFactorLoginLimiter, async (req, res) => {
    try {
        const challengeId = String(req.body.challengeId || "");
        const code = String(req.body.code || "");
        const recoveryCode = String(req.body.recoveryCode || "");

        const challengeRecord = await TwoFactorChallenge.findOne({
            challengeId,
            consumedAt: null
        });

        if (!challengeRecord) {
            return res.status(400).json({
                success: false,
                message: "Two-factor challenge expired. Please sign in again."
            });
        }

        const user = await User.findById(challengeRecord.userId);

        if (!user || !user.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                message: "Two-factor challenge is invalid"
            });
        }

        const challenge = await verifyLoginChallenge(challengeId, user);

        if (!challenge.success) {
            return res.status(400).json(challenge);
        }

        let verified = false;
        let usedRecoveryCode = false;

        if (recoveryCode) {
            usedRecoveryCode = await consumeRecoveryCode(user, recoveryCode);
            verified = usedRecoveryCode;
        }

        if (!verified && code && user.twoFactorSecretEncrypted) {
            const secret = decryptSecret(user.twoFactorSecretEncrypted);
            verified = await verifyTotp(secret, code);
        }

        if (!verified) {
            await failChallenge(challenge.challenge);
            await recordSecurityEvent(user, {
                type: "two_factor.challenge_failed",
                title: "Two-factor login verification failed"
            });

            return res.status(400).json({
                success: false,
                message: "Invalid authenticator or recovery code"
            });
        }

        if (usedRecoveryCode) {
            await recordSecurityEvent(user, {
                type: "recovery_code.used",
                title: "Recovery code used for sign-in"
            });
        }

        await user.save();
        await consumeChallenge(challenge.challenge);

        const issued = await issueUserSession(user, req, {
            provider: user.authProvider || "local",
            eventType: "login.success",
            eventTitle: "New sign-in"
        });

        return res.json({
            success: true,
            token: issued.token,
            message: "Login success",
            user: projectUser(user)
        });
    } catch (error) {
        console.log("2FA login verify error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not verify two-factor challenge"
        });
    }
});

module.exports = router;
