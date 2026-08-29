// frontend/js/admin-stats.js
// AZIEL Admin command center dashboard

let adminDashboardTimer = null;
let adminDashboardRefreshTimer = null;
let adminDashboardLoading = false;
let lastAdminDashboard = null;
let lastSupplierOperations = [];
let lastSupplierPackageProducts = [];
let dashboardChartMode = "MMK";
let dashboardActivityMode = "orders";
const adminDashboardPhoneQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 767px)")
    : { matches: false, addEventListener() {} };

const DASHBOARD_STATE_KEY = "aziel.admin.dashboard.filters";
const DASHBOARD_DEFAULT_FILTERS = Object.freeze({
    preset: "today",
    region: "ALL",
    start: "",
    end: ""
});

document.addEventListener("DOMContentLoaded", () => {
    initAdminDashboard();
});

function initAdminDashboard() {
    syncDashboardResponsiveState();
    adminDashboardPhoneQuery.addEventListener?.("change", () => {
        syncDashboardResponsiveState();
        if (lastAdminDashboard?.kpis) renderKpis(lastAdminDashboard.kpis);
    });
    bindDashboardControls();
    loadAdminDashboard();
    loadSupplierOperations(false);

    if (!adminDashboardTimer) {
        adminDashboardTimer = setInterval(() => {
            if (!document.hidden && isDashboardActive()) {
                loadAdminDashboard(false);
            }
        }, 45000);
    }

    [
        "admin:order-updated",
        "aziel:admin-dashboard-refresh",
        "wallet:topup-updated",
        "liveChatMessage",
        "supportUpdated"
    ].forEach(eventName => {
        window.addEventListener(eventName, scheduleAdminDashboardRefresh);
    });

    if (window.AZIEL?.realtime) {
        [
            "admin:order-updated",
            "adminNewUpdate",
            "liveChatMessage",
            "supportUpdated"
        ].forEach(eventName => {
            window.AZIEL.realtime.on(eventName, scheduleAdminDashboardRefresh, { role: "admin" });
        });
    }

    window.addEventListener("aziel:admin-locale-changed", () => {
        if (lastAdminDashboard) renderAdminDashboard(lastAdminDashboard);
    });
}

function syncDashboardResponsiveState() {
    const phone = adminDashboardPhoneQuery.matches;
    const analytics = document.querySelector(".dashboard-mobile-analytics");
    const filters = document.getElementById("dashboardMobileFilters");

    if (analytics) analytics.open = !phone;
    if (filters) filters.open = !phone;
}

function bindDashboardControls() {
    const preset = document.getElementById("dashboardPresetSelect");
    const region = document.getElementById("dashboardRegionSelect");
    const refresh = document.getElementById("refreshDashboardBtn");
    const apply = document.getElementById("dashboardApplyCustomBtn");
    const cancel = document.getElementById("dashboardCancelCustomBtn");
    const mobileFilterClose = document.getElementById("dashboardMobileFilterClose");
    const supplierRefresh = document.getElementById("dashboardSupplierRefresh");
    const supplierFilter = document.getElementById("dashboardSupplierFilter");
    const availabilityFilter = document.getElementById("dashboardAvailabilityFilter");
    const productFilter = document.getElementById("dashboardProductFilter");
    const packageFilter = document.getElementById("dashboardPackageFilter");
    const stockFilters = ["dashboardStockSupplierFilter", "dashboardStockProductFilter", "dashboardStockPackageFilter"];

    const filters = getDashboardFilters();
    if (preset) preset.value = filters.preset;
    if (region) region.value = filters.region;
    syncCustomRangeVisibility();

    preset?.addEventListener("change", () => {
        const next = getDashboardFiltersFromDom();
        if (next.preset !== "custom") {
            persistDashboardFilters({ ...next, start: "", end: "" });
            loadAdminDashboard(true);
        } else {
            persistDashboardFilters(next);
        }
        syncCustomRangeVisibility();
    });

    region?.addEventListener("change", () => {
        persistDashboardFilters(getDashboardFiltersFromDom());
        loadAdminDashboard(true);
    });

    refresh?.addEventListener("click", () => loadAdminDashboard(true));
    apply?.addEventListener("click", () => {
        const filters = getDashboardFiltersFromDom();
        const error = validateCustomRange(filters);
        if (error) {
            renderDashboardGlobalError(error);
            return;
        }
        persistDashboardFilters(filters);
        loadAdminDashboard(true);
    });
    cancel?.addEventListener("click", () => {
        const next = { ...getDashboardFilters(), preset: "today", start: "", end: "" };
        persistDashboardFilters(next);
        if (preset) preset.value = next.preset;
        syncCustomRangeVisibility();
        loadAdminDashboard(true);
    });
    mobileFilterClose?.addEventListener("click", () => {
        document.getElementById("dashboardMobileFilters")?.removeAttribute("open");
    });
    supplierRefresh?.addEventListener("click", () => loadSupplierOperations(true));
    supplierFilter?.addEventListener("change", renderSupplierPackageAvailability);
    availabilityFilter?.addEventListener("change", renderSupplierPackageAvailability);
    productFilter?.addEventListener("change", () => { populateSupplierPackageFilters(); renderSupplierPackageAvailability(); });
    packageFilter?.addEventListener("change", renderSupplierPackageAvailability);
    stockFilters.forEach(id => document.getElementById(id)?.addEventListener("change", () => renderStockAffectedOrders(lastAdminDashboard?.supplierStockAffected || {})));

    document.querySelectorAll("[data-dashboard-chart]").forEach(button => {
        button.addEventListener("click", () => {
            dashboardChartMode = button.dataset.dashboardChart || "MMK";
            document.querySelectorAll("[data-dashboard-chart]").forEach(item => {
                item.classList.toggle("active", item === button);
            });
            renderSalesChart(lastAdminDashboard);
        });
    });

    document.querySelectorAll("[data-dashboard-activity]").forEach(button => {
        button.addEventListener("click", () => {
            dashboardActivityMode = button.dataset.dashboardActivity || "orders";
            document.querySelectorAll("[data-dashboard-activity]").forEach(item => {
                item.classList.toggle("active", item === button);
            });
            renderRecentActivity(lastAdminDashboard?.recentActivity || {});
        });
    });

    document.querySelectorAll("[data-dashboard-section]").forEach(button => {
        button.addEventListener("click", () => {
            window.openAdminSection?.(button.dataset.dashboardSection, true);
        });
    });
}

