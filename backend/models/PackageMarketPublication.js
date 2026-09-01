const mongoose = require("mongoose");

const packageMarketPublicationSchema = new mongoose.Schema(
    {
        productCode: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
        packageCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 120 },
        customerMarket: { type: String, required: true, trim: true, uppercase: true, enum: ["MM", "TH"] },
        published: { type: Boolean, required: true, default: false },
        publishedAt: { type: Date, default: null },
        publishedBy: { type: String, trim: true, maxlength: 120, default: "" },
        unpublishedAt: { type: Date, default: null },
        unpublishedBy: { type: String, trim: true, maxlength: 120, default: "" },
        decisionVersion: { type: Number, required: true, min: 1, default: 1 },
        decisionNote: { type: String, trim: true, maxlength: 500, default: "" },
        provenance: {
            source: { type: String, trim: true, maxlength: 120, default: "ADMIN" },
            migrationId: { type: String, trim: true, maxlength: 160, default: "" },
            legacySnapshotAt: { type: Date, default: null },
            metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
        }
    },
    { timestamps: true }
);

packageMarketPublicationSchema.index(
    { productCode: 1, packageCode: 1, customerMarket: 1 },
    { unique: true, name: "one_package_publication_per_customer_market" }
);
packageMarketPublicationSchema.index({ customerMarket: 1, published: 1, productCode: 1 });

module.exports = mongoose.model("PackageMarketPublication", packageMarketPublicationSchema);
