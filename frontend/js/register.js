// frontend/js/register.js

document.addEventListener("DOMContentLoaded", () => {

    const registerBtn = document.getElementById("registerBtn");
    const username = document.getElementById("username");
    const password = document.getElementById("password");
    const confirmPassword = document.getElementById("confirmPassword");
    const msg = document.getElementById("msg");

    registerBtn.addEventListener("click", async () => {

        const user = username.value.trim();
        const pass = password.value.trim();
        const confirm = confirmPassword.value.trim();

        if (user === "" || pass === "" || confirm === "") {
            msg.innerHTML = `<div class="error-msg">Please fill all fields.</div>`;
            return;
        }

        if (pass.length < 4) {
            msg.innerHTML = `<div class="error-msg">Password must be at least 4 characters.</div>`;
            return;
        }

        if (pass !== confirm) {
            msg.innerHTML = `<div class="error-msg">Passwords do not match.</div>`;
            return;
        }

        try {

            const res = await fetch("/api/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: user,
                    password: pass
                })
            });
            const data = await res.json();

            if (data.success) {

                msg.innerHTML = `<div class="success-msg">Register success. Redirecting...</div>`;

                setTimeout(() => {
                    window.location.href = "login.html";
                }, 1000);

            } else {
                msg.innerHTML = `<div class="error-msg">${data.message}</div>`;
            }

        } catch (error) {

            msg.innerHTML = `<div class="error-msg">Server error.</div>`;

        }

    });

});