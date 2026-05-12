// frontend/js/admin-live.js

const socket = io();

socket.emit("joinAdmin");

socket.on("adminNewUpdate", data => {

    console.log(
        "LIVE ADMIN UPDATE:",
        data
    );

    // auto reload
    if (typeof loadOrders === "function") {
        loadOrders();
    }

    if (typeof loadWalletTopups === "function") {
        loadWalletTopups();
    }

    // sound
    const audio = new Audio(
        "/assets/notification.mp3"
    );

    audio.play().catch(() => { });

});