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
            enum: ["manual_admin", "provider_webhook", "automatic_provider", "wallet_internal"],
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

        openAppMode: {
            type: String,
            enum: ["direct", "bank_chooser", "disabled"],
            default: "disabled"
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

        androidPackageName: {
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
        railType: {
            type: String,
            enum: ["MANUAL_QR", "MANUAL_BANK_TRANSFER", "MANUAL_BANK_APP", "WALLET", "AUTO_PROMPTPAY", "AUTO_CARD", ""],
            default: ""
        },
        availabilityMode: {
            type: String,
            enum: ["MANUAL_ONLY", "AUTO_ONLY", "AUTO_WITH_MANUAL_FALLBACK", "DISABLED", ""],
            default: ""
        },
        routingPriority: {
            type: Number,
            default: 0
        },
        providerEnvironment: {
            type: String,
            enum: ["TEST", "LIVE", ""],
            default: ""
        },
        feeConfig: {
            minAmount: { type: Number, default: 0 },
            maxAmount: { type: Number, default: 0 },
            percentageFee: { type: Number, default: 0 },
            fixedFee: { type: Number, default: 0 },
            feeAbsorbedBy: {
                type: String,
                enum: ["CUSTOMER", "MERCHANT"],
                default: "MERCHANT"
            },
            displayText: { type: String, default: "" }
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
                            "scan_saved_qr",
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
        bankLaunchers: {
            type: [
                {
                    key: { type: String, default: "" },
                    displayName: { type: String, default: "" },
                    logoUrl: { type: String, default: "" },
                    enabled: { type: Boolean, default: true },
                    sortOrder: { type: Number, default: 0 },
                    androidPackageName: { type: String, default: "" },
                    androidAppLaunchUrl: { type: String, default: "" },
                    playStoreFallbackUrl: { type: String, default: "" },
                    iosAppLaunchUrl: { type: String, default: "" },
                    appStoreFallbackUrl: { type: String, default: "" },
                    verificationStatus: { type: String, default: "verified" },
                    sourcePaymentMethodKey: { type: String, default: "" },
                    legacyPaymentMethodId: { type: String, default: "" },
                    operatorNotes: { type: String, default: "" }
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
