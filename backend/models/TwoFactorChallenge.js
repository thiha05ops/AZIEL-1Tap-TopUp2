const mongoose = require("mongoose");

const twoFactorChallengeSchema = new mongoose.Schema(
    {
        challengeId: {
            type: String,
            required: true,
            unique: true
        },

        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        purpose: {
            type: String,
            enum: ["login"],
            default: "login"
        },

        attempts: {
            type: Number,
            default: 0
        },

        expiresAt: {
            type: Date,
            required: true
        },

        consumedAt: {
            type: Date,
            default: null
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true
    }
);

twoFactorChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
twoFactorChallengeSchema.index({ userId: 1, consumedAt: 1, expiresAt: 1 });

module.exports = mongoose.model("TwoFactorChallenge", twoFactorChallengeSchema);
