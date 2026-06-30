// frontend/js/support.js
// AZIEL V2.5 Support Ticket System
// Live Chat is handled by frontend/js/live-chat.js

let allTickets = [];
let currentFilter = "all";
let supportSocketStarted = false;

function supportApiUrl(path) {
    if (window.AZIEL?.apiUrl) {
        return window.AZIEL.apiUrl(path);
    }

    const base =
        location.port === "5500"
            ? "http://localhost:3000"
            : "";

    return `${base}${path}`;
}

document.addEventListener("DOMContentLoaded", () => {
    initSupportForm();
    initCategoryCards();
    initTicketTabs();
    startSupportSocket();
    loadMyTickets();
});

// INIT

function initSupportForm() {
    document
        .getElementById("supportForm")
        ?.addEventListener("submit", submitSupportTicket);
}

function initCategoryCards() {
    document.querySelectorAll(".category-card").forEach(card => {
        card.addEventListener("click", () => {
            const type = card.dataset.type;

            document.querySelectorAll(".category-card").forEach(c =>
                c.classList.remove("active")
            );

            card.classList.add("active");

            const select = document.getElementById("ticketType");
            if (select) select.value = type;

            const subject = document.getElementById("ticketSubject");

            if (subject && !subject.value.trim()) {
                subject.value = getSubjectByType(type);
            }
        });
    });
}

function initTicketTabs() {
    document.querySelectorAll(".ticket-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".ticket-tab").forEach(t =>
                t.classList.remove("active")
            );

            tab.classList.add("active");
            currentFilter = tab.dataset.filter || "all";

            renderTickets();
        });
    });
}

function getSubjectByType(type) {
    const subjects = {
        order: "My order is not completed",
        payment: "Payment issue",
        wallet: "Wallet balance problem",
        account: "Account login issue",
        general: "Need help"
    };

    return subjects[type] || "Need help";
}

// SUBMIT TICKET

async function submitSupportTicket(e) {
    e.preventDefault();

    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username");

    if (!username) {
        alert("Please login first");
        return;
    }

    const form = document.getElementById("supportForm");
    const btn = document.getElementById("submitTicketBtn");

    const type = document.getElementById("ticketType")?.value;
    const subject = document.getElementById("ticketSubject")?.value.trim();
    const message = document.getElementById("ticketMessage")?.value.trim();
    const orderId = document.getElementById("ticketOrderId")?.value.trim();
    const screenshot = document.getElementById("ticketScreenshot")?.files[0];

    if (!type || !subject || !message) {
        showFormMessage("Please fill all required fields.", "error");
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = "Submitting...";
        }

        const formData = new FormData();

        formData.append("username", username);
        formData.append("type", type);
        formData.append("subject", subject);
        formData.append("message", message);

        if (orderId) {
            formData.append("orderId", orderId);
        }

        if (screenshot) {
            formData.append("screenshot", screenshot);
        }

        const res = await fetch(supportApiUrl("/api/support/ticket"), {
            method: "POST",
            body: formData
        });

        const data = await res.json();

        if (!data.success) {
            showFormMessage(data.message || "Submit failed", "error");
            return;
        }

        showFormMessage("✅ Support ticket submitted successfully", "success");

        form?.reset();

        document.querySelectorAll(".category-card").forEach(c =>
            c.classList.remove("active")
        );

        await loadMyTickets();
    } catch (error) {
        console.log("Submit support error:", error);
        showFormMessage("Server error", "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "🚀 Submit Ticket";
        }
    }
}

function showFormMessage(text, type) {
    const msg = document.getElementById("supportMsg");
    if (!msg) return;

    msg.innerText = text;
    msg.className = type === "success" ? "msg-success" : "msg-error";
}

// LOAD TICKETS

async function loadMyTickets() {
    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username");

    const box = document.getElementById("myTickets");
    if (!box) return;

    if (!username) {
        box.innerHTML = `
            <div class="empty-ticket">
                <h3>Please login first</h3>
                <p>You need to login to view your support tickets.</p>
            </div>
        `;
        return;
    }

    try {
        box.innerHTML = `<p class="loading-text">Loading tickets...</p>`;

        const res = await fetch(
            supportApiUrl(`/api/support/my/${encodeURIComponent(username)}`)
        );

        const data = await res.json();

        if (!data.success || !data.tickets?.length) {
            allTickets = [];
            renderTickets();
            return;
        }

        allTickets = data.tickets;
        renderTickets();
    } catch (error) {
        console.log("Load tickets error:", error);

        box.innerHTML = `
            <div class="empty-ticket">
                <h3>Failed to load tickets</h3>
                <p>Please try again later.</p>
            </div>
        `;
    }
}

