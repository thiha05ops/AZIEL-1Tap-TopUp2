document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem("token");
    const username = localStorage.getItem("username");

    const accountName = document.getElementById("accountName");
    const accountUsername = document.getElementById("accountUsername");
    const accountAvatar = document.getElementById("accountAvatar");
    const profilePreview = document.getElementById("profilePreview");

    const displayName = document.getElementById("displayName");
    const accountRegion = document.getElementById("accountRegion");
    const telegramName = document.getElementById("telegramName");
    const phoneNumber = document.getElementById("phoneNumber");
    const mlbbUserId = document.getElementById("mlbbUserId");
    const mlbbServerId = document.getElementById("mlbbServerId");
    const profilePhoto = document.getElementById("profilePhoto");

    const saveProfileBtn = document.getElementById("saveProfileBtn");
    const goHistoryBtn = document.getElementById("goHistoryBtn");
    const logoutAccountBtn = document.getElementById("logoutAccountBtn");
    const accountMsg = document.getElementById("accountMsg");

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    async function loadProfile() {
        try {
            const res = await fetch("/api/profile/me", {
                headers: {
                    Authorization: "Bearer " + token
                }
            });

            const data = await res.json();

            if (!data.success) {
                accountMsg.innerText = "❌ Failed to load profile";
                return;
            }

            const user = data.user;

            accountUsername.innerText = user.username || "-";
            accountName.innerText = user.displayName || user.username || "User";
            accountAvatar.innerText = (user.displayName || user.username || "U").charAt(0).toUpperCase();

            displayName.value = user.displayName || "";
            accountRegion.value = user.region || "MM";
            telegramName.value = user.telegram || "";
            phoneNumber.value = user.phone || "";
            mlbbUserId.value = user.mlbbUserId || "";
            mlbbServerId.value = user.mlbbServerId || "";

            localStorage.setItem("region", user.region || "MM");

            if (user.photo) {
                profilePreview.src = user.photo;
                profilePreview.style.display = "block";
                accountAvatar.style.display = "none";
            } else {
                profilePreview.style.display = "none";
                accountAvatar.style.display = "flex";
            }

        } catch (error) {
            console.log(error);
            accountMsg.innerText = "❌ Server error";
        }
    }

    await loadProfile();

    saveProfileBtn?.addEventListener("click", async () => {
        try {
            const formData = new FormData();
            formData.append("displayName", displayName.value.trim());
            formData.append("region", accountRegion.value);
            formData.append("telegram", telegramName.value.trim());
            formData.append("phone", phoneNumber.value.trim());
            formData.append("mlbbUserId", mlbbUserId.value.trim());
            formData.append("mlbbServerId", mlbbServerId.value.trim());

            if (profilePhoto.files[0]) {
                formData.append("photo", profilePhoto.files[0]);
            }

            const res = await fetch("/api/profile/me", {
                method: "PUT",
                headers: {
                    Authorization: "Bearer " + token
                },
                body: formData
            });

            const data = await res.json();

            if (data.success) {
                localStorage.setItem("region", data.user.region || "MM");
                localStorage.setItem("username", data.user.username || username);
                accountMsg.innerText = "✅ Profile saved!";
                await loadProfile();
            } else {
                accountMsg.innerText = "❌ " + data.message;
            }

        } catch (error) {
            console.log(error);
            accountMsg.innerText = "❌ Server error";
        }
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
