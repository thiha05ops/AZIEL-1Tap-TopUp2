// frontend/js/logout.js

document.addEventListener("DOMContentLoaded", () => {

    const logoutBtn = document.getElementById("logoutBtn");

    if (logoutBtn) {

        logoutBtn.addEventListener("click", () => {

            const ok = confirm("Are you sure to logout?");

            if (ok) {

                localStorage.removeItem("isLogin");
                localStorage.removeItem("username");

                window.location.href = "login.html";
            }

        });

    }

});