const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const User = require("../models/User");
const Order = require("../models/Order");
const Notification = require("../models/Notification");
const WalletTopup = require("../models/WalletTopup");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads/profile");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },

    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });


// ============================
// GET PROFILE
// GET /api/profile/me
// ============================

router.get("/profile/me", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select("-password");

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


// ============================
// UPDATE PROFILE
// PUT /api/profile/me
// ============================

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

            user.displayName =
                (displayName || user.displayName || user.username).trim();

            user.telegram = telegram || "";
            user.phone = phone || "";
            user.region = region || "MM";
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
                message: "Server error"
            });
        }
    }
);

module.exports = router;