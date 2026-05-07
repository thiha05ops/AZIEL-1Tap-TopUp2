const form = document.getElementById("registerForm");

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {

        const res = await fetch("/api/register", {
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
            alert(data.message || "Register failed");
            return;
        }

        alert("Register success ✅");

        window.location.href = "login.html";

    } catch (err) {
        console.log(err);
        alert("Server error");
    }
});