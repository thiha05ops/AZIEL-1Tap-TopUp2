const mongoose = require("mongoose");
const { CATALOG_CATEGORIES, HOMEPAGE_FLAGS, HOMEPAGE_SECTIONS, CATALOG_LIFECYCLE, COMMERCE_STATES } = require("../catalog/catalogTaxonomy");

const catalogProductSchema = new mongoose.Schema(
    {
        productCode: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            lowercase: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            trim: true,
            default: ""
        },
        productKnowledge: {
            locales: {
                en: { type: mongoose.Schema.Types.Mixed, default: undefined },
                my: { type: mongoose.Schema.Types.Mixed, default: undefined },
                th: { type: mongoose.Schema.Types.Mixed, default: undefined }
            },
            shortDescription: { type: String, trim: true, maxlength: 280, default: "" },
            about: {
                summary: { type: String, trim: true, maxlength: 500, default: "" },
                details: { type: String, trim: true, maxlength: 3000, default: "" }
            },
            purchaseNotes: [{
                _id: false,
                title: { type: String, trim: true, maxlength: 100, default: "" },
                body: { type: String, trim: true, maxlength: 800, default: "" }
            }],
            packageGuide: {
                intro: { type: String, trim: true, maxlength: 800, default: "" },
                groups: [{
                    _id: false,
                    title: { type: String, trim: true, maxlength: 100, default: "" },
                    description: { type: String, trim: true, maxlength: 800, default: "" },
                    packageCodes: { type: [String], default: [] }
                }]
            },
            faq: [{
                _id: false,
                question: { type: String, trim: true, maxlength: 180, default: "" },
                answer: { type: String, trim: true, maxlength: 1200, default: "" }
            }]
        },
        fulfillment: {
            manualAllowedRegions: {
                type: [String],
                enum: ["MM", "TH"],
                default: []
            }
        },
        enabled: {
            type: Boolean,
            default: true
        },
        featured: {
            type: Boolean,
            default: false
        },
        catalogCategory: {
            type: String,
            enum: CATALOG_CATEGORIES,
            default: undefined
        },
        lifecycleStatus: {
            type: String,
            enum: CATALOG_LIFECYCLE,
            default: "ACTIVE"
        },
        commerceState: {
            type: String,
            enum: COMMERCE_STATES,
            default: "HIDDEN"
        },
        publicDiscoveryEnabled: {
            type: Boolean,
            default: false
        },
        homepageEnabled: {
            type: Boolean,
            default: false
        },
        homepageCategory: {
            type: String,
            enum: CATALOG_CATEGORIES,
            default: undefined
        },
        homepageOrder: {
            type: Number,
            default: 0
        },
        homepageFlags: {
            type: [String],
            enum: HOMEPAGE_FLAGS,
            default: []
        },
        homepageSections: {
            type: [String],
            enum: HOMEPAGE_SECTIONS,
            default: []
        },
        productRoute: {
            type: String,
            trim: true,
            default: ""
        },
        artworkPath: {
            type: String,
            trim: true,
            default: ""
        },
        supportedRegions: {
            type: [String],
            enum: ["GLOBAL", "MM", "TH", "ID", "MY", "SG", "PH", "SEA", "ASIA"],
            default: []
        },
        aliases: {
            type: [String],
            default: []
        },
        sortOrder: {
            type: Number,
            default: 0
        },
        source: {
            type: String,
            enum: ["seeded", "admin"],
            default: "seeded"
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        seo: {
            title: {
                type: String,
                trim: true,
                default: ""
            },
            description: {
                type: String,
                trim: true,
                default: ""
            }
        },
        presentation: {
            previewPrice: {
                amount: { type: Number, min: 0, default: null },
                currency: { type: String, enum: ["MMK", "THB"], default: undefined },
                label: { type: String, enum: ["PREVIEW_PRICE", "ESTIMATED", "FROM", "NONE"], default: "PREVIEW_PRICE" }
            },
            displayMarketLabel: {
                type: String,
                trim: true,
                maxlength: 60,
                default: ""
            },
            marketScope: {
                type: String,
                enum: ["GLOBAL", "REGION", "MULTI_REGION"],
                default: "MULTI_REGION"
            },
            imageAssetId: {
                type: String,
                trim: true,
                default: ""
            },
            bannerAssetId: {
                type: String,
                trim: true,
                default: ""
            },
            mobilePackagePreview: {
                assetId: {
                    type: String,
                    trim: true,
                    default: ""
                }
            }
        },
        deletedAt: {
            type: Date,
            default: null
        },
        deletedBy: {
            type: String,
            trim: true,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

catalogProductSchema.index({ productCode: 1 }, { unique: true });
catalogProductSchema.index({ enabled: 1, sortOrder: 1 });
catalogProductSchema.index({ homepageEnabled: 1, homepageCategory: 1, homepageOrder: 1 });
catalogProductSchema.index({ homepageEnabled: 1, homepageSections: 1, homepageOrder: 1 });
catalogProductSchema.index({ deletedAt: 1 });
catalogProductSchema.index({ "presentation.imageAssetId": 1 });
catalogProductSchema.index({ "presentation.bannerAssetId": 1 });
catalogProductSchema.index({ "presentation.mobilePackagePreview.assetId": 1 });

module.exports = mongoose.model("CatalogProduct", catalogProductSchema);
