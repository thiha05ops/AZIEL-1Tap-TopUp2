const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, fragment, message) {
    assert(read(file).includes(fragment), `${file}: ${message}`);
}

function loadContracts() {
    const context = {
        console,
        window: {},
        document: {
            documentElement: { lang: "en" },
            querySelectorAll: () => [],
            querySelector: () => null,
            getElementById: () => null,
            addEventListener: () => {},
            readyState: "complete"
        },
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        },
        performance: { now: () => Date.now() },
        CustomEvent: function CustomEvent(name, init = {}) {
            this.type = name;
            this.detail = init.detail;
        }
    };
    context.window.window = context.window;
    context.window.document = context.document;
    context.window.localStorage = context.localStorage;
    context.window.performance = context.performance;
    context.window.CustomEvent = context.CustomEvent;
    context.window.addEventListener = () => {};
    context.window.removeEventListener = () => {};
    context.window.dispatchEvent = () => {};
    context.window.location = { hash: "#dashboard", href: "" };

    [
        "frontend/js/os/kernel-errors.js",
        "frontend/js/os/kernel-diagnostics.js",
        "frontend/js/os/event-bus.js",
        "frontend/js/os/app-registry.js",
        "frontend/js/os/service-container.js",
        "frontend/js/os/runtime-registry.js",
        "frontend/js/os/workspace-manager.js",
        "frontend/js/os/navigation-manager.js"
    ].forEach(file => {
        vm.runInNewContext(read(file), context, { filename: file });
    });
    return context.window.AZIELOS_CONTRACTS;
}

function verifyFileStructure() {
    [
        "kernel-errors.js",
        "kernel-diagnostics.js",
        "event-bus.js",
        "app-registry.js",
        "service-container.js",
        "runtime-registry.js",
        "workspace-manager.js",
        "navigation-manager.js",
        "kernel.js",
        "kernel-bootstrap.js",
        "compatibility/admin-navigation-adapter.js",
        "apps/core-app-manifest.js"
    ].forEach(file => {
        assert(fs.existsSync(path.join(ROOT, "frontend/js/os", file)), `Missing OS kernel file ${file}`);
    });
}

function verifyAdminWiring() {
    const html = read("frontend/admin.html");
    const scriptOrder = [
        "/js/os/kernel-errors.js",
        "/js/os/kernel-diagnostics.js",
        "/js/os/event-bus.js",
        "/js/os/app-registry.js",
        "/js/os/workspace-manager.js",
        "/js/os/navigation-manager.js",
        "/js/os/service-container.js",
        "/js/os/runtime-registry.js",
        "/js/os/apps/core-app-manifest.js",
        "/js/os/compatibility/admin-navigation-adapter.js",
        "/js/os/kernel.js",
        "/js/admin-app.js",
        "/js/os/kernel-bootstrap.js"
    ];
    let previous = -1;
    scriptOrder.forEach(src => {
        const index = html.indexOf(src);
        assert(index > previous, `${src} must load after the previous kernel/admin dependency.`);
        previous = index;
    });

    [
        "dashboard",
        "website",
        "orders",
        "wallet",
        "fulfillment",
        "support",
        "chat",
        "catalog",
        "promos",
        "media",
        "site-content",
        "campaigns",
        "users",
        "broadcast",
        "admin-security",
        "payments",
        "settings"
    ].forEach(section => {
        assert(html.includes(`data-section="${section}"`), `Existing data-section ${section} must remain.`);
        assert(html.includes(`id="section-${section}"`), `Existing section panel ${section} must remain.`);
    });

    assert(html.includes(`href="/admin-design-studio.html"`), "Design Studio direct route must remain.");
    assert(!html.includes("/js/os/") || !read("frontend/home.html").includes("/js/os/"), "Public home must not load Admin OS kernel scripts.");
}

function verifyRegistryContracts() {
    const contracts = loadContracts();
    const diagnostics = contracts.createDiagnostics();
    const events = contracts.createEventBus(diagnostics);
    const apps = contracts.createAppRegistry(events, diagnostics);

    const app = apps.register({
        id: "dashboard",
        displayName: "Dashboard",
        group: "COMMAND",
        route: "dashboard",
        section: "dashboard",
        type: "WORKSPACE",
        permissions: ["DASHBOARD_READ"],
        order: 1
    });
    assert.strictEqual(app.id, "dashboard", "App registry should register valid manifests.");
    assert.strictEqual(apps.count(), 1, "App registry count should reflect registered apps.");
    assert.throws(() => apps.register({ ...app }), /App ID is already registered/, "Duplicate app IDs must be rejected.");
    assert.throws(() => apps.register({ id: "", route: "bad" }), /stable id/, "Invalid manifests must be rejected.");
    assert.deepStrictEqual(Array.from(apps.get("dashboard").permissions), ["DASHBOARD_READ"], "Permission metadata must be preserved.");
    assert.strictEqual(apps.list()[0].id, "dashboard", "App listing must be read-only and deterministic.");

    const workspace = contracts.createWorkspaceManager(apps, events, diagnostics);
    assert.throws(() => workspace.activate("missing"), /unknown app/, "Workspace must reject unknown app activation.");
    workspace.activate("dashboard");
    assert.strictEqual(workspace.snapshot().activeAppId, "dashboard", "Workspace should activate known app.");
}

