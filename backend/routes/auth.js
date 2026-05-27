// backend/routes/auth.js

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

const JWT_SECRET =
    process.env.JWT_SECRET || "aziel_jwt_secret";

// REGISTER
router.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !password) {
            return res.json({
                success: false,
                message: "Username and password required"
            });
        }

        if (password.length < 6) {
            return res.json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        const existingUser = await User.findOne({ username });

        if (existingUser) {
            return res.json({
                success: false,
                message: "Username already taken"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            username,
            email: email || "",
            password: hashedPassword,
            displayName: username,
            region: "MM",
            wallet: {
                MMK: 0,
                THB: 0
            }
        });

        const token = jwt.sign(
            { id: user._id, username: user.username },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            success: true,
            message: "Account created successfully",
            token,
            user: {
                username: user.username,
                displayName: user.displayName || user.username,
                region: user.region || "MM"
            }
        });

    } catch (error) {
        console.log("Register error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({
                success: false,
                message: "Wrong username or password"
            });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.json({
                success: false,
                message: "Wrong username or password"
            });
        }

        const token = jwt.sign(
            { id: user._id, username: user.username },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            success: true,
            token,
            user: {
                username: user.username,
                displayName: user.displayName || user.username,
                region: user.region || "MM"
            }
        });

    } catch (error) {
        console.log("Login error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});
// ADMIN GET USERS LIST
router.get("/admin/users", async (req, res) => {
    try {
        const users = await User.find({})
            .select("username email displayName region createdAt")
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            users
        });

    } catch (error) {
        console.log("Admin users error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;