function renderTickets() {
    const box = document.getElementById("myTickets");
    if (!box) return;

    let tickets = allTickets;

    if (currentFilter !== "all") {
        tickets = allTickets.filter(ticket =>
            normalizeStatus(ticket.status) === currentFilter
        );
    }

    if (!tickets.length) {
        box.innerHTML = `
            <div class="empty-ticket">
                <div class="empty-icon">📭</div>
                <h3>No tickets found</h3>
                <p>Your support tickets will appear here.</p>
            </div>
        `;
        return;
    }

    box.innerHTML = tickets.map(renderTicket).join("");
}

// RENDER

function renderTicket(ticket) {
    const status = normalizeStatus(ticket.status);
    const type = ticket.type || "general";

    const screenshot = ticket.screenshot
        ? normalizeUploadPath(`/uploads/support/${ticket.screenshot}`)
        : "";

    return `
        <div class="ticket-item">
            <div class="ticket-main">
                <div class="ticket-icon ${escapeHTML(type)}">
                    ${getTypeIcon(type)}
                </div>

                <div class="ticket-info">
                    <h3>${escapeHTML(ticket.subject || "-")}</h3>

                    <p>
                        <b>Ticket ID:</b>
                        ${escapeHTML(ticket.ticketId || "-")}
                    </p>

                    <p>
                        <b>Type:</b>
                        ${escapeHTML(formatType(type))}
                    </p>

                    ${ticket.orderId
            ? `<p><b>Order ID:</b> ${escapeHTML(ticket.orderId)}</p>`
            : ""
        }

                    <p class="ticket-message">
                        ${escapeHTML(ticket.message || "")}
                    </p>
                </div>

                <span class="ticket-status status-${escapeHTML(status)}">
                    ${escapeHTML(status)}
                </span>
            </div>

            ${screenshot
            ? `
                        <img
                            src="${escapeHTML(screenshot)}"
                            class="ticket-image"
                            onclick="window.open('${escapeHTML(screenshot)}', '_blank')"
                            alt="Support screenshot"
                        >
                    `
            : ""
        }

            ${ticket.adminReply
            ? `
                        <div class="ticket-reply">
                            <strong>👤 Admin Reply</strong>
                            <p>${escapeHTML(ticket.adminReply)}</p>
                        </div>
                    `
            : ""
        }
        </div>
    `;
}

function normalizeUploadPath(path) {
    if (!path) return "";

    if (path.startsWith("http")) return path;

    if (location.port === "5500") {
        return `http://localhost:3000${path}`;
    }

    return path;
}

function normalizeStatus(status) {
    const value = String(status || "").toLowerCase();

    if (!value) return "open";
    if (value === "pending") return "open";
    if (value === "answered") return "replied";
    if (value === "reply") return "replied";
    if (value === "done") return "solved";

    return value;
}

function getTypeIcon(type) {
    const icons = {
        order: "🎮",
        payment: "💳",
        wallet: "💰",
        account: "👤",
        general: "🚨"
    };

    return icons[type] || "🚨";
}

function formatType(type) {
    const names = {
        order: "Order Issue",
        payment: "Payment Issue",
        wallet: "Wallet Issue",
        account: "Account Issue",
        general: "General Help"
    };

    return names[type] || "General Help";
}

// SUPPORT SOCKET ONLY

function startSupportSocket() {
    if (supportSocketStarted) return;
    supportSocketStarted = true;

    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded for support");
        return;
    }

    const username =
        window.AZIEL?.user?.username ||
        localStorage.getItem("username");

    if (!username) return;

    const socket =
        location.port === "5500"
            ? io("http://localhost:3000")
            : io();

    socket.emit("joinUser", username);

    socket.on("newNotification", data => {
        if (data.title !== "Support Reply") return;

        showSupportPopup(data.message || "Admin replied to your ticket");
        loadMyTickets();
    });

    socket.on("supportUpdated", data => {
        showSupportPopup(data.message || "Your support ticket was updated");
        loadMyTickets();
    });
}

function showSupportPopup(message) {
    const old = document.querySelector(".support-live-popup");
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.className = "support-live-popup";
    popup.innerHTML = escapeHTML(message);

    document.body.appendChild(popup);

    setTimeout(() => {
        popup.classList.add("show");
    }, 100);

    setTimeout(() => {
        popup.classList.remove("show");

        setTimeout(() => {
            popup.remove();
        }, 400);
    }, 5000);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

window.loadMyTickets = loadMyTickets;