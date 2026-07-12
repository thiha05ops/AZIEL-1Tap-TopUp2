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

async function adminLogin(e) {
    e.preventDefault();

    const username = document.getElementById("adminUsername")?.value.trim();
    const password = document.getElementById("adminPassword")?.value;
    const btn = document.getElementById("adminLoginBtn");

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
            btn.innerText = "LOGIN";
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
