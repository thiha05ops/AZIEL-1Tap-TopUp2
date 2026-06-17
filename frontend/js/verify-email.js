// frontend/js/verify-email.js

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("verifyEmailForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("verifyEmailBtn");
    const otpInput = document.getElementById("otp");
    const emailText = document.getElementById("verifyEmailText");

    const email = localStorage.getItem("verifyEmail");

    if (!email) {
        window.location.href = "register.html";
        return;
    }

    emailText.textContent = `Code sent to ${email}`;

    otpInput.addEventListener("input", () => {
        otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const otp = otpInput.value.trim();

        if (otp.length !== 6) {
            showMessage("Please enter 6-digit OTP.", "error");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("http://localhost:3000/api/verify-email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email,
                    otp
                })
            });

            const data = await res.json();

            if (!data.success) {
                showMessage(data.message || "Email verification failed.", "error");
                setLoading(false);
                return;
            }

            localStorage.removeItem("verifyEmail");

            showMessage("Account created ✅ Redirecting to login...", "success");

            setTimeout(() => {
                window.location.href = "login.html";
            }, 900);

        } catch (error) {
            console.log("Verify email error:", error);
            showMessage("Server error. Please try again.", "error");
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        btn.disabled = isLoading;
        btn.textContent = isLoading
            ? "Verifying..."
            : "Verify & Create Account";
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