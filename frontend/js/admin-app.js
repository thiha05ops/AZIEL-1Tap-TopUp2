// frontend/js/admin-app.js

document.addEventListener("DOMContentLoaded", () => {
    initAdminNavigation();
    initAdminBroadcastMock();
});

const adminSectionTitles = {
    dashboard: {
        title: "Dashboard",
        sub: "Live control center for AZIEL 1Tap Shop."
    },
    orders: {
        title: "Orders",
        sub: "Manage user orders without leaving the admin app."
    },
    wallet: {
        title: "Wallet Topups",
        sub: "Review and approve wallet balance requests."
    },
    users: {
        title: "Users",
        sub: "Customer accounts and activity overview."
    },
    games: {
        title: "Games & Prices",
        sub: "Manage game packages and regional prices."
    },
    support: {
        title: "Support Tickets",
        sub: "Handle user problems and screenshots."
    },
    chat: {
        title: "Live Chat",
        sub: "Realtime customer messages."
    },
    broadcast: {
        title: "Broadcast",
        sub: "Send announcements, promos and system messages."
    },
    settings: {
        title: "Settings",
        sub: "Admin controls and system preferences."
    }
};

function initAdminNavigation() {
    const navButtons = document.querySelectorAll(".admin-nav");
    const sections = document.querySelectorAll(".admin-section");
    const title = document.getElementById("adminPageTitle");
    const sub = document.getElementById("adminPageSub");

    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.section;

            navButtons.forEach(item => item.classList.remove("active"));
            btn.classList.add("active");

            sections.forEach(section => {
                section.classList.remove("active");
            });

            const activeSection = document.getElementById(`section-${target}`);
            if (activeSection) {
                activeSection.classList.add("active");
            }

            if (adminSectionTitles[target]) {
                title.innerText = adminSectionTitles[target].title;
                sub.innerText = adminSectionTitles[target].sub;
            }
        });
    });
}

function initAdminBroadcastMock() {

    const btn =
        document.getElementById(
            "sendBroadcastBtn"
        );

    if (!btn) return;

    btn.addEventListener(
        "click",

        async () => {

            const type =
                document.getElementById(
                    "broadcastType"
                )?.value;

            const title =
                document.getElementById(
                    "broadcastTitle"
                )?.value.trim();

            const message =
                document.getElementById(
                    "broadcastMessage"
                )?.value.trim();

            if (!title || !message) {

                showAdminToast(
                    "Please fill title and message.",
                    "error"
                );

                return;

            }

            btn.disabled = true;
            btn.innerText = "Sending...";

            try {

                // 1. GET USERS
                const usersRes =
                    await fetch(
                        "/api/admin/users"
                    );

                const usersData =
                    await usersRes.json();

                if (
                    !usersData.success
                ) {

                    throw new Error(
                        "Failed to load users"
                    );

                }

                const usernames =
                    usersData.users.map(
                        user => user.username
                    );

                // 2. CATEGORY
                let category =
                    "announcements";

                if (
                    type === "promo"
                ) {

                    category =
                        "promotions";

                }

                if (
                    type ===
                    "topup_delayed"
                ) {

                    category =
                        "orders";

                }

                // 3. SEND BROADCAST
                const res =
                    await fetch(
                        "/api/notifications/broadcast",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({

                                usernames,

                                title,

                                message,

                                type,

                                category

                            })

                        }
                    );

                const data =
                    await res.json();

                if (
                    !data.success
                ) {

                    throw new Error(
                        data.message
                    );

                }

                showAdminToast(
                    `Broadcast sent to ${data.count} users`,
                    "success"
                );

                // RESET
                document.getElementById(
                    "broadcastTitle"
                ).value = "";

                document.getElementById(
                    "broadcastMessage"
                ).value = "";

            } catch (error) {

                console.log(error);

                showAdminToast(
                    "Broadcast failed",
                    "error"
                );

            }

            btn.disabled = false;
            btn.innerText =
                "Send Broadcast";

        }

    );

}

function showAdminToast(message, type = "success") {
    const old = document.getElementById("adminToast");
    if (old) old.remove();

    const toast = document.createElement("div");
    toast.id = "adminToast";
    toast.className = `admin-toast ${type}`;
    toast.innerText = message;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("show");
    }, 80);

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}
document.addEventListener("DOMContentLoaded", () => {
    initQuickBroadcastButtons();
});

function initQuickBroadcastButtons() {
    const buttons = document.querySelectorAll(".quick-action");

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const text = btn.innerText.toLowerCase();

            let type = "announcement";
            let title = "";

            if (text.includes("promotion")) {
                type = "promo";
                title = "Special Promotion";
            } else if (text.includes("delay")) {
                type = "topup_delayed";
                title = "Top-up Delay Notice";
            } else if (text.includes("completed")) {
                type = "order_completed";
                title = "Order Completed";
            } else {
                type = "announcement";
                title = "Admin Announcement";
            }

            openAdminSection("broadcast");

            setTimeout(() => {
                document.getElementById("broadcastType").value = type;
                document.getElementById("broadcastTitle").value = title;
                document.getElementById("broadcastMessage").focus();
            }, 120);
        });
    });
}

function openAdminSection(sectionName) {
    const btn = document.querySelector(
        `.admin-nav[data-section="${sectionName}"]`
    );

    if (btn) btn.click();
}