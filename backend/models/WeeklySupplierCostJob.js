"use strict";

const mongoose = require("mongoose");
const resultSchema = new mongoose.Schema({ supplierCode: String, status: String, updated: Number, unchanged: Number, reviewRequired: Number, failed: Number, pendingInitialApproval: Number, errorCode: String, errorMessage: String }, { _id: false, strict: true });
const schema = new mongoose.Schema({
    jobId: { type: String, required: true, unique: true, immutable: true, trim: true },
    trigger: { type: String, enum: ["MANUAL", "WEEKLY", "RETRY"], required: true },
    status: { type: String, enum: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "SUCCEEDED", "PARTIAL", "FAILED"], required: true, default: "QUEUED" },
    requestedBy: { adminId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminAccount", default: null }, username: { type: String, default: "" }, role: { type: String, default: "" } },
    supplierResults: { type: [resultSchema], default: [] },
    retryAttempt: { type: Number, min: 0, max: 3, default: 0 },
    nextRetryAt: { type: Date, default: null },
    startedAt: { type: Date, default: null }, completedAt: { type: Date, default: null },
    lastFailureCode: { type: String, default: "" }, lastFailureReason: { type: String, default: "", maxlength: 500 },
    leaseOwnerId: { type: String, default: "" }
}, { timestamps: true, strict: "throw", minimize: false, autoIndex: process.env.NODE_ENV !== "production", autoCreate: process.env.NODE_ENV !== "production" });
schema.index({ status: 1, nextRetryAt: 1 });
schema.index({ completedAt: -1 });
module.exports = mongoose.model("WeeklySupplierCostJob", schema);
