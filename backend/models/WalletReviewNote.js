const mongoose = require("mongoose");

const walletReviewNoteSchema = new mongoose.Schema(
    {
        topupId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WalletTopup",
            required: true,
            index: true
        },
        body: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000
        },
        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        },
        createdByAdminName: {
            type: String,
            trim: true,
            default: "Admin"
        },
        updatedByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        },
        updatedByAdminName: {
            type: String,
            trim: true,
            default: ""
        }
    },
    { timestamps: true }
);

walletReviewNoteSchema.index({ topupId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("WalletReviewNote", walletReviewNoteSchema);
