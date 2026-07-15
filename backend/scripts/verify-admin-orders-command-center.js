const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const {
    ORDER_STATES,
    getAllowedNextStatuses
} = require("../services/orderStateService");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function verifyTransitionTruth() {
    assert(getAllowedNextStatuses(ORDER_STATES.PENDING_PAYMENT).includes(ORDER_STATES.PAID), "pending_payment should allow paid");
    assert(getAllowedNextStatuses(ORDER_STATES.PAID).includes(ORDER_STATES.PROCESSING), "paid should allow processing");
    assert(getAllowedNextStatuses(ORDER_STATES.PROCESSING).includes(ORDER_STATES.COMPLETED), "processing should allow completed");
    assert(getAllowedNextStatuses(ORDER_STATES.PROCESSING).includes(ORDER_STATES.FAILED), "processing should allow failed");
    assert(!getAllowedNextStatuses(ORDER_STATES.COMPLETED).includes(ORDER_STATES.PENDING_PAYMENT), "completed should not allow pending_payment");
}

function verifyOrderRouteContracts() {
    const source = read("backend/routes/order.js");

    assert(source.includes('router.get("/admin/orders", adminMiddleware'), "Admin orders list must require adminMiddleware");
    assert(source.includes('filter === "manual_review"'), "Admin orders API should support manual_review");
    assert(source.includes('query.status = "pending_payment"'), "Manual review filter should require pending_payment");
    assert(source.includes('"paymentEvidence.url"'), "Manual review should include paymentEvidence.url evidence");
    assert(source.includes('"paymentEvidence.key"'), "Manual review should include paymentEvidence.key evidence");
    assert(source.includes("projectAdminOrder"), "Admin orders should use an explicit projection");
    assert(source.includes("allowedNextStatuses"), "Admin order projection should include allowed transitions");
    assert(source.includes("transitionOrder(order, status"), "Status updates should use canonical transitionOrder");
    assert(!source.includes("ManualPaymentAttempt.find"), "Admin order queues must not query ManualPaymentAttempt");
}

function verifyFrontendCommandCenter() {
    const html = read("frontend/admin.html");
    const adminApp = read("frontend/js/admin-app.js");
    const ordersJs = read("frontend/js/admin-orders.js");
    const adminCss = read("frontend/css/admin/admin-design-system.css");
    const ordersSectionStart = html.indexOf('<section class="admin-section" id="section-orders">');
    const ordersSectionEnd = html.indexOf('<section class="admin-section" id="section-catalog">');
    const ordersSection = ordersSectionStart >= 0 && ordersSectionEnd > ordersSectionStart
        ? html.slice(ordersSectionStart, ordersSectionEnd)
        : "";
    const localSearchIndex = ordersSection.indexOf('id="orderSearchInput"');
    const queueIndex = ordersSection.indexOf('id="adminOrdersQueue"');
    const topbarSearchIndex = html.indexOf('id="adminGlobalSearch"');

    assert(html.includes("orders-command-center"), "Orders section should use command center shell");
    assert(html.includes('data-order-filter="manual_review"'), "Manual Review queue tab should exist");
    assert(!html.includes('class="admin-status-select"'), "Unrestricted status dropdown should be removed from HTML");
    assert(ordersJs.includes("getOrderActions"), "Frontend should derive visible actions");
    assert(ordersJs.includes("allowedNextStatuses"), "Frontend should use backend-projected allowed transitions");
    assert(ordersJs.includes("confirmOrderPaid"), "Confirm Paid flow should exist");
    assert(ordersJs.includes("window.AZIEL_UI?.confirm"), "Financial actions should use AZIEL_UI confirmation");
    assert(!ordersJs.includes("confirm(\""), "Native confirm should not be used for order actions");
    assert(ordersJs.includes("getOrderEvidenceUrl"), "Evidence URL projection should exist");
    assert(ordersJs.includes("renderTimeline"), "Persisted timeline should render");
    assert(!ordersJs.includes("wheel"), "Orders split-pane scrolling must not use JavaScript wheel interception");
    assert(topbarSearchIndex >= 0, "Global topbar search should remain available in the Admin shell");
    assert(ordersSection.includes('class="admin-filter-bar"'), "Orders-local search should have one canonical DOM owner");
    assert(localSearchIndex >= 0 && queueIndex >= 0 && localSearchIndex < queueIndex, "Orders-local search must remain outside and before the scrollable queue");
    assert(ordersJs.includes("currentOrderContext.q"), "Orders-local search must own Orders query context");
    assert(ordersJs.includes("buildOrdersEndpoint") && ordersJs.includes('params.set("q"'), "Orders-local search must feed the Orders API q parameter");
    assert(ordersJs.includes('orderSearchBtn') && ordersJs.includes('orderClearSearchBtn'), "Search and Clear controls must remain wired");
    assert(adminApp.includes("admin-orders-active"), "Admin shell must expose active Orders state for topbar search visibility");
    assert(adminApp.includes('sectionName === "orders"'), "Orders active state must be scoped to the Orders section");
    assert(adminApp.includes("adminGlobalSearch") && adminApp.includes('openAdminSection("orders")'), "Global search should keep cross-section navigation behavior");

    assert(adminCss.includes("--admin-orders-workspace-height"), "Orders workspace height should be derived from Admin shell variables");
    assert(adminCss.includes(".orders-command-center") && adminCss.includes("height: var(--admin-orders-workspace-height)"), "Desktop Orders workspace must be viewport-bounded");
    assert(adminCss.includes(".orders-command-center") && adminCss.includes("overflow: hidden"), "Desktop Orders workspace must prevent queue-driven page scrolling");
    assert(adminCss.includes(".orders-command-panel") && adminCss.includes("display: flex") && adminCss.includes("flex-direction: column"), "Orders queue pane must establish a column height owner");
    assert(adminCss.includes(".orders-command-panel,\n.order-detail-panel") && adminCss.includes("min-height: 0"), "Orders pane flex/grid children must allow internal scrolling");
    assert(adminCss.includes(".orders-queue-list") && adminCss.includes("flex: 1 1 auto"), "Orders queue list must consume remaining pane height");
    assert(adminCss.includes(".orders-queue-list") && adminCss.includes("overflow-y: auto"), "Orders queue list must own vertical scrolling");
    assert(adminCss.includes(".order-detail-panel") && adminCss.includes("overflow-y: auto"), "Order detail pane must own vertical scrolling");
    assert(adminCss.includes("overscroll-behavior: contain"), "Orders panes should contain scroll chaining");
    assert(adminCss.includes(".admin-body.admin-orders-active #adminGlobalSearch") && adminCss.includes("display: none"), "Global topbar search should be hidden while Orders is active");
    assert(adminCss.includes(".orders-command-panel > .admin-filter-bar") && adminCss.includes("flex: 0 0 auto"), "Orders-local search row must stay in normal non-scrolling pane flow");
    assert(adminCss.includes("position: static") && adminCss.includes("z-index: auto"), "Orders-local search row must not float over queue rows");
    assert(adminCss.includes("@media (max-width: 1200px)") && adminCss.includes("height: auto") && adminCss.includes("overflow: visible"), "Non-desktop breakpoint must restore stacked page scrolling");
    assert(adminCss.includes("overflow-x: hidden"), "Responsive Admin layout should prevent full-page horizontal scrolling");
}

