// frontend/js/admin-login.js

document.addEventListener(
    "DOMContentLoaded",
    () => {

        const form =
            document.getElementById(
                "adminLoginForm"
            );

        const msg =
            document.getElementById(
                "adminMsg"
            );

        form?.addEventListener(
            "submit",
            async (e) => {

                e.preventDefault();

                const username =
                    document.getElementById(
                        "adminUsername"
                    ).value.trim();

                const password =
                    document.getElementById(
                        "adminPassword"
                    ).value.trim();

                try {

                    const res =
                        await fetch(
                            "/api/admin/login",
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body: JSON.stringify({
                                    username,
                                    password
                                })
                            }
                        );

                    const data =
                        await res.json();

                    if (!data.success) {

                        msg.innerText =
                            data.message ||
                            "Login failed";

                        return;
                    }

                    // SAVE ADMIN TOKEN
                    localStorage.setItem(
                        "adminToken",
                        data.token
                    );

                    msg.innerText =
                        "✅ Login success";

                    window.location.href =
                        "admin.html";

                } catch (error) {

                    console.log(error);

                    msg.innerText =
                        "❌ Server error";
                }

            }
        );

    }
);
function resetAdminSession() {
    localStorage.removeItem("adminToken");

    alert("Admin session cleared");

    location.reload();
}