console.log("LIVE CHAT LOADED");

document.addEventListener("DOMContentLoaded", () => {
    createLiveChatUI();
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
                <div class="chat-agent-icon">💬</div>
                <div>
                    <strong>AZIEL Support</strong>
                    <small>Online</small>
                </div>
            </div>
            <button class="chat-close-btn">✕</button>
        </div>

        <div class="chat-body" id="liveChatBody"></div>

        <div class="chat-input-row">
            <input id="liveChatInput" type="text" placeholder="Type your message...">
            <button id="sendLiveChatBtn">➤</button>
        </div>
    `;

    document.body.appendChild(panel);

    ball.addEventListener("click", () => {
        panel.classList.toggle("open");
    });

    panel.querySelector(".chat-close-btn").addEventListener("click", () => {
        panel.classList.remove("open");
    });
}

function initLiveChatSystem() {
    addChatMessage("bot", "Hello 👋 Welcome to AZIEL Support. How can we help you today?");
    loadLiveChatHistory();

    const input = document.getElementById("liveChatInput");
    const sendBtn = document.getElementById("sendLiveChatBtn");

    sendBtn.addEventListener("click", sendLiveChatMessage);

    input.addEventListener("keypress", e => {
        if (e.key === "Enter") {
            sendLiveChatMessage();
        }
    });

    setInterval(loadLiveChatHistory, 5000);
}

async function sendLiveChatMessage() {
    const input = document.getElementById("liveChatInput");
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
            alert(data.message || "Send failed");
            return;
        }

        addChatMessage("bot", "✅ Message sent to admin. Please wait for reply.");

    } catch (error) {
        console.error("Live chat send error:", error);
        alert("Server connection error");
    }
}

async function loadLiveChatHistory() {
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
        console.log("Load chat history error:", error);
    }
}

function addChatMessage(type, text) {
    const body = document.getElementById("liveChatBody");
    if (!body) return;

    const msg = document.createElement("div");
    msg.className = `chat-message ${type}`;

    msg.innerHTML = `
        ${text}
        <small>${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    })}</small>
    `;

    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
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