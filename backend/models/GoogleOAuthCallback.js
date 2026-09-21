"use strict";

const mongoose = require("mongoose");

const googleOAuthCallbackSchema = new mongoose.Schema(
    {
        callbackKey: { type: String, required: true, unique: true },
        bindingKey: { type: String, required: true },
        status: { type: String, enum: ["processing", "completed", "failed"], required: true, default: "processing" },
        sessionId: { type: String, default: "" },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

googleOAuthCallbackSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("GoogleOAuthCallback", googleOAuthCallbackSchema);
