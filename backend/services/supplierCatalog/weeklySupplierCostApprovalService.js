"use strict";

const Approval = require("../../models/WeeklySupplierCostApproval");
const { ROLES } = require("../adminAuthorizationService");
const { createAdminOwnerAuthorizationService } = require("../adminOwnerAuthorizationService");

class WeeklySupplierCostApprovalError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

function createWeeklySupplierCostApprovalService({ Model = Approval, AdminModel, SessionModel, ownerAuthorization, clock = () => new Date() } = {}) {
    const ownerAuth = ownerAuthorization || createAdminOwnerAuthorizationService({ ...(AdminModel ? { AdminModel } : {}), ...(SessionModel ? { SessionModel } : {}), clock });
    async function approve({ manifestHash, maximumInitialPromotions, expiresAt, confirmed, actor }) {
        if (confirmed !== true) throw new WeeklySupplierCostApprovalError("EXPLICIT_OWNER_CONFIRMATION_REQUIRED", "Explicit Owner confirmation is required.");
        let owner;
        try { owner = await ownerAuth.requireAuthenticatedOwner(actor); }
        catch (_error) { throw new WeeklySupplierCostApprovalError("OWNER_APPROVAL_REQUIRED", "An authenticated active OWNER session must approve the exact manifest."); }
        const maximum = Number(maximumInitialPromotions), expiry = new Date(expiresAt), now = clock();
        if (!Number.isInteger(maximum) || maximum < 1) throw new WeeklySupplierCostApprovalError("INITIAL_PROMOTION_LIMIT_REQUIRED", "A positive maximum initial-promotion count is required.");
        if (!Number.isFinite(expiry.getTime()) || expiry <= now) throw new WeeklySupplierCostApprovalError("APPROVAL_EXPIRATION_REQUIRED", "A future approval expiration is required.");
        const pending = await Model.findById(manifestHash).lean();
        if (!pending) throw new WeeklySupplierCostApprovalError("APPROVAL_MANIFEST_NOT_FOUND", "The immutable candidate manifest was not found.");
        if (pending.candidates.length > maximum) throw new WeeklySupplierCostApprovalError("INITIAL_PROMOTION_LIMIT_EXCEEDED", "The candidate manifest exceeds the approved maximum.");
        if (pending.status === "APPROVED" || pending.status === "CONSUMED") {
            const same = Number(pending.maximumInitialPromotions) === maximum && new Date(pending.expiresAt).toISOString() === expiry.toISOString() && String(pending.approvedBy?.adminId || "") === String(owner.id);
            if (!same) throw new WeeklySupplierCostApprovalError("APPROVAL_IMMUTABLE", "An existing approval cannot be changed.");
            return { replayed: true, approval: pending };
        }
        const approved = await Model.findOneAndUpdate({ _id: pending._id, status: "PENDING", manifestHash }, { $set: { status: "APPROVED", maximumInitialPromotions: maximum, expiresAt: expiry, approvedAt: now, approvedBy: { adminId: owner.id, username: String(owner.username || ""), role: ROLES.OWNER } } }, { new: true, runValidators: true }).lean();
        if (!approved) throw new WeeklySupplierCostApprovalError("APPROVAL_CONFLICT", "The manifest approval changed concurrently.");
        return { replayed: false, approval: approved };
    }
    return Object.freeze({ approve });
}

module.exports = Object.freeze({ WeeklySupplierCostApprovalError, createWeeklySupplierCostApprovalService });
