const mongoose = require("mongoose");

const pendingRegistrationSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            unique: true
        },

        username: {
            type: String,
            required: true,
            trim: true,
            index: true
        },

        passwordHash: {
            type: String,
            required: true
        },

        displayName: {
            type: String,
            default: ""
        },

        otpHash: {
            type: String,
            required: true
        },

        otpExpiresAt: {
            type: Date,
            required: true
        },

        otpAttempts: {
            type: Number,
            default: 0
        },

        resendAvailableAt: {
            type: Date,
            default: null
        },

        consumedAt: {
            type: Date,
            default: null
        },

        expiresAt: {
            type: Date,
            required: true,
            index: {
                expires: 0
            }
        }
    },
    {
        timestamps: true
    }
);

pendingRegistrationSchema.index({
    email: 1,
    consumedAt: 1,
    otpExpiresAt: 1
});

module.exports = mongoose.model("PendingRegistration", pendingRegistrationSchema);
