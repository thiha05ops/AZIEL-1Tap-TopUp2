document.addEventListener("DOMContentLoaded", () => {
    const forgotUser = document.getElementById("forgotUser");
    const forgotBtn = document.getElementById("forgotBtn");
    const forgotMsg = document.getElementById("forgotMsg");

    forgotBtn.addEventListener("click", async () => {
        forgotMsg.innerText = "";

        const username = forgotUser.value.trim();
        if (!username) {
            forgotMsg.innerText = "❌ Enter username or email";
            return;
        }

        try {
            const res = await fetch("/api/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username }),
            });

            const data = await res.json();
            forgotMsg.innerText = data.success ? "✅ " + data.message : "❌ " + data.message;
        } catch (error) {
            forgotMsg.innerText = "❌ Server error";
        }
    });
});