function scheduleAdminDashboardRefresh() {
    clearTimeout(adminDashboardRefreshTimer);
    adminDashboardRefreshTimer = setTimeout(() => {
        if (!document.hidden) loadAdminDashboard(false);
    }, 900);
}

async function loadAdminDashboard(showError = true) {
    if (adminDashboardLoading) return;

    try {
        if (typeof adminFetch !== "function") {
            console.error("adminFetch not found. Make sure admin-api.js is loaded first.");
            return;
        }

        adminDashboardLoading = true;
        setRefreshState(true);
        if (showError) setDashboardLoading();

        const filters = getDashboardFilters();
        const query = new URLSearchParams();
        query.set("preset", filters.preset);
        query.set("region", filters.region);
        if (filters.preset === "custom") {
            query.set("start", filters.start || "");
            query.set("end", filters.end || "");
        }

        const data = await adminFetch(`/api/admin/dashboard/command-center?${query.toString()}`);

        if (!data || !data.success) {
            if (showError) renderDashboardError(data?.message || adminT("something_went_wrong"));
            return;
        }

        lastAdminDashboard = data.dashboard || null;
        renderAdminDashboard(lastAdminDashboard);
    } catch (error) {
        console.log("Admin dashboard error:", error);
        if (showError) renderDashboardError(adminT("something_went_wrong"));
    } finally {
        adminDashboardLoading = false;
        setRefreshState(false);
    }
}

function renderAdminDashboard(dashboard) {
    if (!dashboard) {
        renderDashboardError(adminT("something_went_wrong"));
        return;
    }

    clearDashboardGlobalError();
    renderRangeMeta(dashboard);
    renderKpis(dashboard.kpis || {});
    renderSalesChart(dashboard);
    renderStatusChart(dashboard.orderStatus || []);
    renderAttentionQueue(dashboard.attention || []);
    renderRegionPerformance(dashboard.regionPerformance || []);
    renderTopGames(dashboard.topGames || []);
    renderTopPackages(dashboard.topPackages || []);
    renderStockAffectedOrders(dashboard.supplierStockAffected || {});
    renderDashboardPaymentMethods(resolvePaymentDistribution(dashboard));
    renderRecentActivity(dashboard.recentActivity || {});
    renderQuickActions(dashboard.quickActions || []);

    setText("dashboardLastUpdated", `${adminT("last_updated", "Last updated")}: ${formatDateTime(dashboard.updatedAt)}`);
}

function renderRangeMeta(dashboard) {
    const box = document.getElementById("dashboardRangeMeta");
    if (!box) return;
    const range = dashboard.range || {};
    const filters = dashboard.filters || {};
    box.innerHTML = `
        <span>${escapeHTML(range.label || "Selected period")}</span>
        <b>${escapeHTML(formatDate(range.start))} - ${escapeHTML(formatDate(range.end, true))}</b>
        <span>${escapeHTML(range.timezone || "Asia/Bangkok")}</span>
        <span>${escapeHTML(regionLabel(filters.region))}</span>
        <em>${escapeHTML(dashboard.definitions?.currencyRule || "MMK and THB are separate.")}</em>
    `;
}

