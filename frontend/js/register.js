// frontend/js/register.js

document.addEventListener("DOMContentLoaded", () => {
    const t = (key, fallback) => window.AZIEL_LOCALE?.t?.(key, fallback) || fallback;
    const form = document.getElementById("registerForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("registerBtn");

    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const togglePassword = document.getElementById("togglePassword");

    if (!form || !btn || !msg) {
        console.log("Register form elements missing");
        return;
    }

    togglePassword?.addEventListener("click", (e) => {
        e.preventDefault();

        const icon = togglePassword.querySelector("i");
        const isHidden = passwordInput.type === "password";

        passwordInput.type = isHidden ? "text" : "password";
        confirmPasswordInput.type = isHidden ? "text" : "password";

        if (icon) {
            icon.className = isHidden
                ? "fa-regular fa-eye"
                : "fa-regular fa-eye-slash";
        }
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const username = document.getElementById("username").value.trim().toLowerCase();
        const email = document.getElementById("email").value.trim().toLowerCase();
        const password = passwordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();

        if (!username || !email || !password || !confirmPassword) {
            showMessage(t("validation.requiredFields", "Please fill all required fields."), "error");
            return;
        }

        if (!isValidGmail(email)) {
            showMessage(t("validation.validGmail", "Please enter a valid Gmail address."), "error");
            return;
        }

        if (password.length < 8) {
            showMessage(t("validation.passwordEight", "Password must be at least 8 characters."), "error");
            return;
        }

        if (password !== confirmPassword) {
            showMessage(t("validation.passwordMismatch", "Passwords do not match."), "error");
            return;
        }

        setLoading(true);

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
                showMessage(data.message || t("auth.register.failed", "Register failed"), "error");
                setLoading(false);
                return;
            }

            localStorage.setItem("verifyEmail", email);

            showMessage(t("auth.otp.sentCheckGmail", "OTP sent. Check your Gmail."), "success");

            setTimeout(() => {
                window.location.href = "verify-email.html";
            }, 800);

        } catch (error) {
            console.log("Register error:", error);
            showMessage(t("common.serverErrorTryAgain", "Server error. Try again."), "error");
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        if (window.AZIEL_UI?.button) {
            if (isLoading) {
                window.AZIEL_UI.button.setLoading(btn, { text: t("auth.otp.sending", "Sending OTP...") });
            } else {
                window.AZIEL_UI.button.reset(btn);
            }
            return;
        }

        btn.disabled = isLoading;
        btn.textContent = isLoading ? t("auth.otp.sending", "Sending OTP...") : t("auth.createAccount", "Create Account");
    }

    function isValidGmail(email) {
        return /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email);
    }

    function showMessage(text, type) {
        const feedback = document.createElement("div");
        feedback.className = type === "success" ? "success-msg" : "error-msg";
        feedback.textContent = text;
        msg.replaceChildren(feedback);

        if (window.AZIEL_UI?.toast) {
            window.AZIEL_UI.toast[type === "success" ? "success" : "error"](text);
        }
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
