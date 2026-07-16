// backend/routes/password.js

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const User = require("../models/User");
const { sendResetOTP } = require("../services/mail");
const { EmailTransportError, SAFE_EMAIL_FAILURE_MESSAGE } = require("../services/emailTransportService");
const {
    createSecurityNotification,
    recordSecurityEvent,
    revokeAllUserSessions
} = require("../services/authSessionService");

const router = express.Router();

function isValidGmail(email) {
    return /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(
        String(email).toLowerCase()
    );
}

function makeOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const PASSWORD_MIN_LENGTH = 8;
const RESET_OTP_MAX_ATTEMPTS = 5;
const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_OTP_COOLDOWN_MS = 60 * 1000;

function hashOTP(otp) {
    return crypto
        .createHash("sha256")
        .update(String(otp || ""))
        .digest("hex");
}

function clearResetOTP(user) {
    user.resetOTP = "";
    user.resetOTPHash = "";
    user.resetOTPExpire = null;
    user.resetOTPVerified = false;
    user.resetOTPVerifiedAt = null;
    user.resetOTPAttempts = 0;
    user.resetOTPResendAvailableAt = null;
}

/* =========================
   SEND RESET OTP
========================= */
router.post("/send-otp", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();

        if (!isValidGmail(email)) {
            return res.json({
                success: false,
                message: "Valid Gmail address required"
            });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.json({
                success: false,
                message: "No account found with this Gmail"
            });
        }

        if (
            user.resetOTPResendAvailableAt &&
            user.resetOTPResendAvailableAt > new Date()
        ) {
            return res.json({
                success: false,
                message: "Please wait before requesting another OTP."
            });
        }

        const otp = makeOTP();

        user.resetOTP = "";
        user.resetOTPHash = hashOTP(otp);
        user.resetOTPExpire = new Date(Date.now() + RESET_OTP_TTL_MS);
        user.resetOTPVerified = false;
        user.resetOTPVerifiedAt = null;
        user.resetOTPAttempts = 0;
        user.resetOTPResendAvailableAt = new Date(Date.now() + RESET_OTP_COOLDOWN_MS);

        await user.save();

        try {
            await sendResetOTP(email, otp);
        } catch (error) {
            clearResetOTP(user);
            await user.save();

            if (!(error instanceof EmailTransportError)) {
                console.log("Password reset OTP email failed:", {
                    code: error?.code || "EMAIL_SEND_FAILED"
                });
            }

            return res.status(503).json({
                success: false,
                code: "PASSWORD_RESET_EMAIL_SEND_FAILED",
                message: SAFE_EMAIL_FAILURE_MESSAGE
            });
        }

        return res.json({
            success: true,
            message: "OTP sent successfully"
        });

    } catch (error) {
        console.log("Send OTP error:", {
            code: error?.code || "PASSWORD_RESET_OTP_FAILED"
        });

        return res.json({
            success: false,
            message: "Server error"
        });
    }
});

/* =========================
   VERIFY RESET OTP
========================= */
router.post("/verify-otp", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const otp = String(req.body.otp || "").trim();

        if (!email || !otp) {
            return res.json({
                success: false,
                message: "Email and OTP required"
            });
        }

        const user = await User.findOne({ email });

        if (!user || !user.resetOTPHash || !user.resetOTPExpire) {
            return res.json({
                success: false,
                message: "OTP not found. Please request again."
            });
        }

        if (user.resetOTPExpire < new Date()) {
            clearResetOTP(user);
            await user.save();

            return res.json({
                success: false,
                message: "OTP expired. Please request again."
            });
        }

        if (Number(user.resetOTPAttempts || 0) >= RESET_OTP_MAX_ATTEMPTS) {
            clearResetOTP(user);
            await user.save();

            return res.json({
                success: false,
                message: "Too many invalid attempts. Please request a new OTP."
            });
        }

        if (user.resetOTPHash !== hashOTP(otp)) {
            user.resetOTPAttempts = Number(user.resetOTPAttempts || 0) + 1;

            if (user.resetOTPAttempts >= RESET_OTP_MAX_ATTEMPTS) {
                clearResetOTP(user);
            }

            await user.save();

            return res.json({
                success: false,
                message: "Invalid OTP"
            });
        }

        user.resetOTPVerified = true;
        user.resetOTPVerifiedAt = new Date();
        await user.save();

        return res.json({
            success: true,
            message: "OTP verified",
            username: user.username,
            displayName: user.displayName || user.username
        });

    } catch (error) {
        console.log("Verify OTP error:", error);

        return res.json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

/* =========================
   RESET PASSWORD
========================= */
router.post("/reset", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const newPassword = String(req.body.newPassword || "");

        if (!email || !newPassword) {
            return res.json({
                success: false,
                message: "Email and new password required"
            });
        }

        if (newPassword.length < PASSWORD_MIN_LENGTH) {
            return res.json({
                success: false,
                message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
            });
        }

        const user = await User.findOne({ email });

        if (
            !user ||
            !user.resetOTPHash ||
            !user.resetOTPExpire ||
            !user.resetOTPVerified ||
            !user.resetOTPVerifiedAt
        ) {
            return res.json({
                success: false,
                message: "OTP verification required"
            });
        }

        if (user.resetOTPExpire < new Date()) {
            clearResetOTP(user);
            await user.save();

            return res.json({
                success: false,
                message: "OTP expired. Please request again."
            });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.passwordChangedAt = new Date();
        user.authProvider = user.authProvider === "google" ? "hybrid" : (user.authProvider || "local");

        clearResetOTP(user);

        await user.save();

        await revokeAllUserSessions(user, "password_reset");

        await recordSecurityEvent(user, {
            type: "password.reset",
            title: "Password reset completed"
        });

        await createSecurityNotification(user, {
            title: "Password reset completed",
            message: "Your AZIEL password was reset. Please sign in again."
        });

        return res.json({
            success: true,
            message: "Password updated successfully. Please login again."
        });

    } catch (error) {
        console.log("Reset password error:", error);

        return res.json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

module.exports = router;
