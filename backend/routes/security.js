const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const User = require("../models/User");
const Session = require("../models/Session");
const SecurityEvent = require("../models/SecurityEvent");
const authMiddleware = require("../middleware/authMiddleware");
const { normalizePersistedDeviceInfo } = require("../services/deviceInfoService");
const {
    createSecurityNotification,
    isEmailVerified,
    projectUser,
    recordSecurityEvent,
    revokeAllUserSessions,
    revokeOtherSessions,
    revokeSession
} = require("../services/authSessionService");
const {
    consumeRecoveryCode,
    createSetup,
    decryptSecret,
    encryptSecret,
    generateRecoveryCodes,
    hashRecoveryCodes,
    verifyPendingSetup,
    verifyTotp
} = require("../services/twoFactorService");

const router = express.Router();

const PASSWORD_MIN_LENGTH = 8;

const sensitiveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_SECURITY || 20),
    standardHeaders: true,
    legacyHeaders: false
});

const twoFactorSetupLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_2FA_SETUP || 20),
    standardHeaders: true,
    legacyHeaders: false
});

const twoFactorVerifyLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_2FA_VERIFY || 10),
    standardHeaders: true,
    legacyHeaders: false
});

const twoFactorManageLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_2FA_MANAGE || 10),
    standardHeaders: true,
    legacyHeaders: false
});

function hasLocalPassword(user) {
    return Boolean(user?.password && user.authProvider !== "google");
}

function projectSession(session, currentSessionId = "") {
    const device = normalizePersistedDeviceInfo(session);

    return {
        sessionId: session.sessionId,
        current: session.sessionId === currentSessionId,
        deviceType: device.deviceType,
        deviceLabel: device.deviceLabel,
        deviceName: device.deviceName,
        platform: device.platform,
        browser: device.browser,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        isCurrentSession: session.sessionId === currentSessionId
    };
}

function projectEvent(event) {
    return {
        id: String(event._id),
        type: event.type,
        title: event.title,
        createdAt: event.createdAt,
        deviceName: event.deviceName || "",
        metadata: event.metadata || {}
    };
}

async function getFreshUser(req) {
    return User.findById(req.user.id);
}

router.get("/overview", authMiddleware, async (req, res) => {
    try {
        const user = await getFreshUser(req);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.json({
            success: true,
            overview: {
                ...projectUser(user),
                emailVerified: isEmailVerified(user),
                emailVerifiedAt: user.emailVerifiedAt || null,
                googleLinked: Boolean(user.googleId),
                google: {
                    linked: Boolean(user.googleId),
                    provider: user.googleId ? (user.authProvider || "google") : (user.authProvider || "local")
                },
                hasPassword: hasLocalPassword(user),
                authProvider: user.authProvider || "local",
                twoFactorEnabled: Boolean(user.twoFactorEnabled),
                twoFactor: {
                    enabled: Boolean(user.twoFactorEnabled),
                    enabledAt: user.twoFactorEnabledAt || null,
                    recoveryCodesRemaining: (user.twoFactorRecoveryCodes || [])
                        .filter(item => !item.usedAt)
                        .length
                },
                currentSessionId: req.user.sessionId || "",
                legacyAuth: Boolean(req.user.legacyAuth),
                legacySession: Boolean(req.user.legacyAuth)
            }
        });
    } catch (error) {
        console.log("Security overview error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.post("/2fa/setup", authMiddleware, twoFactorSetupLimiter, async (req, res) => {
    try {
        const user = await getFreshUser(req);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (user.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                message: "Two-factor authentication is already enabled"
            });
        }

        const setup = createSetup(user);
        await user.save();

        return res.json({
            success: true,
            setup: {
                provisioningUri: setup.provisioningUri,
                manualKey: setup.manualKey,
                expiresAt: user.pendingTwoFactorSetupExpiresAt
            }
        });
    } catch (error) {
        console.log("2FA setup error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to start two-factor setup"
        });
    }
});