function verifyNoSecretsProjected() {
    const source = read("backend/routes/order.js");
    const projectionStart = source.indexOf("function projectAdminOrder");
    const projection = projectionStart >= 0 ? source.slice(projectionStart, source.indexOf("// ADMIN GET ALL ORDERS")) : "";

    assert(!projection.includes("password"), "Admin order projection must not expose password");
    assert(!projection.includes("token"), "Admin order projection must not expose tokens");
    assert(!projection.includes("OTP"), "Admin order projection must not expose OTP data");
    assert(!projection.includes("secret"), "Admin order projection must not expose secrets");
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
        this.dataset = {};
        this.listeners = {};
        this.classList = new FakeClassList();
        this.value = "";
        this.innerHTML = "";
    }

    addEventListener(type, handler) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(handler);
    }

    click() {
        (this.listeners.click || []).forEach(handler => handler({ currentTarget: this, preventDefault() {} }));
    }

    keydown(key) {
        (this.listeners.keydown || []).forEach(handler => handler({ key, preventDefault() {} }));
    }

    querySelectorAll() {
        return [];
    }

    querySelector() {
        return null;
    }
}

function createOrdersHarness() {
    const elements = new Map();
    const tabs = ["all", "manual_review", "paid", "processing", "refund_requested", "completed", "failed"].map(filter => {
        const element = new FakeElement(`tab-${filter}`);
        element.dataset.orderFilter = filter;
        return element;
    });

    [
        "adminOrdersQueue",
        "adminOrderDetailPanel",
        "orderSearchBtn",
        "orderClearSearchBtn",
        "orderSearchInput",
        "closeOrderModal",
        "closeSlipModal",
        "orderDetailModal",
        "slipModal",
        "slipModalImg"
    ].forEach(id => elements.set(id, new FakeElement(id)));

    const section = new FakeElement("section-orders");
    section.classList.add("active");
    elements.set("section-orders", section);

    const documentListeners = {};
    const windowListeners = {};
    const requests = [];
    const pending = [];
    const document = {
        addEventListener(type, handler) {
            documentListeners[type] = documentListeners[type] || [];
            documentListeners[type].push(handler);
        },
        getElementById(id) {
            return elements.get(id) || null;
        },
        querySelectorAll(selector) {
            if (selector === ".orders-queue-tab") return tabs;
            return [];
        },
        querySelector() {
            return null;
        }
    };
    const window = {
        location: { hash: "#orders" },
        innerWidth: 1280,
        addEventListener(type, handler) {
            windowListeners[type] = windowListeners[type] || [];
            windowListeners[type].push(handler);
        },
        dispatchEvent(event) {
            (windowListeners[event.type] || []).forEach(handler => handler(event));
        },
        openAdminSection(sectionName, updateHash, context) {
            window.location.hash = sectionName === "orders"
                ? `#orders${context?.status ? `?status=${context.status}` : context?.filter ? `?filter=${context.filter}` : context?.q ? `?q=${context.q}` : ""}`
                : `#${sectionName}`;
            window.dispatchEvent({
                type: "aziel:admin-section-opened",
                detail: { section: sectionName, context: context || {} }
            });
        },
        AZIEL_ADMIN_I18N: { t: (key, fallback) => fallback || key },
        AZIEL_ADMIN_LAYOUT: { showDetail() {}, showList() {} },
        AZIEL_UI: { button: { setLoading() {}, reset() {} } }
    };
    const context = {
        document,
        window,
        CustomEvent: function CustomEvent(type, init = {}) {
            return { type, detail: init.detail || {} };
        },
        URLSearchParams,
        setInterval() {},
        clearTimeout,
        setTimeout,
        console,
        adminFetch(url) {
            requests.push(url);
            return new Promise(resolve => pending.push(resolve));
        },
        showAdminToast() {},
        loadAdminDashboard() {},
        getAdminUploadedImageUrl: value => value || "",
        isAdminUploadedImageFailed: () => false,
        handleAdminUploadedImageError() {}
    };
    context.window.window = context.window;
    context.window.document = document;

    vm.runInNewContext(read("frontend/js/admin/admin-ui.js"), context, { filename: "frontend/js/admin/admin-ui.js" });
    vm.runInNewContext(read("frontend/js/admin-orders.js"), context, { filename: "frontend/js/admin-orders.js" });

    return {
        context,
        elements,
        tabs,
        requests,
        pending,
        fireReady() {
            (documentListeners.DOMContentLoaded || []).forEach(handler => handler());
        },
        resolveNext(payload = {}) {
            const resolve = pending.shift();
            assert(resolve, "Expected a pending Admin Orders request.");
            resolve({
                success: true,
                orders: payload.orders || [],
                pagination: payload.pagination || { hasMore: false, nextCursor: "", limit: 50 }
            });
        },
        flush: () => new Promise(resolve => setImmediate(resolve))
    };
}

