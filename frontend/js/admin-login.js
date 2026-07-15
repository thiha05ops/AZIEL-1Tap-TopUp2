// frontend/js/admin-login.js

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("adminLoginForm");
    const resetBtn = document.getElementById("resetAdminSessionBtn");

    form?.addEventListener("submit", adminLogin);

    resetBtn?.addEventListener("click", () => {
        localStorage.removeItem("adminToken");
        localStorage.removeItem("adminUsername");
        localStorage.removeItem("adminRole");
        showAdminLoginMessage("Admin session reset.", "success");
    });
});

let adminLoginChallengeId = "";

async function adminLogin(e) {
    e.preventDefault();

    const username = document.getElementById("adminUsername")?.value.trim();
    const password = document.getElementById("adminPassword")?.value;
    const code = document.getElementById("adminTwoFactorCode")?.value.trim();
    const btn = document.getElementById("adminLoginBtn");

    if (adminLoginChallengeId) {
        if (!/^\d{6}$/.test(code || "")) {
            showAdminLoginMessage("Enter a valid 6-digit code", "error");
            return;
        }
        return verifyAdminLogin2FA(code, btn);
    }

    if (!username || !password) {
        showAdminLoginMessage("Fill all fields", "error");
        return;
    }

    if (window.AZIEL_UI?.button) {
        window.AZIEL_UI.button.setLoading(btn, { text: "Logging in..." });
    } else {
        btn.disabled = true;
        btn.innerText = "Logging in...";
    }

    try {
        const res = await fetch("/api/admin/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            showAdminLoginMessage(data.message || "Login failed", "error");
            return;
        }

        if (data.twoFactorRequired && data.challengeId) {
            adminLoginChallengeId = data.challengeId;
            document.getElementById("adminUsername").disabled = true;
            document.getElementById("adminPassword").disabled = true;
            document.getElementById("adminTwoFactorCode").hidden = false;
            document.getElementById("adminTwoFactorCode").focus();
            btn.textContent = "Verify";
            showAdminLoginMessage("Two-factor authentication required", "info");
            return;
        }

        localStorage.setItem("adminToken", data.token);
        window.location.href = "/admin.html";

    } catch (error) {
        console.log("Admin login error:", error);
        showAdminLoginMessage("Server error", "error");
    } finally {
        if (window.AZIEL_UI?.button) {
            window.AZIEL_UI.button.reset(btn);
        } else {
            btn.disabled = false;
            btn.innerText = "Continue to Console";
        }
    }
}

async function verifyAdminLogin2FA(code, btn) {
    if (window.AZIEL_UI?.button) {
        window.AZIEL_UI.button.setLoading(btn, { text: "Verifying..." });
    } else {
        btn.disabled = true;
        btn.innerText = "Verifying...";
    }

    try {
        const res = await fetch("/api/admin/login/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId: adminLoginChallengeId, code })
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            showAdminLoginMessage(data.message || "Invalid verification code", "error");
            return;
        }

        localStorage.setItem("adminToken", data.token);
        window.location.href = "/admin.html";
    } catch (error) {
        console.log("Admin 2FA login error:", error);
        showAdminLoginMessage("Server error", "error");
    } finally {
        if (window.AZIEL_UI?.button) {
            window.AZIEL_UI.button.reset(btn);
        } else {
            btn.disabled = false;
            btn.innerText = "Verify";
        }
    }
}

function showAdminLoginMessage(message, type = "info") {
    const msg = document.getElementById("adminMsg");
    if (msg) {
        msg.textContent = message;
    }

    const method = type === "success"
        ? "success"
        : type === "error"
            ? "error"
            : "info";

    window.AZIEL_UI?.toast?.[method]?.(message);
}
