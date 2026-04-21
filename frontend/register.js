document.addEventListener("DOMContentLoaded", () => {
    const registerBtn = document.getElementById("registerBtn");
    const regUser = document.getElementById("regUser");
    const regPass = document.getElementById("regPass");
    const registerMsg = document.getElementById("registerMsg");

    registerBtn.addEventListener("click", async () => {
        const username = regUser.value.trim();
        const password = regPass.value.trim();

        registerMsg.innerText = "";

        if (!username) {
            registerMsg.innerText = "❌ Enter username!";
            return;
        }

        if (!password) {
            registerMsg.innerText = "❌ Enter password!";
            return;
        }

        try {
            const res = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (data.success) {
                registerMsg.innerText = "✅ Register success!";
                setTimeout(() => {
                    window.location.href = "login.html";
                }, 1000);
            } else {
                registerMsg.innerText = "❌ " + data.message;
            }
        } catch (err) {
            registerMsg.innerText = "❌ Server error!";
            console.log(err);
        }
    });
});