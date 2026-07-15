const mongoose = require("mongoose");

const mediaAssetSchema = new mongoose.Schema(
    {
        assetId: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            trim: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        category: {
            type: String,
            enum: [
                "product_image",
                "product_banner",
                "home_banner",
                "package_icon",
                "campaign",
                "promotion",
                "announcement",
                "other"
            ],
            required: true
        },
        altText: {
            type: String,
            trim: true,
            default: ""
        },
        storageProvider: {
            type: String,
            trim: true,
            default: ""
        },
        storageKey: {
            type: String,
            trim: true,
            default: ""
        },
        publicId: {
            type: String,
            trim: true,
            default: ""
        },
        url: {
            type: String,
            trim: true,
            default: ""
        },
        secureUrl: {
            type: String,
            trim: true,
            default: ""
        },
        mimeType: {
            type: String,
            trim: true,
            default: ""
        },
        sizeBytes: {
            type: Number,
            default: 0
        },
        originalName: {
            type: String,
            trim: true,
            default: ""
        },
        uploadedBy: {
            type: String,
            trim: true,
            default: "admin"
        },
        status: {
            type: String,
            enum: ["active", "deleted"],
            default: "active"
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true
    }
);

mediaAssetSchema.index({ category: 1, status: 1, createdAt: -1 });
mediaAssetSchema.index({ name: "text", altText: "text", originalName: "text" });

module.exports = mongoose.model("MediaAsset", mediaAssetSchema);
