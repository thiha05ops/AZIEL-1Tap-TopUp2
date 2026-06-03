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

        maintenanceMessage: {
            type: String,
            default: ""
        },

        paymentType: {
            type: String,
            enum: ["manual", "auto"],
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