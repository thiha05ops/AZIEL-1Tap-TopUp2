const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
    {
        siteName: {
            type: String,
            default: "AZIEL 1Tap Shop"
        },

        announcement: {
            type: String,
            default: ""
        },

        maintenanceMode: {
            type: Boolean,
            default: false
        },

        defaultRegion: {
            type: String,
            default: "MM"
        },

        supportEnabled: {
            type: Boolean,
            default: true
        },

        liveChatEnabled: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Setting", settingSchema);