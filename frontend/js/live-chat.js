// frontend/js/live-chat.js
// AZIEL Assistant V2.5 - Live Chat

console.log("AZIEL ASSISTANT V2 LOADED");

const API_BASE =
    location.port === "5500"
        ? "http://localhost:3000"
        : "";

function apiUrl(path) {
    return `${API_BASE}${path}`;
}

function getLiveChatAuthHeaders(extra = {}) {
    return window.AZIEL?.authHeaders?.(extra) || extra;
}

const AZIEL_CHAT = {
    username:
        localStorage.getItem("username") ||
        localStorage.getItem("userName") ||
        localStorage.getItem("azielUsername") ||
        "Guest",
    polling: null,
    lastMessageCount: 0,
    isOpen: false
};

document.addEventListener("DOMContentLoaded", () => {
    createLiveChatUI();
    initLiveChatSystem();
});

function createLiveChatUI() {
    if (document.querySelector(".aziel-support-tab")) return;

    const ball = document.createElement("button");
    ball.className = "aziel-support-tab";
    ball.type = "button";
    ball.innerHTML = `
        <i class="fa-solid fa-headset"></i>
        <span>Live Chat</span>
        <b id="chatBadge"></b>
    `;

    const panel = document.createElement("div");
    panel.className = "live-chat-panel";
    panel.innerHTML = `
        <div class="chat-header">
            <div class="chat-agent">
                <div class="chat-agent-icon">AI</div>
                <div>
                    <strong>AZIEL Assistant</strong>
                    <small><span class="mini-online"></span> Online support</small>
                </div>
            </div>
            <button class="chat-close-btn" type="button">✕</button>
        </div>

        <div class="chat-body" id="liveChatBody"></div>

        <div class="typing-indicator" id="typingIndicator">
            AZIEL is typing<span>.</span><span>.</span><span>.</span>
        </div>

        <div class="chat-input-row">
            <input id="liveChatInput" type="text" placeholder="Type your message..." autocomplete="off">
            <button id="sendLiveChatBtn" type="button">➤</button>
        </div>
    `;

    document.body.appendChild(ball);
    document.body.appendChild(panel);

    ball.addEventListener("click", async () => {
        AZIEL_CHAT.isOpen = !panel.classList.contains("open");
        panel.classList.toggle("open");

        if (panel.classList.contains("open")) {
            await loadLiveChatHistory();
            await markUserRead();
            updateBadge(0);
            document.getElementById("liveChatInput")?.focus();
        }
    });

    panel.querySelector(".chat-close-btn")?.addEventListener("click", () => {
        AZIEL_CHAT.isOpen = false;
        panel.classList.remove("open");
    });
}

function initLiveChatSystem() {
    if (!window.AZIEL?.getToken?.()) {
        addChatMessage(
            "bot",
            "Please login to use live chat support.",
            false
        );
        return;
    }

    addChatMessage(
        "bot",
        "Hello 👋 Welcome to AZIEL Assistant. How can we help you today?",
        false
    );

    loadLiveChatHistory();
    loadUnreadCount();
    initLiveChatRealtimeAssist();

    document
        .getElementById("sendLiveChatBtn")
        ?.addEventListener("click", sendLiveChatMessage);

    document
        .getElementById("liveChatInput")
        ?.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                sendLiveChatMessage();
            }
        });

    if (AZIEL_CHAT.polling) {
        clearInterval(AZIEL_CHAT.polling);
    }

    AZIEL_CHAT.polling = setInterval(() => {
        loadLiveChatHistory();
        loadUnreadCount();
    }, 5000);
}

function initLiveChatRealtimeAssist() {
    if (!window.AZIEL?.realtime || window.__azielLiveChatRealtimeStarted) return;

    window.__azielLiveChatRealtimeStarted = true;

    window.AZIEL.realtime.on("adminLiveReply", async () => {
        await loadLiveChatHistory();
        await loadUnreadCount();
    });
}