router.post("/2fa/verify-setup", authMiddleware, twoFactorVerifyLimiter, async (req, res) => {
    try {
        const user = await getFreshUser(req);
        const code = String(req.body.code || "");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (user.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                message: "Two-factor authentication is already enabled"
            });
        }

        const result = await verifyPendingSetup(user, code);

        if (!result.success) {
            await recordSecurityEvent(user, {
                type: "two_factor.challenge_failed",
                title: "Two-factor setup verification failed",
                sessionId: req.user.sessionId || ""
            });

            return res.status(400).json(result);
        }

        const recoveryCodes = generateRecoveryCodes();
        user.twoFactorSecretEncrypted = encryptSecret(result.secret);
        user.twoFactorEnabled = true;
        user.twoFactorEnabledAt = new Date();
        user.pendingTwoFactorSecretEncrypted = "";
        user.pendingTwoFactorSetupExpiresAt = null;
        user.twoFactorRecoveryCodes = await hashRecoveryCodes(recoveryCodes);
        await user.save();

        await recordSecurityEvent(user, {
            type: "two_factor.enabled",
            title: "Two-factor authentication enabled",
            sessionId: req.user.sessionId || ""
        });

        await createSecurityNotification(user, {
            title: "Two-factor authentication enabled",
            message: "Your AZIEL account now requires an authenticator code when signing in."
        });

        return res.json({
            success: true,
            message: "Two-factor authentication enabled",
            recoveryCodes
        });
    } catch (error) {
        console.log("2FA verify setup error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not verify two-factor setup"
        });
    }
});

async function verifyTwoFactorOrRecovery(user, code, recoveryCode, req, eventTitle = "Two-factor verification failed") {
    if (recoveryCode) {
        const used = await consumeRecoveryCode(user, recoveryCode);

        if (used) {
            await recordSecurityEvent(user, {
                type: "recovery_code.used",
                title: "Recovery code used",
                sessionId: req.user?.sessionId || ""
            });
            return true;
        }
    }

    if (code && user.twoFactorSecretEncrypted) {
        const secret = decryptSecret(user.twoFactorSecretEncrypted);
        if (await verifyTotp(secret, code)) return true;
    }

    await recordSecurityEvent(user, {
        type: "two_factor.challenge_failed",
        title: eventTitle,
        sessionId: req.user?.sessionId || ""
    });

    return false;
}

router.post("/2fa/recovery-codes/regenerate", authMiddleware, twoFactorManageLimiter, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user?.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                message: "Two-factor authentication is not enabled"
            });
        }

        if (!hasLocalPassword(user)) {
            return res.status(400).json({
                success: false,
                message: "Recovery code regeneration requires local password verification."
            });
        }

        const currentPassword = String(req.body.currentPassword || "");
        const passwordOk = await bcrypt.compare(currentPassword, user.password);

        if (!passwordOk) {
            return res.status(400).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        const verified = await verifyTwoFactorOrRecovery(
            user,
            String(req.body.code || ""),
            String(req.body.recoveryCode || ""),
            req,
            "Recovery code regeneration verification failed"
        );

        if (!verified) {
            await user.save();
            return res.status(400).json({
                success: false,
                message: "Invalid authenticator or recovery code"
            });
        }

        const recoveryCodes = generateRecoveryCodes();
        user.twoFactorRecoveryCodes = await hashRecoveryCodes(recoveryCodes);
        await user.save();

        await recordSecurityEvent(user, {
            type: "recovery_codes.regenerated",
            title: "Recovery codes regenerated",
            sessionId: req.user.sessionId || ""
        });

        await createSecurityNotification(user, {
            title: "Recovery codes regenerated",
            message: "Your previous AZIEL recovery codes are no longer valid."
        });

        return res.json({
            success: true,
            recoveryCodes
        });
    } catch (error) {
        console.log("2FA regenerate recovery codes error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not regenerate recovery codes"
        });
    }
});

