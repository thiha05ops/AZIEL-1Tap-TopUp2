// frontend/js/register.js

document.addEventListener("DOMContentLoaded", () => {

    const registerBtn = document.getElementById("registerBtn");
    const username = document.getElementById("username");
    const email = document.getElementById("email");
    const password = document.getElementById("password");
    const confirmPassword = document.getElementById("confirmPassword");
    const msg = document.getElementById("msg");

    registerBtn.addEventListener("click", async () => {

        const user = username.value.trim();
        const mail = email.value.trim();
        const pass = password.value.trim();
        const confirm = confirmPassword.value.trim();

        if (!user || !mail || !pass || !confirm) {
            msg.innerHTML = `<div class="error-msg">Please fill all fields.</div>`;
            return;
        }

        if (pass.length < 6) {
            msg.innerHTML = `<div class="error-msg">Password must be at least 6 characters.</div>`;
            return;
        }

        if (pass !== confirm) {
            msg.innerHTML = `<div class="error-msg">Passwords do not match.</div>`;
            return;
        }

        registerBtn.disabled = true;
        registerBtn.innerText = "Creating...";

        try {
            const res = await fetch("/api/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: user,
                    email: mail,
                    password: pass
                })
            });

            const data = await res.json();

            if (data.success) {
                msg.innerHTML = `<div class="success-msg">Account created ✅ Redirecting...</div>`;

                setTimeout(() => {
                    window.location.href = "login.html";
                }, 1000);
            } else {
                msg.innerHTML = `<div class="error-msg">${data.message}</div>`;
                registerBtn.disabled = false;
                registerBtn.innerText = "CREATE ACCOUNT";
            }

        } catch (error) {
            msg.innerHTML = `<div class="error-msg">Server error.</div>`;
            registerBtn.disabled = false;
            registerBtn.innerText = "CREATE ACCOUNT";
        }

    });

});