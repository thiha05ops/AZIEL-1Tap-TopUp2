document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");

    const accountName = document.getElementById("accountName");
    const accountUsername = document.getElementById("accountUsername");
    const accountAvatar = document.getElementById("accountAvatar");
    const accountRegion = document.getElementById("accountRegion");
    const telegramName = document.getElementById("telegramName");
    const phoneNumber = document.getElementById("phoneNumber");
    const saveProfileBtn = document.getElementById("saveProfileBtn");
    const goHistoryBtn = document.getElementById("goHistoryBtn");
    const logoutAccountBtn = document.getElementById("logoutAccountBtn");
    const accountMsg = document.getElementById("accountMsg");

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const savedRegion = localStorage.getItem("region") || "MM";
    const savedTelegram = localStorage.getItem("telegramName") || "";
    const savedPhone = localStorage.getItem("phoneNumber") || "";

    if (accountName) accountName.innerText = username || "User";
    if (accountUsername) accountUsername.innerText = username || "-";
    if (accountAvatar) accountAvatar.innerText = (username || "U").charAt(0).toUpperCase();

    accountRegion.value = savedRegion;
    telegramName.value = savedTelegram;
    phoneNumber.value = savedPhone;

    saveProfileBtn?.addEventListener("click", () => {
        localStorage.setItem("region", accountRegion.value);
        localStorage.setItem("telegramName", telegramName.value.trim());
        localStorage.setItem("phoneNumber", phoneNumber.value.trim());

        accountMsg.innerText = "✅ Profile saved!";
    });

    goHistoryBtn?.addEventListener("click", () => {
        window.location.href = "history.html";
    });

    logoutAccountBtn?.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        localStorage.removeItem("isLoggedIn");

        window.location.href = "login.html";
    });
});