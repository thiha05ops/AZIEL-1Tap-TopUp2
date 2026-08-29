const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const adminStatsRouter = require("../routes/adminStats");
const CommerceOrder = require("../models/CommerceOrder");
const PaymentAttempt = require("../models/PaymentAttempt");
const WalletTopup = require("../models/WalletTopup");
const SupportTicket = require("../models/SupportTicket");
const LiveChat = require("../models/LiveChat");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");

const ROOT = path.join(__dirname, "../..");
const internals = adminStatsRouter._adminDashboardInternals;

assert(internals, "Admin dashboard internals should be exposed for verification");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function verifyManualEvidenceQuery() {
    const query = internals.manualPaymentReviewQuery();

    assert.deepStrictEqual(query.provider, { $in: ["MANUAL_PROMPTPAY", "MANUAL_ADMIN"] });
    assert.strictEqual(query.status, "PENDING");
    assert.strictEqual(query["safeMetadata.receiptAttached"], true);
    assert(query["safeMetadata.receiptEvidence.fileReference"], "Manual review query should require canonical receipt evidence");
}

function verifyModelTruthFields() {
    assert(CommerceOrder.schema.path("status"), "CommerceOrder.status must exist");
    assert(CommerceOrder.schema.path("commercial.totalAmount"), "Canonical amount must exist");
    assert(CommerceOrder.schema.path("commercial.currency"), "Canonical currency must exist");
    assert(CommerceOrder.schema.path("commercial.region"), "Canonical region must exist");
    assert(CommerceOrder.schema.path("product.gameCode"), "Canonical game code must exist");
    assert(CommerceOrder.schema.path("product.gameName"), "Canonical game name must exist");
    assert(CommerceOrder.schema.path("payment.paymentMethodId"), "Canonical payment method must exist");
    assert(!CommerceOrder.schema.path("refundAmount"), "Refund amount must not be fabricated");
    assert(!CommerceOrder.schema.path("refundedAt"), "Refund timestamp must not be fabricated");
    assert(PaymentAttempt.schema.path("safeMetadata"), "Canonical payment evidence authority must exist");
    assert(WalletTopup.schema.path("status"), "WalletTopup.status must exist");
    assert(SupportTicket.schema.path("unreadByAdmin"), "SupportTicket.unreadByAdmin must exist");
    assert(LiveChat.schema.path("messages"), "LiveChat.messages must exist");
    assert(FulfillmentAttempt.schema.path("status"), "FulfillmentAttempt.status must exist");
}

function verifyStatusTaxonomy() {
    const expected = [
        "pending_payment",
        "paid",
        "processing",
        "completed",
        "cancelled",
        "payment_failed",
        "failed",
        "expired",
        "refund_pending",
        "refunded"
    ];
    expected.forEach(status => {
        assert(internals.ORDER_STATUSES.includes(status), `${status} must be a dashboard-recognized order status`);
    });
    assert.deepStrictEqual(internals.SALES_STATUSES, ["paid", "processing", "completed"], "Sales statuses must be explicit");
    assert(internals.FAILED_STATUSES.includes("payment_failed"), "payment_failed must be a failed/cancelled status");
    assert(!internals.ORDER_STATUSES.includes("refund_requested"), "Unsupported refund_requested must not be invented");
}

function verifyCanonicalQuerySemantics() {
    assert.deepStrictEqual(internals.orderRegionQuery("ALL"), {}, "ALL must add no region predicate");
    assert.deepStrictEqual(internals.orderRegionQuery("TH"), { "commercial.region": "TH" });
    assert.deepStrictEqual(internals.orderRegionQuery("MM"), { "commercial.region": "MM" });
    const range = internals.buildRangeFromRequest({ preset: "today" }, new Date("2026-07-13T12:00:00.000Z"));
    const match = internals.dateMatch("createdAt", range, "TH", { status: "completed" });
    assert.strictEqual(match.createdAt.$gte.toISOString(), "2026-07-12T17:00:00.000Z", "Exact start boundary must be inclusive");
    assert.strictEqual(match.createdAt.$lt.toISOString(), "2026-07-13T17:00:00.000Z", "Exact end boundary must be exclusive");
    assert.strictEqual(match["commercial.region"], "TH");
    assert.strictEqual(internals.sumPendingAttention({ manual: 9, wallet: 79, support: 6, empty: 0 }), 94, "Pending Attention must be a deterministic operational-queue sum");
}

