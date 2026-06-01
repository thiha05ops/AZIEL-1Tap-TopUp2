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

        qrImage: {
            type: String,
            default: ""
        },

        maintenanceMessage: {
            type: String,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model(
    "PaymentMethod",
    paymentMethodSchema
);