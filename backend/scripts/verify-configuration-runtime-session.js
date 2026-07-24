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

async function verifySessionManager() {
    const { createConfigurationSessionManager } = require("../configuration/configurationSessionManager");
    const events = [];
    const manager = createConfigurationSessionManager({
        ttlMs: 1000,
        maxSessions: 3,
        events: {
            emit: (eventName, payload) => events.push({ eventName, payload })
        }
    });
    const adminA = { actorId: "admin-a", ownerRole: "OWNER", openedFrom: "verify" };
    const adminB = { actorId: "admin-b", ownerRole: "ADMIN", openedFrom: "verify" };

    const opened = await manager.openSession("website.home.placements", {
        region: "MM",
        language: "en",
        route: "/home.html",
        previewMode: "desktop"
    }, adminA);
    assert.strictEqual(opened.configurationId, "website.home.placements");
    assert.strictEqual(opened.context.region, "MM");
    assert.strictEqual(opened.actorId, "admin-a");
    assert(opened.contextFingerprint.includes("MM|en"), "Normalized context fingerprint must include normalized context.");
    assert(opened.expiresAt, "Session must include expiresAt.");
    assert(["ACTIVE", "FAILED"].includes(opened.status), "Open should resolve the session or fail safely.");
    assert(opened.sessionId, "Session ID must exist.");
    assert(opened.configuredValue && opened.fallbackValue && opened.effectiveValue, "Session must carry resolution values.");
    assert(opened.validation, "Session must carry validation.");
    assert(opened.readiness, "Session must carry readiness.");
    assert(!JSON.stringify(opened).match(/password|secret|token|cookie|mongodb|\$__/i), "Session must not expose secrets or raw documents.");

    const reused = await manager.openSession("website.home.placements", {
        region: "MM",
        language: "en",
        route: "/home.html",
        previewMode: "desktop"
    }, adminA);
    assert.strictEqual(reused.sessionId, opened.sessionId, "Opening same configuration should reuse active session.");
    assert.strictEqual(reused.reuseState, "REUSED", "Reused session should mark reuse state.");

    const thSession = await manager.openSession("website.home.placements", {
        region: "TH",
        language: "th",
        route: "/home.html",
        previewMode: "desktop"
    }, adminA);
    assert.notStrictEqual(thSession.sessionId, reused.sessionId, "Different context must create a new session.");

    const adminBSession = await manager.openSession("website.home.placements", {
        region: "MM",
        language: "en",
        route: "/home.html",
        previewMode: "desktop"
    }, adminB);
    assert.notStrictEqual(adminBSession.sessionId, reused.sessionId, "Different actor must not reuse another actor session.");
    assert.throws(() => manager.getSession(reused.sessionId, adminB), /belongs to another Admin/, "Another actor must be denied session access.");

    const validated = await manager.validateSession(reused.sessionId, adminA);
    assert.strictEqual(validated.status, "VALIDATED", "Validate should move session to VALIDATED.");
    assert.strictEqual(typeof validated.validation.valid, "boolean");

    const resolved = await manager.resolveSession(reused.sessionId, adminA);
    assert.strictEqual(resolved.status, "ACTIVE", "Resolve should move session to ACTIVE.");

    const parallel = await Promise.all([
        manager.openSession("website.home.placements", { region: "MM", language: "my", route: "/home.html", previewMode: "mobile" }, adminA),
        manager.openSession("website.home.placements", { region: "MM", language: "my", route: "/home.html", previewMode: "mobile" }, adminA)
    ]);
    assert.strictEqual(parallel[0].sessionId, parallel[1].sessionId, "Parallel duplicate opens must converge to one session.");

    manager.expireStaleSessions(Date.now() + 5000);
    const expired = manager.getSession(reused.sessionId);
    assert.strictEqual(expired.status, "EXPIRED", "Stale sessions must expire.");
    await assert.rejects(() => manager.resolveSession(reused.sessionId, adminA), /expired/i, "Expired sessions cannot resolve.");

    const openedAfterExpiry = await manager.openSession("website.home.placements", { region: "MM", language: "en" }, adminA);
    assert.notStrictEqual(openedAfterExpiry.sessionId, reused.sessionId, "Opening after expiry should create a replacement session.");
    const closed = manager.closeSession(openedAfterExpiry.sessionId, adminA);
    assert.strictEqual(closed.status, "CLOSED");
    assert(manager.listSessions().some(session => session.status === "CLOSED"), "Closed sessions should remain observable.");
    assert(manager.listSessions(adminB).every(session => session.actorId === "admin-b"), "List sessions must be actor-isolated.");
    manager.cleanupSessions();
    const diagnostics = manager.diagnostics();
    assert(diagnostics.totalSessionCount >= 1, "Diagnostics must include session counts.");
    assert(diagnostics.expiredCount > 0, "Diagnostics must count expirations.");
    assert(diagnostics.ownershipViolations > 0, "Diagnostics must count ownership violations.");
    assert(diagnostics.concurrencyPrevented > 0, "Diagnostics must count prevented duplicate opens.");
    assert(diagnostics.sessionReuseCount > 0, "Diagnostics must count reuse.");
    assert(diagnostics.newSessionCount > 0, "Diagnostics must count new sessions.");

    [
        "configuration.session.opened",
        "configuration.session.reused",
        "configuration.session.resolved",
        "configuration.session.validated",
        "configuration.session.closed",
        "configuration.session.expired"
    ].forEach(eventName => {
        assert(events.some(event => event.eventName === eventName), `${eventName} event must be emitted.`);
    });
    assert(events.every(event => !JSON.stringify(event.payload).match(/configuredValue|effectiveValue|actorId|password|secret|token/i)), "Session events must contain safe metadata only.");
}

