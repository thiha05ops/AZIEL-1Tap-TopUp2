const mongoose = require("mongoose");

const authHandoffSchema = new mongoose.Schema({
    codeHash: { type: String, required: true, unique: true },
    token: { type: String, required: true },
    user: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null }
}, { timestamps: true });

authHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AuthHandoff", authHandoffSchema);
