const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateSecret, generateURI } = require("otplib");
const QRCode = require("qrcode");

const AdminAccount = require("../models/AdminAccount");
const AdminSession = require("../models/AdminSession");
const AdminLoginChallenge = require("../models/AdminLoginChallenge");
const { decryptSecret, encryptSecret, verifyTotp } = require("./twoFactorService");
const { PERMISSIONS, STATUSES, ROLES, getPermissionsForRole } = require("./adminAuthorizationService");
const { ADMIN_AUDIT_ACTIONS, writeAdminAudit } = require("./adminAuditService");

const JWT_SECRET = process.env.JWT_SECRET || "aziel_jwt_secret";
const ADMIN_JWT_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SESSION_TTL_MS = ADMIN_JWT_TTL_SECONDS * 1000;
const ADMIN_2FA_SETUP_TTL_MS = 10 * 60 * 1000;
const ADMIN_2FA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_2FA_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 12;

class AdminAuthError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "AdminAuthError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizeAdminUsername(value = "") {
    const username = String(value || "").trim().toLowerCase();
    if (!/^[a-z0-9._@-]{3,64}$/.test(username)) {
        throw new AdminAuthError("ADMIN_USERNAME_INVALID", "Admin username is invalid.");
    }
    return username;
}

function cleanDisplayName(value = "") {
    return String(value || "").trim().slice(0, 100);
}

function assertStrongEnoughPassword(password) {
    if (String(password || "").length < 10) {
        throw new AdminAuthError("ADMIN_PASSWORD_WEAK", "Admin password must be at least 10 characters.");
    }
}

function summarizeUserAgent(userAgent = "") {
    return String(userAgent || "Unknown device").replace(/\s+/g, " ").slice(0, 220);
}

function ipHash(ip = "") {
    const salt = process.env.ADMIN_IP_HASH_SALT || JWT_SECRET;
    return crypto.createHash("sha256").update(`${salt}:${ip || ""}`).digest("hex");
}

function projectAdminAccount(admin) {
    return {
        id: String(admin._id),
        username: admin.username,
        displayName: admin.displayName || admin.username,
        role: admin.role,
        status: admin.status,
        permissions: getPermissionsForRole(admin.role),
        twoFactorEnabled: Boolean(admin.twoFactor?.enabled),
        lastLoginAt: admin.lastLoginAt || null,
        createdByAdminId: admin.createdByAdminId ? String(admin.createdByAdminId) : null,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt
    };
}

async function bootstrapFirstOwnerIfAllowed({ username, password, req }) {
    const count = await AdminAccount.countDocuments();
    if (count > 0) return null;

    const envUsername = process.env.ADMIN_USERNAME || "admin";
    const envPassword = process.env.ADMIN_PASSWORD || "AZIEL2026";

    if (String(username || "") !== envUsername || String(password || "") !== envPassword) {
        return null;
    }

    const usernameNormalized = normalizeAdminUsername(envUsername);
    const passwordHash = await bcrypt.hash(envPassword, BCRYPT_ROUNDS);
    const admin = await AdminAccount.create({
        username: envUsername,
        usernameNormalized,
        displayName: "Owner",
        passwordHash,
        role: ROLES.OWNER,
        status: STATUSES.ACTIVE,
        passwordChangedAt: new Date()
    });

    await writeAdminAudit({
        actor: projectAdminAccount(admin),
        req,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_ACCOUNT_CREATED,
        resourceType: "AdminAccount",
        resourceId: String(admin._id),
        targetAdminId: admin._id,
        metadata: { bootstrap: true, role: ROLES.OWNER }
    });

    return admin;
}

async function findAdminForLogin(username) {
    const usernameNormalized = normalizeAdminUsername(username);
    return AdminAccount.findOne({ usernameNormalized });
}

