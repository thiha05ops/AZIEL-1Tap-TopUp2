const form = document.getElementById("loginForm");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {

        const res = await fetch("/api/login", {
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

        if (!data.success) {
            alert(data.message || "Login failed");
            return;
        }

        // ✅ SAVE LOGIN
        localStorage.setItem("isLogin", "true");
        localStorage.setItem("username", data.user.username);
        localStorage.setItem("token", data.token);

        // optional profile
        localStorage.setItem(
            "displayName",
            data.user.displayName || data.user.username
        );

        // redirect
        window.location.href = "home.html";

    } catch (err) {
        console.log(err);
        alert("Server error");
    }
});