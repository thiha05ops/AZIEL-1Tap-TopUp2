
// frontend/js/notification-live.js

document.addEventListener("DOMContentLoaded", () => {

    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded");
        return;
    }

    const username =
        localStorage.getItem("username");

    if (!username) return;

    const socket = io();

    socket.emit("joinUser", username);

    socket.on("newNotification", data => {

        console.log(
            "🔔 Notification:",
            data
        );

        increaseNotificationCount();

        showLiveNotification(data);

    });

});

function increaseNotificationCount() {

    const badge =
        document.getElementById(
            "notificationCount"
        );

    if (!badge) return;

    let count =
        Number(badge.innerText || 0);

    count++;

    badge.innerText = count;

}

function showLiveNotification(data) {

    const old =
        document.getElementById(
            "liveNotificationPopup"
        );

    if (old) old.remove();

    const popup =
        document.createElement("div");

    popup.id =
        "liveNotificationPopup";

    popup.innerHTML = `
        <strong>
            🔔 ${data.title || "Notification"}
        </strong>

        <br>

        ${data.message || ""}
    `;

    document.body.appendChild(popup);

    popup.style.position = "fixed";
    popup.style.top = "20px";
    popup.style.right = "-400px";
    popup.style.background =
        "linear-gradient(135deg,#2563eb,#1d4ed8)";
    popup.style.color = "#fff";
    popup.style.padding = "18px";
    popup.style.borderRadius = "18px";
    popup.style.zIndex = "999999";
    popup.style.fontWeight = "700";
    popup.style.transition = ".4s";
    popup.style.boxShadow =
        "0 12px 40px rgba(0,0,0,.35)";

    setTimeout(() => {
        popup.style.right = "20px";
    }, 100);

    setTimeout(() => {

        popup.style.right = "-400px";

        setTimeout(() => {
            popup.remove();
        }, 400);

    }, 5000);

}