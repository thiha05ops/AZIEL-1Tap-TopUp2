// frontend/js/admin-stats.js

document.addEventListener("DOMContentLoaded", async () => {

    loadDashboard();

});

async function loadDashboard() {

    try {

        const res = await fetch("/api/admin/stats");

        const data = await res.json();

        console.log("ADMIN STATS:", data);

        // =========================
        // STATS
        // =========================

        setValue("totalOrders", data.totalOrders || 0);
        setValue("pendingOrders", data.pendingOrders || 0);
        setValue("processingOrders", data.processingOrders || 0);
        setValue("completedOrders", data.completedOrders || 0);
        setValue("totalUsers", data.totalUsers || 0);
        setValue("revenue", data.revenue || 0);

        // =========================
        // REVENUE CHART
        // =========================

        const revenueCanvas =
            document.getElementById("revenueChart");

        if (revenueCanvas) {

            new Chart(revenueCanvas, {
                type: "line",

                data: {
                    labels: [
                        "Mon",
                        "Tue",
                        "Wed",
                        "Thu",
                        "Fri",
                        "Sat",
                        "Sun"
                    ],

                    datasets: [{
                        label: "Revenue",

                        data: [
                            data.revenueData?.monday || 120000,
                            data.revenueData?.tuesday || 190000,
                            data.revenueData?.wednesday || 140000,
                            data.revenueData?.thursday || 250000,
                            data.revenueData?.friday || 310000,
                            data.revenueData?.saturday || 280000,
                            data.revenueData?.sunday || 420000
                        ],

                        borderColor: "#ffd700",

                        backgroundColor:
                            "rgba(255,215,0,.12)",

                        tension: 0.45,

                        fill: true
                    }]
                },

                options: {
                    responsive: true,

                    plugins: {
                        legend: {
                            labels: {
                                color: "#fff"
                            }
                        }
                    },

                    scales: {

                        x: {
                            ticks: {
                                color: "#aaa"
                            }
                        },

                        y: {
                            ticks: {
                                color: "#aaa"
                            }
                        }
                    }
                }
            });
        }

        // =========================
        // ORDERS CHART
        // =========================

        const ordersCanvas =
            document.getElementById("ordersChart");

        if (ordersCanvas) {

            new Chart(ordersCanvas, {

                type: "doughnut",

                data: {

                    labels: [
                        "Completed",
                        "Processing",
                        "Pending",
                        "Cancelled"
                    ],

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

                            labels: {
                                color: "#fff"
                            }
                        }
                    }
                }
            });
        }

    } catch (error) {

        console.log("Admin stats error:", error);

    }
}

function setValue(id, value) {

    const el =
        document.getElementById(id);

    if (el) {

        el.innerText = value;

    }
}