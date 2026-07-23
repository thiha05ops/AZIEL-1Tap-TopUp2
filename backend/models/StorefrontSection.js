const mongoose = require("mongoose");

const storefrontSectionSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            lowercase: true
        },
        displayName: {
            type: String,
            required: true,
            trim: true
        },
        icon: {
            type: String,
            required: true,
            trim: true
        },
        path: {
            type: String,
            required: true,
            immutable: true,
            trim: true
        },
        status: {
            type: String,
            enum: ["PUBLISHED", "COMING_SOON", "HIDDEN"],
            default: "PUBLISHED"
        },
        showInGamesMenu: {
            type: Boolean,
            default: true
        },
        showOnHome: {
            type: Boolean,
            default: false
        },
        sortOrder: {
            type: Number,
            default: 0
        },
        isSystem: {
            type: Boolean,
            default: true
        },
        updatedBy: {
            type: String,
            trim: true,
            default: "admin"
        }
    },
    {
        timestamps: true
    }
);

storefrontSectionSchema.index({ key: 1 }, { unique: true });
storefrontSectionSchema.index({ showInGamesMenu: 1, status: 1, sortOrder: 1 });

module.exports = mongoose.model("StorefrontSection", storefrontSectionSchema);
