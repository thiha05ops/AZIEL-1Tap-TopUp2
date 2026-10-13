"use strict";

const AdminAccount = require("../models/AdminAccount");
const AdminSession = require("../models/AdminSession");
const { ROLES, STATUSES } = require("./adminAuthorizationService");

class AdminOwnerAuthorizationError extends Error {
    constructor(code, message, statusCode = 403) { super(message); this.code = code; this.statusCode = statusCode; }
}

function createAdminOwnerAuthorizationService({ AdminModel = AdminAccount, SessionModel = AdminSession, clock = () => new Date() } = {}) {
    async function requireAuthenticatedOwner(actor = {}) {
        const adminId = actor.id || actor._id || actor.adminId, sessionId = String(actor.sessionId || "").trim();
        if (!adminId || !sessionId) throw new AdminOwnerAuthorizationError("OWNER_AUTHENTICATION_REQUIRED", "An authenticated Owner session is required.");
        let admin, session;
        try {
            [admin, session] = await Promise.all([
                AdminModel.findOne({ _id: adminId, status: STATUSES.ACTIVE, role: ROLES.OWNER }).lean(),
                SessionModel.findOne({ sessionId, adminId, revokedAt: null, expiresAt: { $gt: clock() } }).lean()
            ]);
        } catch (_error) {
            throw new AdminOwnerAuthorizationError("OWNER_AUTHENTICATION_REQUIRED", "An authenticated Owner session is required.");
        }
        if (!admin || !session) throw new AdminOwnerAuthorizationError("OWNER_AUTHENTICATION_REQUIRED", "An authenticated active Owner session is required.");
        return Object.freeze({ id: admin._id, username: admin.username, role: admin.role, sessionId: session.sessionId });
    }
    return Object.freeze({ requireAuthenticatedOwner });
}

module.exports = Object.freeze({ AdminOwnerAuthorizationError, createAdminOwnerAuthorizationService });
