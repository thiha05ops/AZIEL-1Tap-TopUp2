document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");
    const helpLoginBtn = document.getElementById("helpLoginBtn");

    if (token && username && helpLoginBtn) {
        helpLoginBtn.innerText = username;
        helpLoginBtn.href = "account.html";
    }
});