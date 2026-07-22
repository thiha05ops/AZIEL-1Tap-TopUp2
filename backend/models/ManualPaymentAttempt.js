const mongoose = require("mongoose");

const manualPaymentAttemptSchema = new mongoose.Schema(
    {
        attemptId: {
            type: String,
            required: true,
            unique: true
        },
        username: {
            type: String,
            required: true,
            index: true
        },
        customerEmail: {
            type: String,
            default: "",
            trim: true,
            lowercase: true
        },
        customerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        productCode: {
            type: String,
            required: true
        },
        packageCode: {
            type: String,
            required: true
        },
        region: {
            type: String,
            required: true
        },
        canonicalAmount: {
            type: Number,
            required: true
        },
        originalAmount: {
            type: Number,
            default: 0
        },
        discountAmount: {
            type: Number,
            default: 0
        },
        finalAmount: {
            type: Number,
            default: 0
        },
        promoCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: ""
        },
        promoSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },
        promoRedemptionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PromoRedemption",
            default: null
        },
        canonicalCurrency: {
            type: String,
            required: true
        },
        productName: {
            type: String,
            required: true
        },
        packageName: {
            type: String,
            required: true
        },
        paymentMethod: {
            type: String,
            required: true
        },
        paymentType: {
            type: String,
            enum: ["manual", "deeplink"],
            default: "manual"
        },
        provider: {
            type: String,
            default: "manual"
        },
        reference: {
            type: String,
            required: true,
            unique: true
        },
        gameUserData: {
            userId: { type: String, required: true },
            zoneId: { type: String, default: "" }
        },
        instructions: {
            method: { type: String, default: "" },
            key: { type: String, default: "" },
            accountName: { type: String, default: "" },
            accountNumber: { type: String, default: "" },
            qrImage: { type: String, default: "" },
            qrMode: { type: String, default: "" },
            confirmationMode: { type: String, default: "" },
            enableSaveQr: { type: Boolean, default: false },
            enableOpenApp: { type: Boolean, default: false },
            enableChecklist: { type: Boolean, default: false },
            dynamicQrSupported: { type: Boolean, default: false },
            amountPrefillSupported: { type: Boolean, default: false },
            referenceSupported: { type: Boolean, default: false },
            galleryScanSupported: { type: Boolean, default: false },
            receiptUploadEnabled: { type: Boolean, default: true },
            slipRequired: { type: Boolean, default: true },
            appDisplayName: { type: String, default: "" },
            openAppMode: { type: String, default: "disabled" },
            deepLinkUrl: { type: String, default: "" },
            appLaunchMode: { type: String, default: "" },
            iosAppLaunchUrl: { type: String, default: "" },
            androidAppLaunchUrl: { type: String, default: "" },
            androidPackageName: { type: String, default: "" },
            appStoreFallbackUrl: { type: String, default: "" },
            playStoreFallbackUrl: { type: String, default: "" },
            promptPayRecipientType: { type: String, default: "" },
            promptPayRecipientMasked: { type: String, default: "" },
            checklistSteps: {
                type: [
                    {
                        key: { type: String, default: "" },
                        label: { type: String, default: "" },
                        action: { type: String, default: "" },
                        enabled: { type: Boolean, default: true },
                        sortOrder: { type: Number, default: 0 }
                    }
                ],
                default: []
            },
            dynamicQr: {
                orderReference: { type: String, default: "" },
                encodedReference: { type: String, default: "" },
                qrPayload: { type: String, default: "" },
                qrImage: { type: String, default: "" },
                expiresAt: { type: Date, default: null }
            }
        },
        status: {
            type: String,
            enum: ["active", "consumed", "expired"],
            default: "active",
            index: true
        },
        expiresAt: {
            type: Date,
            required: true
        },
        recoverableExpiresAt: {
            type: Date,
            default: null
        },
        receiptSubmittedAt: {
            type: Date,
            default: null
        },
        consumedAt: {
            type: Date,
            default: null
        },
        orderId: {
            type: String,
            default: ""
        },
        evidence: {
            provider: { type: String, default: "" },
            key: { type: String, default: "" },
            url: { type: String, default: "" },
            mimeType: { type: String, default: "" },
            size: { type: Number, default: 0 },
            originalName: { type: String, default: "" },
            uploadedAt: { type: Date, default: null }
        }
    },
    {
        timestamps: true
    }
);

manualPaymentAttemptSchema.index({ username: 1, status: 1, expiresAt: 1 });
manualPaymentAttemptSchema.index({ username: 1, status: 1, recoverableExpiresAt: 1 });
manualPaymentAttemptSchema.index({ customerUserId: 1, status: 1, recoverableExpiresAt: 1 });
manualPaymentAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = mongoose.model("ManualPaymentAttempt", manualPaymentAttemptSchema);
