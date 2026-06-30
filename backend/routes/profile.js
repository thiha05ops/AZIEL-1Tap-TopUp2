// backend/routes/profile.js

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads/profile");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

function safeFileName(name) {
    return String(name || "profile")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },

    filename: function (req, file, cb) {
        cb(null, `${Date.now()}-${safeFileName(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: function (req, file, cb) {
        const allowed = ["image/jpeg", "image/png", "image/webp"];

        if (!allowed.includes(file.mimetype)) {
            return cb(new Error("Only JPG, PNG and WEBP images are allowed"));
        }

        cb(null, true);
    }
});

// GET /api/profile/me
router.get("/profile/me", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-password");

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        res.json({
            success: true,
            user
        });
    } catch (error) {
        console.log("Get profile error:", error);

        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// PUT /api/profile/me
router.put(
    "/profile/me",
    authMiddleware,
    upload.single("photo"),
    async (req, res) => {
        try {
            const {
                displayName,
                telegram,
                phone,
                region,
                mlbbUserId,
                mlbbServerId
            } = req.body;

            const user = await User.findById(req.user.id);

            if (!user) {
                return res.json({
                    success: false,
                    message: "User not found"
                });
            }

            const cleanRegion = region === "TH" ? "TH" : "MM";

            user.displayName =
                String(displayName || user.displayName || user.username)
                    .trim();

            user.telegram = telegram || "";
            user.phone = phone || "";
            user.region = cleanRegion;
            user.mlbbUserId = mlbbUserId || "";
            user.mlbbServerId = mlbbServerId || "";

            if (req.file) {
                user.photo = `/uploads/profile/${req.file.filename}`;
            }

            await user.save();

            const updatedUser = await User.findById(req.user.id)
                .select("-password");

            res.json({
                success: true,
                message: "Profile updated",
                user: updatedUser
            });
        } catch (error) {
            console.log("Update profile error:", error);

            res.json({
                success: false,
                message: error.message || "Server error"
            });
        }
    }
);

module.exports = router;