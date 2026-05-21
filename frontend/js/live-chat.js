const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");

sendChatBtn.addEventListener("click", sendLiveChat);

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
            chatInput.value = "";
            alert("Message sent to admin ✅");
        } else {
            alert(data.message || "Send failed");
        }
    } catch (error) {
        console.error("Live chat send error:", error);
        alert("Server connection error");
    }
}