const mongoose = require("mongoose");

const adminLoginChallengeSchema = new mongoose.Schema(
    {
        challengeId: {
            type: String,
            required: true,
            unique: true
        },
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            required: true
        },
        purpose: {
            type: String,
            enum: ["admin_login"],
            default: "admin_login"
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
        }
    },
    { timestamps: true }
);

adminLoginChallengeSchema.index({ challengeId: 1 }, { unique: true });
adminLoginChallengeSchema.index({ adminId: 1, consumedAt: 1, expiresAt: 1 });
adminLoginChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AdminLoginChallenge", adminLoginChallengeSchema);
