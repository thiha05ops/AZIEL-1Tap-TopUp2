const mongoose = require("mongoose");

const SUPPLIER_EXECUTION_MODES = Object.freeze({
    MANUAL: "MANUAL",
    API: "API"
});

const supplierProductMappingSchema = new mongoose.Schema(
    {
        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            required: true
        },
        supplierCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },
        productCode: {
            type: String,
            required: true,
            trim: true,
            lowercase: true
        },
        packageCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },
        supplierProductCode: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        supplierPackageCode: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        supplierDisplayName: {
            type: String,
            trim: true,
            maxlength: 160,
            default: ""
        },
        region: {
            type: String,
            enum: ["MM", "TH"],
            required: true
        },
        enabled: {
            type: Boolean,
            default: true
        },
        executionMode: {
            type: String,
            enum: Object.values(SUPPLIER_EXECUTION_MODES),
            required: true,
            default: SUPPLIER_EXECUTION_MODES.MANUAL
        },
        mappingMetadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true
    }
);

supplierProductMappingSchema.index(
    { supplierId: 1, productCode: 1, packageCode: 1, region: 1 },
    { unique: true }
);
supplierProductMappingSchema.index({ productCode: 1, packageCode: 1, region: 1, enabled: 1 });
supplierProductMappingSchema.index({ supplierCode: 1 });

module.exports = mongoose.model("SupplierProductMapping", supplierProductMappingSchema);
module.exports.SUPPLIER_EXECUTION_MODES = SUPPLIER_EXECUTION_MODES;