async function createAdminSession(admin, req) {
    const session = await AdminSession.create({
        adminId: admin._id,
        sessionId: crypto.randomBytes(24).toString("hex"),
        expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS),
        userAgentSummary: summarizeUserAgent(req?.headers?.["user-agent"]),
        ipHash: ipHash(req?.ip || req?.socket?.remoteAddress || "")
    });

    const token = jwt.sign(
        {
            role: "admin",
            adminId: String(admin._id),
            sessionId: session.sessionId
        },
        JWT_SECRET,
        { expiresIn: ADMIN_JWT_TTL_SECONDS }
    );

    admin.lastLoginAt = new Date();
    await admin.save();

    return { session, token };
}

async function loginAdmin({ username, password, req }) {
    let admin = await findAdminForLogin(username).catch(() => null);

    if (!admin) {
        admin = await bootstrapFirstOwnerIfAllowed({ username, password, req });
    }

    if (!admin || admin.status !== STATUSES.ACTIVE || !(await bcrypt.compare(String(password || ""), admin.passwordHash))) {
        await writeAdminAudit({
            req,
            action: ADMIN_AUDIT_ACTIONS.ADMIN_LOGIN_FAILED,
            resourceType: "AdminAccount",
            metadata: { username: String(username || "").slice(0, 64) }
        });
        throw new AdminAuthError("ADMIN_AUTH_FAILED", "Invalid admin credentials.", 401);
    }

    if (admin.twoFactor?.enabled) {
        const challenge = await AdminLoginChallenge.create({
            challengeId: crypto.randomBytes(24).toString("hex"),
            adminId: admin._id,
            purpose: "admin_login",
            expiresAt: new Date(Date.now() + ADMIN_2FA_CHALLENGE_TTL_MS)
        });

        await writeAdminAudit({
            actor: projectAdminAccount(admin),
            req,
            action: ADMIN_AUDIT_ACTIONS.ADMIN_2FA_CHALLENGE,
            resourceType: "AdminAccount",
            resourceId: String(admin._id),
            targetAdminId: admin._id
        });

        return {
            twoFactorRequired: true,
            challengeId: challenge.challengeId,
            expiresAt: challenge.expiresAt
        };
    }

    const { token, session } = await createAdminSession(admin, req);
    await writeAdminAudit({
        actor: projectAdminAccount(admin),
        req,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_LOGIN_SUCCESS,
        resourceType: "AdminSession",
        resourceId: session.sessionId
    });

    return {
        token,
        admin: projectAdminAccount(admin),
        session: projectAdminSession(session, true)
    };
}

async function verifyAdminLogin2FA({ challengeId, code, req }) {
    const challenge = await AdminLoginChallenge.findOne({
        challengeId: String(challengeId || ""),
        purpose: "admin_login",
        consumedAt: null
    });

    if (!challenge || challenge.expiresAt < new Date() || challenge.attempts >= MAX_2FA_ATTEMPTS) {
        throw new AdminAuthError("ADMIN_2FA_INVALID", "Invalid verification code.", 401);
    }

    const admin = await AdminAccount.findById(challenge.adminId);
    if (!admin || admin.status !== STATUSES.ACTIVE || !admin.twoFactor?.enabled || !admin.twoFactor?.secretEncrypted) {
        throw new AdminAuthError("ADMIN_2FA_INVALID", "Invalid verification code.", 401);
    }

    const secret = decryptSecret(admin.twoFactor.secretEncrypted);
    const valid = await verifyTotp(secret, code);

    if (!valid) {
        challenge.attempts = Number(challenge.attempts || 0) + 1;
        await challenge.save();
        await writeAdminAudit({
            actor: projectAdminAccount(admin),
            req,
            action: ADMIN_AUDIT_ACTIONS.ADMIN_2FA_FAILED,
            resourceType: "AdminAccount",
            resourceId: String(admin._id),
            targetAdminId: admin._id
        });
        throw new AdminAuthError("ADMIN_2FA_INVALID", "Invalid verification code.", 401);
    }

    challenge.consumedAt = new Date();
    await challenge.save();

    const { token, session } = await createAdminSession(admin, req);
    await writeAdminAudit({
        actor: projectAdminAccount(admin),
        req,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_2FA_SUCCESS,
        resourceType: "AdminSession",
        resourceId: session.sessionId
    });

    return {
        token,
        admin: projectAdminAccount(admin),
        session: projectAdminSession(session, true)
    };
}

