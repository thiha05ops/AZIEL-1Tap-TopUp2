// frontend/js/login.js

const API_BASE =
    location.port === "5500"
        ? "http://localhost:3000"
        : "";

function apiUrl(path) {
    return `${API_BASE}${path}`;
}

document.addEventListener("DOMContentLoaded", () => {
    const token =
        localStorage.getItem("token") ||
        sessionStorage.getItem("token");

    if (token) {
        localStorage.removeItem("token");
        localStorage.removeItem("isLogin");
        sessionStorage.removeItem("token");
    }

    const form = document.getElementById("loginForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("loginBtn");

    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const togglePassword = document.getElementById("togglePassword");
    const rememberMe = document.getElementById("rememberMe");

    setTimeout(() => {
        if (usernameInput) usernameInput.value = "";
        if (passwordInput) passwordInput.value = "";
    }, 200);

    if (!form || !msg || !btn || !usernameInput || !passwordInput) {
        console.log("Login form elements missing");
        return;
    }

    if (togglePassword) {
        togglePassword.addEventListener("click", (e) => {
            e.preventDefault();

            const icon = togglePassword.querySelector("i");

            if (passwordInput.type === "password") {
                passwordInput.type = "text";
                if (icon) icon.className = "fa-regular fa-eye";
            } else {
                passwordInput.type = "password";
                if (icon) icon.className = "fa-regular fa-eye-slash";
            }
        });
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            showMessage("Please enter username/email and password.", "error");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch(apiUrl("/api/login"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    password
                })
            });

            const data = await res.json();

            if (!data.success) {
                showMessage(data.message || "Login failed", "error");
                setLoading(false);
                return;
            }

            localStorage.removeItem("token");
            localStorage.removeItem("username");
            sessionStorage.removeItem("token");
            sessionStorage.removeItem("username");

            localStorage.setItem("isLogin", "true");
            localStorage.setItem("displayName", data.user.displayName || data.user.username);
            localStorage.setItem("region", data.user.region || "MM");
            localStorage.setItem("email", data.user.email || "");
            localStorage.setItem("role", data.user.role || "user");

            if (rememberMe && rememberMe.checked) {
                localStorage.setItem("token", data.token);
                localStorage.setItem("username", data.user.username);
            } else {
                sessionStorage.setItem("token", data.token);
                sessionStorage.setItem("username", data.user.username);
            }

            showMessage("Login success ✅ Redirecting...", "success");

            const redirectUrl =
                localStorage.getItem("redirectAfterLogin") || "home.html";

            localStorage.removeItem("redirectAfterLogin");

            setTimeout(() => {
                window.location.href = redirectUrl;
            }, 500);

        } catch (error) {
            console.log("Login error:", error);
            showMessage("Server error. Please try again.", "error");
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Signing in..." : "Sign In";
    }

    function showMessage(text, type) {
        msg.innerHTML = `
            <div class="${type === "success" ? "success-msg" : "error-msg"}">
                ${escapeHTML(text)}
            </div>
        `;
    }

    function escapeHTML(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }
});