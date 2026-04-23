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

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

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

router.put("/profile/me", authMiddleware, upload.single("photo"), async (req, res) => {
    try {
        const {
            displayName,
            telegram,
            phone,
            region,
            mlbbUserId,
            mlbbServerId
        } = req.body;

        const updateData = {
            displayName: displayName || "",
            telegram: telegram || "",
            phone: phone || "",
            region: region || "MM",
            mlbbUserId: mlbbUserId || "",
            mlbbServerId: mlbbServerId || ""
        };

        if (req.file) {
            updateData.photo = `/uploads/profile/${req.file.filename}`;
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            updateData,
            { new: true }
        ).select("-password");

        res.json({
            success: true,
            message: "Profile updated",
            user
        });
    } catch (error) {
        console.log("Update profile error:", error);
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;