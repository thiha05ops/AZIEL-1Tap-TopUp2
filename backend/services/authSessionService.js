const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Session = require("../models/Session");
const SecurityEvent = require("../models/SecurityEvent");
const { parseDeviceInfoFromRequest } = require("./deviceInfoService");

const JWT_SECRET = process.env.JWT_SECRET || "aziel_jwt_secret";
const JWT_EXPIRES_IN = "15d";
const SESSION_TTL_MS = 15 * 24 * 60 * 60 * 1000;
const LAST_SEEN_UPDATE_MS = 60 * 60 * 1000;

function getRequestIp(req) {
    return (
        req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req?.socket?.remoteAddress ||
        ""
    );
}

function sanitizeHeader(value = "") {
    return String(value || "")
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 240);
}

function getHeader(req, key) {
    const value = req?.headers?.[key] || req?.headers?.[key.toLowerCase()] || "";
    return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function sanitizeUserAgentBrands(brands) {
    if (!Array.isArray(brands)) return [];

    return brands.slice(0, 6).map((brand) => ({
        brand: sanitizeHeader(brand?.brand),
        version: sanitizeHeader(brand?.version)
    }));
}

function logDeviceInfoDebug(req, metadata) {
    if (process.env.DEVICE_INFO_DEBUG !== "true") return;

    const context = req?.body?.deviceContext || {};
    const userAgentData = context.userAgentData && typeof context.userAgentData === "object"
        ? context.userAgentData
        : {};

    console.log("DEVICE_INFO_DEBUG", {
        userAgentPresent: Boolean(getHeader(req, "user-agent")),
        userAgent: sanitizeHeader(getHeader(req, "user-agent")),
        secChUa: sanitizeHeader(getHeader(req, "sec-ch-ua")),
        secChUaMobile: sanitizeHeader(getHeader(req, "sec-ch-ua-mobile")),
        secChUaPlatform: sanitizeHeader(getHeader(req, "sec-ch-ua-platform")),
        clientContext: {
            platform: sanitizeHeader(context.platform),
            userAgentPresent: Boolean(context.userAgent),
            userAgent: sanitizeHeader(context.userAgent),
            userAgentData: {
                mobile: Boolean(userAgentData.mobile),
                platform: sanitizeHeader(userAgentData.platform),
                brands: sanitizeUserAgentBrands(userAgentData.brands)
            }
        },
        parserResult: {
            deviceType: metadata.deviceType,
            deviceLabel: metadata.deviceLabel,
            browser: metadata.browser,
            platform: metadata.platform
        }
    });
}

function getDeviceMetadata(req) {
    const metadata = {
        ...parseDeviceInfoFromRequest(req),
        ipAddress: getRequestIp(req)
    };

    logDeviceInfoDebug(req, metadata);

    return metadata;
}

function isEmailVerified(user) {
    return Boolean(user?.emailVerified || user?.isVerified);
}

function projectUser(user) {
    return {
        id: String(user._id),
        username: user.username,
        email: user.email || "",
        displayName: user.displayName || user.username,
        region: user.region || "MM",
        role: user.role || "user",
        emailVerified: isEmailVerified(user),
        emailVerifiedAt: user.emailVerifiedAt || null,
        googleLinked: Boolean(user.googleId),
        authProvider: user.authProvider || "local",
        hasPassword: Boolean(user.password),
        lastLoginDevice: user.lastLoginDevice || null
    };
}

function createSessionId() {
    return crypto.randomBytes(24).toString("hex");
}

function issueAccessToken(user, session) {
    return jwt.sign(
        {
            id: user._id,
            userId: user._id,
            username: user.username,
            role: user.role || "user",
            sessionId: session.sessionId,
            tokenVersion: Number(user.tokenVersion || 0)
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

async function recordSecurityEvent(user, input = {}) {
    if (!user?._id || !input.type || !input.title) return null;

    return SecurityEvent.create({
        userId: user._id,
        username: user.username || "",
        type: input.type,
        title: input.title,
        sessionId: input.sessionId || "",
        ipAddress: input.ipAddress || "",
        userAgent: input.userAgent || "",
        deviceName: input.deviceName || "",
        metadata: sanitizeMetadata(input.metadata || {})
    });
}

function sanitizeMetadata(metadata) {
    const safe = {};

    Object.entries(metadata || {}).forEach(([key, value]) => {
        if (/password|otp|token|secret|authorization/i.test(key)) return;
        safe[key] = value;
    });

    return safe;
}

async function createSecurityNotification(user, input = {}) {
    if (!user?.username || !input.title) return null;

    try {
        const notificationService = require("./notificationService");

        return await notificationService.createUserNotification({
            userId: user._id,
            username: user.username,
            title: input.title,
            message: input.message || "",
            type: "system",
            category: "security",
            source: "security",
            metadata: sanitizeMetadata(input.metadata || {})
        });
    } catch (error) {
        console.log("Security notification error:", error.message);
        return null;
    }
}

async function createSessionForUser(user, req, options = {}) {
    const metadata = getDeviceMetadata(req);
    const now = new Date();
    const session = await Session.create({
        sessionId: createSessionId(),
        userId: user._id,
        ...metadata,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS)
    });

    user.currentSessionToken = session.sessionId;
    user.sessionUpdatedAt = now;
    user.lastActiveAt = now;
    user.lastLoginDevice = {
        deviceName: metadata.deviceName,
        deviceType: metadata.deviceType,
        browser: metadata.browser,
        platform: metadata.platform,
        ip: metadata.ipAddress,
        loginAt: now
    };

    await user.save();

    await recordSecurityEvent(user, {
        type: options.eventType || "session.created",
        title: options.eventTitle || "New sign-in",
        sessionId: session.sessionId,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        deviceName: metadata.deviceName,
        metadata: {
            provider: options.provider || user.authProvider || "local",
            deviceType: metadata.deviceType,
            browser: metadata.browser,
            platform: metadata.platform
        }
    });

    await createSecurityNotification(user, {
        title: "New sign-in to your AZIEL account",
        message: `${metadata.deviceName}${metadata.platform ? ` on ${metadata.platform}` : ""}`,
        metadata: {
            sessionId: session.sessionId,
            deviceType: metadata.deviceType,
            deviceName: metadata.deviceName,
            browser: metadata.browser,
            platform: metadata.platform
        }
    });

    return session;
}

async function issueUserSession(user, req, options = {}) {
    const session = await createSessionForUser(user, req, options);
    const token = issueAccessToken(user, session);

    return {
        token,
        session,
        user: projectUser(user)
    };
}

async function verifyUserToken(token, options = {}) {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.id || decoded.role === "admin") {
        throw new Error("Invalid authentication token");
    }

    const user = await User.findById(decoded.id).select("-password");
    if (!user) throw new Error("User not found");

    if (decoded.sessionId) {
        if (Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
            throw new Error("Session expired");
        }

        const session = await Session.findOne({
            sessionId: decoded.sessionId,
            userId: user._id
        });

        if (!session || session.revokedAt || session.expiresAt < new Date()) {
            throw new Error("Session expired");
        }

        await touchSession(session);
        await touchUserActive(user);

        return {
            user,
            session,
            decoded,
            legacy: false,
            context: createAuthContext(user, session, decoded, false)
        };
    }

    if (options.allowLegacy !== false && decoded.sessionToken) {
        if (
            !user.currentSessionToken ||
            decoded.sessionToken !== user.currentSessionToken
        ) {
            throw new Error("Session expired");
        }

        await touchUserActive(user);

        return {
            user,
            session: null,
            decoded,
            legacy: true,
            context: createAuthContext(user, null, decoded, true)
        };
    }

    throw new Error("Invalid authentication token");
}

async function touchSession(session) {
    const now = new Date();
    const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt) : null;

    if (!lastSeen || now - lastSeen > LAST_SEEN_UPDATE_MS) {
        session.lastSeenAt = now;
        await session.save();
    }
}

async function touchUserActive(user) {
    const now = new Date();
    const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt) : null;

    if (!lastActive || now - lastActive > LAST_SEEN_UPDATE_MS) {
        user.lastActiveAt = now;
        await user.save();
    }
}

