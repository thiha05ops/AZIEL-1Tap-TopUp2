async function loadNotifications() {
    const username = localStorage.getItem("username");
    const token = localStorage.getItem("token");

    const notiBtn = document.getElementById("notiBtn");
    const notiCount = document.getElementById("notiCount");
    const notiDropdown = document.getElementById("notiDropdown");
    const notiList = document.getElementById("notiList");

    if (!notiBtn || !notiCount || !notiDropdown || !notiList) return;

    notiBtn.addEventListener("click", () => {
        notiDropdown.classList.toggle("show");
    });

    if (!username || !token) {
        notiCount.innerText = "0";
        notiList.innerHTML = "<p>Please login to see notifications.</p>";
        return;
    }

    try {
        const res = await fetch(`/api/history/${username}`);
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