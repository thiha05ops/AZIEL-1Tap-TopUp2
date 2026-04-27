// frontend/js/login.js

document.addEventListener("DOMContentLoaded", () => {

    const loginBtn = document.getElementById("loginBtn");
    const username = document.getElementById("username");
    const password = document.getElementById("password");
    const msg = document.getElementById("msg");

    loginBtn.addEventListener("click", async () => {

        const user = username.value.trim();
        const pass = password.value.trim();

        if (user === "" || pass === "") {
            msg.innerHTML = `<div class="error-msg">Please fill all fields.</div>`;
            return;
        }

        try {

            const res = await fetch("/api/login", {
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

                msg.innerHTML = `<div class="success-msg">Login success...</div>`;

                localStorage.setItem("isLogin", "true");
                localStorage.setItem("username", user);

                setTimeout(() => {
                    window.location.href = "home.html";
                }, 800);

            } else {
                msg.innerHTML = `<div class="error-msg">${data.message}</div>`;
            }

        } catch (error) {

            msg.innerHTML = `<div class="error-msg">Server error.</div>`;

        }

    });

});