async function verifyOrdersRequestOwnershipHarness() {
    const harness = createOrdersHarness();
    harness.fireReady();

    assert.strictEqual(harness.requests.length, 1, "Opening Orders initially should create one initial request.");
    assert.strictEqual(harness.requests[0], "/api/admin/orders?limit=50", "Initial Orders request should be bounded.");

    harness.context.loadOrders(false);
    assert.strictEqual(harness.requests.length, 1, "Duplicate same initial query while in flight must be coalesced.");
    harness.resolveNext();
    await harness.flush();

    harness.context.loadOrders(false);
    assert.strictEqual(harness.requests.length, 2, "Same initial query after settlement may issue a legitimate refresh.");
    assert.strictEqual(harness.requests[1], "/api/admin/orders?limit=50", "Sequential refresh should preserve the same bounded All endpoint.");
    harness.resolveNext();
    await harness.flush();

    const paid = harness.tabs.find(tab => tab.dataset.orderFilter === "paid");
    paid.click();
    assert.strictEqual(harness.requests.filter(url => url === "/api/admin/orders?status=paid&limit=50").length, 1, "One Paid click should create one Paid request.");

    harness.context.loadOrders(false);
    assert.strictEqual(harness.requests.filter(url => url === "/api/admin/orders?status=paid&limit=50").length, 1, "Duplicate Paid initial query while in flight must not fetch twice.");

    const failed = harness.tabs.find(tab => tab.dataset.orderFilter === "failed");
    failed.click();
    assert.strictEqual(harness.requests.filter(url => url === "/api/admin/orders?status=failed&limit=50").length, 1, "Different newer Failed query must start immediately.");

    harness.elements.get("orderSearchInput").value = "AZL-1";
    harness.elements.get("orderSearchBtn").click();
    assert.strictEqual(harness.requests.filter(url => url === "/api/admin/orders?status=failed&q=AZL-1&limit=50").length, 1, "Search submit should create one initial request.");

    harness.elements.get("orderClearSearchBtn").click();
    assert.strictEqual(harness.requests.filter(url => url === "/api/admin/orders?status=failed&limit=50").length, 1, "Clear while identical Failed request is in flight should coalesce.");
}

async function main() {
    verifyTransitionTruth();
    verifyOrderRouteContracts();
    verifyFrontendCommandCenter();
    verifyNoSecretsProjected();
    await verifyOrdersRequestOwnershipHarness();
    console.log("Admin orders command center verification checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
