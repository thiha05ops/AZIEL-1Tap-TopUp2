document.addEventListener("DOMContentLoaded", () => {
    const loginBtn = document.getElementById("loginBtn");
    const loginUser = document.getElementById("loginUser");
    const loginPass = document.getElementById("loginPass");
    const loginError = document.getElementById("loginError");

    loginBtn.addEventListener("click", async () => {
        const username = loginUser.value.trim();
        const password = loginPass.value.trim();

        loginError.innerText = "";

        if (!username) {
            loginError.innerText = "❌ Please enter username!";
            return;
        }

        if (!password) {
            loginError.innerText = "❌ Please enter password!";
            return;
        }

        try {
            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (data.success) {
                localStorage.setItem("isLoggedIn", "true");
                localStorage.setItem("username", data.username || username);
                window.location.href = "home.html";
            } else {
                loginError.innerText = "❌ " + data.message;
            }
        } catch (err) {
            loginError.innerText = "❌ Server error!";
            console.log(err);
        }
    });
});
document.addEventListener("DOMContentLoaded", () => {
    const loginBtn = document.getElementById("loginBtn");
    const loginUser = document.getElementById("loginUser");
    const loginPass = document.getElementById("loginPass");
    const loginError = document.getElementById("loginError");

    loginBtn.addEventListener("click", async () => {
        const username = loginUser.value.trim();
        const password = loginPass.value.trim();

        loginError.innerText = "";

        if (!username) {
            loginError.innerText = "❌ Please enter username!";
            return;
        }

        if (!password) {
            loginError.innerText = "❌ Please enter password!";
            return;
        }

        try {
            const res = await fetch("/api/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (data.success) {
                localStorage.setItem("isLoggedIn", "true");
                localStorage.setItem("username", data.username);
                localStorage.setItem("token", data.token);
                window.location.href = "home.html";
            } else {
                loginError.innerText = "❌ " + data.message;
            }
        } catch (error) {
            console.error(error);
            loginError.innerText = "❌ Server error!";
        }
    });
});