// frontend/js/admin-login.js

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("adminLoginForm");
    const resetBtn = document.getElementById("resetAdminSessionBtn");

    form?.addEventListener("submit", adminLogin);

    resetBtn?.addEventListener("click", () => {
        localStorage.removeItem("adminToken");
        localStorage.removeItem("adminUsername");
        localStorage.removeItem("adminRole");
        alert("Admin session reset ✅");
    });
});

async function adminLogin(e) {
    e.preventDefault();

    const username = document.getElementById("adminUsername")?.value.trim();
    const password = document.getElementById("adminPassword")?.value;
    const btn = document.getElementById("adminLoginBtn");

    if (!username || !password) {
        alert("Fill all fields");
        return;
    }

    btn.disabled = true;
    btn.innerText = "Logging in...";

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
            alert(data.message || "Login failed");
            return;
        }

        localStorage.setItem("adminToken", data.token);
        window.location.href = "/admin.html";

    } catch (error) {
        console.log("Admin login error:", error);
        alert("Server error");
    } finally {
        btn.disabled = false;
        btn.innerText = "LOGIN";
    }
}