async function sendLiveChatMessage() {
    const input = document.getElementById("liveChatInput");
    const sendBtn = document.getElementById("sendLiveChatBtn");
    if (!input) return;

    const message = input.value.trim();
    if (!message) return;

    input.value = "";
    addChatMessage("user", message, true);
    showTyping(true);
    window.AZIEL_UI?.button?.setLoading(sendBtn, { text: "..." });

    try {
        const res = await fetch(apiUrl("/api/live-chat/send"), {
            method: "POST",
            headers: getLiveChatAuthHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify({
                username: AZIEL_CHAT.username,
                message
            })
        });

        const data = await res.json();

        showTyping(false);

        if (!data.success) {
            addChatMessage("bot", data.message || "Send failed.", true);
            window.AZIEL_UI?.toast?.error(data.message || "Send failed.");
            return;
        }

        setTimeout(() => {
            addChatMessage(
                "bot",
                "✅ Message sent to admin. Please wait for reply.",
                true
            );
        }, 300);

        AZIEL_CHAT.lastMessageCount = data.chat?.messages?.length || AZIEL_CHAT.lastMessageCount;
    } catch (error) {
        showTyping(false);
        console.error("Live chat send error:", error);
        addChatMessage("bot", "Server connection error. Please try again.", true);
        window.AZIEL_UI?.toast?.error("Server connection error. Please try again.");
    } finally {
        window.AZIEL_UI?.button?.reset(sendBtn);
    }
}

async function loadLiveChatHistory() {
    try {
        const res = await fetch(
            apiUrl(`/api/live-chat/user/${encodeURIComponent(AZIEL_CHAT.username)}`),
            {
                headers: getLiveChatAuthHeaders()
            }
        );

        const data = await res.json();

        if (!data.success || !data.chat) return;

        const messages = data.chat.messages || [];

        if (messages.length === AZIEL_CHAT.lastMessageCount) return;

        const body = document.getElementById("liveChatBody");
        if (!body) return;

        body.innerHTML = "";

        messages.forEach(msg => {
            addChatMessage(
                msg.sender === "admin" ? "bot" : msg.sender,
                msg.text,
                false,
                msg.createdAt
            );
        });

        AZIEL_CHAT.lastMessageCount = messages.length;

        if (AZIEL_CHAT.isOpen) {
            await markUserRead();
            updateBadge(0);
        }
    } catch (error) {
        console.log("Load chat history error:", error);
    }
}

async function loadUnreadCount() {
    try {
        const res = await fetch(
            apiUrl(`/api/live-chat/user/${encodeURIComponent(AZIEL_CHAT.username)}/unread`),
            {
                headers: getLiveChatAuthHeaders()
            }
        );

        const data = await res.json();

        if (data.success) {
            updateBadge(AZIEL_CHAT.isOpen ? 0 : data.unread);
        }
    } catch (error) {
        console.log("Unread count error:", error);
    }
}

async function markUserRead() {
    try {
        await fetch(
            apiUrl(`/api/live-chat/user/${encodeURIComponent(AZIEL_CHAT.username)}/read`),
            {
                method: "PUT",
                headers: getLiveChatAuthHeaders()
            }
        );
    } catch (error) {
        console.log("Mark read error:", error);
    }
}

function addChatMessage(type, text, saveScroll = true, createdAt = null) {
    const body = document.getElementById("liveChatBody");
    if (!body) return;

    const msg = document.createElement("div");
    msg.className = `chat-message ${type}`;

    const safeText = escapeHTML(text);
    const time = createdAt ? new Date(createdAt) : new Date();

    msg.innerHTML = `
        <div>${safeText}</div>
        <small>${time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    })}</small>
    `;

    body.appendChild(msg);

    if (saveScroll) {
        body.scrollTop = body.scrollHeight;
    } else {
        requestAnimationFrame(() => {
            body.scrollTop = body.scrollHeight;
        });
    }
}

function updateBadge(count) {
    const badge = document.getElementById("chatBadge");
    if (!badge) return;

    const number = Number(count || 0);

    badge.textContent = number > 99 ? "99+" : number;
    badge.style.display = number > 0 ? "flex" : "none";
}

function showTyping(show) {
    const typing = document.getElementById("typingIndicator");
    if (!typing) return;

    typing.classList.toggle("show", Boolean(show));
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
