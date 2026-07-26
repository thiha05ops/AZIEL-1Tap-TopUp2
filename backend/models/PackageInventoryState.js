const mongoose = require("mongoose");
const { AVAILABILITY_STATE, INVENTORY_SOURCE } = require("../constants/commerce");
const { applyMetadataValidation } = require("./commerceSchemas");

const packageInventoryStateSchema = new mongoose.Schema(
    {
        packageId: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },
        packageCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: ""
        },
        packageRef: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CatalogPackage",
            default: null
        },
        availabilityState: {
            type: String,
            enum: AVAILABILITY_STATE,
            required: true,
            default: "AVAILABLE"
        },
        source: {
            type: String,
            enum: INVENTORY_SOURCE,
            required: true,
            default: "MANUAL"
        },
        supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            default: null
        },
        supplierOfferId: {
            type: String,
            trim: true,
            default: ""
        },
        supplierAvailable: {
            type: Boolean,
            default: true
        },
        manualOverrideEnabled: {
            type: Boolean,
            default: false
        },
        manualOverrideState: {
            type: String,
            enum: AVAILABILITY_STATE,
            default: undefined
        },
        customerMessage: {
            type: String,
            trim: true,
            default: ""
        },
        internalReason: {
            type: String,
            trim: true,
            default: ""
        },
        expectedRestockAt: {
            type: Date,
            default: null
        },
        lastSupplierSyncAt: {
            type: Date,
            default: null
        },
        lastAvailabilityChangeAt: {
            type: Date,
            default: null
        },
        changedBy: {
            type: String,
            trim: true,
            default: "admin"
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true }
);

applyMetadataValidation(packageInventoryStateSchema);

packageInventoryStateSchema.index({ packageId: 1 }, { unique: true });
packageInventoryStateSchema.index({ packageCode: 1 });
packageInventoryStateSchema.index({ packageRef: 1 }, { sparse: true });
packageInventoryStateSchema.index({ availabilityState: 1, source: 1 });
packageInventoryStateSchema.index({ supplierId: 1, supplierOfferId: 1 });
packageInventoryStateSchema.index({ expectedRestockAt: 1 });
packageInventoryStateSchema.index({ lastAvailabilityChangeAt: -1 });

module.exports = mongoose.model("PackageInventoryState", packageInventoryStateSchema);
