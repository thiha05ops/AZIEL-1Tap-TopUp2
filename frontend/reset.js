document.addEventListener("DOMContentLoaded", () => {
    const newPass = document.getElementById("newPass");
    const resetBtn = document.getElementById("resetBtn");
    const resetMsg = document.getElementById("resetMsg");

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    resetBtn.addEventListener("click", async () => {
        const password = newPass.value.trim();

        if (!password || password.length < 6) {
            resetMsg.innerText = "❌ Password must be at least 6 characters";
            return;
        }

        try {
            const res = await fetch("/api/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
            });

            const data = await res.json();

            if (data.success) {
                resetMsg.innerText = "✅ Password changed. Go to login.";
            } else {
                resetMsg.innerText = "❌ " + data.message;
            }
        } catch (error) {
            resetMsg.innerText = "❌ Server error";
        }
    });
});