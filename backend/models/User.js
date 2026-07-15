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

        photoEvidence: {
            provider: {
                type: String,
                default: ""
            },
            key: {
                type: String,
                default: ""
            },
            url: {
                type: String,
                default: ""
            },
            mimeType: {
                type: String,
                default: ""
            },
            size: {
                type: Number,
                default: 0
            },
            originalName: {
                type: String,
                default: ""
            },
            uploadedAt: {
                type: Date,
                default: null
            }
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

        tokenVersion: {
            type: Number,
            default: 0
        },

        passwordChangedAt: {
            type: Date,
            default: null
        },

        // Forgot password
        resetOTP: {
            type: String,
            default: ""
        },

        resetOTPHash: {
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

        resetOTPVerifiedAt: {
            type: Date,
            default: null
        },

        resetOTPAttempts: {
            type: Number,
            default: 0
        },

        resetOTPResendAvailableAt: {
            type: Date,
            default: null
        },

        // Email verification
        emailVerified: {
            type: Boolean,
            default: false
        },

        emailVerifiedAt: {
            type: Date,
            default: null
        },

        // Legacy email verification adapter. Keep during V2.5 transition.
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

        googleId: {
            type: String,
            default: "",
            index: true,
            sparse: true
        },

        authProvider: {
            type: String,
            enum: ["local", "google", "hybrid"],
            default: "local"
        },

        twoFactorEnabled: {
            type: Boolean,
            default: false
        },

        twoFactorSecretEncrypted: {
            type: String,
            default: ""
        },

        twoFactorEnabledAt: {
            type: Date,
            default: null
        },

        pendingTwoFactorSecretEncrypted: {
            type: String,
            default: ""
        },

        pendingTwoFactorSetupExpiresAt: {
            type: Date,
            default: null
        },

        twoFactorRecoveryCodes: [
            {
                hash: {
                    type: String,
                    default: ""
                },
                usedAt: {
                    type: Date,
                    default: null
                },
                createdAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ],

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
            deviceType: {
                type: String,
                default: ""
            },
            browser: {
                type: String,
                default: ""
            },
            platform: {
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

userSchema.index(
    { email: 1 },
    {
        unique: true,
        partialFilterExpression: {
            email: {
                $type: "string",
                $ne: ""
            }
        }
    }
);
userSchema.index({ createdAt: -1, _id: -1 });
userSchema.index({ username: 1, createdAt: -1, _id: -1 });
userSchema.index({ email: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("User", userSchema);
