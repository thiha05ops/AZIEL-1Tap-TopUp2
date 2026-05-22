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

    return icons[type] || "🎧";
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

    initLiveChatMessages();
    initLiveChatSend();

});

// ======================================
// CREATE CHAT UI
// ======================================

function createLiveChatUI() {

    // CHAT BALL
    const ball = document.createElement("div");

    ball.className = "chat-ball";

    ball.innerHTML = `
        <i class="fa-solid fa-comments"></i>

        <div class="chat-badge">1</div>

        <div class="online-dot"></div>
    `;

    document.body.appendChild(ball);

    // CHAT PANEL
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

                    <small id="supportStatusText">
                        Support Online
                    </small>
                </div>

            </div>

            <button class="chat-close-btn">
                ✕
            </button>

        </div>

        <div class="chat-body" id="liveChatBody">

        </div>

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

    // TOGGLE
    ball.addEventListener("click", () => {

        panel.classList.toggle("open");

        ball.classList.remove("has-unread");

    });

    panel
        .querySelector(".chat-close-btn")
        ?.addEventListener("click", () => {

            panel.classList.remove("open");

        });

}

// ======================================
// DRAGGABLE CHAT BALL
// ======================================

function initLiveChatBall() {

    const ball =
        document.querySelector(".chat-ball");

    if (!ball) return;

    let isDragging = false;

    let offsetX = 0;
    let offsetY = 0;

    ball.addEventListener("pointerdown", (e) => {

        isDragging = true;

        offsetX =
            e.clientX - ball.offsetLeft;

        offsetY =
            e.clientY - ball.offsetTop;

        ball.style.transition = "none";

    });

    window.addEventListener("pointermove", (e) => {

        if (!isDragging) return;

        ball.style.left =
            `${e.clientX - offsetX}px`;

        ball.style.top =
            `${e.clientY - offsetY}px`;

        ball.style.right = "auto";
        ball.style.bottom = "auto";

    });

    window.addEventListener("pointerup", () => {

        isDragging = false;

        ball.style.transition = ".2s";

    });

}
function initLiveChatSend() {
    const input = document.getElementById("liveChatInput");
    const sendBtn = document.getElementById("sendLiveChatBtn");
    const body = document.getElementById("liveChatBody");

    if (!input || !sendBtn || !body) return;

    async function sendMessage() {
        const message = input.value.trim();

        if (!message) return;

        // user message UI
        const userMsg = document.createElement("div");
        userMsg.className = "chat-msg user";
        userMsg.innerHTML = `
            <p>${message}</p>
            <small>${new Date().toLocaleTimeString()}</small>
        `;
        body.appendChild(userMsg);
        body.scrollTop = body.scrollHeight;

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
            }

        } catch (error) {
            console.error("Chat ball send error:", error);
            alert("Server connection error");
        }
    }

    sendBtn.addEventListener("click", sendMessage);

    input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            sendMessage();
        }
    });
}

// ======================================
// CHAT SYSTEM
// ======================================

function initLiveChatMessages() {

    const input =
        document.getElementById("liveChatInput");

    const sendBtn =
        document.getElementById("sendLiveChatBtn");

    if (!input || !sendBtn) return;

    sendBtn.addEventListener("click", sendLiveMessage);

    input.addEventListener("keypress", (e) => {

        if (e.key === "Enter") {

            sendLiveMessage();

        }

    });

    // FIRST BOT MESSAGE
    setTimeout(() => {

        addChatMessage(
            "bot",
            "Hello 👋 Welcome to AZIEL Support. How can we help you today?"
        );

    }, 700);

}

// ======================================
// SEND MESSAGE
// ======================================

function sendLiveMessage() {

    const input =
        document.getElementById("liveChatInput");

    if (!input) return;

    const text =
        input.value.trim();

    if (!text) return;

    addChatMessage("user", text);

    input.value = "";

    autoReplyBot(text);

}

// ======================================
// ADD CHAT MESSAGE
// ======================================

function addChatMessage(type, text) {

    const body =
        document.getElementById("liveChatBody");

    if (!body) return;

    const msg =
        document.createElement("div");

    msg.className =
        `chat-message ${type}`;

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

    body.scrollTop =
        body.scrollHeight;

    // UNREAD BADGE
    const panel =
        document.querySelector(".live-chat-panel");

    const ball =
        document.querySelector(".chat-ball");

    if (
        panel &&
        !panel.classList.contains("open")
    ) {

        ball?.classList.add(
            "has-unread"
        );

    }

}

// ======================================
// AUTO REPLY BOT
// ======================================

function autoReplyBot(message) {

    const typing =
        document.getElementById("chatTyping");

    typing?.classList.add("show");

    setTimeout(() => {

        typing?.classList.remove("show");

        const text =
            message.toLowerCase();

        let reply =
            "Thank you for contacting AZIEL Support. Our admin team will reply soon.";

        if (
            text.includes("payment") ||
            text.includes("paid")
        ) {

            reply =
                "If your payment is pending, please send payment screenshot and order ID.";

        } else if (
            text.includes("wallet")
        ) {

            reply =
                "Wallet topup usually takes 1 - 5 minutes after admin approval.";

        } else if (
            text.includes("order")
        ) {

            reply =
                "Please provide your order ID so we can check your order.";

        } else if (
            text.includes("refund")
        ) {

            reply =
                "Refund requests are reviewed manually by our support team.";

        } else if (
            text.includes("hello") ||
            text.includes("hi")
        ) {

            reply =
                "Hello 👋 Welcome to AZIEL Live Support.";

        }

        addChatMessage(
            "bot",
            reply
        );

    }, 1400);

}