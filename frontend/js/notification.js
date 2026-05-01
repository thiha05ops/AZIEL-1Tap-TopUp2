function getNotifications() {
    return JSON.parse(localStorage.getItem("notifications")) || [];
}

function addNotification(text, orderId) {
    const list = getNotifications();

    list.unshift({
        id: orderId,
        text,
        time: new Date().toLocaleString(),
        read: false
    });

    localStorage.setItem("notifications", JSON.stringify(list));
    updateBell();
}

function updateBell() {
    const list = getNotifications();
    const unread = list.filter(n => !n.read).length;

    const badge = document.getElementById("notiCount");

    if (!badge) return;

    badge.innerText = unread;
    badge.style.display = unread > 0 ? "block" : "none";
}

function markAllRead() {
    const list = getNotifications().map(n => ({ ...n, read: true }));
    localStorage.setItem("notifications", JSON.stringify(list));
    updateBell();
}