router.post("/2fa/disable", authMiddleware, twoFactorManageLimiter, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user?.twoFactorEnabled) {
            return res.status(400).json({
                success: false,
                message: "Two-factor authentication is not enabled"
            });
        }

        if (!hasLocalPassword(user)) {
            return res.status(400).json({
                success: false,
                message: "Disabling 2FA requires local password verification."
            });
        }

        const currentPassword = String(req.body.currentPassword || "");
        const passwordOk = await bcrypt.compare(currentPassword, user.password);

        if (!passwordOk) {
            return res.status(400).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        const verified = await verifyTwoFactorOrRecovery(
            user,
            String(req.body.code || ""),
            String(req.body.recoveryCode || ""),
            req,
            "Two-factor disable verification failed"
        );

        if (!verified) {
            await user.save();
            return res.status(400).json({
                success: false,
                message: "Invalid authenticator or recovery code"
            });
        }

        user.twoFactorEnabled = false;
        user.twoFactorSecretEncrypted = "";
        user.twoFactorEnabledAt = null;
        user.pendingTwoFactorSecretEncrypted = "";
        user.pendingTwoFactorSetupExpiresAt = null;
        user.twoFactorRecoveryCodes = [];
        await user.save();

        await recordSecurityEvent(user, {
            type: "two_factor.disabled",
            title: "Two-factor authentication disabled",
            sessionId: req.user.sessionId || ""
        });

        await createSecurityNotification(user, {
            title: "Two-factor authentication disabled",
            message: "Your AZIEL account no longer requires an authenticator code when signing in."
        });

        return res.json({
            success: true,
            message: "Two-factor authentication disabled"
        });
    } catch (error) {
        console.log("2FA disable error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Could not disable two-factor authentication"
        });
    }
});

router.get("/sessions", authMiddleware, async (req, res) => {
    try {
        const sessions = await Session.find({
            userId: req.user._id,
            revokedAt: null,
            expiresAt: { $gt: new Date() }
        })
            .sort({ lastSeenAt: -1 })
            .limit(50);

        return res.json({
            success: true,
            sessions: sessions.map(session => projectSession(session, req.user.sessionId)),
            legacyAuth: Boolean(req.user.legacyAuth),
            legacySession: Boolean(req.user.legacyAuth)
        });
    } catch (error) {
        console.log("Security sessions error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.delete("/sessions/:sessionId", authMiddleware, sensitiveLimiter, async (req, res) => {
    try {
        const user = await getFreshUser(req);
        const sessionId = String(req.params.sessionId || "");

        const session = await revokeSession(sessionId, user, "user_revoked");
        const isCurrentSession = sessionId === req.user.sessionId;

        return res.json({
            success: Boolean(session),
            message: session ? "Session revoked" : "Session not found",
            forceLogout: isCurrentSession
        });
    } catch (error) {
        console.log("Revoke session error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.post("/sessions/revoke-others", authMiddleware, sensitiveLimiter, async (req, res) => {
    try {
        const user = await getFreshUser(req);
        await revokeOtherSessions(user, req.user.sessionId, "user_revoked_others");

        return res.json({
            success: true,
            message: "Other sessions revoked"
        });
    } catch (error) {
        console.log("Revoke other sessions error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.post("/sessions/revoke-all", authMiddleware, sensitiveLimiter, async (req, res) => {
    try {
        const user = await getFreshUser(req);
        await revokeAllUserSessions(user, "user_revoked_all");

        return res.json({
            success: true,
            forceLogout: true,
            message: "All sessions revoked"
        });
    } catch (error) {
        console.log("Revoke all sessions error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.post("/change-password", authMiddleware, sensitiveLimiter, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("+password");
        const currentPassword = String(req.body.currentPassword || "");
        const newPassword = String(req.body.newPassword || "");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (!user.password) {
            return res.status(400).json({
                success: false,
                message: "Password is managed by your sign-in provider."
            });
        }

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Current password and new password are required"
            });
        }

        if (newPassword.length < PASSWORD_MIN_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
            });
        }

        const currentMatches = await bcrypt.compare(currentPassword, user.password);

        if (!currentMatches) {
            return res.status(400).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        const samePassword = await bcrypt.compare(newPassword, user.password);

        if (samePassword) {
            return res.status(400).json({
                success: false,
                message: "New password must be different"
            });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.passwordChangedAt = new Date();
        user.authProvider = user.authProvider === "google" ? "hybrid" : (user.authProvider || "local");
        await user.save();

        await revokeAllUserSessions(user, "password_changed");

        await recordSecurityEvent(user, {
            type: "password.changed",
            title: "Password changed"
        });

        await createSecurityNotification(user, {
            title: "Password changed",
            message: "Your AZIEL password was changed. Please sign in again."
        });

        return res.json({
            success: true,
            forceLogout: true,
            message: "Password changed. Please sign in again."
        });
    } catch (error) {
        console.log("Change password error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.get("/events", authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit || 20), 50);
        const events = await SecurityEvent.find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(limit);

        return res.json({
            success: true,
            events: events.map(projectEvent)
        });
    } catch (error) {
        console.log("Security events error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;
