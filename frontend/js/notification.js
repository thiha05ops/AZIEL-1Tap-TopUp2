// notification.js

function addNotification(text, orderId) {
    const list = JSON.parse(localStorage.getItem("aziel_orders") || "[]");

    list.unshift({
        text,
        orderId,
        time: new Date().toLocaleString()
    });

    localStorage.setItem("aziel_orders", JSON.stringify(list));
}

function loadNotifications() {
    const list = JSON.parse(localStorage.getItem("aziel_orders") || "[]");
    const box = document.getElementById("notiList");

    if (!box) return;

    if (list.length === 0) {
        box.innerHTML = `<p>No notifications</p>`;
        return;
    }

    box.innerHTML = "";

    list.forEach(item => {
        box.innerHTML += `
            <div class="noti-item" onclick="window.location.href='tracking.html?orderId=${item.orderId}'">
                🔔 ${item.text}<br>
                <small>${item.time}</small>
            </div>
        `;
    });
}

document.addEventListener("DOMContentLoaded", loadNotifications);