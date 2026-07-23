const { ConfigurationError } = require("./configurationErrors");
const { cloneSnapshot } = require("./configurationDefinition");
const { getConfigurationRegistry } = require("./configurationRegistry");
const { getConfigurationSessionManager } = require("./configurationSessionManager");

const DRAFT_STATUSES = Object.freeze(["CREATED", "DIRTY", "VALIDATED", "READY", "DISCARDED", "EXPIRED", "FAILED"]);
const EDITABLE_FIELDS = Object.freeze(["enabled", "order", "assignedContentReference", "visibility", "metadata", "items"]);

function nowIso() {
    return new Date().toISOString();
}

function draftIdFor(sessionId) {
    return `draft.${sessionId}`;
}

function createDefaultDraft(session) {
    return {
        draftId: draftIdFor(session.sessionId),
        sessionId: session.sessionId,
        configurationId: session.configurationId,
        actorId: session.actorId,
        region: session.context?.region || "MM",
        language: session.context?.language || "en",
        status: "CREATED",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        configuredDraft: cloneSnapshot(session.configuredValue || { placements: [] }),
        validation: session.validation || null,
        previewProjection: null,
        dirtyState: {
            isDirty: false,
            changedFields: [],
            changeCount: 0
        },
        diagnostics: {
            source: "runtime-memory",
            productionMutation: false
        }
    };
}

class HomePlacementDraftManager {
    constructor({ events = null, sessionManager = null } = {}) {
        this.events = events;
        this.sessionManager = sessionManager || getConfigurationSessionManager();
        this.drafts = new Map();
        this.counters = {
            activeDrafts: 0,
            dirtyDrafts: 0,
            expiredDrafts: 0,
            discardCount: 0,
            previewCount: 0,
            validationFailures: 0
        };
    }

    createDraft(sessionId, actor = {}) {
        const session = this.requireActiveSession(sessionId, actor);
        const existing = this.drafts.get(session.sessionId);
        if (existing && !isDraftTerminal(existing.status)) return cloneSnapshot(existing);
        const draft = freezeDraft(createDefaultDraft(session));
        this.drafts.set(draft.sessionId, draft);
        this.emit("configuration.draft.created", draft);
        return cloneSnapshot(draft);
    }

    updateDraft(sessionId, patch = {}, actor = {}) {
        const session = this.requireActiveSession(sessionId, actor);
        const current = this.drafts.get(session.sessionId) || this.createDraft(sessionId, actor);
        const nextDraftValue = applyPatch(current.configuredDraft, patch);
        const dirtyState = calculateDirtyState(session.configuredValue || { placements: [] }, nextDraftValue);
        const next = freezeDraft({
            ...current,
            configuredDraft: nextDraftValue,
            status: dirtyState.isDirty ? "DIRTY" : "CREATED",
            dirtyState,
            previewProjection: null,
            updatedAt: nowIso()
        });
        this.drafts.set(next.sessionId, next);
        this.emit("configuration.draft.changed", next);
        return cloneSnapshot(next);
    }

    async validateDraft(sessionId, actor = {}) {
        const session = this.requireActiveSession(sessionId, actor);
        const current = this.drafts.get(session.sessionId) || this.createDraft(sessionId, actor);
        const registry = await getConfigurationRegistry();
        const validation = registry.validate(session.configurationId, current.configuredDraft, session.context);
        const next = freezeDraft({
            ...current,
            validation,
            status: validation.valid ? "READY" : "VALIDATED",
            updatedAt: nowIso()
        });
        if (!validation.valid) this.counters.validationFailures += 1;
        this.drafts.set(next.sessionId, next);
        this.emit("configuration.draft.validated", next);
        return cloneSnapshot(next);
    }

    previewDraft(sessionId, actor = {}) {
        const session = this.requireActiveSession(sessionId, actor);
        const current = this.drafts.get(session.sessionId) || this.createDraft(sessionId, actor);
        const production = cloneSnapshot(session.effectiveValue || { placements: [] });
        const previewProjection = buildPreviewProjection(production, current.configuredDraft);
        const next = freezeDraft({
            ...current,
            previewProjection,
            updatedAt: nowIso()
        });
        this.counters.previewCount += 1;
        this.drafts.set(next.sessionId, next);
        this.emit("configuration.preview.generated", next);
        return cloneSnapshot(next);
    }

    discardDraft(sessionId, actor = {}) {
        const session = this.sessionManager.getSession(sessionId, actor);
        const current = this.drafts.get(session.sessionId);
        if (!current) return null;
        const discarded = freezeDraft({
            ...current,
            status: "DISCARDED",
            previewProjection: null,
            dirtyState: {
                isDirty: false,
                changedFields: [],
                changeCount: 0
            },
            updatedAt: nowIso()
        });
        this.drafts.set(discarded.sessionId, discarded);
        this.counters.discardCount += 1;
        this.emit("configuration.draft.discarded", discarded);
        return cloneSnapshot(discarded);
    }

    getDraft(sessionId, actor = {}) {
        this.expireDrafts();
        const session = this.sessionManager.getSession(sessionId, actor);
        const draft = this.drafts.get(session.sessionId);
        if (!draft) throw new ConfigurationError("CONFIGURATION_DRAFT_NOT_FOUND", "Configuration draft was not found.", 404);
        return cloneSnapshot(draft);
    }

