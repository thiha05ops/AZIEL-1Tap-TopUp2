const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },

        email: {
            type: String,
            default: "",
            trim: true,
            lowercase: true
        },

        password: {
            type: String,
            required: true
        },

        displayName: {
            type: String,
            default: ""
        },

        photo: {
            type: String,
            default: ""
        },

        telegram: {
            type: String,
            default: ""
        },

        phone: {
            type: String,
            default: ""
        },

        region: {
            type: String,
            default: "MM"
        },

        mlbbUserId: {
            type: String,
            default: ""
        },

        mlbbServerId: {
            type: String,
            default: ""
        },

        wallet: {
            MMK: {
                type: Number,
                default: 0
            },

            THB: {
                type: Number,
                default: 0
            }
        },

        role: {
            type: String,
            default: "user"
        },

        // Forgot password
        resetOTP: {
            type: String,
            default: ""
        },

        resetOTPExpire: {
            type: Date,
            default: null
        },
        resetOTPVerified: {
            type: Boolean,
            default: false
        },

        // Email verification
        isVerified: {
            type: Boolean,
            default: false
        },

        verifyOTP: {
            type: String,
            default: ""
        },

        verifyOTPExpire: {
            type: Date,
            default: null
        },

        // Login security
        currentSessionToken: {
            type: String,
            default: ""
        },

        sessionUpdatedAt: {
            type: Date,
            default: null
        },

        lastActiveAt: {
            type: Date,
            default: Date.now
        },

        lastLoginDevice: {
            deviceName: {
                type: String,
                default: ""
            },
            browser: {
                type: String,
                default: ""
            },
            ip: {
                type: String,
                default: ""
            },
            loginAt: {
                type: Date,
                default: null
            }
        },


    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("User", userSchema);