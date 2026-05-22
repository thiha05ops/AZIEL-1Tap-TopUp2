const chatList = document.getElementById("chatList");
const messagesBox = document.getElementById("messagesBox");
const selectedUsername = document.getElementById("selectedUsername");
const selectedChatId = document.getElementById("selectedChatId");
const replyForm = document.getElementById("replyForm");
const replyInput = document.getElementById("replyInput");
const sendReplyBtn = document.getElementById("sendReplyBtn");
const deleteChatBtn = document.getElementById("deleteChatBtn");
const refreshBtn = document.getElementById("refreshBtn");

let chats = [];
let activeChat = null;

async function loadChats() {
    try {
        const res = await fetch("/api/live-chat/admin");
        const data = await res.json();

        console.log("ADMIN CHATS:", data);

        if (!data.success) {
            chatList.innerHTML = `<p class="empty">Failed to load chats</p>`;
            return;
        }

        chats = (data.chats || []).filter(chat => chat.status !== "deleted");
        renderChatList();
    } catch (error) {
        console.error("Load chats error:", error);
        chatList.innerHTML = `<p class="empty">Server connection error</p>`;
    }
}

function renderChatList() {
    if (!chats.length) {
        chatList.innerHTML = `<p class="empty">No active live chats</p>`;
        return;
    }

    chatList.innerHTML = "";

    chats.forEach(chat => {
        const lastMsg = chat.messages && chat.messages.length
            ? chat.messages[chat.messages.length - 1]
            : null;

        const card = document.createElement("div");
        card.className = "chat-user-card";

        card.innerHTML = `
      <h3>${chat.username || "Guest"}</h3>
      <p>${lastMsg ? lastMsg.text : "No message"}</p>
      <span class="chat-time">${formatTime(chat.lastMessageAt)}</span>
    `;

        card.addEventListener("click", () => {
            activeChat = chat;
            renderMessages(chat);
        });

        chatList.appendChild(card);
    });
}

function renderMessages(chat) {
    selectedUsername.textContent = chat.username || "Guest";
    selectedChatId.textContent = chat.chatId || "No chat ID";

    replyInput.disabled = false;
    sendReplyBtn.disabled = false;
    deleteChatBtn.disabled = false;

    messagesBox.innerHTML = "";

    (chat.messages || []).forEach(msg => {
        const div = document.createElement("div");
        div.className = `message ${msg.sender || "user"}`;

        div.innerHTML = `
      ${msg.text || ""}
      <small>${msg.sender || "user"} • ${formatTime(msg.createdAt)}</small>
    `;

        messagesBox.appendChild(div);
    });

    messagesBox.scrollTop = messagesBox.scrollHeight;
}

replyForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (!activeChat) return;

    const message = replyInput.value.trim();
    if (!message) return;

    const res = await fetch(`/api/live-chat/admin/reply/${activeChat.chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
    });

    const data = await res.json();

    if (data.success) {
        replyInput.value = "";
        activeChat = data.chat;
        renderMessages(activeChat);
        loadChats();
    }
});

deleteChatBtn.addEventListener("click", async () => {
    if (!activeChat) return;

    await fetch(`/api/live-chat/admin/delete/${activeChat.chatId}`, {
        method: "DELETE"
    });

    activeChat = null;
    selectedUsername.textContent = "Select a user";
    selectedChatId.textContent = "No chat selected";
    messagesBox.innerHTML = `<p class="empty">Choose a user chat from the left side.</p>`;

    replyInput.disabled = true;
    sendReplyBtn.disabled = true;
    deleteChatBtn.disabled = true;

    loadChats();
});

refreshBtn.addEventListener("click", loadChats);

function formatTime(date) {
    if (!date) return "";
    return new Date(date).toLocaleString();
}

loadChats();
setInterval(loadChats, 5000);