const mongoose = require("mongoose");

const paymentMethodSchema = new mongoose.Schema(
    {
        method: {
            type: String,
            required: true
        },

        key: {
            type: String,
            required: true,
            unique: true
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

        accountName: {
            type: String,
            default: ""
        },

        accountNumber: {
            type: String,
            default: ""
        },

        qrImageUrl: {
            type: String,
            default: ""
        },

        uploadedQrImage: {
            type: String,
            default: ""
        },

        uploadedQrImageEvidence: {
            provider: { type: String, default: "" },
            key: { type: String, default: "" },
            url: { type: String, default: "" },
            mimeType: { type: String, default: "" },
            size: { type: Number, default: 0 },
            originalName: { type: String, default: "" },
            uploadedAt: { type: Date, default: null }
        },

        maintenanceMessage: {
            type: String,
            default: ""
        },

        logoUrl: {
            type: String,
            default: ""
        },

        shortDescription: {
            type: String,
            default: ""
        },

        badgeText: {
            type: String,
            default: ""
        },

        recipientLabel: {
            type: String,
            default: ""
        },

        referenceInstructions: {
            type: String,
            default: ""
        },

        qrMode: {
            type: String,
            enum: ["provider_generated", "uploaded_static", "aziel_promptpay_dynamic", "none"],
            default: "uploaded_static"
        },

        receiptUploadEnabled: {
            type: Boolean,
            default: true
        },

        confirmationMode: {
            type: String,
            enum: ["manual_admin", "automatic_provider", "wallet_internal"],
            default: "manual_admin"
        },

        availabilitySchedule: {
            type: String,
            default: ""
        },

        appDisplayName: {
            type: String,
            default: ""
        },

        deepLinkUrl: {
            type: String,
            default: ""
        },

        appStoreUrl: {
            type: String,
            default: ""
        },

        playStoreUrl: {
            type: String,
            default: ""
        },

        appLaunchMode: {
            type: String,
            enum: ["APP_ONLY", "OFFICIAL_PAYMENT_DEEPLINK"],
            default: "OFFICIAL_PAYMENT_DEEPLINK"
        },

        iosAppLaunchUrl: {
            type: String,
            default: ""
        },

        androidAppLaunchUrl: {
            type: String,
            default: ""
        },

        appStoreFallbackUrl: {
            type: String,
            default: ""
        },

        playStoreFallbackUrl: {
            type: String,
            default: ""
        },

        promptPayRecipientType: {
            type: String,
            enum: ["", "PHONE", "NATIONAL_ID", "TAX_ID"],
            default: ""
        },

        promptPayRecipientValue: {
            type: String,
            default: ""
        },

        dynamicQrExpiryMinutes: {
            type: Number,
            default: 15
        },

        paymentType: {
            type: String,
            enum: ["manual", "auto", "deeplink", "wallet"],
            default: "manual"
        },
        provider: {
            type: String,
            default: "manual"
        },

        providerConfig: {
            merchantId: {
                type: String,
                default: ""
            },
            apiKey: {
                type: String,
                default: ""
            },
            webhookSecret: {
                type: String,
                default: ""
            }
        },

        enableSaveQr: { type: Boolean, default: false },
        enableOpenApp: { type: Boolean, default: false },
        enableChecklist: { type: Boolean, default: false },
        dynamicQrSupported: { type: Boolean, default: false },
        amountPrefillSupported: { type: Boolean, default: false },
        referenceSupported: { type: Boolean, default: false },
        galleryScanSupported: { type: Boolean, default: false },
        slipRequired: { type: Boolean, default: undefined },
        autoVerificationSupported: { type: Boolean, default: false },
        webhookSupported: { type: Boolean, default: false },
        checklistSteps: {
            type: [
                {
                    key: { type: String, default: "" },
                    label: { type: String, default: "" },
                    action: {
                        type: String,
                        enum: [
                            "save_qr",
                            "open_app",
                            "upload_receipt",
                            "wait_for_confirmation",
                            "confirm_payment"
                        ],
                        default: "upload_receipt"
                    },
                    enabled: { type: Boolean, default: true },
                    sortOrder: { type: Number, default: 0 }
                }
            ],
            default: []
        },
        sortOrder: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

paymentMethodSchema.virtual("finalQrImage").get(function () {
    return this.uploadedQrImage || this.qrImageUrl || "";
});

paymentMethodSchema.set("toJSON", {
    virtuals: true
});

paymentMethodSchema.set("toObject", {
    virtuals: true
});

module.exports = mongoose.model(
    "PaymentMethod",
    paymentMethodSchema
);
