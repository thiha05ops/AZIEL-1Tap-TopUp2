// frontend/js/register.js

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("registerForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("registerBtn");

    if (!form || !btn || !msg) {
        console.log("Register form elements missing");
        return;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const username = document.getElementById("username").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value.trim();
        const confirmPassword = document.getElementById("confirmPassword").value.trim();

        if (!username || !password || !confirmPassword) {
            msg.innerHTML = `<div class="error-msg">Please fill all required fields.</div>`;
            return;
        }

        if (password.length < 6) {
            msg.innerHTML = `<div class="error-msg">Password must be at least 6 characters.</div>`;
            return;
        }

        if (password !== confirmPassword) {
            msg.innerHTML = `<div class="error-msg">Passwords do not match.</div>`;
            return;
        }

        btn.disabled = true;
        btn.innerText = "Creating...";

        try {
            const res = await fetch("/api/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    email,
                    password
                })
            });

            const data = await res.json();

            if (!data.success) {
                msg.innerHTML = `<div class="error-msg">${data.message || "Register failed"}</div>`;
                btn.disabled = false;
                btn.innerText = "CREATE ACCOUNT";
                return;
            }

            msg.innerHTML = `<div class="success-msg">Account created ✅ Redirecting...</div>`;

            setTimeout(() => {
                window.location.href = "login.html";
            }, 1000);

        } catch (error) {
            console.log("Register error:", error);
            msg.innerHTML = `<div class="error-msg">Server error. Try again.</div>`;
            btn.disabled = false;
            btn.innerText = "CREATE ACCOUNT";
        }
    });
});
