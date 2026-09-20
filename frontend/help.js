async function getHelpAuthenticatedUser() {
    try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const data = await response.json();
        return response.ok && data.success ? data.user : null;
    } catch (_) {
        return null;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const user = await getHelpAuthenticatedUser();
    const helpLoginBtn = document.getElementById("helpLoginBtn");

    if (user?.username && helpLoginBtn) {
        helpLoginBtn.innerText = user.displayName || user.username;
        helpLoginBtn.href = "/account";
    }
});
async function loadNotifications() {
    const user = await getHelpAuthenticatedUser();

    const notiBtn = document.getElementById("notiBtn");
    const notiCount = document.getElementById("notiCount");
    const notiDropdown = document.getElementById("notiDropdown");
    const notiList = document.getElementById("notiList");

    if (!notiBtn || !notiCount || !notiDropdown || !notiList) return;

    notiBtn.addEventListener("click", () => {
        notiDropdown.classList.toggle("show");
    });

    if (!user?.username) {
        notiCount.innerText = "0";
        notiList.innerHTML = "<p>Please login to see notifications.</p>";
        return;
    }

    try {
        const res = await fetch(`/api/history/${encodeURIComponent(user.username)}`, { credentials: "include" });
        const data = await res.json();

        if (!data.success || data.orders.length === 0) {
            notiCount.innerText = "0";
            notiList.innerHTML = "<p>No notifications yet.</p>";
            return;
        }

        const activeOrders = data.orders.filter(
            o => o.status !== "Done" && o.status !== "Cancelled"
        );

        notiCount.innerText = activeOrders.length;

        notiList.innerHTML = data.orders.slice(0, 5).map(order => `
            <div class="noti-item">
                <strong>${order.status}</strong>
                <p>${order.packageName}</p>
                <p>${order.note || "Order received."}</p>
                <small>${new Date(order.createdAt).toLocaleString()}</small>
            </div>
        `).join("");

    } catch (error) {
        console.log(error);
        notiList.innerHTML = "<p>Failed to load notifications.</p>";
    }
}

loadNotifications();
setInterval(loadNotifications, 10000);