function verifyTimezoneBoundary() {
    const bounds = internals.getBangkokTodayBounds(new Date("2026-07-13T12:00:00.000Z"));

    assert.strictEqual(internals.DASHBOARD_TIMEZONE, "Asia/Bangkok");
    assert.strictEqual(bounds.start.toISOString(), "2026-07-12T17:00:00.000Z");
    assert.strictEqual(bounds.end.toISOString(), "2026-07-13T17:00:00.000Z");

    const today = internals.buildRangeFromRequest({ preset: "today" }, new Date("2026-07-13T12:00:00.000Z"));
    assert.strictEqual(today.start.toISOString(), "2026-07-12T17:00:00.000Z");
    assert.strictEqual(today.end.toISOString(), "2026-07-13T17:00:00.000Z");
    assert.strictEqual(today.comparison.start.toISOString(), "2026-07-11T17:00:00.000Z");
    assert.strictEqual(today.comparison.end.toISOString(), "2026-07-12T17:00:00.000Z");
    assert.strictEqual(today.grouping, "hour");
}

function verifyDatePresets() {
    const now = new Date("2026-07-13T12:00:00.000Z");
    const last7 = internals.buildRangeFromRequest({ preset: "last_7_days" }, now);
    assert.strictEqual(last7.rangeDays, 7);
    assert.strictEqual(last7.grouping, "day");

    const month = internals.buildRangeFromRequest({ preset: "this_month" }, now);
    assert(month.start < month.end, "This month range should be valid");
    assert(month.rangeDays <= 31, "This month range should stay bounded");

    const custom = internals.buildRangeFromRequest({ preset: "custom", start: "2026-07-01", end: "2026-07-05" }, now);
    assert.strictEqual(custom.rangeDays, 5);
    assert.throws(
        () => internals.buildRangeFromRequest({ preset: "custom", start: "2026-01-01", end: "2026-07-05" }, now),
        /cannot exceed/,
        "Excessive custom range must be rejected"
    );
}

function verifyCurrencyNormalization() {
    assert.strictEqual(internals.normalizeCurrency("THB"), "THB");
    assert.strictEqual(internals.normalizeCurrency("MMK"), "MMK");
    assert.strictEqual(internals.normalizeCurrency("usd"), "MMK");
    assert.strictEqual(internals.normalizeCurrency(""), "MMK");
}

function verifyRouteContracts() {
    const statsSource = read("backend/routes/adminStats.js");
    const orderSource = read("backend/routes/order.js");
    const walletSource = read("backend/routes/wallet.js");
    const supportSource = read("backend/routes/support.js");

    assert(statsSource.includes('router.get("/admin/dashboard/command-center", adminMiddleware'), "Command center API must require adminMiddleware");
    assert(statsSource.includes("requireAdminPermission(PERMISSIONS.DASHBOARD_READ)"), "Command center API must require dashboard read permission");
    assert(statsSource.includes("hasPermission(admin, item.permission)"), "Quick actions must be filtered by existing RBAC permissions");
    assert(statsSource.includes('router.get("/admin/stats", adminMiddleware'), "Legacy Dashboard API must remain available");
    assert(statsSource.includes("formatPaymentDisplayName"), "Payment method distribution must use centralized display names");
    assert(statsSource.includes('const CommerceOrder = require("../models/CommerceOrder")'), "Dashboard must use canonical CommerceOrder authority");
    assert(!statsSource.includes('require("../models/Order")'), "Dashboard must not import legacy Order authority");
    assert(statsSource.includes('$sum: "$commercial.totalAmount"'), "Gross Sales must use canonical total amount");
    assert(statsSource.includes('_id: "$commercial.currency"'), "Currency aggregation must use canonical currency");
    assert(statsSource.includes('method: "$payment.paymentMethodId"'), "Payment distribution must use canonical payment method");
    assert(statsSource.includes('order.product?.gameCode'), "Top games/recent activity must use canonical product fields");
    assert(statsSource.includes("refundMetrics"), "Response must document unsupported canonical refund totals");
    assert(statsSource.includes("{ $match: salesMatch }"), "Payment method distribution must use Gross Sales eligible status/date scope");
    assert(statsSource.includes("buildPaymentDistribution(paymentRows, totalEligibleOrders)"), "Payment method response must use the shared mapper");
    assert(statsSource.includes("currencyRule"), "Dashboard response must document currency separation");
    assert(!statsSource.includes("ManualPaymentAttempt"), "Dashboard queues must not count ManualPaymentAttempt records");
    assert(orderSource.includes('filter === "manual_review"'), "Orders API should support manual_review filter");
    assert(walletSource.includes('router.get("/admin/wallet/topups", adminMiddleware'), "Wallet topups API must require adminMiddleware");
    assert(supportSource.includes('filter === "unreadByAdmin"'), "Support API should support unreadByAdmin filter");
}

