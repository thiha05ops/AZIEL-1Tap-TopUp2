// frontend/js/support.js

let supportLiveStarted = false;
let allTickets = [];
let currentFilter = "all";

document.addEventListener("DOMContentLoaded", () => {
    initSupportForm();
    initCategoryCards();
    initTicketTabs();
    startSupportLiveSystem();
    loadMyTickets();
});

// ======================
// INIT
// ======================

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

// ======================
// SUBMIT TICKET
// ======================

async function submitSupportTicket(e) {
    e.preventDefault();

    const username = localStorage.getItem("username");

    if (!username) {
        alert("Please login first");
        return;
    }

    const msg = document.getElementById("supportMsg");
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
        btn.disabled = true;
        btn.innerText = "Submitting...";

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

        const res = await fetch("/api/support/ticket", {
            method: "POST",
            body: formData
        });

        const data = await res.json();

        if (!data.success) {
            showFormMessage(data.message || "Submit failed", "error");
            return;
        }

        showFormMessage("✅ Support ticket submitted successfully", "success");

        document.getElementById("supportForm").reset();

        document.querySelectorAll(".category-card").forEach(c =>
            c.classList.remove("active")
        );

        await loadMyTickets();

    } catch (error) {
        console.log("Submit support error:", error);
        showFormMessage("Server error", "error");

    } finally {
        btn.disabled = false;
        btn.innerText = "🚀 Submit Ticket";
    }
}

function showFormMessage(text, type) {
    const msg = document.getElementById("supportMsg");
    if (!msg) return;

    msg.innerText = text;
    msg.className = type === "success" ? "msg-success" : "msg-error";
}

// ======================
// LOAD TICKETS
// ======================