async function resolveAdminRequest(token) {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin" || !decoded.adminId || !decoded.sessionId) {
        throw new AdminAuthError("ADMIN_SESSION_INVALID", "Admin session expired.", 401);
    }

    const [admin, session] = await Promise.all([
        AdminAccount.findById(decoded.adminId),
        AdminSession.findOne({ sessionId: decoded.sessionId, adminId: decoded.adminId })
    ]);

    if (!admin || admin.status !== STATUSES.ACTIVE) {
        throw new AdminAuthError("ADMIN_SESSION_INVALID", "Admin session expired.", 401);
    }
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
        throw new AdminAuthError("ADMIN_SESSION_INVALID", "Admin session expired.", 401);
    }

    session.lastSeenAt = new Date();
    await session.save();

    return {
        admin: {
            ...projectAdminAccount(admin),
            adminId: String(admin._id),
            sessionId: session.sessionId
        },
        session
    };
}

function projectAdminSession(session, isCurrent = false) {
    return {
        id: session.sessionId,
        current: Boolean(isCurrent),
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt || null,
        userAgentSummary: session.userAgentSummary || "Unknown device"
    };
}

async function listSessionsForAdmin(adminId, currentSessionId = "") {
    const sessions = await AdminSession.find({ adminId })
        .sort({ revokedAt: 1, lastSeenAt: -1 })
        .lean();
    return sessions.map(session => projectAdminSession(session, session.sessionId === currentSessionId));
}

async function revokeSession({ sessionId, actor, reason = "revoked", req }) {
    const session = await AdminSession.findOne({ sessionId: String(sessionId || "") });
    if (!session || session.revokedAt) return null;

    session.revokedAt = new Date();
    session.revokedByAdminId = actor?.id || actor?.adminId || null;
    session.revokeReason = String(reason || "revoked").slice(0, 200);
    await session.save();

    await writeAdminAudit({
        actor,
        req,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_SESSION_REVOKED,
        resourceType: "AdminSession",
        resourceId: session.sessionId,
        targetAdminId: session.adminId,
        metadata: { reason: session.revokeReason }
    });

    return session;
}

async function revokeOtherSessions({ adminId, currentSessionId, actor, req }) {
    const sessions = await AdminSession.find({
        adminId,
        sessionId: { $ne: currentSessionId },
        revokedAt: null,
        expiresAt: { $gt: new Date() }
    });

    for (const session of sessions) {
        session.revokedAt = new Date();
        session.revokedByAdminId = actor?.id || actor?.adminId || null;
        session.revokeReason = "revoke_other_sessions";
        await session.save();
    }

    if (sessions.length) {
        await writeAdminAudit({
            actor,
            req,
            action: ADMIN_AUDIT_ACTIONS.ADMIN_SESSION_REVOKED,
            resourceType: "AdminSession",
            resourceId: "multiple",
            targetAdminId: adminId,
            metadata: { count: sessions.length, reason: "revoke_other_sessions" }
        });
    }

    return sessions.length;
}

async function assertNotFinalActiveOwner(adminId, patch = {}) {
    const current = await AdminAccount.findById(adminId);
    if (!current) throw new AdminAuthError("ADMIN_ACCOUNT_NOT_FOUND", "Admin account not found.", 404);
    if (current.role !== ROLES.OWNER || current.status !== STATUSES.ACTIVE) return current;

    const wouldRemainOwner = (patch.role || current.role) === ROLES.OWNER;
    const wouldRemainActive = (patch.status || current.status) === STATUSES.ACTIVE;
    if (wouldRemainOwner && wouldRemainActive) return current;

    const activeOwners = await AdminAccount.countDocuments({
        _id: { $ne: current._id },
        role: ROLES.OWNER,
        status: STATUSES.ACTIVE
    });
    if (activeOwners < 1) {
        throw new AdminAuthError("FINAL_ACTIVE_OWNER_PROTECTED", "The final active OWNER cannot be disabled or demoted.");
    }
    return current;
}

async function listAdminAccounts() {
    const accounts = await AdminAccount.find().sort({ role: 1, usernameNormalized: 1 }).lean();
    return accounts.map(projectAdminAccount);
}