function verifyPaymentDistributionSchema() {
    const rows = [
        { _id: { method: "PromptPay", region: "TH", currency: "THB" }, orders: 2, paidCompleted: 2, failed: 0, sales: 1490 },
        { _id: { method: "wallet", region: "MM", currency: "MMK" }, orders: 1, paidCompleted: 1, failed: 0, sales: 2500 },
        { _id: { method: "mystery_provider_legacy", region: "", currency: "MMK" }, orders: 1, paidCompleted: 1, failed: 0, sales: 3000 },
        { _id: { method: "", region: "", currency: "" }, orders: 1, paidCompleted: 1, failed: 0, sales: 1000 }
    ];
    const result = internals.buildPaymentDistribution(rows, 5);

    assert.strictEqual(result.length, 4, "All raw payment method buckets should survive mapping");
    assert.strictEqual(result[0].storedValue, "PromptPay");
    assert.strictEqual(result[0].displayName, "PromptPay");
    assert.strictEqual(result[0].currency, "THB");
    assert.strictEqual(result[0].sales, 1490);
    assert.strictEqual(result[0].share, 40);
    assert.strictEqual(result[1].displayName, "AZIEL Wallet");
    assert.strictEqual(result[1].currency, "MMK");
    assert.strictEqual(result[2].displayName, "mystery_provider_legacy", "Unknown legacy methods should render the stored value");
    assert.strictEqual(result[3].displayName, "Unknown", "Missing payment method should render safe Unknown label");
    assert.deepStrictEqual(result[3].target.params, {}, "Missing payment method should not create a false method filter");
}