function createAuthContext(user, session, decoded, legacy) {
    return {
        id: String(user._id),
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role || "user",
        region: user.region || "MM",
        sessionId: session?.sessionId || decoded.sessionId || "",
        tokenVersion: Number(user.tokenVersion || 0),
        legacyAuth: Boolean(legacy)
    };
}

async function revokeSession(sessionId, user, reason = "revoked") {
    const session = await Session.findOne({
        sessionId,
        userId: user._id,
        revokedAt: null
    });

    if (!session) return null;

    session.revokedAt = new Date();
    session.revokeReason = reason;
    await session.save();

    await recordSecurityEvent(user, {
        type: "session.revoked",
        title: "Session revoked",
        sessionId,
        ...getSessionEventMetadata(session)
    });

    return session;
}

async function revokeOtherSessions(user, currentSessionId, reason = "revoked_others") {
    const result = await Session.updateMany(
        {
            userId: user._id,
            sessionId: { $ne: currentSessionId },
            revokedAt: null
        },
        {
            $set: {
                revokedAt: new Date(),
                revokeReason: reason
            }
        }
    );

    await recordSecurityEvent(user, {
        type: "sessions.revoked_others",
        title: "Other sessions revoked",
        sessionId: currentSessionId || "",
        metadata: { count: result.modifiedCount || 0 }
    });

    await createSecurityNotification(user, {
        title: "Other devices signed out",
        message: "Other active AZIEL sessions were revoked."
    });

    return result;
}

async function revokeAllUserSessions(user, reason = "revoked_all") {
    const now = new Date();

    const result = await Session.updateMany(
        {
            userId: user._id,
            revokedAt: null
        },
        {
            $set: {
                revokedAt: now,
                revokeReason: reason
            }
        }
    );

    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    user.currentSessionToken = "";
    user.sessionUpdatedAt = now;
    await user.save();

    await recordSecurityEvent(user, {
        type: "sessions.revoked_all",
        title: "All sessions revoked",
        metadata: { count: result.modifiedCount || 0 }
    });

    await createSecurityNotification(user, {
        title: "All devices signed out",
        message: "All active AZIEL sessions were revoked."
    });

    return result;
}

function getSessionEventMetadata(session) {
    return {
        ipAddress: session.ipAddress || "",
        userAgent: session.userAgent || "",
        deviceName: session.deviceName || "",
        metadata: {
            platform: session.platform || "",
            browser: session.browser || ""
        }
    };
}

module.exports = {
    createSecurityNotification,
    getDeviceMetadata,
    isEmailVerified,
    issueUserSession,
    projectUser,
    recordSecurityEvent,
    revokeAllUserSessions,
    revokeOtherSessions,
    revokeSession,
    verifyUserToken
};
