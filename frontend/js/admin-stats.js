// frontend/js/admin-stats.js

let ordersChartInstance = null;

document.addEventListener("DOMContentLoaded", () => {
    loadAdminDashboard();
});

async function loadAdminDashboard() {
    try {
        const token =
            localStorage.getItem("adminToken") ||
            localStorage.getItem("token");

        if (!token) {
            alert("Admin session expired. Please login again.");
            window.location.href = "admin-login.html";
            return;
        }

        const res = await fetch("/api/admin/stats", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await res.json();

        console.log("ADMIN STATS:", data);

        if (!data.success) {
            alert(data.message || "Admin session expired.");
            window.location.href = "admin-login.html";
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

    } catch (error) {
        console.log("Admin stats error:", error);
    }
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function updateOrdersChart(stats) {
    const canvas = document.getElementById("ordersChart");

    if (!canvas || typeof Chart === "undefined") return;

    if (ordersChartInstance) {
        ordersChartInstance.destroy();
    }

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
                    labels: {
                        color: "#cbd5e1"
                    }
                }
            }
        }
    });
}