function verifyFrontendContract() {
    const html = read("frontend/admin.html");
    const js = read("frontend/js/admin-stats.js");
    const css = read("frontend/css/admin/admin-design-system.css");

    [
        "dashboard-command-center",
        "dashboardPresetSelect",
        "dashboardRegionSelect",
        "dashboardKpis",
        "dashboardSalesChart",
        "dashboardStatusChart",
        "dashboardAttentionQueue",
        "dashboardTopPackages",
        "dashboardTopGames",
        "dashboardSupplierBalances",
        "dashboardSupplierPackages",
        "dashboardStockAffectedOrders",
        "dashboardPaymentMethods",
        "dashboardRecentActivity"
    ].forEach(token => {
        assert(html.includes(token), `Dashboard HTML must include ${token}`);
    });

    assert(js.includes("/api/admin/dashboard/command-center?"), "Frontend must load command center endpoint");
    assert(js.includes("renderDashboardPaymentMethods(resolvePaymentDistribution(dashboard))"), "Dashboard must call its namespaced payment renderer");
    assert(!js.includes("function renderPaymentMethods("), "Dashboard must not define a generic global renderPaymentMethods that can be overwritten");
    assert(js.includes("function renderDashboardPaymentMethods("), "Dashboard payment renderer must be namespaced");
    assert(js.includes("resolvePaymentDistribution(dashboard)"), "Frontend must normalize payment distribution from the dashboard payload");
    assert(js.includes("Array.isArray(dashboard.paymentDistribution)"), "Payment panel must read the canonical paymentDistribution array");
    assert(js.includes("data-dashboard-retry"), "Payment panel error state must expose retry");
    assert(js.includes("setDashboardPanelState(box, \"populated\")"), "Populated payment rows must clear loading state");
    assert(js.includes("setDashboardPanelState(box, \"empty\")"), "Empty payment response must clear loading state");
    assert(js.includes("setDashboardPanelState(box, \"error\")"), "Payment error response must clear loading state");
    assert(js.includes("Payment-method statistics could not be loaded."), "Payment method panel must have explicit error state");
    assert(js.includes("No payment data"), "Payment method panel must have explicit no-data state");
    assert(js.includes("item.displayName || item.storedValue || item.key || \"Unknown\""), "Frontend must render legacy/raw payment labels safely");
    assert(js.includes("sessionStorage.setItem(DASHBOARD_STATE_KEY"), "Dashboard filters should persist only in sessionStorage");
    assert(js.includes("dashboardChartMode === \"orders\""), "Chart must support order count mode");
    assert(js.includes("formatMoney(value.MMK, \"MMK\")"), "KPI rendering must keep MMK separate");
    assert(js.includes("formatMoney(value.THB, \"THB\")"), "KPI rendering must keep THB separate");
    assert(js.includes("window.loadAdminDashboard = loadAdminDashboard"), "Existing dashboard refresh contract must remain");
    assert(js.includes("box.innerHTML = cards.map"), "Desktop Dashboard must render all KPI cards in its canonical grid");
    assert(js.includes("analytics.open = !phone"), "Desktop analytics must not depend on opening More analytics");
    assert(js.includes("filters.open = !phone"), "Desktop filters must remain fully expanded");
    assert(js.includes('timeZone: "Asia/Bangkok"'), "Dashboard date chip must be Bangkok-timezone stable");
    assert(!js.includes("localStorage.setItem(DASHBOARD_STATE_KEY"), "Dashboard filters must not use localStorage as source of truth");

    assert(css.includes(".dashboard-command-center"), "Dashboard command center CSS must exist");
    assert(css.includes(".dashboard-kpi-grid"), "Dashboard KPI grid CSS must exist");
    assert(css.includes("@media (max-width: 680px)"), "Dashboard mobile breakpoint must exist");
    assert(css.includes("@media (prefers-reduced-motion: reduce)"), "Dashboard must respect reduced motion");
    assert(html.includes("admin-stats.js?v=20260829-supplier-operations"), "Admin page must bust cached dashboard runtime after supplier operations changes");
}

