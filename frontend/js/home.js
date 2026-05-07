// frontend/js/home.js

document.addEventListener("DOMContentLoaded", () => {
    const username = localStorage.getItem("username");
    const displayName = localStorage.getItem("displayName") || username;

    const avatarText = document.getElementById("avatarText");
    const usernameText = document.getElementById("usernameText");
    const profileBox = document.getElementById("profileBox");
    const profileDropdown = document.getElementById("profileDropdown");
    const notiBtn = document.getElementById("notiBtn");
    const notiCount = document.getElementById("notiCount");

    // Profile text
    if (avatarText && usernameText) {
        if (username) {
            avatarText.innerText = displayName.charAt(0).toUpperCase();
            usernameText.innerText = displayName;
        } else {
            avatarText.innerText = "👤";
            usernameText.innerText = "Login";
        }
    }

    // Profile dropdown
    if (profileBox && profileDropdown) {
        profileBox.addEventListener("click", (e) => {
            e.stopPropagation();

            if (!username) {
                window.location.href = "login.html";
                return;
            }

            profileDropdown.style.display =
                profileDropdown.style.display === "flex" ? "none" : "flex";
        });

        document.addEventListener("click", () => {
            profileDropdown.style.display = "none";
        });
    }

    // Notification button
    if (notiBtn) {
        notiBtn.addEventListener("click", (e) => {
            e.stopPropagation();

            if (!username) {
                window.location.href = "login.html";
                return;
            }

            window.location.href = "notifications.html";
        });
    }

    // Notification count from DB
    if (username && notiCount) {
        loadNotificationCount(username, notiCount);
        setInterval(() => loadNotificationCount(username, notiCount), 8000);
    }

    // Game cards login gate
    document.querySelectorAll(".game-card").forEach(card => {
        card.addEventListener("click", (e) => {
            if (!username) {
                e.preventDefault();
                alert("Please login first 🔐");
                window.location.href = "login.html";
            }
        });
    });
});

async function loadNotificationCount(username, badge) {
    try {
        const res = await fetch(`/api/history/${username}`);
        const data = await res.json();

        if (!data.success || !data.orders) {
            badge.innerText = "0";
            return;
        }

        const activeOrders = data.orders.filter(o => o.status !== "completed");
        badge.innerText = activeOrders.length;

    } catch (error) {
        badge.innerText = "0";
    }
}