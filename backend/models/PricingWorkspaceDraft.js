const mongoose = require("mongoose");
const { CURRENCY, REGION } = require("../constants/commerce");

const packageRowSchema = new mongoose.Schema(
    {
        packageId: {
            type: String,
            trim: true,
            default: ""
        },
        packageCode: {
            type: String,
            trim: true,
            uppercase: true,
            required: true
        },
        stagedSupplierCost: {
            type: Number,
            min: 0,
            required: true
        },
        expectedUpdatedAt: {
            type: Date,
            default: null
        },
        pricingNote: {
            type: String,
            trim: true,
            default: ""
        },
        status: {
            type: String,
            enum: ["DRAFT", "PUBLISHED", "FAILED"],
            default: "DRAFT"
        },
        version: {
            type: Number,
            min: 1,
            default: 1
        },
        updatedBy: {
            type: String,
            trim: true,
            default: "admin"
        },
        updatedAt: {
            type: Date,
            default: Date.now
        }
    },
    { _id: false }
);

const pricingWorkspaceDraftSchema = new mongoose.Schema(
    {
        productId: {
            type: String,
            trim: true,
            lowercase: true,
            required: true
        },
        region: {
            type: String,
            enum: REGION,
            required: true
        },
        supplierCurrency: {
            type: String,
            enum: CURRENCY,
            required: true
        },
        supplierName: {
            type: String,
            trim: true,
            default: "Primary supplier"
        },
        supplierVersion: {
            type: String,
            trim: true,
            default: ""
        },
        packageRows: {
            type: [packageRowSchema],
            default: []
        },
        status: {
            type: String,
            enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
            default: "DRAFT",
            required: true
        },
        version: {
            type: Number,
            min: 1,
            default: 1
        },
        owner: {
            adminId: {
                type: String,
                trim: true,
                default: ""
            },
            username: {
                type: String,
                trim: true,
                default: ""
            },
            role: {
                type: String,
                trim: true,
                default: ""
            }
        },
        createdBy: {
            type: String,
            trim: true,
            default: "admin"
        },
        updatedBy: {
            type: String,
            trim: true,
            default: "admin"
        }
    },
    { timestamps: true }
);

pricingWorkspaceDraftSchema.index(
    { productId: 1, region: 1, supplierCurrency: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "DRAFT" } }
);
pricingWorkspaceDraftSchema.index({ region: 1, status: 1, updatedAt: -1 });
pricingWorkspaceDraftSchema.index({ "packageRows.packageCode": 1, region: 1, status: 1 });

module.exports = mongoose.model("PricingWorkspaceDraft", pricingWorkspaceDraftSchema);