function createElement(id = "") {
    return {
        id,
        innerHTML: "",
        textContent: "",
        innerText: "",
        hidden: false,
        disabled: false,
        value: "",
        dataset: {},
        classList: {
            toggle() {},
            contains() { return true; }
        },
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
}

function verifyPaymentMethodsRuntimeRender() {
    const js = read("frontend/js/admin-stats.js");
    const elements = new Map();
    const requiredIds = [
        "dashboardRangeMeta",
        "dashboardKpis",
        "dashboardSalesChart",
        "dashboardStatusChart",
        "dashboardAttentionQueue",
        "dashboardRegionPerformance",
        "dashboardTopGames",
        "dashboardPaymentMethods",
        "dashboardRecentActivity",
        "dashboardQuickActions",
        "dashboardLastUpdated",
        "dashboardErrorRegion"
    ];
    requiredIds.forEach(id => elements.set(id, createElement(id)));
    elements.get("dashboardPaymentMethods").innerHTML = `<div class="admin-dashboard-skeleton"></div>`;

    const context = {
        console,
        window: {
            AZIEL_ADMIN_I18N: { t: (key, fallback) => fallback || key },
            openAdminSection() {}
        },
        document: {
            addEventListener() {},
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, createElement(id));
                return elements.get(id);
            },
            querySelectorAll() {
                return [];
            }
        },
        localStorage: {
            getItem() { return "OWNER"; }
        },
        sessionStorage: {
            getItem() { return ""; },
            setItem() {}
        },
        URLSearchParams,
        Date,
        Number,
        String,
        Array,
        JSON,
        performance: { now: () => 0 },
        setInterval() { return 0; },
        clearTimeout() {},
        setTimeout(fn) { return fn(); }
    };
    context.window.window = context.window;

    vm.createContext(context);
    vm.runInContext(js, context, { filename: "frontend/js/admin-stats.js" });
    assert.strictEqual(typeof context.renderAdminDashboard, "function", "Production renderAdminDashboard should be callable in runtime harness");

    context.renderAdminDashboard({
        updatedAt: "2026-07-23T00:00:00.000Z",
        range: { label: "This Month", start: "2026-07-01T00:00:00.000Z", end: "2026-08-01T00:00:00.000Z", timezone: "Asia/Bangkok" },
        filters: { region: "TH" },
        definitions: { currencyRule: "MMK and THB are separate." },
        kpis: {},
        series: [],
        orderStatus: [],
        attention: [],
        regionPerformance: [],
        topGames: [],
        recentActivity: {},
        quickActions: [],
        paymentDistribution: [
            { key: "scb", storedValue: "scb", displayName: "SCB", region: "TH", currency: "THB", orders: 10, sales: 234.67, share: 62.5, failed: 0, target: { section: "orders", params: { paymentMethod: "scb" } } },
            { key: "promptpay", storedValue: "promptpay", displayName: "PromptPay", region: "TH", currency: "THB", orders: 3, sales: 81, share: 18.8, failed: 0, target: { section: "orders", params: { paymentMethod: "promptpay" } } },
            { key: "wallet", storedValue: "wallet", displayName: "AZIEL Wallet", region: "TH", currency: "THB", orders: 3, sales: 1527, share: 18.8, failed: 0, target: { section: "orders", params: { paymentMethod: "wallet" } } }
        ]
    });

    const paymentBox = elements.get("dashboardPaymentMethods");
    assert.strictEqual(paymentBox.dataset.dashboardState, "populated", "Payment panel should end in populated state");
    assert(!paymentBox.innerHTML.includes("admin-dashboard-skeleton"), "Payment panel populated render must remove skeletons");
    assert(paymentBox.innerHTML.includes("SCB"), "SCB row should render");
    assert(paymentBox.innerHTML.includes("PromptPay"), "PromptPay row should render");
    assert(paymentBox.innerHTML.includes("AZIEL Wallet"), "AZIEL Wallet row should render");

    context.renderAdminDashboard({
        updatedAt: "2026-07-23T00:00:00.000Z",
        range: {},
        filters: {},
        definitions: {},
        paymentDistribution: []
    });
    assert.strictEqual(paymentBox.dataset.dashboardState, "empty", "Empty payment response should end in empty state");
    assert(paymentBox.innerHTML.includes("No payment data"), "Empty payment response should show no-data copy");

    context.renderDashboardPaymentMethods(null);
    assert.strictEqual(paymentBox.dataset.dashboardState, "error", "Malformed payment response should end in error state");
    assert(paymentBox.innerHTML.includes("Retry") || paymentBox.innerHTML.includes("Try again"), "Error state should expose retry");
}

function verifyIndexesAndNoChartDependency() {
    const packageJson = JSON.parse(read("package.json"));
    const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
    assert(!deps["chart.js"] && !deps.apexcharts && !deps.recharts, "Dashboard should not add a chart dependency for this pass");

    assert(CommerceOrder.schema.indexes().some(([fields]) => fields.status === 1 && fields.createdAt === -1), "CommerceOrder status/date index should support dashboard reads");
    assert(WalletTopup.schema.indexes().some(([fields]) => fields.status === 1 && fields.createdAt === -1), "Wallet topup status/date index should support attention counts");
}

function main() {
    verifyManualEvidenceQuery();
    verifyModelTruthFields();
    verifyStatusTaxonomy();
    verifyCanonicalQuerySemantics();
    verifyTimezoneBoundary();
    verifyDatePresets();
    verifyCurrencyNormalization();
    verifyPaymentDistributionSchema();
    verifyRouteContracts();
    verifyFrontendContract();
    verifyPaymentMethodsRuntimeRender();
    verifyIndexesAndNoChartDependency();
    console.log("Admin dashboard command center verification checks passed.");
}

main();
