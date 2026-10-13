"use strict";

const mongoose = require("mongoose");
const schema = new mongoose.Schema({
    _id: { type: String, required: true, immutable: true },
    jobKey: { type: String, required: true, immutable: true, trim: true },
    ownerId: { type: String, required: true, trim: true },
    runKey: { type: String, required: true, trim: true },
    acquiredAt: { type: Date, required: true },
    heartbeatAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    version: { type: Number, min: 1, default: 1 }
}, { timestamps: true, strict: "throw", minimize: false, autoIndex: process.env.NODE_ENV !== "production", autoCreate: process.env.NODE_ENV !== "production" });
schema.index({ expiresAt: 1 });
module.exports = mongoose.model("WeeklySupplierCostJobLease", schema);