function renderKpis(kpis) {
    const box = document.getElementById("dashboardKpis");
    const secondaryBox = document.getElementById("dashboardSecondaryKpis");
    if (!box || !secondaryBox) return;

    const cards = [
        {
            title: "Gross Sales",
            definition: "Final immutable paid order amounts. Wallet top-ups are excluded.",
            type: "money",
            value: kpis.grossSales?.current,
            comparison: kpis.grossSales?.comparison,
            section: "orders"
        },
        {
            title: "Gross Profit",
            definition: "Final paid revenue minus persisted immutable direct cost snapshots. Incomplete rows are never recalculated.",
            type: "profit",
            value: kpis.grossProfit?.current,
            margin: kpis.grossProfit?.margin,
            complete: kpis.grossProfit?.complete,
            incompleteOrders: kpis.grossProfit?.incompleteOrders,
            section: "orders"
        },
        {
            title: "Orders",
            definition: "Order records created in the selected period.",
            value: kpis.orders?.current,
            previous: kpis.orders?.previous,
            change: kpis.orders?.change,
            section: "orders"
        },
        {
            title: "Completed Orders",
            definition: "Orders currently marked completed and created in the selected period.",
            value: kpis.completedOrders?.current,
            previous: kpis.completedOrders?.previous,
            change: kpis.completedOrders?.change,
            section: "orders",
            status: "completed"
        },
        {
            title: "Pending Attention",
            definition: "Manual payment review, paid, old processing, refund, wallet, support, chat, and fulfillment queues.",
            value: kpis.pendingAttention?.current,
            previous: kpis.pendingAttention?.previous,
            change: kpis.pendingAttention?.change,
            section: "orders"
        },
        {
            title: "Failed / Cancelled",
            definition: "Failed, cancelled, and expired orders created in the selected period.",
            value: kpis.failedCancelled?.current,
            previous: kpis.failedCancelled?.previous,
            change: kpis.failedCancelled?.change,
            section: "orders",
            status: "failed"
        },
        {
            title: "Refunds",
            definition: "Refunded orders by refundedAt, with refund amounts separated by currency.",
            type: "refund",
            value: kpis.refunds,
            section: "orders",
            status: "refund_pending"
        },
        {
            title: "Average Order Value",
            definition: "Gross sales divided by eligible sales orders, separately per currency.",
            type: "money",
            value: kpis.averageOrderValue?.current,
            comparison: kpis.averageOrderValue?.comparison,
            section: "orders"
        },
        {
            title: "New Customers",
            definition: "Users whose account was created inside the selected period.",
            value: kpis.newCustomers?.current,
            previous: kpis.newCustomers?.previous,
            change: kpis.newCustomers?.change,
            section: "users"
        }
    ];

    if (adminDashboardPhoneQuery.matches) {
        box.innerHTML = cards.slice(0, 4).map(card => renderKpiCard(card)).join("");
        secondaryBox.innerHTML = cards.slice(4).map(card => renderKpiCard(card)).join("");
    } else {
        box.innerHTML = cards.map(card => renderKpiCard(card)).join("");
        secondaryBox.innerHTML = "";
    }
    document.querySelectorAll("#dashboardKpis [data-dashboard-open], #dashboardSecondaryKpis [data-dashboard-open]").forEach(card => {
        card.addEventListener("click", () => {
            const params = card.dataset.status ? { status: card.dataset.status } : {};
            window.openAdminSection?.(card.dataset.dashboardOpen, true, params);
        });
    });
}

function renderKpiCard(card) {
    if (card.type === "money") {
        const value = card.value || {};
        const comparison = card.comparison || {};
        return `
            <button class="dashboard-kpi-card" type="button" data-dashboard-open="${escapeHTML(card.section || "orders")}" title="${escapeHTML(card.definition)}">
                <span>${escapeHTML(card.title)}</span>
                <strong>${escapeHTML(formatMoney(value.MMK, "MMK"))}</strong>
                <strong>${escapeHTML(formatMoney(value.THB, "THB"))}</strong>
                <small>${escapeHTML(changeLabel(comparison.MMK?.change))} MMK · ${escapeHTML(changeLabel(comparison.THB?.change))} THB</small>
            </button>
        `;
    }

    if (card.type === "profit") {
        const value = card.value || {};
        const margin = card.margin || {};
        const incomplete = Number(card.incompleteOrders?.MMK || 0) + Number(card.incompleteOrders?.THB || 0);
        const marginLabel = card.complete
            ? `${margin.MMK ?? 0}% MMK · ${margin.THB ?? 0}% THB`
            : `${incomplete.toLocaleString()} order${incomplete === 1 ? "" : "s"} missing immutable costs`;
        return `
            <button class="dashboard-kpi-card" type="button" data-dashboard-open="${escapeHTML(card.section || "orders")}" title="${escapeHTML(card.definition)}">
                <span>${escapeHTML(card.title)}${card.complete ? "" : " · Partial"}</span>
                <strong>${escapeHTML(formatMoney(value.MMK, "MMK"))}</strong>
                <strong>${escapeHTML(formatMoney(value.THB, "THB"))}</strong>
                <small>${escapeHTML(marginLabel)}</small>
            </button>
        `;
    }

    if (card.type === "refund") {
        const count = card.value?.count || {};
        const amount = card.value?.amount || {};
        return `
            <button class="dashboard-kpi-card" type="button" data-dashboard-open="${escapeHTML(card.section || "orders")}" data-status="${escapeHTML(card.status || "")}" title="${escapeHTML(card.definition)}">
                <span>${escapeHTML(card.title)}</span>
                <strong>${Number(count.current || 0).toLocaleString()} refunds</strong>
                <b>${escapeHTML(formatMoney(amount.MMK?.current, "MMK"))}</b>
                <b>${escapeHTML(formatMoney(amount.THB?.current, "THB"))}</b>
            </button>
        `;
    }

    return `
        <button class="dashboard-kpi-card" type="button" data-dashboard-open="${escapeHTML(card.section || "orders")}" data-status="${escapeHTML(card.status || "")}" title="${escapeHTML(card.definition)}">
            <span>${escapeHTML(card.title)}</span>
            <strong>${Number(card.value || 0).toLocaleString()}</strong>
            <small>${escapeHTML(changeLabel(card.change))} vs previous · ${Number(card.previous || 0).toLocaleString()} previous</small>
        </button>
    `;
}

