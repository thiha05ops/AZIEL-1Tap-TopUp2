const mongoose = require("mongoose");

const schema = new mongoose.Schema({
    provider: { type: String, required: true, trim: true, uppercase: true },
    eventId: { type: String, required: true, trim: true, maxlength: 160 },
    eventType: { type: String, required: true, trim: true, maxlength: 120 },
    providerOrderId: { type: String, trim: true, maxlength: 160, default: "" },
    processingStatus: { type: String, enum: ["RECEIVED", "PROCESSED", "IGNORED", "FAILED"], default: "RECEIVED" },
    safeMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    processedAt: { type: Date, default: null }
}, { timestamps: true });

schema.index({ provider: 1, eventId: 1 }, { unique: true, name: "unique_provider_webhook_event" });
module.exports = mongoose.model("ProviderWebhookEvent", schema);
