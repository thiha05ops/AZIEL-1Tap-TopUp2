const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const User = require("../models/User");

const router = express.Router();

router.post("/forgot-password", async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({
            $or: [{ username }, { email: username }],
        });

        if (!user || !user.email) {
            return res.json({
                success: false,
                message: "Account email not found",
            });
        }

        const resetToken = crypto.randomBytes(32).toString("hex");
        user.resetToken = resetToken;
        user.resetTokenExpire = Date.now() + 15 * 60 * 1000;
        await user.save();

        const resetLink = `https://aziel-1tap-topup2.onrender.com/reset.html?token=${resetToken}`;

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: "AZIEL Password Reset",
            html: `
        <h2>Reset your password</h2>
        <p>Click this link to reset your password:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>This link expires in 15 minutes.</p>
      `,
        });

        res.json({
            success: true,
            message: "Reset link sent to your email",
        });
    } catch (error) {
        console.log("Forgot password error:", error);
        res.json({
            success: false,
            message: "Server error",
        });
    }
});

router.post("/reset-password", async (req, res) => {
    try {
        const { token, password } = req.body;

        const user = await User.findOne({
            resetToken: token,
            resetTokenExpire: { $gt: Date.now() },
        });

        if (!user) {
            return res.json({
                success: false,
                message: "Invalid or expired reset link",
            });
        }

        user.password = await bcrypt.hash(password, 10);
        user.resetToken = "";
        user.resetTokenExpire = undefined;
        user.authProvider = "local";
        await user.save();

        res.json({
            success: true,
            message: "Password changed successfully",
        });
    } catch (error) {
        console.log("Reset password error:", error);
        res.json({
            success: false,
            message: "Server error",
        });
    }
});

module.exports = router;