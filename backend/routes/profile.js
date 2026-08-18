// backend/routes/profile.js

const express = require("express");

const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/imageMemoryUpload");
const {
    StorageError,
    cleanupAfterFailedPersistence,
    logStorageError,
    uploadFile
} = require("../services/storageService");

const router = express.Router();

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
        let photoEvidence = null;
        let profilePersisted = false;

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

            // Partial profile update authority:
            // Only mutate fields explicitly supplied by the client.
            if (displayName !== undefined) {
                const cleanDisplayName = String(displayName).trim();

                if (cleanDisplayName) {
                    user.displayName = cleanDisplayName;
                }
            }

            if (telegram !== undefined) {
                user.telegram = String(telegram).trim();
            }

            if (phone !== undefined) {
                user.phone = String(phone).trim();
            }

            if (region !== undefined) {
                user.region = region === "TH" ? "TH" : "MM";
            }

            if (mlbbUserId !== undefined) {
                user.mlbbUserId = String(mlbbUserId).trim();
            }

            if (mlbbServerId !== undefined) {
                user.mlbbServerId = String(mlbbServerId).trim();
            }

            if (req.file) {
                photoEvidence = await uploadFile({
                    file: req.file,
                    category: "profilePhoto",
                    ownerReference: req.user.id
                });
                user.photo = photoEvidence.url;
                user.photoEvidence = photoEvidence;
            }

            await user.save();
            profilePersisted = true;

            const updatedUser = await User.findById(req.user.id)
                .select("-password");

            res.json({
                success: true,
                message: "Profile updated",
                user: updatedUser
            });
        } catch (error) {
            console.log("Update profile error:", error);

            if (photoEvidence && !profilePersisted) {
                await cleanupAfterFailedPersistence(photoEvidence);
            }

            if (error instanceof StorageError) {
                logStorageError(error.code, {
                    provider: error.provider,
                    category: "profilePhoto"
                });

                return res.status(error.statusCode).json({
                    success: false,
                    code: error.code,
                    message: error.message
                });
            }

            res.json({
                success: false,
                message: error.message || "Server error"
            });
        }
    }
);

module.exports = router;
