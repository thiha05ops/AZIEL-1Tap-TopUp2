// frontend/js/verify-otp.js

document.addEventListener("DOMContentLoaded", () => {
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
    const form = document.getElementById("verifyOtpForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("verifyOtpBtn");
    const otpInput = document.getElementById("otp");
    const emailText = document.getElementById("otpEmailText");

    const email = localStorage.getItem("resetEmail");

    if (!email) {
        window.location.href = "forgot-password.html";
        return;
    }

    emailText.textContent = t("auth.otp.codeSentTo", "Code sent to {email}", { email });

    otpInput.addEventListener("input", () => {
        otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const otp = otpInput.value.trim();

        if (otp.length !== 6) {
            showMessage(t("auth.otp.sixDigitsRequired", "Please enter 6-digit OTP."), "error");
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/password/verify-otp", {
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
                showMessage(data.message || t("auth.otp.invalid", "Invalid OTP."), "error");
                setLoading(false);
                return;
            }

            localStorage.setItem("resetOTPVerified", "true");

            if (data.username) {
                localStorage.setItem("resetUsername", data.username);

                const usernameBox = document.getElementById("usernameBox");
                const usernameText = document.getElementById("usernameText");

                if (usernameBox && usernameText) {
                    usernameText.textContent = data.username;
                    usernameBox.style.display = "block";
                }

                showMessage(
                    t("auth.otp.verifiedUsername", "OTP verified. Username: {username}", { username: data.username }),
                    "success"
                );

            } else {

                showMessage(
                    t("auth.otp.verified", "OTP verified."),
                    "success"
                );
            }

            setTimeout(() => {
                window.location.href = "reset-password.html";
            }, 1500);

            setTimeout(() => {
                window.location.href = "reset-password.html";
            }, 700);

        } catch (error) {
            console.log("Verify OTP error:", error);
            showMessage(t("common.serverErrorRetry", "Server error. Please try again."), "error");
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        btn.disabled = isLoading;
        btn.textContent = isLoading ? t("auth.verifying", "Verifying...") : t("auth.otp.verify", "Verify OTP");
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
});
