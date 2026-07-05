// frontend/js/admin-stats.js
// AZIEL Admin V2.5 Dashboard Stats

let ordersChartInstance = null;
let revenueChartInstance = null;

document.addEventListener("DOMContentLoaded", () => {
    loadAdminDashboard();

    setInterval(() => {
        if (!document.hidden) loadAdminDashboard(false);
    }, 15000);
});

async function loadAdminDashboard(showError = true) {
    try {
        if (typeof adminFetch !== "function") {
            console.error("adminFetch not found. Make sure admin-api.js is loaded first.");
            return;
        }

        const data = await adminFetch("/api/admin/stats");

        if (!data || !data.success) {
            if (showError) {
                showAdminToast?.(data?.message || "Failed to load dashboard stats", "error");
            }
            return;
        }

        const stats = data.stats || data;

        setValue("totalOrders", stats.totalOrders || 0);
        setValue("pendingOrders", stats.pendingOrders || 0);
        setValue("processingOrders", stats.processingOrders || 0);
        setValue("completedOrders", stats.completedOrders || 0);
        setValue("totalUsers", stats.totalUsers || 0);
        setValue("revenue", Number(stats.revenue || 0).toLocaleString());

        updateOrdersChart(stats);
        updateRevenueChart(stats);

    } catch (error) {
        console.log("Admin stats error:", error);
        if (showError) showAdminToast?.("Dashboard stats error", "error");
    }
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    if (typeof value === "string") {
        el.innerText = value;
        return;
    }

    animateCounter(el, Number(value || 0));
}

function updateOrdersChart(stats) {
    const canvas = document.getElementById("ordersChart");
    if (!canvas || typeof Chart === "undefined") return;

    if (ordersChartInstance) ordersChartInstance.destroy();

    ordersChartInstance = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: ["Completed", "Processing", "Pending", "Cancelled"],
            datasets: [{
                data: [
                    stats.completedOrders || 0,
                    stats.processingOrders || 0,
                    stats.pendingOrders || 0,
                    stats.cancelledOrders || 0
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            cutout: "68%",
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: "#cbd5e1" }
                }
            }
        }
    });
}

function updateRevenueChart(stats) {
    const canvas = document.getElementById("revenueChart");
    if (!canvas || typeof Chart === "undefined") return;

    if (revenueChartInstance) revenueChartInstance.destroy();

    const labels = stats.revenueLabels || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const values = stats.revenueSeries || [0, 0, 0, 0, 0, 0, stats.revenue || 0];

    revenueChartInstance = new Chart(canvas, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Revenue",
                data: values,
                borderWidth: 3,
                tension: 0.45,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: "#94a3b8" } },
                y: { ticks: { color: "#94a3b8" } }
            }
        }
    });
}

function animateCounter(element, target) {
    const start = Number(element.dataset.value || 0);
    const duration = 700;
    const startTime = performance.now();

    function update(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const current = Math.floor(start + (target - start) * progress);

        element.innerText = current.toLocaleString();

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.dataset.value = target;
        }
    }

    requestAnimationFrame(update);
}

window.loadAdminDashboard = loadAdminDashboard;