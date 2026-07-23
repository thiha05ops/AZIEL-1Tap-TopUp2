const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
require("dotenv").config({
    path: path.join(ROOT, ".env")
});

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, fragment, message) {
    assert(read(file).includes(fragment), `${file}: ${message}`);
}

function notIncludes(file, fragment, message) {
    assert(!read(file).includes(fragment), `${file}: ${message}`);
}

async function verifyDraftManager() {
    const { createConfigurationSessionManager } = require("../configuration/configurationSessionManager");
    const { createHomePlacementDraftManager } = require("../configuration/homePlacementDraftManager");
    const { listAdminPlacements, resolveHomePlacements } = require("../services/sitePlacementService");
    const events = [];
    const sessionManager = createConfigurationSessionManager({
        ttlMs: 1000,
        events: { emit: (eventName, payload) => events.push({ eventName, payload }) }
    });
    const draftManager = createHomePlacementDraftManager({
        events: { emit: (eventName, payload) => events.push({ eventName, payload }) },
        sessionManager
    });
    const actor = { actorId: "draft-admin", ownerRole: "OWNER", openedFrom: "verify" };
    const beforeAdmin = JSON.stringify(await listAdminPlacements());
    const beforePublic = JSON.stringify(await resolveHomePlacements({ region: "MM" }));

    const session = await sessionManager.openSession("website.home.placements", { region: "MM", language: "en", route: "/home.html" }, actor);
    const created = draftManager.createDraft(session.sessionId, actor);
    assert.strictEqual(created.sessionId, session.sessionId);
    assert.strictEqual(created.status, "CREATED");
    assert.strictEqual(created.dirtyState.isDirty, false);

    const reused = draftManager.createDraft(session.sessionId, actor);
    assert.strictEqual(reused.draftId, created.draftId, "Opening another draft for same session should reuse it.");

    const first = created.configuredDraft.placements[0];
    const updated = draftManager.updateDraft(session.sessionId, {
        placements: [{ placementCode: first.placementCode, enabled: first.enabled === false }]
    }, actor);
    assert.strictEqual(updated.status, "DIRTY");
    assert.strictEqual(updated.dirtyState.isDirty, true);
    assert(updated.dirtyState.changedFields.some(field => field.endsWith(".enabled")), "Dirty tracking must include enabled field.");

    const validated = await draftManager.validateDraft(session.sessionId, actor);
    assert(["READY", "VALIDATED"].includes(validated.status), "Draft validation should complete without production mutation.");
    assert(validated.validation, "Draft validation result must exist.");

    const previewed = draftManager.previewDraft(session.sessionId, actor);
    assert(previewed.previewProjection, "Draft preview projection must exist.");
    assert.strictEqual(previewed.previewProjection.mode, "DRAFT");
    assert(previewed.previewProjection.placements.some(placement => placement.changed), "Preview must highlight changed placements.");

    const discarded = draftManager.discardDraft(session.sessionId, actor);
    assert.strictEqual(discarded.status, "DISCARDED");
    assert.strictEqual(discarded.dirtyState.isDirty, false);
    assert.strictEqual(discarded.previewProjection, null);

    const draftAfterDiscard = draftManager.createDraft(session.sessionId, actor);
    sessionManager.closeSession(session.sessionId, actor);
    draftManager.expireDrafts();
    assert.strictEqual(draftManager.getDraft(session.sessionId, actor).status, "EXPIRED", "Session close should expire/discard runtime draft state.");

    const session2 = await sessionManager.openSession("website.home.placements", { region: "TH", language: "th", route: "/home.html" }, actor);
    draftManager.createDraft(session2.sessionId, actor);
    sessionManager.expireStaleSessions(Date.now() + 5000);
    draftManager.expireDrafts();
    assert.strictEqual(draftManager.getDraft(session2.sessionId, actor).status, "EXPIRED", "Session expiry should expire draft.");

    const diagnostics = draftManager.diagnostics();
    assert(diagnostics.expiredDrafts >= 1, "Draft diagnostics must count expired drafts.");
    assert(diagnostics.discardCount >= 1, "Draft diagnostics must count discard.");
    assert(diagnostics.previewCount >= 1, "Draft diagnostics must count preview.");

    const afterAdmin = JSON.stringify(await listAdminPlacements());
    const afterPublic = JSON.stringify(await resolveHomePlacements({ region: "MM" }));
    assert.strictEqual(afterAdmin, beforeAdmin, "Admin SitePlacement production projection must remain unchanged.");
    assert.strictEqual(afterPublic, beforePublic, "Public Home placement projection must remain unchanged.");

    [
        "configuration.draft.created",
        "configuration.draft.changed",
        "configuration.draft.validated",
        "configuration.draft.discarded",
        "configuration.draft.expired",
        "configuration.preview.generated"
    ].forEach(eventName => assert(events.some(event => event.eventName === eventName), `${eventName} must be emitted.`));
    assert(events.every(event => !JSON.stringify(event.payload).match(/configuredDraft|previewProjection|password|secret|token/i)), "Draft events must contain safe metadata only.");
    assert(draftAfterDiscard.draftId, "Draft reuse after discard should remain runtime-scoped.");
}

function verifyRoutesAndUi() {
    includes("backend/routes/configurationRegistry.js", "/draft", "Draft create endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "/draft/update", "Draft update endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "/draft/validate", "Draft validate endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "/draft/preview", "Draft preview endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "/draft/discard", "Draft discard endpoint must exist.");
    notIncludes("backend/routes/configurationRegistry.js", "publish", "Draft layer must not expose publish.");
    notIncludes("backend/routes/configurationRegistry.js", "rollback", "Draft layer must not expose rollback.");
    includes("frontend/js/admin-website-runtime.js", "Home Placement Draft", "Website Configuration UI must show draft card.");
    includes("frontend/js/admin-website-runtime.js", "Dirty Indicator", "Draft UI must show dirty indicator.");
    includes("frontend/js/admin-website-runtime.js", "Changed Fields", "Draft UI must show changed fields.");
    includes("frontend/js/admin-website-runtime.js", "Discard Draft", "Draft UI must expose discard.");
    includes("frontend/js/admin-website-runtime.js", "Production → Draft", "Draft UI must show comparison.");
    notIncludes("frontend/js/admin-website-runtime.js", "Publish Draft", "Draft UI must not expose publish.");
    includes("backend/services/websiteRuntimeService.js", "draftDiagnostics", "Website Runtime must include draft diagnostics.");
}

function verifyPackageScript() {
    includes("package.json", "\"verify:home-placement-draft-layer\"", "package.json must expose verify:home-placement-draft-layer.");
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });
    try {
        await verifyDraftManager();
        verifyRoutesAndUi();
        verifyPackageScript();
        console.log("Home Placement draft layer verification checks passed.");
    } finally {
        await mongoose.connection.close(false);
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