async function createAdminAccount(payload = {}, actor, req) {
    const usernameNormalized = normalizeAdminUsername(payload.username);
    assertStrongEnoughPassword(payload.password);

    const exists = await AdminAccount.findOne({ usernameNormalized });
    if (exists) throw new AdminAuthError("ADMIN_USERNAME_EXISTS", "Admin username already exists.");

    const account = await AdminAccount.create({
        username: String(payload.username || "").trim(),
        usernameNormalized,
        displayName: cleanDisplayName(payload.displayName || payload.username),
        passwordHash: await bcrypt.hash(String(payload.password), BCRYPT_ROUNDS),
        role: Object.values(ROLES).includes(payload.role) ? payload.role : ROLES.SUPPORT,
        status: Object.values(STATUSES).includes(payload.status) ? payload.status : STATUSES.ACTIVE,
        passwordChangedAt: new Date(),
        createdByAdminId: actor?.id || actor?.adminId || null,
        updatedByAdminId: actor?.id || actor?.adminId || null
    });

    await writeAdminAudit({
        actor,
        req,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_ACCOUNT_CREATED,
        resourceType: "AdminAccount",
        resourceId: String(account._id),
        targetAdminId: account._id,
        metadata: { role: account.role, status: account.status }
    });

    return projectAdminAccount(account);
}

async function updateAdminAccount(adminId, payload = {}, actor, req) {
    const patch = {};
    if (payload.displayName !== undefined) patch.displayName = cleanDisplayName(payload.displayName);
    if (payload.role !== undefined && Object.values(ROLES).includes(payload.role)) patch.role = payload.role;
    if (payload.status !== undefined && Object.values(STATUSES).includes(payload.status)) patch.status = payload.status;

    const current = await assertNotFinalActiveOwner(adminId, patch);
    const previous = projectAdminAccount(current);

    Object.assign(current, patch, { updatedByAdminId: actor?.id || actor?.adminId || null });
    await current.save();

    if (patch.status === STATUSES.DISABLED) {
        await AdminSession.updateMany({ adminId, revokedAt: null }, {
            $set: {
                revokedAt: new Date(),
                revokedByAdminId: actor?.id || actor?.adminId || null,
                revokeReason: "admin_disabled"
            }
        });
    }

    if (patch.role && patch.role !== previous.role) {
        await writeAdminAudit({
            actor,
            req,
            action: ADMIN_AUDIT_ACTIONS.ADMIN_ACCOUNT_ROLE_CHANGED,
            resourceType: "AdminAccount",
            resourceId: String(adminId),
            targetAdminId: adminId,
            metadata: { fromRole: previous.role, toRole: patch.role }
        });
    }
    if (patch.status && patch.status !== previous.status) {
        await writeAdminAudit({
            actor,
            req,
            action: patch.status === STATUSES.ACTIVE ? ADMIN_AUDIT_ACTIONS.ADMIN_ACCOUNT_ENABLED : ADMIN_AUDIT_ACTIONS.ADMIN_ACCOUNT_DISABLED,
            resourceType: "AdminAccount",
            resourceId: String(adminId),
            targetAdminId: adminId,
            metadata: { fromStatus: previous.status, toStatus: patch.status }
        });
    }

    return projectAdminAccount(current);
}

async function changeOwnPassword(admin, payload = {}, req) {
    const account = await AdminAccount.findById(admin.id || admin.adminId);
    if (!account || !(await bcrypt.compare(String(payload.currentPassword || ""), account.passwordHash))) {
        throw new AdminAuthError("ADMIN_AUTH_FAILED", "Invalid admin credentials.", 401);
    }
    assertStrongEnoughPassword(payload.newPassword);

    account.passwordHash = await bcrypt.hash(String(payload.newPassword), BCRYPT_ROUNDS);
    account.passwordChangedAt = new Date();
    await account.save();

    await revokeOtherSessions({
        adminId: account._id,
        currentSessionId: admin.sessionId,
        actor: admin,
        req
    });

    await writeAdminAudit({
        actor: admin,
        req,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_PASSWORD_CHANGED,
        resourceType: "AdminAccount",
        resourceId: String(account._id),
        targetAdminId: account._id
    });
}