function verifyRoutesAndUi() {
    includes("backend/routes/configurationRegistry.js", "router.get(\"/admin/configuration-sessions\"", "Session list endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "router.get(\"/admin/configuration-sessions/:sessionId\"", "Session detail endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "sessions/open", "Open session endpoint must exist.");
    includes("backend/routes/configurationRegistry.js", "resolveSession", "Resolve session route must use session manager.");
    includes("backend/routes/configurationRegistry.js", "validateSession", "Validate session route must use session manager.");
    includes("backend/routes/configurationRegistry.js", "closeSession", "Close session route must use session manager.");
    includes("backend/routes/configurationRegistry.js", "configurationActor", "Session routes must derive authenticated actor.");
    includes("backend/routes/configurationRegistry.js", "manager.listSessions(configurationActor", "Session list must be actor-isolated.");
    notIncludes("backend/routes/configurationRegistry.js", "router.put(", "Session foundation must not add PUT routes.");
    notIncludes("backend/routes/configurationRegistry.js", "router.patch(", "Session foundation must not add PATCH routes.");
    notIncludes("backend/routes/configurationRegistry.js", "router.delete(", "Session foundation must not add DELETE routes.");

    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configurationSession", "Kernel bridge must register configurationSession service.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configuration.session.opened", "Bridge must emit open event.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configuration.session.resolved", "Bridge must emit resolve event.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configuration.session.validated", "Bridge must emit validate event.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configuration.session.closed", "Bridge must emit close event.");
    includes("frontend/js/os/configuration/configuration-runtime-bridge.js", "configuration.session.reused", "Bridge must support safe session metadata.");
    includes("frontend/js/os/service-container.js", "a-zA-Z0-9", "Service container must allow required configurationSession service name.");

    includes("frontend/js/admin-website-runtime.js", "renderConfigurationSession", "Website Configuration UI must render a session card.");
    includes("frontend/js/admin-website-runtime.js", "data-configuration-open-session", "UI must expose Open Session.");
    includes("frontend/js/admin-website-runtime.js", "data-configuration-resolve-session", "UI must expose session Resolve.");
    includes("frontend/js/admin-website-runtime.js", "data-configuration-validate-session", "UI must expose session Validate.");
    includes("frontend/js/admin-website-runtime.js", "data-configuration-close-session", "UI must expose Close Session.");
    includes("frontend/js/admin-website-runtime.js", "Current User", "UI must display owner as Current User.");
    includes("frontend/js/admin-website-runtime.js", "Reopen Session", "UI must handle expired session recovery.");
    includes("frontend/js/admin-website-runtime.js", "expiresAt", "UI must display session expiry.");
    notIncludes("frontend/js/admin-website-runtime.js", "Save Session", "Session UI must not expose save.");
    notIncludes("frontend/js/admin-website-runtime.js", "data-configuration-publish", "Session UI must not expose publish action.");
    notIncludes("frontend/js/admin-website-runtime.js", "Publish Session", "Session UI must not expose publish session action.");
    includes("frontend/js/admin-website-runtime.js", "Publishing is not implemented in this workspace.", "Owner publish status must remain read-only.");
    includes("backend/services/websiteRuntimeService.js", "sessionDiagnostics", "Website Runtime must include session diagnostics.");
}

function verifyPackageScript() {
    includes("package.json", "\"verify:configuration-runtime-session\"", "package.json must expose verify:configuration-runtime-session.");
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000)
    });
    try {
        await verifySessionManager();
        verifyRoutesAndUi();
        verifyPackageScript();
        console.log("Configuration runtime session verification checks passed.");
    } finally {
        await mongoose.connection.close(false);
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
