"use strict";

const mongoose = require("mongoose");

const packageSupplierSelectionSchema = new mongoose.Schema(
    {
        productCode: { type: String, required: true, trim: true, lowercase: true, immutable: true },
        packageCode: { type: String, required: true, trim: true, uppercase: true, immutable: true },
        customerMarket: { type: String, enum: ["TH", "MM"], required: true, immutable: true },
        supplierMappingId: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierProductMapping", required: true },
        selectedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminAccount", default: null },
        selectedByUsernameSnapshot: { type: String, required: true, trim: true, maxlength: 120 },
        selectedAt: { type: Date, required: true, default: Date.now },
        decisionVersion: { type: Number, required: true, min: 1, default: 1 },
        reason: { type: String, trim: true, maxlength: 500, default: "" }
    },
    {
        timestamps: true,
        strict: "throw",
        minimize: false,
        // Production index deployment is explicit and guarded. Development and
        // test retain Mongoose's convenient automatic index initialization.
        autoIndex: process.env.NODE_ENV !== "production",
        autoCreate: process.env.NODE_ENV !== "production"
    }
);

packageSupplierSelectionSchema.index(
    { productCode: 1, packageCode: 1, customerMarket: 1 },
    { unique: true, name: "one_package_supplier_selection_per_customer_market" }
);
packageSupplierSelectionSchema.index({ supplierMappingId: 1, customerMarket: 1 });
packageSupplierSelectionSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("PackageSupplierSelection", packageSupplierSelectionSchema);
