document.addEventListener("DOMContentLoaded", () => {
    loadAdminDashboard();
    initAdminCharts();
});

async function loadAdminDashboard() {
    try {
        const res = await fetch("/api/admin/stats");
        const data = await res.json();

        if (!data.success) return;

        setText("totalOrders", data.totalOrders || 0);
        setText("pendingOrders", data.pendingOrders || 0);
        setText("processingOrders", data.processingOrders || 0);
        setText("completedOrders", data.completedOrders || 0);
        setText("totalUsers", data.totalUsers || 0);
        setText("revenue", Number(data.revenue || 0).toLocaleString());

    } catch (err) {
        console.log("Admin stats error:", err);
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function initAdminCharts() {
    const revenueCanvas = document.getElementById("revenueChart");
    const ordersCanvas = document.getElementById("ordersChart");

    if (revenueCanvas && window.Chart) {
        new Chart(revenueCanvas, {
            type: "line",
            data: {
                labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                datasets: [{
                    label: "Revenue",
                    data: [120000, 180000, 140000, 250000, 310000, 280000, 420000],
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

    if (ordersCanvas && window.Chart) {
        new Chart(ordersCanvas, {
            type: "doughnut",
            data: {
                labels: ["Completed", "Processing", "Pending", "Cancelled"],
                datasets: [{
                    data: [58, 25, 12, 5],
                    borderWidth: 0
                }]
            },
            options: {
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