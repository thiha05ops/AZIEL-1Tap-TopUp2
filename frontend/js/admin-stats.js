async function loadAdminStats() {

    try {

        const res =
            await fetch("/api/admin/stats");

        const data =
            await res.json();

        if (!data.success) return;

        const stats = data.stats;

        document.getElementById(
            "totalOrders"
        ).innerText =
            stats.totalOrders;

        document.getElementById(
            "pendingOrders"
        ).innerText =
            stats.pendingOrders;

        document.getElementById(
            "processingOrders"
        ).innerText =
            stats.processingOrders;

        document.getElementById(
            "completedOrders"
        ).innerText =
            stats.completedOrders;

        document.getElementById(
            "totalUsers"
        ).innerText =
            stats.totalUsers;

        document.getElementById(
            "revenue"
        ).innerText =
            stats.revenue;

    } catch (error) {
        console.log(error);
    }
}

loadAdminStats();

setInterval(loadAdminStats, 5000);