async function startAdmin2FASetup(admin) {
    const account = await AdminAccount.findById(admin.id || admin.adminId);
    if (!account) throw new AdminAuthError("ADMIN_ACCOUNT_NOT_FOUND", "Admin account not found.", 404);

    const secret = generateSecret();
    account.twoFactor.pendingSecretEncrypted = encryptSecret(secret);
    account.twoFactor.pendingExpiresAt = new Date(Date.now() + ADMIN_2FA_SETUP_TTL_MS);
    await account.save();

    const provisioningUri = generateURI({
        secret,
        strategy: "totp",
        algorithm: "sha1",
        digits: 6,
        period: 30,
        issuer: "AZIEL Admin",
        label: account.username
    });

    return {
        manualKey: secret,
        provisioningUri,
        qrDataUrl: await QRCode.toDataURL(provisioningUri, { margin: 1, width: 220 }),
        expiresAt: account.twoFactor.pendingExpiresAt
    };
}

async function verifyAdmin2FASetup(admin, code, req) {
    const account = await AdminAccount.findById(admin.id || admin.adminId);
    if (!account || !account.twoFactor?.pendingSecretEncrypted || account.twoFactor.pendingExpiresAt < new Date()) {
        throw new AdminAuthError("ADMIN_2FA_INVALID", "Invalid verification code.");
    }

    const secret = decryptSecret(account.twoFactor.pendingSecretEncrypted);
    if (!(await verifyTotp(secret, code))) {
        throw new AdminAuthError("ADMIN_2FA_INVALID", "Invalid verification code.");
    }

    account.twoFactor.enabled = true;
    account.twoFactor.secretEncrypted = account.twoFactor.pendingSecretEncrypted;
    account.twoFactor.pendingSecretEncrypted = "";
    account.twoFactor.pendingExpiresAt = null;
    account.twoFactor.enabledAt = new Date();
    await account.save();

    await writeAdminAudit({
        actor: admin,
        req,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_2FA_ENABLED,
        resourceType: "AdminAccount",
        resourceId: String(account._id),
        targetAdminId: account._id
    });

    return projectAdminAccount(account);
}

async function disableAdmin2FA(admin, payload = {}, req) {
    const account = await AdminAccount.findById(admin.id || admin.adminId);
    if (!account || !(await bcrypt.compare(String(payload.currentPassword || ""), account.passwordHash))) {
        throw new AdminAuthError("ADMIN_AUTH_FAILED", "Invalid admin credentials.", 401);
    }
    if (!account.twoFactor?.enabled || !account.twoFactor?.secretEncrypted) {
        throw new AdminAuthError("ADMIN_2FA_NOT_ENABLED", "Two-factor authentication is not enabled.");
    }
    const secret = decryptSecret(account.twoFactor.secretEncrypted);
    if (!(await verifyTotp(secret, payload.code))) {
        throw new AdminAuthError("ADMIN_2FA_INVALID", "Invalid verification code.");
    }

    account.twoFactor.enabled = false;
    account.twoFactor.secretEncrypted = "";
    account.twoFactor.pendingSecretEncrypted = "";
    account.twoFactor.pendingExpiresAt = null;
    account.twoFactor.enabledAt = null;
    await account.save();

    await writeAdminAudit({
        actor: admin,
        req,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_2FA_DISABLED,
        resourceType: "AdminAccount",
        resourceId: String(account._id),
        targetAdminId: account._id
    });

    return projectAdminAccount(account);
}

module.exports = {
    ADMIN_JWT_TTL_SECONDS,
    AdminAuthError,
    changeOwnPassword,
    createAdminAccount,
    disableAdmin2FA,
    listAdminAccounts,
    listSessionsForAdmin,
    loginAdmin,
    projectAdminAccount,
    resolveAdminRequest,
    revokeOtherSessions,
    revokeSession,
    startAdmin2FASetup,
    updateAdminAccount,
    verifyAdmin2FASetup,
    verifyAdminLogin2FA
};
