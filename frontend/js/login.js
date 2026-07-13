// frontend/js/login.js

function apiUrl(path) {
    return path;
}

document.addEventListener("DOMContentLoaded", () => {
    let pendingTwoFactorChallengeId = "";

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
    const googleLoginBtn = document.getElementById("googleLoginBtn");
    const twoFactorBox = document.createElement("div");
    twoFactorBox.className = "auth-2fa-box";
    twoFactorBox.hidden = true;
    twoFactorBox.innerHTML = `
        <label class="auth-label" for="twoFactorCode">Authenticator or recovery code</label>
        <input id="twoFactorCode" type="text" inputmode="numeric" autocomplete="one-time-code"
            placeholder="Enter 6-digit code or recovery code">
    `;
    msg?.before(twoFactorBox);

    if (googleLoginBtn) {
        googleLoginBtn.addEventListener("click", (e) => {
            e.preventDefault();
            window.location.href = apiUrl("/api/auth/google");
        });
    }

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
        const twoFactorCode = document.getElementById("twoFactorCode")?.value.trim() || "";

        if (pendingTwoFactorChallengeId) {
            if (!twoFactorCode) {
                showMessage("Please enter your authenticator or recovery code.", "error");
                return;
            }

            await verifyTwoFactorLogin(twoFactorCode);
            return;
        }

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
                    password,
                    deviceContext: getLoginDeviceContext()
                })
            });

            const data = await res.json();

            if (!data.success) {
                showMessage(data.message || "Login failed", "error");
                setLoading(false);
                return;
            }

            if (data.twoFactorRequired && data.challengeId) {
                pendingTwoFactorChallengeId = data.challengeId;
                twoFactorBox.hidden = false;
                passwordInput.value = "";
                btn.textContent = "Verify Code";
                showMessage(data.message || "Two-factor verification required.", "success");
                setLoading(false);
                document.getElementById("twoFactorCode")?.focus();
                return;
            }

            completeLogin(data);

        } catch (error) {
            console.log("Login error:", error);
            showMessage("Server error. Please try again.", "error");
            setLoading(false);
        }
    });

    async function verifyTwoFactorLogin(twoFactorCode) {
        setLoading(true);

        try {
            const recoveryMode = /[A-Za-z0-9]{8}-[A-Za-z0-9]{8}/.test(twoFactorCode);
            const res = await fetch(apiUrl("/api/auth/2fa/verify"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    challengeId: pendingTwoFactorChallengeId,
                    deviceContext: getLoginDeviceContext(),
                    ...(recoveryMode ? { recoveryCode: twoFactorCode } : { code: twoFactorCode })
                })
            });
            const data = await res.json();

            if (!data.success) {
                showMessage(data.message || "Two-factor verification failed", "error");
                setLoading(false);
                return;
            }

            pendingTwoFactorChallengeId = "";
            completeLogin(data);
        } catch (error) {
            console.log("2FA login error:", error);
            showMessage("Server error. Please try again.", "error");
            setLoading(false);
        }
    }

    function completeLogin(data) {
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

        showMessage("Login success. Redirecting...", "success");

        const redirectUrl =
            localStorage.getItem("redirectAfterLogin") || "home.html";

        localStorage.removeItem("redirectAfterLogin");

        setTimeout(() => {
            window.location.href = redirectUrl;
        }, 500);
    }

    function setLoading(isLoading) {
        if (window.AZIEL_UI?.button) {
            if (isLoading) {
                window.AZIEL_UI.button.setLoading(btn, { text: pendingTwoFactorChallengeId ? "Verifying..." : "Signing in..." });
            } else {
                window.AZIEL_UI.button.reset(btn);
                btn.textContent = pendingTwoFactorChallengeId ? "Verify Code" : "Sign In";
            }
            return;
        }

        btn.disabled = isLoading;
        btn.textContent = isLoading
            ? (pendingTwoFactorChallengeId ? "Verifying..." : "Signing in...")
            : (pendingTwoFactorChallengeId ? "Verify Code" : "Sign In");
    }

    function showMessage(text, type) {
        msg.innerHTML = `
            <div class="${type === "success" ? "success-msg" : "error-msg"}">
                ${escapeHTML(text)}
            </div>
        `;

        if (window.AZIEL_UI?.toast) {
            window.AZIEL_UI.toast[type === "success" ? "success" : "error"](text);
        }
    }

    function getLoginDeviceContext() {
        const userAgentData = navigator.userAgentData;

        return {
            userAgent: navigator.userAgent || "",
            platform: navigator.platform || "",
            userAgentData: userAgentData
                ? {
                    mobile: Boolean(userAgentData.mobile),
                    platform: userAgentData.platform || "",
                    brands: Array.isArray(userAgentData.brands)
                        ? userAgentData.brands.map((brand) => ({
                            brand: brand.brand || "",
                            version: brand.version || ""
                        }))
                        : []
                }
                : null
        };
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
