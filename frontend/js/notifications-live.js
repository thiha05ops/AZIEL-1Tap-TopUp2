// frontend/js/notification-live.js

let socketInitialized = false;

document.addEventListener("DOMContentLoaded", () => {

    // prevent duplicate socket listener
    if (socketInitialized) return;

    socketInitialized = true;

    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded");
        return;
    }

    const username =
        localStorage.getItem("username");

    if (!username) {
        console.log("No username found");
        return;
    }

    const socket = io();

    socket.emit("joinUser", username);

    // remove old listeners first
    socket.off("newNotification");

    socket.on("newNotification", data => {

        console.log(
            "🔔 Live Notification:",
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

    // remove old popup
    const old =
        document.getElementById(
            "liveNotificationPopup"
        );

    if (old) {
        old.remove();
    }

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

    // styles
    popup.style.position = "fixed";
    popup.style.top = "20px";
    popup.style.right = "-420px";
    popup.style.background =
        "linear-gradient(135deg,#2563eb,#1d4ed8)";
    popup.style.color = "#fff";
    popup.style.padding = "18px 20px";
    popup.style.borderRadius = "18px";
    popup.style.zIndex = "999999";
    popup.style.fontWeight = "700";
    popup.style.transition = ".4s";
    popup.style.boxShadow =
        "0 12px 40px rgba(0,0,0,.35)";
    popup.style.maxWidth = "320px";

    // animate in
    setTimeout(() => {
        popup.style.right = "20px";
    }, 100);

    // auto remove
    setTimeout(() => {

        popup.style.right = "-420px";

        setTimeout(() => {

            if (popup.parentNode) {
                popup.remove();
            }

        }, 400);

    }, 5000);

}