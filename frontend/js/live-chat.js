document.addEventListener("DOMContentLoaded", () => {
    createLiveChatUI();
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
}
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const chatMessages = document.getElementById("chatMessages");

sendChatBtn.addEventListener("click", sendLiveChat);

chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        sendLiveChat();
    }
});

async function sendLiveChat() {
    const username =
        localStorage.getItem("username") ||
        localStorage.getItem("userName") ||
        "Guest";

    const message = chatInput.value.trim();

    if (!message) return;

    try {
        const res = await fetch("/api/live-chat/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username,
                message
            })
        });

        const data = await res.json();

        if (data.success) {
            appendMessage("You", message);
            chatInput.value = "";
        } else {
            alert(data.message || "Send failed");
        }
    } catch (error) {
        console.error("Live chat send error:", error);
        alert("Server connection error");
    }
}

function appendMessage(sender, text) {
    if (!chatMessages) return;

    const div = document.createElement("div");
    div.className = "chat-message";

    div.innerHTML = `
        <strong>${sender}:</strong>
        <span>${text}</span>
    `;

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}