function renderSalesChart(dashboard) {
    const box = document.getElementById("dashboardSalesChart");
    if (!box) return;
    const series = dashboard?.series || [];
    if (!series.length) {
        box.innerHTML = renderEmptyState("No trend data", "No completed order activity exists for this period.");
        return;
    }

    const key = dashboardChartMode === "orders" ? "orders" : dashboardChartMode;
    const values = series.map(item => Number(item[key] || 0));
    const max = Math.max(...values, 1);
    const width = 720;
    const height = 260;
    const padding = { top: 22, right: 18, bottom: 36, left: 46 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const step = values.length > 1 ? chartWidth / (values.length - 1) : chartWidth;
    const points = values.map((value, index) => {
        const x = padding.left + index * step;
        const y = padding.top + chartHeight - (value / max) * chartHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const bars = values.map((value, index) => {
        const x = padding.left + index * step;
        const y = padding.top + chartHeight - (value / max) * chartHeight;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${escapeHTML(series[index].label)}: ${escapeHTML(formatChartValue(value, key))}</title></circle>`;
    }).join("");

    box.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(dashboardChartMode)} sales trend">
            <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${width - padding.right}" y2="${padding.top + chartHeight}" class="dashboard-chart-axis"></line>
            <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" class="dashboard-chart-axis"></line>
            <polyline class="dashboard-chart-line" points="${points}"></polyline>
            <g class="dashboard-chart-points">${bars}</g>
            <text x="${padding.left}" y="16" class="dashboard-chart-label">${escapeHTML(formatChartValue(max, key))}</text>
            <text x="${padding.left}" y="${height - 8}" class="dashboard-chart-label">${escapeHTML(series[0]?.label || "")}</text>
            <text x="${width - padding.right - 92}" y="${height - 8}" class="dashboard-chart-label">${escapeHTML(series[series.length - 1]?.label || "")}</text>
        </svg>
    `;
}

function renderStatusChart(items) {
    const box = document.getElementById("dashboardStatusChart");
    if (!box) return;
    const total = items.reduce((sum, item) => sum + Number(item.count || 0), 0);
    if (!total) {
        box.innerHTML = renderEmptyState("No order status data", "No orders were created in this period.");
        return;
    }

    box.innerHTML = items.map(item => {
        const percent = total ? Math.round((Number(item.count || 0) / total) * 100) : 0;
        return `
            <button class="dashboard-status-row" type="button" data-section="${escapeHTML(item.target?.section || "orders")}" data-params="${escapeHTML(JSON.stringify(item.target?.params || {}))}">
                <span class="dashboard-status-dot ${escapeHTML(item.key)}"></span>
                <b>${escapeHTML(item.label)}</b>
                <em>${Number(item.count || 0).toLocaleString()}</em>
                <span class="dashboard-status-meter"><i style="width:${percent}%"></i></span>
                <small>${percent}%</small>
            </button>
        `;
    }).join("");

    bindTargetButtons(box, ".dashboard-status-row");
}

function renderAttentionQueue(items) {
    const box = document.getElementById("dashboardAttentionQueue");
    if (!box) return;
    const visible = items.filter(item => Number(item.count || 0) > 0);
    if (!visible.length) {
        box.innerHTML = renderEmptyState("All clear", "No operational queues require attention right now.");
        return;
    }

    box.innerHTML = visible.map(item => `
        <button class="dashboard-attention-item ${escapeHTML(item.severity || "info")}" type="button" data-section="${escapeHTML(item.target?.section || "orders")}" data-params="${escapeHTML(JSON.stringify(item.target?.params || {}))}">
            <span>${escapeHTML(item.label)}</span>
            <b>${Number(item.count || 0).toLocaleString()}</b>
            <small>${escapeHTML(adminT("open", "Open"))} →</small>
        </button>
    `).join("");

    bindTargetButtons(box, ".dashboard-attention-item");
}

function renderRegionPerformance(items) {
    const box = document.getElementById("dashboardRegionPerformance");
    if (!box) return;
    if (!items.length) {
        box.innerHTML = renderEmptyState("No region data", "No orders exist for this period and filter.");
        return;
    }

    box.innerHTML = items.map(item => `
        <div class="dashboard-region-card">
            <div>
                <strong>${escapeHTML(item.label)}</strong>
                <span>${Number(item.orders || 0).toLocaleString()} orders · ${Number(item.completed || 0).toLocaleString()} completed</span>
            </div>
            <p><span>Sales</span><b>${escapeHTML(formatMoney(item.grossSales?.MMK, "MMK"))}</b><b>${escapeHTML(formatMoney(item.grossSales?.THB, "THB"))}</b></p>
            <p><span>Attention</span><b>${Number(item.pendingAttention || 0).toLocaleString()}</b><span>Failed ${Number(item.failed || 0).toLocaleString()}</span></p>
        </div>
    `).join("");
}

function renderTopPackages(items) {
    const box = document.getElementById("dashboardTopPackages");
    if (!box) return;
    if (!items.length) {
        box.innerHTML = renderEmptyState("No top packages yet", "No successfully fulfilled package sales exist for this period.");
        return;
    }

    box.innerHTML = items.map(item => `
        <div class="dashboard-table-row dashboard-package-rank-row">
            <em>${escapeHTML(item.rank)}</em>
            <span>
                <strong>${escapeHTML(item.productName)} — ${escapeHTML(item.packageName)}</strong>
                <small>${Number(item.unitsSold || 0).toLocaleString()} sold · ${Number(item.orders || 0).toLocaleString()} completed orders</small>
            </span>
            <span><b>${escapeHTML(formatMoney(item.revenue?.MMK, "MMK"))}</b><small>Profit ${escapeHTML(formatMoney(item.profit?.MMK, "MMK"))}${item.profitIncompleteOrders?.MMK ? " · partial" : ""}</small></span>
            <span><b>${escapeHTML(formatMoney(item.revenue?.THB, "THB"))}</b><small>Profit ${escapeHTML(formatMoney(item.profit?.THB, "THB"))}${item.profitIncompleteOrders?.THB ? " · partial" : ""}</small></span>
        </div>
    `).join("");
}

function renderTopGames(items) {
    const box = document.getElementById("dashboardTopGames");
    if (!box) return;
    if (!items.length) {
        box.innerHTML = renderEmptyState("No top games yet", "No eligible paid orders exist for this period.");
        return;
    }
    box.innerHTML = items.map(item => `
        <button class="dashboard-table-row" type="button" data-section="${escapeHTML(item.target?.section || "orders")}" data-params="${escapeHTML(JSON.stringify(item.target?.params || {}))}">
            <span><strong>${escapeHTML(item.name)}</strong><small>${Number(item.orders || 0).toLocaleString()} orders · ${Number(item.share || 0)}% share</small></span>
            <b>${escapeHTML(formatMoney(item.sales?.MMK, "MMK"))}</b>
            <b>${escapeHTML(formatMoney(item.sales?.THB, "THB"))}</b>
        </button>
    `).join("");
    bindTargetButtons(box, ".dashboard-table-row");
}

async function loadSupplierOperations(force = false) {
    const button = document.getElementById("dashboardSupplierRefresh");
    if (button) { button.disabled = true; button.textContent = force ? "Refreshing..." : "Loading..."; }
    try {
        const data = await adminFetch(`/api/admin/dashboard/supplier-operations${force ? "?refresh=true" : ""}`);
        lastSupplierOperations = Array.isArray(data?.suppliers) ? data.suppliers : [];
        lastSupplierPackageProducts = Array.isArray(data?.products) ? data.products : [];
        renderSupplierOperations();
    } catch {
        document.getElementById("dashboardSupplierBalances").innerHTML = renderEmptyState("Supplier monitoring unavailable", "Business analytics and order operations remain available.");
    } finally {
        if (button) { button.disabled = false; button.textContent = "Refresh suppliers"; }
    }
}

function renderSupplierOperations() {
    const balances = document.getElementById("dashboardSupplierBalances");
    const supplierFilter = document.getElementById("dashboardSupplierFilter");
    if (!balances) return;
    const visibleSuppliers = lastSupplierOperations.filter(supplier => supplier.liveOperationsVisible !== false);
    if (!visibleSuppliers.length) {
        balances.innerHTML = renderEmptyState("No suppliers configured", "Configure a supplier to enable operational monitoring.");
    } else {
        balances.innerHTML = visibleSuppliers.map(supplier => {
            const balance = supplier.balance || {};
            const amount = balance.supported && balance.amount != null ? formatMoney(balance.amount, balance.currency) : "Balance unavailable";
            return `<article class="dashboard-supplier-balance-card">
                <div><strong>${escapeHTML(supplier.supplierName || supplier.supplierCode)}</strong><span class="dashboard-health dashboard-health-${escapeHTML(String(balance.status || "UNKNOWN").toLowerCase())}">${escapeHTML(balance.status || "UNKNOWN")}</span></div>
                <b>${escapeHTML(amount)}</b>
                <small>${balance.supported ? `${balance.stale ? "Stale" : "Fresh"} · ${formatDateTime(balance.fetchedAt)}` : escapeHTML(balance.errorMessage || "API balance not supported")}</small>
                ${balance.errorCode && balance.supported ? `<em>${escapeHTML(balance.errorCode)}</em>` : ""}
            </article>`;
        }).join("");
    }
    if (supplierFilter) {
        const selected = supplierFilter.value;
        supplierFilter.innerHTML = `<option value="ALL">All suppliers</option>${visibleSuppliers.map(item => `<option value="${escapeHTML(item.supplierCode)}">${escapeHTML(item.supplierName || item.supplierCode)}</option>`).join("")}`;
        supplierFilter.value = [...supplierFilter.options].some(option => option.value === selected) ? selected : "ALL";
    }
    populateSupplierPackageFilters();
    renderSupplierPackageAvailability();
}

function populateSupplierPackageFilters() {
    const productSelect = document.getElementById("dashboardProductFilter");
    const packageSelect = document.getElementById("dashboardPackageFilter");
    if (!productSelect || !packageSelect) return;
    const selectedProduct = productSelect.value || "ALL";
    const selectedPackage = packageSelect.value || "ALL";
    productSelect.innerHTML = `<option value="ALL">All products</option>${lastSupplierPackageProducts.map(product => `<option value="${escapeHTML(product.productCode)}">${escapeHTML(product.productName || product.productCode)}</option>`).join("")}`;
    productSelect.value = lastSupplierPackageProducts.some(product => product.productCode === selectedProduct) ? selectedProduct : "ALL";
    const packages = lastSupplierPackageProducts.filter(product => productSelect.value === "ALL" || product.productCode === productSelect.value).flatMap(product => (product.packages || []).map(pkg => ({ ...pkg, productCode: product.productCode })));
    packageSelect.innerHTML = `<option value="ALL">All packages</option>${packages.map(pkg => `<option value="${escapeHTML(`${pkg.productCode}:${pkg.packageCode}`)}">${escapeHTML(`${pkg.packageName || pkg.packageCode}${productSelect.value === "ALL" ? ` · ${pkg.productCode}` : ""}`)}</option>`).join("")}`;
    packageSelect.value = packages.some(pkg => `${pkg.productCode}:${pkg.packageCode}` === selectedPackage) ? selectedPackage : "ALL";
}

function supplierAvailabilityLabel(value) {
    return ({ AVAILABLE: "Available", OUT_OF_STOCK: "Out of stock", UNAVAILABLE: "Unavailable", UNKNOWN: "Unknown", NOT_MONITORED: "Not monitored" })[value] || "Unknown";
}

function renderSupplierPackageAvailability() {
    const summary = document.getElementById("dashboardSupplierPackageSummary");
    const box = document.getElementById("dashboardSupplierPackages");
    if (!summary || !box) return;
    const productCode = document.getElementById("dashboardProductFilter")?.value || "ALL";
    const packageIdentity = document.getElementById("dashboardPackageFilter")?.value || "ALL";
    const supplier = document.getElementById("dashboardSupplierFilter")?.value || "ALL";
    const availability = document.getElementById("dashboardAvailabilityFilter")?.value || "ALL";
    const products = lastSupplierPackageProducts.filter(product => productCode === "ALL" || product.productCode === productCode).map(product => ({ ...product, packages: (product.packages || []).filter(pkg => packageIdentity === "ALL" || `${product.productCode}:${pkg.packageCode}` === packageIdentity).map(pkg => ({ ...pkg, suppliers: (pkg.suppliers || []).filter(row => (supplier === "ALL" || row.supplierCode === supplier) && (availability === "ALL" || row.availability === availability)) })).filter(pkg => pkg.suppliers.length) })).filter(product => product.packages.length);
    const selectedSummary = products.length === 1 ? products[0].supplierSummary || [] : [];
    summary.innerHTML = selectedSummary.length ? selectedSummary.map(item => item.monitored === false
        ? `<span><b>${escapeHTML(item.supplierName || item.supplierCode)}</b>Not monitored</span>`
        : `<span><b>${escapeHTML(item.supplierName || item.supplierCode)}</b>${Number(item.counts?.AVAILABLE || 0)} available · ${Number(item.counts?.UNKNOWN || 0)} unknown</span>`).join("") : `<span><b>${products.reduce((sum, product) => sum + product.packages.length, 0)}</b>packages</span>`;
    box.innerHTML = products.length ? products.map(product => `<details class="dashboard-product-group">
        <summary><span><strong>${escapeHTML(product.productName || product.productCode)}</strong><small>${Number(product.packages.length)} packages · ${escapeHTML(product.productCode)}</small></span></summary>
        <div>${product.packages.map(pkg => `<details class="dashboard-package-coverage-row">
            <summary>
                <span class="dashboard-package-identity"><strong>${escapeHTML(pkg.packageName || pkg.packageCode)}</strong><small>${escapeHTML(pkg.packageCode)}</small></span>
                <span class="dashboard-package-coverage-summary">${Number(pkg.coverage?.confirmedAvailableSuppliers || 0)} supplier${Number(pkg.coverage?.confirmedAvailableSuppliers || 0) === 1 ? "" : "s"} available</span>
                <span class="dashboard-supplier-badges" aria-label="Supplier availability">${pkg.suppliers.map(item => `<span class="dashboard-supplier-badge dashboard-supplier-badge-${escapeHTML(item.availability.toLowerCase())}" data-supplier-code="${escapeHTML(item.supplierCode)}" data-availability="${escapeHTML(item.availability)}"><strong>${escapeHTML(item.supplierName || item.supplierCode)}</strong><span>${escapeHTML(supplierAvailabilityLabel(item.availability))}</span></span>`).join("")}</span>
            </summary>
            <div class="dashboard-package-evidence" aria-label="Supplier evidence details">${pkg.suppliers.map(item => `<div>
                <span><strong>${escapeHTML(item.supplierName || item.supplierCode)}</strong><small>${escapeHTML(item.supplierPackageCode || "No mapping")}</small></span>
                <b class="dashboard-health dashboard-health-${escapeHTML(item.availability.toLowerCase())}">${escapeHTML(supplierAvailabilityLabel(item.availability))}</b>
                <small>${item.stale ? "Stale" : item.fetchedAt ? formatDateTime(item.fetchedAt) : escapeHTML(item.evidence.replaceAll("_", " "))}${item.affectedOrderCount ? ` · ${Number(item.affectedOrderCount)} affected orders` : ""}</small>
            </div>`).join("")}</div>
        </details>`).join("")}</div>
    </details>`).join("") : renderEmptyState("No matching packages", "No supplier package coverage matches these filters.");
}

function renderStockAffectedOrders(data) {
    const box = document.getElementById("dashboardStockAffectedOrders");
    if (!box) return;
    const allItems = Array.isArray(data.orders) ? data.orders : [];
    const filterConfigs = [
        ["dashboardStockSupplierFilter", "supplierCode", "All suppliers"],
        ["dashboardStockProductFilter", "productCode", "All products"],
        ["dashboardStockPackageFilter", "packageCode", "All packages"]
    ];
    filterConfigs.forEach(([id, field, label]) => {
        const select = document.getElementById(id);
        if (!select) return;
        const selected = select.value || "ALL";
        const values = [...new Set(allItems.map(item => item[field]).filter(Boolean))].sort();
        select.innerHTML = `<option value="ALL">${escapeHTML(label)}</option>${values.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}`;
        select.value = values.includes(selected) ? selected : "ALL";
    });
    const items = allItems.filter(item => filterConfigs.every(([id, field]) => {
        const value = document.getElementById(id)?.value || "ALL";
        return value === "ALL" || item[field] === value;
    }));
    if (!items.length) {
        box.innerHTML = renderEmptyState(allItems.length ? "No matching affected orders" : "0 stock-affected orders", allItems.length ? "No positively classified supplier stock failures match these filters." : "No fulfillment attempts were positively classified as supplier out of stock in this period.");
        return;
    }
    box.innerHTML = `<strong class="dashboard-operation-count">${Number(data.count || items.length).toLocaleString()} affected orders</strong>${items.map(item => `<div class="dashboard-operation-row">
        <span><strong>${escapeHTML(item.orderId)}</strong><small>${escapeHTML(item.productName)} · ${escapeHTML(item.packageName)}</small></span>
        <span><b>${escapeHTML(item.supplierCode)}</b><small>${escapeHTML(item.supplierPackageCode || "-")}</small></span>
        <span><b>${escapeHTML(formatMoney(item.paidAmount, item.currency))}</b><small>${escapeHTML(item.rawFailureCode || item.normalizedFailureCategory)}</small></span>
        <small>${escapeHTML(formatDateTime(item.failedAt))}</small>
    </div>`).join("")}`;
}

function renderDashboardPaymentMethods(items) {
    const box = document.getElementById("dashboardPaymentMethods");
    if (!box) return;
    setDashboardPanelState(box, "loading");
    if (!Array.isArray(items)) {
        setDashboardPanelState(box, "error");
        box.innerHTML = `<div class="admin-dashboard-error"><strong>Payment-method statistics could not be loaded.</strong><button type="button" data-dashboard-retry>${escapeHTML(adminT("try_again", "Try again"))}</button></div>`;
        box.querySelector("[data-dashboard-retry]")?.addEventListener("click", () => loadAdminDashboard(true));
        return;
    }
    if (!items.length) {
        setDashboardPanelState(box, "empty");
        box.innerHTML = renderEmptyState("No payment data", "No orders have payment-method data for this period.");
        return;
    }

    setDashboardPanelState(box, "populated");
    box.innerHTML = items.slice(0, 8).map(item => `
        <button class="dashboard-table-row" type="button" data-section="${escapeHTML(item.target?.section || "orders")}" data-params="${escapeHTML(JSON.stringify(item.target?.params || {}))}">
            <span>
                <strong>${escapeHTML(item.displayName || item.storedValue || item.key || "Unknown")}</strong>
                <small>${escapeHTML(regionLabel(item.region))} · ${Number(item.orders || 0).toLocaleString()} orders · ${Number(item.share || 0)}%</small>
            </span>
            <b>${escapeHTML(formatMoney(item.sales, item.currency))}</b>
            <em>${Number(item.failed || 0).toLocaleString()} failed</em>
        </button>
    `).join("");

    bindTargetButtons(box, ".dashboard-table-row");
}

function resolvePaymentDistribution(dashboard) {
    if (!dashboard || typeof dashboard !== "object") return [];
    if (Array.isArray(dashboard.paymentDistribution)) return dashboard.paymentDistribution;
    if (Array.isArray(dashboard.paymentMethods)) return dashboard.paymentMethods;
    return [];
}

function renderRecentActivity(activity) {
    const box = document.getElementById("dashboardRecentActivity");
    if (!box) return;
    const items = activity?.[dashboardActivityMode] || [];
    if (!items.length) {
        box.innerHTML = renderEmptyState("No recent activity", "There are no recent records in this activity group.");
        return;
    }

    box.innerHTML = items.map(item => `
        <button class="dashboard-activity-row" type="button" data-section="${escapeHTML(item.target?.section || "orders")}" data-params="${escapeHTML(JSON.stringify(item.target?.params || {}))}">
            <span class="admin-status ${escapeHTML(normalizeStatus(item.status))}">${escapeHTML(formatDashboardStatus(item.status))}</span>
            <strong>${escapeHTML(item.title || item.id || "-")}</strong>
            <small>${escapeHTML(item.subtitle || "")} · ${escapeHTML(formatDateTime(item.at))}</small>
            ${item.amount ? `<b>${escapeHTML(formatMoney(item.amount, item.currency))}</b>` : ""}
        </button>
    `).join("");

    bindTargetButtons(box, ".dashboard-activity-row");
}

function renderQuickActions(items) {
    const box = document.getElementById("dashboardQuickActions");
    if (!box) return;
    const role = String(localStorage.getItem("adminRole") || "").toUpperCase();
    const visible = items.filter(item => role === "OWNER" || item.permission);
    if (!visible.length) {
        box.innerHTML = renderEmptyState("No quick actions", "Your role has no dashboard shortcuts available.");
        return;
    }

    box.innerHTML = visible.map(item => `
        <button class="dashboard-quick-action" type="button" data-section="${escapeHTML(item.section || "dashboard")}" data-params="${escapeHTML(JSON.stringify(item.params || {}))}">
            <span>${escapeHTML(item.label)}</span>
            <i aria-hidden="true">→</i>
        </button>
    `).join("");

    bindTargetButtons(box, ".dashboard-quick-action");
}

function setDashboardLoading() {
    const kpis = document.getElementById("dashboardKpis");
    if (kpis) {
        kpis.innerHTML = Array.from({ length: 8 }).map(() => `<div class="admin-dashboard-skeleton"></div>`).join("");
    }

    [
        "dashboardSalesChart",
        "dashboardStatusChart",
        "dashboardAttentionQueue",
        "dashboardRegionPerformance",
        "dashboardTopGames",
        "dashboardPaymentMethods",
        "dashboardRecentActivity",
        "dashboardQuickActions"
    ].forEach(id => {
        const box = document.getElementById(id);
        if (box) {
            setDashboardPanelState(box, "loading");
            box.innerHTML = `<div class="admin-dashboard-skeleton"></div><div class="admin-dashboard-skeleton"></div>`;
        }
    });
}

function renderDashboardError(message) {
    renderDashboardGlobalError(message);
    [
        "dashboardKpis",
        "dashboardSalesChart",
        "dashboardStatusChart",
        "dashboardAttentionQueue",
        "dashboardRegionPerformance",
        "dashboardTopGames",
        "dashboardPaymentMethods",
        "dashboardRecentActivity",
        "dashboardQuickActions"
    ].forEach(id => {
        const box = document.getElementById(id);
        if (box) {
            setDashboardPanelState(box, "error");
            box.innerHTML = `<div class="admin-dashboard-error"><strong>${escapeHTML(message)}</strong><button type="button" data-dashboard-retry>${escapeHTML(adminT("try_again", "Try again"))}</button></div>`;
        }
    });
    document.querySelectorAll("[data-dashboard-retry]").forEach(button => {
        button.addEventListener("click", () => loadAdminDashboard(true));
    });
}

function setDashboardPanelState(element, state) {
    if (!element) return;
    element.dataset.dashboardState = state;
}

function renderDashboardGlobalError(message) {
    const box = document.getElementById("dashboardErrorRegion");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<strong>${escapeHTML(message)}</strong>`;
}

function clearDashboardGlobalError() {
    const box = document.getElementById("dashboardErrorRegion");
    if (!box) return;
    box.hidden = true;
    box.innerHTML = "";
}

function bindTargetButtons(root, selector) {
    root.querySelectorAll(selector).forEach(button => {
        button.addEventListener("click", () => {
            let params = {};
            try {
                params = JSON.parse(button.dataset.params || "{}");
            } catch (error) {
                params = {};
            }
            window.openAdminSection?.(button.dataset.section, true, params);
        });
    });
}

function getDashboardFilters() {
    try {
        return { ...DASHBOARD_DEFAULT_FILTERS, ...JSON.parse(sessionStorage.getItem(DASHBOARD_STATE_KEY) || "{}") };
    } catch (error) {
        return { ...DASHBOARD_DEFAULT_FILTERS };
    }
}

function getDashboardFiltersFromDom() {
    return {
        preset: document.getElementById("dashboardPresetSelect")?.value || "today",
        region: document.getElementById("dashboardRegionSelect")?.value || "ALL",
        start: document.getElementById("dashboardStartDate")?.value || "",
        end: document.getElementById("dashboardEndDate")?.value || ""
    };
}

function persistDashboardFilters(filters) {
    sessionStorage.setItem(DASHBOARD_STATE_KEY, JSON.stringify({ ...DASHBOARD_DEFAULT_FILTERS, ...filters }));
}

function syncCustomRangeVisibility() {
    const custom = document.getElementById("dashboardCustomRange");
    const filters = getDashboardFilters();
    const current = document.getElementById("dashboardPresetSelect")?.value || filters.preset;
    if (custom) custom.hidden = current !== "custom";
    const start = document.getElementById("dashboardStartDate");
    const end = document.getElementById("dashboardEndDate");
    if (start && !start.value) start.value = filters.start || "";
    if (end && !end.value) end.value = filters.end || "";
}

function validateCustomRange(filters) {
    if (filters.preset !== "custom") return "";
    if (!filters.start || !filters.end) return "Select both a start and end date.";
    if (filters.start > filters.end) return "Start date must be before end date.";
    return "";
}

function setRefreshState(isLoading) {
    const button = document.getElementById("refreshDashboardBtn");
    if (!button) return;
    button.disabled = isLoading;
    button.textContent = isLoading ? "Refreshing..." : "Refresh";
}

function renderEmptyState(title, description) {
    return `
        <div class="admin-empty-state dashboard-empty-state">
            <i aria-hidden="true">·</i>
            <strong>${escapeHTML(title)}</strong>
            <span>${escapeHTML(description)}</span>
        </div>
    `;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function isDashboardActive() {
    const section = document.getElementById("section-dashboard");
    return !section || section.classList.contains("active");
}

function adminT(key, fallback = "") {
    return window.AZIEL_ADMIN_I18N?.t?.(key, fallback) || fallback || key;
}

function formatDashboardStatus(status) {
    return window.AZIEL_ADMIN_I18N?.t?.(status, status) || status || "-";
}

function normalizeStatus(status) {
    const value = String(status || "").toLowerCase();
    if (value === "pending_payment" || value === "refund_requested" || value === "refund_pending" || value === "unread") return "pending";
    if (value === "failed" || value === "cancelled" || value === "expired" || value === "refund_rejected" || value === "rejected") return "cancelled";
    if (value === "paid" || value === "completed" || value === "refunded" || value === "approved" || value === "new") return "completed";
    return value || "info";
}

function formatMoney(value, currency) {
    const amount = Number(value || 0);
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: currency === "THB" ? 2 : 0 })} ${currency || ""}`.trim();
}

function changeLabel(change) {
    if (change === null || change === undefined) return "New";
    if (Number(change) === 0) return "No change";
    return `${Number(change) > 0 ? "+" : ""}${Number(change).toLocaleString()}%`;
}

function formatChartValue(value, key) {
    if (key === "orders") return `${Number(value || 0).toLocaleString()} orders`;
    return formatMoney(value, key);
}

function regionLabel(region) {
    const value = String(region || "ALL").toUpperCase();
    if (value === "MM") return "Myanmar";
    if (value === "TH") return "Thailand";
    if (value === "UNKNOWN") return "Unknown";
    return "All Regions";
}

function formatDateTime(date) {
    if (!date) return "-";
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function formatDate(date, subtractEnd = false) {
    if (!date) return "-";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "-";
    const display = subtractEnd ? new Date(parsed.getTime() - 1) : parsed;
    return new Intl.DateTimeFormat(undefined, { timeZone: "Asia/Bangkok" }).format(display);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.loadAdminDashboard = loadAdminDashboard;
window.loadAdminStats = loadAdminDashboard;
