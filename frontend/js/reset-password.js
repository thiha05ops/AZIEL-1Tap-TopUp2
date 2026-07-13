// frontend/js/reset-password.js

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("resetPasswordForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("resetPasswordBtn");

    const newPasswordInput = document.getElementById("newPassword");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const togglePassword = document.getElementById("togglePassword");

    const email = localStorage.getItem("resetEmail");
    const verified = localStorage.getItem("resetOTPVerified");
    const username = localStorage.getItem("resetUsername");
    const usernameInfo = document.getElementById("usernameInfo");

    if (username && usernameInfo) {
        usernameInfo.innerHTML =
            `Username: <strong>${username}</strong>`;
    }

    if (!email || verified !== "true") {
        window.location.href = "forgot-password.html";
        return;
    }

    togglePassword?.addEventListener("click", () => {
        const icon = togglePassword.querySelector("i");
        const isPassword = newPasswordInput.type === "password";

        newPasswordInput.type = isPassword ? "text" : "password";
        confirmPasswordInput.type = isPassword ? "text" : "password";

        icon.className = isPassword
            ? "fa-regular fa-eye-slash"
            : "fa-regular fa-eye";
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const newPassword = newPasswordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();

        if (!newPassword || !confirmPassword) {
            showMessage("Please fill all password fields.", "error");
            return;
        }

        if (newPassword.length < 8) {
            showMessage("Password must be at least 8 characters.", "error");
            return;
        }

        if (newPassword !== confirmPassword) {
            showMessage("Passwords do not match.", "error");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/password/reset", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email,
                    newPassword
                })
            });

            const data = await res.json();

            if (!data.success) {
                showMessage(data.message || "Password reset failed.", "error");
                setLoading(false);
                return;
            }

            localStorage.removeItem("resetEmail");
            localStorage.removeItem("resetOTPVerified");
            localStorage.removeItem("resetUsername");

            showMessage("Password updated ✅ Redirecting to login...", "success");

            setTimeout(() => {
                window.location.href = "login.html";
            }, 900);

        } catch (error) {
            console.log("Reset password error:", error);
            showMessage("Server error. Please try again.", "error");
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Updating..." : "Update Password";
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
