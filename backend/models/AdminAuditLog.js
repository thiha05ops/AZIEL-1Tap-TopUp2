const mongoose = require("mongoose");

const adminAuditLogSchema = new mongoose.Schema(
    {
        actorAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        },
        actorUsernameSnapshot: {
            type: String,
            trim: true,
            default: ""
        },
        actorRoleSnapshot: {
            type: String,
            trim: true,
            default: ""
        },
        action: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100
        },
        resourceType: {
            type: String,
            trim: true,
            maxlength: 80,
            default: ""
        },
        resourceId: {
            type: String,
            trim: true,
            maxlength: 160,
            default: ""
        },
        targetAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminAccount",
            default: null
        },
        requestId: {
            type: String,
            trim: true,
            maxlength: 120,
            default: ""
        },
        route: {
            type: String,
            trim: true,
            maxlength: 200,
            default: ""
        },
        method: {
            type: String,
            trim: true,
            maxlength: 12,
            default: ""
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ createdAt: -1, _id: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1, _id: -1 });
adminAuditLogSchema.index({ actorAdminId: 1, createdAt: -1 });
adminAuditLogSchema.index({ resourceType: 1, createdAt: -1 });

module.exports = mongoose.model("AdminAuditLog", adminAuditLogSchema);
