// frontend/js/login.js

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("loginBtn");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value.trim();

        if (!username || !password) {
            msg.innerHTML = `<div class="error-msg">Please enter username and password.</div>`;
            return;
        }

        btn.disabled = true;
        btn.innerText = "Signing in...";

        try {
            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (!data.success) {
                msg.innerHTML = `<div class="error-msg">${data.message || "Login failed"}</div>`;
                btn.disabled = false;
                btn.innerText = "SIGN IN";
                return;
            }

            localStorage.setItem("isLogin", "true");
            localStorage.setItem("token", data.token || "");
            localStorage.setItem("username", data.user.username);
            localStorage.setItem("displayName", data.user.displayName || data.user.username);
            localStorage.setItem("region", data.user.region || "MM");

            window.location.href = "home.html";

        } catch (error) {
            console.log("Login error:", error);
            msg.innerHTML = `<div class="error-msg">Server error.</div>`;
            btn.disabled = false;
            btn.innerText = "SIGN IN";
        }
    });
});