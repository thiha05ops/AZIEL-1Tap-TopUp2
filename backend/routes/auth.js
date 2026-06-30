// backend/routes/auth.js

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const User = require("../models/User");
const { sendVerifyOTP } = require("../services/mail");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "aziel_jwt_secret";
const isProduction = process.env.NODE_ENV === "production";

const pendingRegisters = {};

function devLog(...args) {
    if (!isProduction) {
        console.log(...args);
    }
}

function isValidGmail(email) {
    return /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(
        String(email || "").toLowerCase()
    );
}

function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}

function makeOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function makeSessionToken() {
    return crypto.randomBytes(32).toString("hex");
}

function getDeviceInfo(req) {
    const userAgent = req.headers["user-agent"] || "";

    const ip =
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket.remoteAddress ||
        "";

    return {
        deviceName: userAgent.includes("Mobile")
            ? "Mobile Device"
            : "Desktop Device",
        browser: userAgent,
        ip,
        loginAt: new Date()
    };
}

function createToken(user, sessionToken) {
    return jwt.sign(
        {
            id: user._id,
            username: user.username,
            role: user.role || "user",
            sessionToken
        },
        JWT_SECRET,
        {
            expiresIn: "15d"
        }
    );
}

function cleanExpiredPendingRegisters() {
    const now = Date.now();

    Object.keys(pendingRegisters).forEach(email => {
        if (pendingRegisters[email]?.expireAt < now) {
            delete pendingRegisters[email];
        }
    });
}

// REGISTER - SEND VERIFY OTP
router.post("/register", async (req, res) => {
    try {
        cleanExpiredPendingRegisters();

        const username = normalizeUsername(req.body.username);
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (!username || !email || !password) {
            return res.json({
                success: false,
                message: "Username, Gmail and password required"
            });
        }

        if (username.length < 3) {
            return res.json({
                success: false,
                message: "Username must be at least 3 characters"
            });
        }

        if (!isValidGmail(email)) {
            return res.json({
                success: false,
                message: "Valid Gmail address required"
            });
        }

        if (password.length < 6) {
            return res.json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        const existingUser = await User.findOne({
            $or: [
                { username },
                { email }
            ]
        });

        if (existingUser) {
            return res.json({
                success: false,
                message:
                    existingUser.username === username
                        ? "Username already taken"
                        : "Gmail already registered"
            });
        }

        const otp = makeOTP();

        pendingRegisters[email] = {
            username,
            email,
            password,
            otp,
            expireAt: Date.now() + 10 * 60 * 1000
        };

        devLog("AZIEL VERIFY OTP:", email, otp);

        await sendVerifyOTP(email, otp);

        return res.json({
            success: true,
            message: "Verification OTP sent"
        });
    } catch (error) {
        console.log("Register error:", error);

        return res.json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

// VERIFY EMAIL - CREATE USER
router.post("/verify-email", async (req, res) => {
    try {
        cleanExpiredPendingRegisters();

        const email = String(req.body.email || "").trim().toLowerCase();
        const otp = String(req.body.otp || "").trim();

        const pending = pendingRegisters[email];

        if (!pending) {
            return res.json({
                success: false,
                message: "Verification session expired. Please register again."
            });
        }

        if (pending.expireAt < Date.now()) {
            delete pendingRegisters[email];

            return res.json({
                success: false,
                message: "OTP expired. Please register again."
            });
        }

        if (pending.otp !== otp) {
            return res.json({
                success: false,
                message: "Invalid OTP"
            });
        }

        const existingUser = await User.findOne({
            $or: [
                { username: pending.username },
                { email: pending.email }
            ]
        });

        if (existingUser) {
            delete pendingRegisters[email];

            return res.json({
                success: false,
                message: "Account already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(pending.password, 10);

        const user = await User.create({
            username: pending.username,
            email: pending.email,
            password: hashedPassword,
            displayName: pending.username,
            isVerified: true,
            emailVerified: true,
            region: "MM",
            wallet: {
                MMK: 0,
                THB: 0
            },
            currentSessionToken: "",
            sessionUpdatedAt: null,
            lastActiveAt: new Date()
        });

        delete pendingRegisters[email];

        return res.json({
            success: true,
            message: "Email verified and account created",
            user: {
                username: user.username,
                email: user.email,
                displayName: user.displayName || user.username,
                region: user.region || "MM",
                role: user.role || "user"
            }
        });
    } catch (error) {
        console.log("Verify email error:", error);

        return res.json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

// LOGIN
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
            return res.json({
                success: false,
                message: "Wrong username/email or password"
            });
        }

        const now = new Date();
        const sessionToken = makeSessionToken();

        user.currentSessionToken = sessionToken;
        user.sessionUpdatedAt = now;
        user.lastActiveAt = now;
        user.lastLoginDevice = getDeviceInfo(req);

        await user.save();

        const token = createToken(user, sessionToken);

        return res.json({
            success: true,
            token,
            message: "Login success",
            user: {
                username: user.username,
                email: user.email,
                displayName: user.displayName || user.username,
                region: user.region || "MM",
                role: user.role || "user",
                emailVerified: Boolean(user.emailVerified || user.isVerified),
                isVerified: Boolean(user.emailVerified || user.isVerified),
                lastLoginDevice: user.lastLoginDevice
            }
        });
    } catch (error) {
        console.log("Login error:", error);

        return res.json({
            success: false,
            message: error.message || "Server error"
        });
    }
});

module.exports = router;