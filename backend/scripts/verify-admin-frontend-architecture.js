const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function notIncludes(file, pattern, message) {
    assert(!read(file).includes(pattern), `${file}: ${message}`);
}

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    add(value) {
        this.values.add(value);
    }

    remove(value) {
        this.values.delete(value);
    }

    toggle(value, force) {
        const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
        if (enabled) this.add(value);
        else this.remove(value);
    }

    contains(value) {
        return this.values.has(value);
    }
}

class FakeElement {
    constructor(id = "") {
        this.id = id;
        this.listeners = {};
        this.classList = new FakeClassList();
        this.textContent = "";
        this.disabled = false;
        this.dataset = {};
    }

    addEventListener(type, handler) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(handler);
    }

    dispatch(type, event = {}) {
        (this.listeners[type] || []).forEach(handler => handler({ target: this, ...event }));
    }

    replaceChildren() {
        this.textContent = "";
    }
}

function createSharedContext() {
    const documentListeners = {};
    const document = {
        addEventListener(type, handler) {
            documentListeners[type] = documentListeners[type] || [];
            documentListeners[type].push(handler);
        },
        dispatch(type, event = {}) {
            (documentListeners[type] || []).forEach(handler => handler(event));
        },
        querySelector(selector) {
            return selector === "#modal" ? this.modal : null;
        },
        modal: null
    };
    const window = {
        confirm: () => true,
        AZIEL_UI: {
            confirm: async () => true
        }
    };
    const context = {
        document,
        window,
        console,
        setTimeout,
        clearTimeout
    };
    context.window.window = window;
    context.window.document = document;
    vm.runInNewContext(read("frontend/js/admin/admin-ui.js"), context, { filename: "frontend/js/admin/admin-ui.js" });
    return context;
}

async function verifyRequestLifecycle() {
    const context = createSharedContext();
    const gate = context.window.AZIEL_ADMIN_UI.request.createRequestGate();
    let resolveFirst;
    const firstPromise = new Promise(resolve => {
        resolveFirst = resolve;
    });

    const first = gate.begin("status=paid", { coalesceKey: "paid" });
    first.track(firstPromise);
    const duplicate = gate.begin("status=paid", { coalesceKey: "paid" });
    const different = gate.begin("status=failed", { coalesceKey: "failed" });

    assert.strictEqual(duplicate.coalesced, true, "Identical in-flight request should coalesce.");
    assert.strictEqual(duplicate.promise, firstPromise, "Coalesced request should expose original promise.");
    assert.strictEqual(different.coalesced, false, "Different query signatures must remain independently requestable.");
    assert.strictEqual(first.isCurrent(), false, "Older request should be stale after a newer signature begins.");
    assert.strictEqual(different.isCurrent(), true, "Newest request should be current.");

    resolveFirst(true);
    await firstPromise;
    await new Promise(resolve => setImmediate(resolve));

    const settledRefresh = gate.begin("status=paid", { coalesceKey: "paid" });
    assert.strictEqual(settledRefresh.coalesced, false, "Settled same query should be allowed to refresh again.");
}

function verifyPaginationPrimitive() {
    const context = createSharedContext();
    const stateA = context.window.AZIEL_ADMIN_UI.pagination.createPaginatedState({
        getId: item => item.id,
        limit: 2
    });
    const stateB = context.window.AZIEL_ADMIN_UI.pagination.createPaginatedState({
        getId: item => item.id,
        limit: 2
    });

    stateA.replace([{ id: "1" }, { id: "2" }], { hasMore: true, nextCursor: "c1", limit: 2 });
    assert.deepStrictEqual(stateA.items.map(item => item.id), ["1", "2"], "replace should set items.");
    assert.strictEqual(stateA.hasMore, true, "replace should apply pagination metadata.");

    stateA.setLoadingMore(true);
    assert.strictEqual(stateA.canLoadMore(), false, "loadingMore should block concurrent load more.");
    stateA.setLoadingMore(false);
    assert.strictEqual(stateA.canLoadMore(), true, "canLoadMore should recover after loadingMore clears.");

    stateA.append([{ id: "2" }, { id: "3" }], { hasMore: false, nextCursor: "" });
    assert.deepStrictEqual(stateA.items.map(item => item.id), ["1", "2", "3"], "append should dedupe canonical IDs.");
    assert.strictEqual(stateA.hasMore, false, "append should update hasMore.");

    stateB.replace([{ id: "B" }], { hasMore: false });
    assert.deepStrictEqual(stateA.items.map(item => item.id), ["1", "2", "3"], "pagination state must be instance scoped.");
    assert.deepStrictEqual(stateB.items.map(item => item.id), ["B"], "module B state must not mutate module A.");
}

