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

        if (!data.success) {
            chatList.innerHTML = `<p class="empty">Failed to load chats</p>`;
            return;
        }

        chats = data.chats || [];
        renderChatList();
    } catch (error) {
        console.error("Load chats error:", error);
        chatList.innerHTML = `<p class="empty">Server connection error</p>`;
    }
}

function renderChatList() {
    if (chats.length === 0) {
        chatList.innerHTML = `<p class="empty">No active live chats</p>`;
        return;
    }

    chatList.innerHTML = "";

    chats.forEach((chat) => {
        const lastMsg = chat.messages[chat.messages.length - 1];

        const card = document.createElement("div");
        card.className =
            "chat-user-card " +
            (activeChat && activeChat.chatId === chat.chatId ? "active" : "");

        card.innerHTML = `
      <h3>${chat.username}</h3>
      <p>${lastMsg ? lastMsg.text : "No message"}</p>
      <span class="chat-time">
        ${formatTime(chat.lastMessageAt)}
      </span>
    `;

        card.addEventListener("click", () => {
            activeChat = chat;
            renderChatList();
            renderMessages(chat);
        });

        chatList.appendChild(card);
    });
}

function renderMessages(chat) {
    selectedUsername.textContent = chat.username;
    selectedChatId.textContent = chat.chatId;

    replyInput.disabled = false;
    sendReplyBtn.disabled = false;
    deleteChatBtn.disabled = false;

    messagesBox.innerHTML = "";

    chat.messages.forEach((msg) => {
        const div = document.createElement("div");
        div.className = `message ${msg.sender}`;

        div.innerHTML = `
      ${msg.text}
      <small>${msg.sender} • ${formatTime(msg.createdAt)}</small>
    `;

        messagesBox.appendChild(div);
    });

    messagesBox.scrollTop = messagesBox.scrollHeight;
}

replyForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!activeChat) return;

    const message = replyInput.value.trim();

    if (!message) return;

    try {
        const res = await fetch(
            `/api/live-chat/admin/reply/${activeChat.chatId}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ message })
            }
        );

        const data = await res.json();

        if (!data.success) {
            alert("Reply failed");
            return;
        }

        replyInput.value = "";
        activeChat = data.chat;

        await loadChats();
        renderMessages(activeChat);
    } catch (error) {
        console.error("Reply error:", error);
        alert("Server error");
    }
});

deleteChatBtn.addEventListener("click", async () => {
    if (!activeChat) return;

    const ok = confirm(`Delete chat with ${activeChat.username}?`);

    if (!ok) return;

    try {
        const res = await fetch(
            `/api/live-chat/admin/delete/${activeChat.chatId}`,
            {
                method: "DELETE"
            }
        );

        const data = await res.json();

        if (!data.success) {
            alert("Delete failed");
            return;
        }

        activeChat = null;
        selectedUsername.textContent = "Select a user";
        selectedChatId.textContent = "No chat selected";
        messagesBox.innerHTML =
            `<p class="empty">Choose a user chat from the left side.</p>`;

        replyInput.value = "";
        replyInput.disabled = true;
        sendReplyBtn.disabled = true;
        deleteChatBtn.disabled = true;

        await loadChats();
    } catch (error) {
        console.error("Delete error:", error);
        alert("Server error");
    }
});

refreshBtn.addEventListener("click", loadChats);

function formatTime(date) {
    if (!date) return "";

    return new Date(date).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric"
    });
}

// auto refresh every 5 seconds
setInterval(loadChats, 5000);

loadChats();