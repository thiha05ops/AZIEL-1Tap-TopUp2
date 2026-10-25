// frontend/js/verify-email.js

document.addEventListener("DOMContentLoaded", () => {
    let verificationPending = false;
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
    const form = document.getElementById("verifyEmailForm");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("verifyEmailBtn");
    const otpInput = document.getElementById("otp");
    const emailText = document.getElementById("verifyEmailText");

    const email = localStorage.getItem("verifyEmail");

    if (!email) {
        window.location.href = "/register";
        return;
    }

    emailText.textContent = email;

    otpInput.addEventListener("input", () => {
        otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (verificationPending) return;

        const otp = otpInput.value.trim();

        if (otp.length !== 6) {
            showMessage(t("auth.otp.validation", "Enter the 6-digit verification code."), "error");
            otpInput.focus();
            return;
        }

        verificationPending = true;
        setLoading(true);
        const loadingToken = window.AZIEL_LOADING?.start("email-verification");

        try {
            const res = await fetch("/api/verify-email", {
                method: "POST",
                credentials: "include",
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
                const fallback = data.code === "REGISTRATION_SESSION_FAILED"
                    ? t("errors.REGISTRATION_SESSION_FAILED", "Your account was created, but automatic sign-in failed. Please sign in.")
                    : t("auth.otp.failed", "Email verification could not be completed.");
                showMessage(
                    data.code
                        ? window.AZIEL_LOCALE?.translateError?.(data.code, fallback)
                        : fallback,
                    "error"
                );

                if (data.code === "REGISTRATION_SESSION_FAILED") {
                    localStorage.removeItem("verifyEmail");
                    setTimeout(() => {
                        window.location.href = "/login";
                    }, 1400);
                    return;
                }

                verificationPending = false;
                setLoading(false);
                return;
            }

            localStorage.removeItem("verifyEmail");
            window.AZIEL_AUTH_STATE.persistCustomer(data.user);

            showMessage(t("auth.otp.success", "Email verified! Redirecting..."), "success");

            const redirectUrl = window.AZIEL_AUTH_STATE.resolvePostLoginRedirect();

            setTimeout(() => {
                window.location.href = redirectUrl;
            }, 900);

        } catch (error) {
            console.log("Verify email error:", error);
            showMessage(t("common.serverErrorRetry", "Server error. Please try again."), "error");
            verificationPending = false;
            setLoading(false);
        } finally {
            window.AZIEL_LOADING?.finish(loadingToken);
        }
    });

    function setLoading(isLoading) {
        btn.disabled = isLoading;
        btn.setAttribute("aria-busy", String(isLoading));
        btn.textContent = isLoading
            ? t("auth.verifying", "Verifying...")
            : t("auth.otp.verify", "Verify");
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
