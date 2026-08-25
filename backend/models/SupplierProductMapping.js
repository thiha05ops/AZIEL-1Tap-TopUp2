const mongoose = require("mongoose");
const { SUPPLIER_CURRENCY } = require("../constants/commerce");

const SUPPLIER_EXECUTION_MODES = Object.freeze({
    MANUAL: "MANUAL",
    API: "API"
});
const PRODUCTION_ROLES = Object.freeze(["PRIMARY", "BACKUP", "DISABLED"]);

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
        productionRole: {
            type: String,
            enum: PRODUCTION_ROLES,
            default: "DISABLED",
            required: true
        },
        archivedAt: { type: Date, default: null },
        archivedReason: { type: String, trim: true, maxlength: 240, default: "" },
        executionMode: {
            type: String,
            enum: Object.values(SUPPLIER_EXECUTION_MODES),
            required: true,
            default: SUPPLIER_EXECUTION_MODES.MANUAL
        },
        supplierCostAuthority: {
            rawSupplierCost: { type: Number, min: 0, default: null },
            supplierCurrency: { type: String, enum: SUPPLIER_CURRENCY, default: null },
            capturedAt: { type: Date, default: null },
            source: { type: String, trim: true, maxlength: 120, default: "" },
            providerProductCode: { type: String, trim: true, maxlength: 120, default: "" },
            providerOfferCode: { type: String, trim: true, maxlength: 120, default: "" },
            fundingCost: { type: Number, min: 0, default: 0 },
            otherAcquisitionCost: { type: Number, min: 0, default: 0 }
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
supplierProductMappingSchema.index({ archivedAt: 1, supplierCode: 1 });
supplierProductMappingSchema.index({ productCode: 1, packageCode: 1, region: 1, productionRole: 1 });
supplierProductMappingSchema.index(
    { productCode: 1, packageCode: 1, region: 1 },
    { unique: true, partialFilterExpression: { productionRole: "PRIMARY" }, name: "one_primary_supplier_per_package_region" }
);

module.exports = mongoose.model("SupplierProductMapping", supplierProductMappingSchema);
module.exports.SUPPLIER_EXECUTION_MODES = SUPPLIER_EXECUTION_MODES;
module.exports.PRODUCTION_ROLES = PRODUCTION_ROLES;