async function verifyModalPendingAndConfirmHelpers() {
    const context = createSharedContext();
    const modal = new FakeElement("modal");
    context.document.modal = modal;
    let cleanupCount = 0;

    const controller = context.window.AZIEL_ADMIN_UI.modal.createAdminModal({
        root: "#modal",
        onClose: () => {
            cleanupCount += 1;
        },
        closeOnBackdrop: true,
        closeOnEscape: true
    });

    controller.open();
    assert.strictEqual(controller.isOpen(), true, "Modal should open.");
    assert.strictEqual(modal.classList.contains("show"), true, "Modal open should add show class.");
    modal.dispatch("click");
    assert.strictEqual(controller.isOpen(), false, "Backdrop should close modal.");
    assert.strictEqual(cleanupCount, 1, "Close cleanup hook should execute.");

    controller.open();
    context.document.dispatch("keydown", { key: "Escape" });
    assert.strictEqual(controller.isOpen(), false, "Escape should close modal.");
    assert.strictEqual(cleanupCount, 2, "Escape close should execute cleanup.");

    const button = new FakeElement("button");
    button.textContent = "Save";
    await context.window.AZIEL_ADMIN_UI.pending.withPendingAction(button, async () => {
        assert.strictEqual(button.disabled, true, "Pending helper should disable button while action runs.");
        assert.strictEqual(button.textContent, "Saving", "Pending helper should apply pending label.");
    }, { pendingLabel: "Saving" });
    assert.strictEqual(button.disabled, false, "Pending helper should restore disabled state.");
    assert.strictEqual(button.textContent, "Save", "Pending helper should restore label.");

    const confirmed = await context.window.AZIEL_ADMIN_UI.confirm.confirmAdminAction({
        title: "Confirm",
        message: "Proceed?",
        confirmLabel: "Yes"
    });
    assert.strictEqual(confirmed, true, "Shared confirmation should resolve true through AZIEL_UI.confirm.");
}

function verifyScriptAndScopeOwnership() {
    const html = read("frontend/admin.html");
    const packageJson = read("package.json");
    const adminUiIndex = html.indexOf("/js/admin/admin-ui.js");
    const ordersIndex = html.indexOf("/js/admin-orders.js");
    const walletIndex = html.indexOf("/js/admin-wallet.js");
    const fulfillmentIndex = html.indexOf("/js/admin-fulfillment.js");
    const securityIndex = html.indexOf("/js/admin-security.js");

    assert(adminUiIndex > 0, "Admin UI shared script must be loaded.");
    assert(adminUiIndex < ordersIndex, "Admin UI shared script must load before Orders.");
    assert(adminUiIndex < walletIndex, "Admin UI shared script must load before Wallet.");
    assert(adminUiIndex < fulfillmentIndex, "Admin UI shared script must load before Fulfillment.");
    assert(adminUiIndex < securityIndex, "Admin UI shared script must load before Admin Security.");
    includes("frontend/js/admin/admin-ui.js", "window.AZIEL_ADMIN_UI", "One explicit Admin UI shared namespace must exist.");
    includes("frontend/js/admin/admin-ui.js", "createRequestGate", "Shared request lifecycle utility must exist once.");
    includes("frontend/js/admin/admin-ui.js", "createPaginatedState", "Shared pagination primitive must exist once.");
    includes("frontend/js/admin/admin-ui.js", "createAdminModal", "Shared modal lifecycle must exist once.");
    includes("frontend/js/admin-api.js", "class AdminApiError", "Admin API error normalization must be transport-owned.");
    includes("frontend/js/admin-api.js", "window.AZIEL_ADMIN_API", "Admin API namespace must expose error normalization.");

    ["react", "vue", "svelte", "alpine", "htmx", "stimulus", "redux", "zustand", "pinia"].forEach(name => {
        assert(!new RegExp(`["']${name}["']`, "i").test(packageJson), `${name} must not be added as a dependency.`);
        assert(!new RegExp(`${name}`, "i").test(html), `${name} must not be loaded in Admin HTML.`);
    });
}

