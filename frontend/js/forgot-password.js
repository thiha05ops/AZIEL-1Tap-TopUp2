// frontend/js/forgot-password.js

document.addEventListener("DOMContentLoaded", () => {
    const t = (key, fallback) => window.AZIEL_LOCALE?.t?.(key, fallback) || fallback;
    const form = document.getElementById("forgotForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("sendOtpBtn");
    const emailInput = document.getElementById("email");

    if (!form || !msg || !btn || !emailInput) {
        console.log("Forgot password form elements missing");
        return;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = emailInput.value.trim().toLowerCase();

        if (!isValidGmail(email)) {
            showMessage(t("validation.validGmail", "Please enter a valid Gmail address."), "error");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/password/send-otp", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email })
            });

            const data = await res.json();

            if (!data.success) {
                showMessage(safeEmailMessage(data.message || t("auth.otp.sendFailed", "Failed to send OTP.")), "error");
                setLoading(false);
                return;
            }

            localStorage.setItem("resetEmail", email);

            showMessage(t("auth.otp.sentRedirecting", "OTP sent. Redirecting..."), "success");

            setTimeout(() => {
                window.location.href = "verify-otp.html";
            }, 800);

        } catch (error) {
            console.log("Send OTP error:", error);
            showMessage(t("common.serverErrorRetry", "Server error. Please try again."), "error");
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        btn.disabled = isLoading;
        btn.textContent = isLoading ? t("auth.otp.sending", "Sending OTP...") : t("auth.otp.send", "Send OTP");
    }

    function isValidGmail(email) {
        return /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email);
    }

    function showMessage(text, type) {
        const feedback = document.createElement("div");
        feedback.className = type === "success" ? "success-msg" : "error-msg";
        feedback.textContent = text;
        msg.replaceChildren(feedback);
    }

    function escapeHTML(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function safeEmailMessage(message) {
        const text = String(message || "");
        if (/ENETUNREACH|ECONN|ETIMEDOUT|smtp|465|587|::|stack|nodemailer/i.test(text)) {
            return t("auth.email.temporarilyUnavailable", "Email service is temporarily unavailable. Please try again shortly.");
        }
        return text;
    }
});
