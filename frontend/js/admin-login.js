// frontend/js/admin-login.js

document.addEventListener("DOMContentLoaded", () => {

    const form =
        document.getElementById("adminLoginForm");

    if (!form) {
        console.log("Admin login form not found");
        return;
    }

    form.addEventListener("submit", adminLogin);

});

async function adminLogin(e) {

    e.preventDefault();

    const username =
        document.getElementById("adminUsername")?.value;

    const password =
        document.getElementById("adminPassword")?.value;

    const btn =
        document.getElementById("adminLoginBtn");

    if (!username || !password) {
        alert("Fill all fields");
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerText = "Logging in...";
    }

    try {

        const res = await fetch("/api/admin/login", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                username,
                password
            })

        });

        const data = await res.json();

        console.log("ADMIN LOGIN:", data);

        if (!data.success) {

            alert(data.message || "Login failed");

            if (btn) {
                btn.disabled = false;
                btn.innerText = "Login";
            }

            return;
        }

        localStorage.setItem(
            "adminToken",
            data.token
        );

        alert("Admin login success ✅");

        window.location.href =
            "admin.html";

    } catch (error) {

        console.log(
            "Admin login error:",
            error
        );

        alert("Server error");

    } finally {

        if (btn) {
            btn.disabled = false;
            btn.innerText = "Login";
        }

    }
}