function verifyModuleIntegrationAndRegressions() {
    const html = read("frontend/admin.html");
    const orders = read("frontend/js/admin-orders.js");
    const wallet = read("frontend/js/admin-wallet.js");
    const fulfillment = read("frontend/js/admin-fulfillment.js");
    const security = read("frontend/js/admin-security.js");
    const liveChat = read("frontend/js/admin-live-chat.js");
    const adminUsers = read("frontend/js/admin-users.js");
    const pricingEngine = read("frontend/js/admin-pricing-engine.js");
    const adminCss = read("frontend/css/admin/admin-design-system.css");

    assert(orders.includes("adminOrdersRequestGate"), "Orders must integrate shared request gate.");
    assert(orders.includes("createPaginatedState"), "Orders must integrate shared paginated state.");
    assert(orders.includes("coalesceKey"), "Orders same-query in-flight coalescing must remain.");
    assert(orders.includes("request.isCurrent()"), "Orders stale response protection must remain.");
    assert(orders.includes("ordersLoadMoreBtn"), "Orders Load More must remain.");
    assert(orders.includes("refreshAdminOrderDetail"), "Selected Order detail hydration must remain.");

    assert(wallet.includes("credit_this_amount"), "Wallet approve confirmation semantics must remain in module.");
    assert(wallet.includes("/api/admin/wallet/topups/") && wallet.includes("/status"), "Wallet topup mutation path must remain frontend-controller owned.");
    assert(!wallet.includes("calculateBalanceFromRows"), "Wallet balance truth must not be recalculated from paginated rows.");

    assert(fulfillment.includes("createPaginatedState"), "Fulfillment attempts should integrate shared paginated state.");
    assert(fulfillment.includes("fulfillmentAttemptsRequestGate"), "Fulfillment attempts should integrate shared request lifecycle.");
    assert(fulfillment.includes('if (filter !== "ALL") params.set("status", filter);'), "Fulfillment ALL filter semantics must remain.");
    assert(fulfillment.includes("createFulfillmentStartIdempotencyKey"), "Fulfillment retry idempotency must remain.");
    assert(fulfillment.includes("isActiveFulfillmentAttempt"), "Fulfillment retry active-attempt guard must remain.");

    assert(security.includes("createAdminModal"), "Admin Security should integrate shared modal lifecycle.");
    assert(security.includes("cleanupAdminSecurityModal"), "2FA-specific modal cleanup must remain explicit.");
    assert(security.includes('modal.id === "admin2FAModal"'), "2FA setup modal cleanup must remain explicit.");
    assert(security.includes("safeAuditResourceId"), "Audit resource ID masking must remain.");
    assert(security.includes("metadata.textContent"), "Audit metadata must render safely with textContent.");
    assert(security.includes("#section-admin-security [data-admin-security-view]"), "Security controller must not bind Fulfillment tabs.");

    assert(liveChat.includes("mergeChatMessages"), "Live Chat paginated/realtime message dedupe must remain.");
    assert(liveChat.includes("adminLiveChatLoadOlderBtn"), "Live Chat older message loading must remain.");

    assert(adminUsers.includes("const listScrollTop = box.scrollTop"), "Customer CRM must preserve list scroll position across selection rerenders.");
    assert(adminUsers.includes("box.scrollTop = listScrollTop"), "Customer CRM list scroll position must be restored after rendering.");
    assert(adminCss.includes('body.admin-body[data-admin-section="users"]'), "Customer CRM desktop body scroll ownership must be section scoped.");
    assert(adminCss.includes(".customer-crm-workspace") && adminCss.includes("height: var(--admin-orders-workspace-height);"), "Customer CRM workspace must be viewport bounded on desktop.");
    assert(adminCss.includes(".customer-crm-list") && adminCss.includes("overflow-y: auto"), "Customer CRM list must own independent vertical scrolling.");
    assert(adminCss.includes(".customer-tab-panel") && adminCss.includes("overscroll-behavior: contain"), "Customer CRM detail tab panel must own contained scrolling.");

    assert(html.includes('data-section="pricing-engine"'), "Pricing Engine nav item must exist.");
    assert(html.includes('id="section-pricing-engine"'), "Pricing Engine section must exist.");
    assert(html.indexOf('data-section="catalog"') < html.indexOf('data-section="pricing-engine"'), "Pricing Engine should sit after Catalog in Commerce navigation.");
    assert(html.indexOf('data-section="pricing-engine"') < html.indexOf('data-section="promos"'), "Pricing Engine should sit before Promo Codes in Commerce navigation.");
    assert(html.includes("Rule-based pricing and business policy management."), "Pricing Engine approved subtitle must render.");
    assert(html.includes("Exchange Rate") && html.includes("Default Profit") && html.includes("Gateway Fee") && html.includes("Affected Packages"), "Pricing Engine summary cards must render.");
    assert(html.includes("Mobile Legends") && html.includes("PUBG Mobile") && html.includes("Free Fire") && html.includes("Honor of Kings") && html.includes("Genshin Impact"), "Pricing Engine product selector must preserve existing rows before live data loads.");
    assert(html.includes("id=\"pricingFlow\"") && html.includes("id=\"pricingStorefrontPrice\""), "Pricing Engine production preview render targets must exist.");
    assert(html.includes("/js/commerce/pricingCalculationEngine.js") && html.indexOf("/js/commerce/pricingCalculationEngine.js") < html.indexOf("/js/admin-pricing-engine.js"), "Pricing Engine must load the browser calculation engine before the UI controller.");
    assert(adminCss.includes(".pricing-engine-workspace") && adminCss.includes("grid-template-columns: minmax(250px, 320px) minmax(360px, 1fr) minmax(280px, 360px);"), "Pricing Engine must use the approved three-column desktop layout.");
    assert(html.includes("pricingSaveDraftBtn") && html.includes("pricingPublishBtn"), "Pricing Engine production controls must expose Save Draft and Publish.");
    assert(!html.includes("Simulation Only"), "Pricing Engine must not remain in Simulation Only mode.");
    assert(pricingEngine.includes("initPricingEngineUi"), "Pricing Engine UI controller must initialize production pricing selection.");
    assert(pricingEngine.includes("syncPricingPreview"), "Pricing Engine selection must update visual preview labels.");
    assert(pricingEngine.includes("window.AZIEL_COMMERCE_PRICING_ENGINE"), "Pricing Engine UI must consume the shared browser calculation engine.");
    assert(pricingEngine.includes("result.breakdown"), "Pricing Engine preview must render engine breakdown output.");
    assert(pricingEngine.includes("/api/admin/pricing-engine"), "Pricing Engine must load production pricing configuration.");
    assert(pricingEngine.includes("/api/admin/pricing-engine/draft"), "Pricing Engine must save production drafts.");
    assert(pricingEngine.includes("/api/admin/pricing-engine/publish"), "Pricing Engine must publish production versions.");

    ["adminOrdersInitialized", "adminWalletInitialized", "fulfillmentInitialized"].forEach(pattern => {
        assert(orders.includes(pattern) || wallet.includes(pattern) || fulfillment.includes(pattern), `${pattern} lifecycle guard must remain.`);
    });

    notIncludes("frontend/wallet.html", "admin-ui.js", "Customer wallet frontend must not load Admin UI consolidation helpers.");
    notIncludes("frontend/home.html", "admin-ui.js", "Customer home frontend must not load Admin UI consolidation helpers.");
}

function main() {
    verifyScriptAndScopeOwnership();
    return Promise.resolve()
        .then(verifyRequestLifecycle)
        .then(() => {
            verifyPaginationPrimitive();
            return verifyModalPendingAndConfirmHelpers();
        })
        .then(() => {
            verifyModuleIntegrationAndRegressions();
            console.log("Admin frontend architecture verification checks passed.");
        });
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