async function loadMyTickets() {
    const username = localStorage.getItem("username");
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

        const res = await fetch(`/api/support/my/${username}`);
        const data = await res.json();

        if (!data.success || !data.tickets || !data.tickets.length) {
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

// ======================
// RENDER TICKET CARD
// ======================

function renderTicket(ticket) {
    const status = normalizeStatus(ticket.status);
    const type = ticket.type || "general";

    const screenshot = ticket.screenshot
        ? `/uploads/support/${ticket.screenshot}`
        : "";

    return `
        <div class="ticket-item">
            <div class="ticket-main">
                <div class="ticket-icon ${type}">
                    ${getTypeIcon(type)}
                </div>

                <div class="ticket-info">
                    <h3>${ticket.subject || "-"}</h3>

                    <p>
                        <b>Ticket ID:</b>
                        ${ticket.ticketId || "-"}
                    </p>

                    <p>
                        <b>Type:</b>
                        ${formatType(type)}
                    </p>

                    ${ticket.orderId
            ? `<p><b>Order ID:</b> ${ticket.orderId}</p>`
            : ""
        }

                    <p class="ticket-message">
                        ${ticket.message || ""}
                    </p>
                </div>

                <span class="ticket-status status-${status}">
                    ${status}
                </span>
            </div>

            ${screenshot
            ? `
                    <img
                        src="${screenshot}"
                        class="ticket-image"
                        onclick="window.open('${screenshot}', '_blank')"
                    >
                `
            : ""
        }

            ${ticket.adminReply
            ? `
                    <div class="ticket-reply">
                        <strong>👤 Admin Reply</strong>
                        <p>${ticket.adminReply}</p>
                    </div>
                `
            : ""
        }
        </div>
    `;
}

function normalizeStatus(status) {
    if (!status) return "open";

    if (status === "pending") return "open";
    if (status === "answered") return "replied";
    if (status === "reply") return "replied";
    if (status === "done") return "solved";

    return status;
}

function getTypeIcon(type) {
    const icons = {
        order: "🎮",
        payment: "💳",
        wallet: "💰",
        account: "👤",
        general: "🚨"
    };

    return icons[type] || "null";
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

// ======================
// LIVE SUPPORT
// ======================

function startSupportLiveSystem() {
    if (supportLiveStarted) return;
    supportLiveStarted = true;

    if (typeof io === "undefined") {
        console.log("Socket.IO not loaded for support");
        return;
    }

    const username = localStorage.getItem("username");

    if (!username) return;

    const socket = io();

    socket.emit("joinUser", username);
    socket.emit("joinUserRoom", username);

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

    popup.innerHTML = `
         ${message}
    `;

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

window.loadMyTickets = loadMyTickets;
// ======================================
// FLOATING LIVE CHAT SYSTEM
// ======================================

document.addEventListener("DOMContentLoaded", () => {
    createLiveChatUI();
    initLiveChatBall();
    initLiveChatSystem();
});

function createLiveChatUI() {
    const ball = document.createElement("div");
    ball.className = "chat-ball";
    ball.innerHTML = `
        <i class="fa-solid fa-comments"></i>
        <div class="chat-badge">1</div>
        <div class="online-dot"></div>
    `;
    document.body.appendChild(ball);

    const panel = document.createElement("div");
    panel.className = "live-chat-panel";

    panel.innerHTML = `
        <div class="chat-header">
            <div class="chat-agent">
                <div class="chat-agent-icon">
                    <i class="fa-solid fa-headset"></i>
                </div>
                <div>
                    <strong>AZIEL Live Support</strong>
                    <small id="supportStatusText">Support Online</small>
                </div>
            </div>
            <button class="chat-close-btn">✕</button>
        </div>

        <div class="chat-body" id="liveChatBody"></div>

        <div class="chat-typing" id="chatTyping">
            Admin is typing...
        </div>

        <div class="chat-input-row">
            <input
                type="text"
                id="liveChatInput"
                placeholder="Type your message..."
            >
            <button id="sendLiveChatBtn">
                <i class="fa-solid fa-paper-plane"></i>
            </button>
        </div>
    `;

    document.body.appendChild(panel);

    ball.addEventListener("click", () => {
        panel.classList.toggle("open");
        ball.classList.remove("has-unread");
    });

    panel.querySelector(".chat-close-btn")?.addEventListener("click", () => {
        panel.classList.remove("open");
    });
}

function initLiveChatBall() {
    const ball = document.querySelector(".chat-ball");
    if (!ball) return;

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    ball.addEventListener("pointerdown", e => {
        isDragging = true;
        offsetX = e.clientX - ball.offsetLeft;
        offsetY = e.clientY - ball.offsetTop;
        ball.style.transition = "none";
    });

    window.addEventListener("pointermove", e => {
        if (!isDragging) return;

        ball.style.left = `${e.clientX - offsetX}px`;
        ball.style.top = `${e.clientY - offsetY}px`;
        ball.style.right = "auto";
        ball.style.bottom = "auto";
    });

    window.addEventListener("pointerup", () => {
        if (!isDragging) return;

        isDragging = false;
        ball.style.transition = ".2s";

        const screenWidth = window.innerWidth;
        const ballRect = ball.getBoundingClientRect();

        if (ballRect.left < screenWidth / 2) {
            ball.style.left = "0px";
            ball.style.right = "auto";
            ball.style.borderRadius = "0 18px 18px 0";
        } else {
            ball.style.left = "auto";
            ball.style.right = "0px";
            ball.style.borderRadius = "18px 0 0 18px";
        }
    });
}

function initLiveChatSystem() {
    const input = document.getElementById("liveChatInput");
    const sendBtn = document.getElementById("sendLiveChatBtn");

    if (!input || !sendBtn) return;

    loadLiveChatHistory();

    sendBtn.addEventListener("click", sendLiveChatToAdmin);

    input.addEventListener("keypress", e => {
        if (e.key === "Enter") {
            sendLiveChatToAdmin();
        }
    });

    setInterval(loadLiveChatHistory, 5000);
}

async function sendLiveChatToAdmin() {
    const input = document.getElementById("liveChatInput");

    if (!input) return;

    const message = input.value.trim();

    if (!message) return;

    addChatMessage("user", message);
    input.value = "";

    try {
        const res = await fetch("/api/live-chat/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username:
                    localStorage.getItem("username") ||
                    localStorage.getItem("userName") ||
                    "Guest",
                message
            })
        });

        const data = await res.json();

        if (!data.success) {
            alert(data.message || "Live chat send failed");
            return;
        }

        addChatMessage(
            "bot",
            "✅ Message sent to admin. Please wait for reply."
        );

    } catch (error) {
        console.error("Live chat send error:", error);
        alert("Server connection error");
    }
}

function addChatMessage(type, text) {
    const body = document.getElementById("liveChatBody");
    if (!body) return;

    const msg = document.createElement("div");
    msg.className = `chat-message ${type}`;

    msg.innerHTML = `
        ${text}
        <small>
            ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    })}
        </small>
    `;

    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
}
function initLiveChatSystem() {
    const input = document.getElementById("liveChatInput");
    const sendBtn = document.getElementById("sendLiveChatBtn");

    if (!input || !sendBtn) return;

    loadLiveChatHistory();

    sendBtn.addEventListener("click", sendLiveChatToAdmin);

    input.addEventListener("keypress", e => {
        if (e.key === "Enter") {
            sendLiveChatToAdmin();
        }
    });

    setInterval(loadLiveChatHistory, 5000);
} async function loadLiveChatHistory() {
    const username =
        localStorage.getItem("username") ||
        localStorage.getItem("userName") ||
        "Guest";

    try {
        const res = await fetch(`/api/live-chat/user/${username}`);
        const data = await res.json();

        if (!data.success || !data.chat) return;

        const body = document.getElementById("liveChatBody");
        if (!body) return;

        body.innerHTML = "";

        data.chat.messages.forEach(msg => {
            addChatMessage(
                msg.sender === "admin" ? "bot" : "user",
                msg.text
            );
        });

    } catch (error) {
        console.log("Load live chat history error:", error);
    }
}
document.addEventListener("click", e => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) return;

    const url = new URL(href, window.location.href);

    if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = url.pathname + url.search + url.hash;
    }
});