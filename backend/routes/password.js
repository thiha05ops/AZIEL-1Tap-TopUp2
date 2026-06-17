// backend/routes/password.js

const express = require("express");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const { sendResetOTP } = require("../services/mail");

const router = express.Router();

function isValidGmail(email) {
    return /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(
        String(email).toLowerCase()
    );
}

function makeOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
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

        const otp = makeOTP();

        user.resetOTP = otp;
        user.resetOTPExpire = new Date(Date.now() + 10 * 60 * 1000);
        user.resetOTPVerified = false;

        await user.save();

        console.log("AZIEL RESET OTP:", email, otp);

        await sendResetOTP(email, otp);

        return res.json({
            success: true,
            message: "OTP sent successfully"
        });

    } catch (error) {
        console.log("Send OTP error:", error);

        return res.json({
            success: false,
            message: error.message || "Server error"
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

        if (!user || !user.resetOTP || !user.resetOTPExpire) {
            return res.json({
                success: false,
                message: "OTP not found. Please request again."
            });
        }

        if (user.resetOTPExpire < new Date()) {
            user.resetOTP = "";
            user.resetOTPExpire = null;
            user.resetOTPVerified = false;
            await user.save();

            return res.json({
                success: false,
                message: "OTP expired. Please request again."
            });
        }

        if (user.resetOTP !== otp) {
            return res.json({
                success: false,
                message: "Invalid OTP"
            });
        }

        user.resetOTPVerified = true;
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

        if (newPassword.length < 6) {
            return res.json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        const user = await User.findOne({ email });

        if (
            !user ||
            !user.resetOTP ||
            !user.resetOTPExpire ||
            !user.resetOTPVerified
        ) {
            return res.json({
                success: false,
                message: "OTP verification required"
            });
        }

        if (user.resetOTPExpire < new Date()) {
            user.resetOTP = "";
            user.resetOTPExpire = null;
            user.resetOTPVerified = false;
            await user.save();

            return res.json({
                success: false,
                message: "OTP expired. Please request again."
            });
        }

        user.password = await bcrypt.hash(newPassword, 10);

        user.resetOTP = "";
        user.resetOTPExpire = null;
        user.resetOTPVerified = false;

        // Password reset ပြီးရင် device အဟောင်းတွေ logout ဖြစ်စေမယ်
        user.currentSessionToken = "";
        user.sessionUpdatedAt = new Date();

        await user.save();

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