const { ConfigurationError, toSafeError } = require("./configurationErrors");
const { cloneSnapshot, normalizeConfigurationId, normalizeContext } = require("./configurationDefinition");
const { getConfigurationRegistry } = require("./configurationRegistry");

const SESSION_STATUSES = Object.freeze(["CREATED", "OPEN", "ACTIVE", "VALIDATED", "CLOSED", "EXPIRED", "FAILED"]);
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 200;

function safeNow() {
    return new Date().toISOString();
}

function createSessionId(configurationId) {
    return `${configurationId}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
}

class ConfigurationSessionManager {
    constructor({ ttlMs = DEFAULT_TTL_MS, maxSessions = DEFAULT_MAX_SESSIONS, events = null } = {}) {
        this.ttlMs = Number(ttlMs || DEFAULT_TTL_MS);
        this.maxSessions = Number(maxSessions || DEFAULT_MAX_SESSIONS);
        this.events = events;
        this.sessions = new Map();
        this.activeByIdentity = new Map();
        this.openLocks = new Map();
        this.createdAt = safeNow();
        this.counters = {
            expiredCount: 0,
            cleanupCount: 0,
            ownershipViolations: 0,
            concurrencyPrevented: 0,
            sessionReuseCount: 0,
            newSessionCount: 0,
            restartRecoveryCount: 0
        };
    }

    async openSession(configurationId, context = {}, actor = {}) {
        const id = normalizeConfigurationId(configurationId);
        this.expireStaleSessions();
        this.cleanupSessions();
        const safeContext = normalizeContext(context);
        const safeActor = normalizeActor(actor);
        const contextFingerprint = fingerprintContext(safeContext);
        const identityKey = buildIdentityKey(id, safeActor.actorId, contextFingerprint);
        if (this.openLocks.has(identityKey)) {
            this.counters.concurrencyPrevented += 1;
            return this.openLocks.get(identityKey);
        }
        const openPromise = this.openSessionLocked({ id, safeContext, safeActor, contextFingerprint, identityKey });
        this.openLocks.set(identityKey, openPromise);
        try {
            return await openPromise;
        } finally {
            this.openLocks.delete(identityKey);
        }
    }

    async openSessionLocked({ id, safeContext, safeActor, contextFingerprint, identityKey }) {
        const existingId = this.activeByIdentity.get(identityKey);
        const existing = existingId ? this.sessions.get(existingId) : null;
        let session;
        if (existing && !isTerminal(existing.status) && !isExpired(existing, Date.now())) {
            this.counters.sessionReuseCount += 1;
            session = {
                ...existing,
                status: "OPEN",
                updatedAt: safeNow(),
                expiresAt: expiresAtFromNow(this.ttlMs),
                reuseState: "REUSED"
            };
            this.sessions.set(session.sessionId, freezeSession(session));
            this.emit("configuration.session.reused", session);
        } else {
            if (existing && !isTerminal(existing.status)) {
                const closed = freezeSession({
                    ...existing,
                    status: "CLOSED",
                    updatedAt: safeNow(),
                    diagnostics: {
                        ...(existing.diagnostics || {}),
                        replacementReason: "Session replaced by a new normalized context owner request."
                    }
                });
                this.sessions.set(closed.sessionId, closed);
                this.emit("configuration.session.closed", closed);
            }
            this.counters.newSessionCount += 1;
            session = {
                sessionId: createSessionId(id),
                configurationId: id,
                actorId: safeActor.actorId,
                ownerRole: safeActor.ownerRole,
                openedFrom: safeActor.openedFrom,
                context: safeContext,
                contextFingerprint,
                configuredValue: null,
                fallbackValue: null,
                effectiveValue: null,
                validation: null,
                readiness: { state: "UNKNOWN", reason: "Session opened; resolution pending." },
                capabilities: [],
                owner: null,
                source: null,
                diagnostics: {},
                status: "CREATED",
                openedAt: safeNow(),
                updatedAt: safeNow(),
                expiresAt: expiresAtFromNow(this.ttlMs),
                reuseState: "NEW"
            };
            session.status = "OPEN";
            this.sessions.set(session.sessionId, freezeSession(session));
            this.activeByIdentity.set(identityKey, session.sessionId);
            this.emit("configuration.session.opened", session);
        }

        return this.resolveSession(session.sessionId, safeActor);
    }

    getSession(sessionId, actor = null) {
        this.expireStaleSessions();
        const session = this.sessions.get(String(sessionId || ""));
        if (!session) {
            this.counters.restartRecoveryCount += 1;
            throw new ConfigurationError("SESSION_NOT_FOUND", "Configuration session was not found or expired after restart.", 404);
        }
        if (actor) this.assertOwnership(session, actor);
        return cloneSnapshot(session);
    }

    listSessions(actor = null) {
        this.expireStaleSessions();
        return Object.freeze([...this.sessions.values()]
            .filter(session => !actor || isOwner(session, normalizeActor(actor)))
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
            .map(session => cloneSnapshot(session)));
    }

    async resolveSession(sessionId, actor = {}) {
        const current = this.getOwnedActiveSession(sessionId, actor);
        try {
            const registry = await getConfigurationRegistry();
            const resolution = await registry.resolve(current.configurationId, current.context);
            const next = freezeSession({
                ...current,
                configuredValue: resolution.configuredValue,
                fallbackValue: resolution.fallbackValue,
                effectiveValue: resolution.effectiveValue,
                validation: resolution.validation,
                readiness: resolution.readiness,
                capabilities: resolution.capabilities,
                owner: resolution.owner,
                source: resolution.source,
                diagnostics: resolution.diagnostics,
                status: "ACTIVE",
                updatedAt: safeNow(),
                expiresAt: expiresAtFromNow(this.ttlMs)
            });
            this.sessions.set(next.sessionId, next);
            this.activeByIdentity.set(buildIdentityKey(next.configurationId, next.actorId, next.contextFingerprint), next.sessionId);
            this.emit("configuration.session.resolved", next);
            return cloneSnapshot(next);
        } catch (error) {
            const failed = freezeSession({
                ...current,
                status: "FAILED",
                diagnostics: {
                    ...(current.diagnostics || {}),
                    failure: toSafeError(error)
                },
                updatedAt: safeNow()
            });
            this.sessions.set(failed.sessionId, failed);
            this.emit("configuration.session.failed", failed);
            return cloneSnapshot(failed);
        }
    }

    async validateSession(sessionId, actor = {}) {
        const current = this.getOwnedActiveSession(sessionId, actor);
        try {
            const registry = await getConfigurationRegistry();
            const validation = registry.validate(current.configurationId, current.configuredValue || { placements: [] }, current.context);
            const next = freezeSession({
                ...current,
                validation,
                status: "VALIDATED",
                updatedAt: safeNow(),
                expiresAt: expiresAtFromNow(this.ttlMs)
            });
            this.sessions.set(next.sessionId, next);
            this.emit("configuration.session.validated", next);
            return cloneSnapshot(next);
        } catch (error) {
            const failed = freezeSession({
                ...current,
                status: "FAILED",
                diagnostics: {
                    ...(current.diagnostics || {}),
                    failure: toSafeError(error)
                },
                updatedAt: safeNow()
            });
            this.sessions.set(failed.sessionId, failed);
            this.emit("configuration.session.failed", failed);
            return cloneSnapshot(failed);
        }
    }

    closeSession(sessionId, actor = {}) {
        const current = this.getSession(sessionId, actor);
        const next = freezeSession({
            ...current,
            status: "CLOSED",
            updatedAt: safeNow()
        });
        this.sessions.set(next.sessionId, next);
        const identityKey = buildIdentityKey(next.configurationId, next.actorId, next.contextFingerprint);
        if (this.activeByIdentity.get(identityKey) === next.sessionId) {
            this.activeByIdentity.delete(identityKey);
        }
        this.emit("configuration.session.closed", next);
        return cloneSnapshot(next);
    }

    closeAll(actor = null) {
        return this.listSessions(actor)
            .filter(session => !isTerminal(session.status))
            .map(session => this.closeSession(session.sessionId, actor || {
                actorId: session.actorId,
                ownerRole: session.ownerRole,
                openedFrom: "system"
            }));
    }

    diagnostics() {
        this.expireStaleSessions();
        const sessions = this.listSessions();
        return Object.freeze({
            managerStatus: "READY",
            createdAt: this.createdAt,
            ttlMs: this.ttlMs,
            maxSessions: this.maxSessions,
            activeSessionCount: sessions.filter(session => ["OPEN", "ACTIVE", "VALIDATED"].includes(session.status)).length,
            totalSessionCount: sessions.length,
            expiredCount: this.counters.expiredCount,
            cleanupCount: this.counters.cleanupCount,
            ownershipViolations: this.counters.ownershipViolations,
            concurrencyPrevented: this.counters.concurrencyPrevented,
            sessionReuseCount: this.counters.sessionReuseCount,
            newSessionCount: this.counters.newSessionCount,
            restartRecoveryCount: this.counters.restartRecoveryCount,
            sessionsByStatus: SESSION_STATUSES.reduce((counts, status) => {
                counts[status] = sessions.filter(session => session.status === status).length;
                return counts;
            }, {})
        });
    }

    expireStaleSessions(now = Date.now()) {
        for (const session of this.sessions.values()) {
            if (isTerminal(session.status)) continue;
            const updatedAt = new Date(session.updatedAt).getTime();
            if (Number.isFinite(updatedAt) && now - updatedAt > this.ttlMs) {
                const expired = freezeSession({
                    ...session,
                    status: "EXPIRED",
                    updatedAt: safeNow()
                });
                this.sessions.set(expired.sessionId, expired);
                this.counters.expiredCount += 1;
                const identityKey = buildIdentityKey(expired.configurationId, expired.actorId, expired.contextFingerprint);
                if (this.activeByIdentity.get(identityKey) === expired.sessionId) {
                    this.activeByIdentity.delete(identityKey);
                }
                this.emit("configuration.session.expired", expired);
            }
        }
    }

    cleanupSessions() {
        if (this.sessions.size <= this.maxSessions) return 0;
        const removable = [...this.sessions.values()]
            .filter(session => isTerminal(session.status))
            .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
        let removed = 0;
        while (this.sessions.size > this.maxSessions && removable.length) {
            const session = removable.shift();
            this.sessions.delete(session.sessionId);
            removed += 1;
        }
        if (removed) {
            this.counters.cleanupCount += removed;
            this.emitRaw("configuration.session.cleanup", { removedCount: removed, totalSessionCount: this.sessions.size });
        }
        return removed;
    }

    getOwnedActiveSession(sessionId, actor) {
        const current = this.getSession(sessionId, actor);
        if (current.status === "EXPIRED" || isExpired(current, Date.now())) {
            this.expireStaleSessions(Date.now() + this.ttlMs + 1);
            throw new ConfigurationError("SESSION_EXPIRED", "Configuration session has expired. Reopen Session.", 410, { sessionId: current.sessionId });
        }
        if (isTerminal(current.status)) {
            throw new ConfigurationError("SESSION_EXPIRED", "Configuration session is no longer active. Reopen Session.", 410, { sessionId: current.sessionId });
        }
        return current;
    }

    assertOwnership(session, actor) {
        const safeActor = normalizeActor(actor);
        if (!isOwner(session, safeActor)) {
            this.counters.ownershipViolations += 1;
            throw new ConfigurationError("SESSION_OWNERSHIP_DENIED", "Configuration session belongs to another Admin.", 403, { sessionId: session.sessionId });
        }
    }

    emit(eventName, session) {
        this.emitRaw(eventName, {
            sessionId: session.sessionId,
            configurationId: session.configurationId,
            status: session.status,
            readiness: session.readiness?.state || "UNKNOWN",
            contextFingerprint: session.contextFingerprint || "",
            reuseState: session.reuseState || ""
        });
    }

    emitRaw(eventName, payload) {
        this.events?.emit?.(eventName, payload, { source: "configuration-session-manager" });
    }
}

function freezeSession(session) {
    return Object.freeze(cloneSnapshot(session));
}

function isTerminal(status) {
    return ["CLOSED", "EXPIRED", "FAILED"].includes(status);
}

function expiresAtFromNow(ttlMs) {
    return new Date(Date.now() + Number(ttlMs || DEFAULT_TTL_MS)).toISOString();
}

function isExpired(session, now = Date.now()) {
    const expiresAt = new Date(session.expiresAt || session.updatedAt).getTime();
    return Number.isFinite(expiresAt) && now > expiresAt;
}

function normalizeActor(actor = {}) {
    const actorId = String(actor.actorId || actor.id || actor._id || actor.username || "").trim();
    if (!/^[A-Za-z0-9_.:@-]{2,128}$/.test(actorId)) {
        throw new ConfigurationError("SESSION_INVALID_ACTOR", "Configuration session actor is invalid.", 401);
    }
    return Object.freeze({
        actorId,
        ownerRole: String(actor.ownerRole || actor.role || "ADMIN").trim().toUpperCase(),
        openedFrom: String(actor.openedFrom || "admin-website").trim().slice(0, 80)
    });
}

function fingerprintContext(context = {}) {
    return [
        context.region,
        context.language,
        context.environment,
        context.previewMode
    ].map(value => String(value || "").trim()).join("|");
}

function buildIdentityKey(configurationId, actorId, contextFingerprint) {
    return `${configurationId}::${actorId}::${contextFingerprint}`;
}

function isOwner(session = {}, actor = {}) {
    return String(session.actorId || "") === String(actor.actorId || "");
}

let singleton = null;

function getConfigurationSessionManager() {
    if (!singleton) singleton = new ConfigurationSessionManager();
    return singleton;
}

function createConfigurationSessionManager(options = {}) {
    return new ConfigurationSessionManager(options);
}

module.exports = {
    DEFAULT_TTL_MS,
    DEFAULT_MAX_SESSIONS,
    SESSION_STATUSES,
    ConfigurationSessionManager,
    createConfigurationSessionManager,
    getConfigurationSessionManager
};
