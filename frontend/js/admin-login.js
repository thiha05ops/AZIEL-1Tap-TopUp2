document
    .getElementById("adminLoginForm")
    ?.addEventListener("submit", adminLogin);

async function adminLogin(e) {

    e.preventDefault();

    const username =
        document.getElementById("adminUsername").value;

    const password =
        document.getElementById("adminPassword").value;

    const btn =
        document.getElementById("adminLoginBtn");

    btn.disabled = true;
    btn.innerText = "Logging in...";

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

            btn.disabled = false;
            btn.innerText = "Login";

            return;
        }

        // SAVE TOKEN
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

        btn.disabled = false;
        btn.innerText = "Login";

    }
}