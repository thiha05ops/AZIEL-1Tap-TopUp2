const express = require("express");
const router = express.Router();
const Setting = require("../models/Settings");
const adminMiddleware = require("../middleware/adminMiddleware");

async function getOrCreateSettings() {
    let settings = await Setting.findOne();

    if (!settings) {
        settings = await Setting.create({});
    }

    return settings;
}

// GET SETTINGS
router.get("/settings", async (req, res) => {
    try {
        const settings = await getOrCreateSettings();

        res.json({
            success: true,
            settings
        });

    } catch (error) {
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

// ADMIN UPDATE SETTINGS
router.put("/admin/settings", adminMiddleware, async (req, res) => {
    try {
        const settings = await getOrCreateSettings();

        const allowed = [
            "siteName",
            "announcement",
            "maintenanceMode",
            "defaultRegion",
            "supportEnabled",
            "liveChatEnabled"
        ];

        allowed.forEach(key => {
            if (req.body[key] !== undefined) {
                settings[key] = req.body[key];
            }
        });

        await settings.save();

        res.json({
            success: true,
            message: "Settings updated",
            settings
        });

    } catch (error) {
        res.json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;