    expireDrafts() {
        const manager = this.sessionManager;
        for (const draft of this.drafts.values()) {
            if (isDraftTerminal(draft.status)) continue;
            let session = null;
            try {
                session = manager.getSession(draft.sessionId, { actorId: draft.actorId });
            } catch (_error) {
                session = null;
            }
            if (!session || ["CLOSED", "EXPIRED", "FAILED"].includes(session.status)) {
                const expired = freezeDraft({
                    ...draft,
                    status: "EXPIRED",
                    previewProjection: null,
                    updatedAt: nowIso()
                });
                this.drafts.set(expired.sessionId, expired);
                this.counters.expiredDrafts += 1;
                this.emit("configuration.draft.expired", expired);
            }
        }
    }

    diagnostics() {
        this.expireDrafts();
        const drafts = [...this.drafts.values()];
        return Object.freeze({
            activeDrafts: drafts.filter(draft => !isDraftTerminal(draft.status)).length,
            dirtyDrafts: drafts.filter(draft => draft.dirtyState?.isDirty).length,
            expiredDrafts: this.counters.expiredDrafts,
            discardCount: this.counters.discardCount,
            previewCount: this.counters.previewCount,
            validationFailures: this.counters.validationFailures,
            draftsByStatus: DRAFT_STATUSES.reduce((counts, status) => {
                counts[status] = drafts.filter(draft => draft.status === status).length;
                return counts;
            }, {})
        });
    }

    emit(eventName, draft) {
        this.events?.emit?.(eventName, safeDraftEvent(draft), { source: "home-placement-draft-manager" });
    }

    requireActiveSession(sessionId, actor) {
        const session = this.sessionManager.getSession(sessionId, actor);
        if (["CLOSED", "EXPIRED", "FAILED"].includes(session.status)) {
            throw new ConfigurationError("SESSION_EXPIRED", "Configuration session is not active. Reopen Session.", 410, { sessionId });
        }
        if (session.configurationId !== "website.home.placements") {
            throw new ConfigurationError("CONFIGURATION_CAPABILITY_UNSUPPORTED", "Drafts are only supported for Home Placements in this phase.", 400);
        }
        return session;
    }
}

function applyPatch(configuredDraft = {}, patch = {}) {
    const next = cloneSnapshot(configuredDraft || { placements: [] });
    const placements = Array.isArray(next.placements) ? next.placements : [];
    const updates = Array.isArray(patch.placements) ? patch.placements : [];
    updates.forEach(update => {
        const placementCode = String(update.placementCode || update.placementId || "").trim().toUpperCase();
        const index = placements.findIndex(placement => placement.placementCode === placementCode || placement.placementId === placementCode);
        if (index < 0) return;
        const current = placements[index];
        EDITABLE_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(update, field)) {
                current[field] = cloneSnapshot(update[field]);
            }
        });
    });
    placements.sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.placementCode).localeCompare(String(b.placementCode)));
    next.placements = placements;
    return next;
}

function calculateDirtyState(productionConfigured = {}, draftConfigured = {}) {
    const changedFields = [];
    const production = new Map((productionConfigured.placements || []).map(placement => [placement.placementCode, placement]));
    (draftConfigured.placements || []).forEach(draft => {
        const original = production.get(draft.placementCode) || {};
        EDITABLE_FIELDS.forEach(field => {
            if (JSON.stringify(original[field]) !== JSON.stringify(draft[field])) {
                changedFields.push(`${draft.placementCode}.${field}`);
            }
        });
    });
    return {
        isDirty: changedFields.length > 0,
        changedFields,
        changeCount: changedFields.length
    };
}

function buildPreviewProjection(production = {}, configuredDraft = {}) {
    const draftMap = new Map((configuredDraft.placements || []).map(placement => [placement.placementCode, placement]));
    return {
        mode: "DRAFT",
        productionMode: "PRODUCTION",
        generatedAt: nowIso(),
        region: production.region || "MM",
        placements: (production.placements || []).map(placement => {
            const draft = draftMap.get(placement.placementCode) || {};
            const changedFields = [];
            EDITABLE_FIELDS.forEach(field => {
                if (Object.prototype.hasOwnProperty.call(draft, field)) changedFields.push(field);
            });
            return {
                placementCode: placement.placementCode,
                displayName: placement.displayName,
                productionState: placement.effectiveState || "PRODUCTION",
                draftState: draft.enabled === false ? "DISABLED" : "DRAFT",
                changed: changedFields.length > 0,
                changedFields,
                order: draft.order || placement.order,
                itemCount: Array.isArray(draft.items) ? draft.items.length : placement.itemCount || 0
            };
        })
    };
}

function freezeDraft(draft) {
    return Object.freeze(cloneSnapshot(draft));
}

function isDraftTerminal(status) {
    return ["DISCARDED", "EXPIRED", "FAILED"].includes(status);
}

function safeDraftEvent(draft = {}) {
    return {
        draftId: draft.draftId || "",
        sessionId: draft.sessionId || "",
        configurationId: draft.configurationId || "",
        status: draft.status || "UNKNOWN",
        isDirty: Boolean(draft.dirtyState?.isDirty),
        changeCount: draft.dirtyState?.changeCount || 0
    };
}

let singleton = null;

function getHomePlacementDraftManager() {
    if (!singleton) singleton = new HomePlacementDraftManager();
    return singleton;
}

function createHomePlacementDraftManager(options = {}) {
    return new HomePlacementDraftManager(options);
}

module.exports = {
    DRAFT_STATUSES,
    HomePlacementDraftManager,
    createHomePlacementDraftManager,
    getHomePlacementDraftManager
};