function verifyEventBusAndServices() {
    const contracts = loadContracts();
    const diagnostics = contracts.createDiagnostics();
    const events = contracts.createEventBus(diagnostics);
    let delivered = 0;
    const handler = () => { delivered += 1; };
    const off = events.on("kernel.ready", handler, { scopeId: "test" });
    events.on("kernel.ready", () => { throw new Error("broken listener"); }, { scopeId: "broken" });
    const result = events.emit("kernel.ready", { ok: true });
    assert.strictEqual(delivered, 1, "Working listener should receive event.");
    assert.strictEqual(result.failed, 1, "Broken listener failure should be captured.");
    off();
    events.emit("kernel.ready", {});
    assert.strictEqual(delivered, 1, "Unsubscribed listener should not be called.");
    assert(diagnostics.snapshot({ events }).listenerFailures.length > 0, "Listener failures should appear in diagnostics.");

    const services = contracts.createServiceContainer();
    services.register("navigation", { openApp: () => true });
    assert.strictEqual(services.has("navigation"), true, "Service should register.");
    assert.strictEqual(typeof services.resolve("navigation").openApp, "function", "Service should resolve.");
    assert.throws(() => services.register("navigation", {}), /already registered/, "Duplicate services must be rejected.");
    assert.throws(() => services.resolve("missing"), /not registered/, "Missing service resolution must fail.");

    const runtimes = contracts.createRuntimeRegistry(events);
    assert.strictEqual(runtimes.count(), 0, "Runtime registry should support empty state.");
    assert.deepStrictEqual(Array.from(runtimes.list()), [], "Empty runtime registry should list no runtimes.");
}

function verifyDiagnosticsAndSafety() {
    includes("frontend/js/os/kernel.js", "window.AZIELOS = kernel", "Kernel must expose one controlled global.");
    includes("frontend/js/os/kernel.js", "Object.freeze", "Kernel public surface should be immutable.");
    includes("frontend/js/os/kernel.js", "CREATED", "Lifecycle CREATED must exist.");
    includes("frontend/js/os/kernel.js", "BOOTING", "Lifecycle BOOTING must exist.");
    includes("frontend/js/os/kernel.js", "READY", "Lifecycle READY must exist.");
    includes("frontend/js/os/kernel.js", "DEGRADED", "Lifecycle DEGRADED must exist.");
    includes("frontend/js/os/kernel.js", "FAILED", "Lifecycle FAILED must exist.");
    includes("frontend/js/os/kernel.js", "DESTROYED", "Lifecycle DESTROYED must exist.");
    includes("frontend/js/os/kernel-errors.js", "token|secret|password|cookie|authorization", "Diagnostics context sanitizer must block obvious secrets.");
    includes("frontend/js/os/event-bus.js", "HISTORY_LIMIT = 60", "Event history must be bounded.");
    includes("frontend/js/os/event-bus.js", "RECURSION_LIMIT = 8", "Event recursion must be bounded.");
    includes("frontend/js/os/compatibility/admin-navigation-adapter.js", "data-admin-permission", "Adapter must preserve permission metadata.");
    includes("frontend/js/os/compatibility/admin-navigation-adapter.js", "aziel:admin-section-opened", "Adapter must sync existing Admin section events.");
    includes("frontend/js/os/compatibility/admin-navigation-adapter.js", "button.click()", "Hash synchronization should route through existing nav activation.");
    includes("frontend/js/os/apps/core-app-manifest.js", "website: 15", "Website app order must be registered in core app manifest.");
    includes("frontend/js/os/apps/core-app-manifest.js", "EXPERIENCE", "Experience group must exist for Website app.");
    includes("frontend/js/admin-app.js", "initAdminNavSearch", "Current sidebar search must remain wired.");
    includes("frontend/js/admin-app.js", "admin-sidebar-collapsed", "Collapsed navigation must remain wired.");
    includes("frontend/js/admin-app.js", "admin-drawer-lock", "Mobile drawer must remain wired.");
}

function verifyPackageScript() {
    includes("package.json", "\"verify:aziel-os-kernel\"", "package.json must expose kernel verifier.");
}

verifyFileStructure();
verifyAdminWiring();
verifyRegistryContracts();
verifyEventBusAndServices();
verifyDiagnosticsAndSafety();
verifyPackageScript();

console.log("AZIEL OS Kernel foundation verification checks passed.");
