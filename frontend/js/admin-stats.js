// frontend/js/admin-stats.js

document.addEventListener("DOMContentLoaded", () => {
    loadAdminDashboard();
});

async function loadAdminDashboard() {
    try {
        const res = await fetch("/api/admin/stats");
        const data = await res.json();

        console.log("ADMIN STATS:", data);

        if (!data.success) {
            console.log(data.message || "Admin stats failed");
            return;
        }

        setValue("totalOrders", data.totalOrders || 0);
        setValue("pendingOrders", data.pendingOrders || 0);
        setValue("processingOrders", data.processingOrders || 0);
        setValue("completedOrders", data.completedOrders || 0);
        setValue("totalUsers", data.totalUsers || 0);
        setValue("revenue", Number(data.revenue || 0).toLocaleString());

        renderAdminCharts(data);

    } catch (error) {
        console.log("Admin stats error:", error);
    }
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function renderAdminCharts(data) {
    if (typeof Chart === "undefined") {
        console.log("Chart.js not loaded");
        return;
    }

    const revenueCanvas = document.getElementById("revenueChart");

    if (revenueCanvas) {
        new Chart(revenueCanvas, {
            type: "line",
            data: {
                labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                datasets: [{
                    label: "Revenue",
                    data: [
                        120000,
                        180000,
                        140000,
                        250000,
                        310000,
                        280000,
                        Number(data.revenue || 0)
                    ],
                    borderColor: "#ffd700",
                    backgroundColor: "rgba(255, 215, 0, .12)",
                    borderWidth: 3,
                    tension: 0.45,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { ticks: { color: "#94a3b8" } },
                    y: { ticks: { color: "#94a3b8" } }
                }
            }
        });
    }

    const ordersCanvas = document.getElementById("ordersChart");

    if (ordersCanvas) {
        new Chart(ordersCanvas, {
            type: "doughnut",
            data: {
                labels: ["Completed", "Processing", "Pending", "Cancelled"],
                datasets: [{
                    data: [
                        data.completedOrders || 0,
                        data.processingOrders || 0,
                        data.pendingOrders || 0,
                        data.cancelledOrders || 0
                    ],
                    backgroundColor: [
                        "#22c55e",
                        "#3b82f6",
                        "#f59e0b",
                        "#ef4444"
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: "#cbd5e1" }
                    }
                }
            }
        });
    }
}