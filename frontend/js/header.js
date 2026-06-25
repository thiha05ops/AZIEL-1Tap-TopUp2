// frontend/js/header.js - AZIEL V2.5 Global Header Data

document.addEventListener("DOMContentLoaded", () => {
    loadHeaderUserData();
});

function getHeaderToken() {
    return (
        localStorage.getItem("token") ||
        sessionStorage.getItem("token")
    );
}

async function loadHeaderUserData() {
    const token = getHeaderToken();

    const walletText = document.getElementById("headerWalletText");
    const avatarText = document.getElementById("avatarText");
    const localeFlag = document.getElementById("localeFlag");
    const profileBox = document.getElementById("profileBox");

    if (!token) {
        if (walletText) walletText.innerText = "0 Ks";
        if (avatarText) avatarText.innerText = "G";
        if (profileBox) profileBox.href = "login.html";
        return;
    }

    try {
        const res = await fetch("/api/profile/me", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await res.json();

        if (!data.success || !data.user) {
            return;
        }

        const user = data.user;

        const name =
            user.displayName ||
            user.username ||
            "User";

        const region =
            localStorage.getItem("region") ||
            localStorage.getItem("selectedRegion") ||
            user.region ||
            "MM";

        const currency = region === "TH" ? "THB" : "MMK";
        const symbol = currency === "THB" ? "฿" : "Ks";

        if (avatarText) {
            avatarText.innerText =
                name.charAt(0).toUpperCase();
        }

        if (localeFlag) {
            localeFlag.innerText =
                region === "TH" ? "🇹🇭" : "🇲🇲";
        }

        localStorage.setItem("username", user.username || "");
        localStorage.setItem("displayName", name);

        await loadHeaderWallet(user.username, currency, symbol);

    } catch (error) {
        console.log("Header user load error:", error);
    }
}

async function loadHeaderWallet(username, currency, symbol) {
    const walletText = document.getElementById("headerWalletText");

    if (!walletText || !username) return;

    try {
        const res = await fetch(
            `/api/wallet/${encodeURIComponent(username)}?currency=${currency}`
        );

        const data = await res.json();

        const balance = data.success
            ? Number(data.balance || 0)
            : 0;

        walletText.innerText =
            `${balance.toLocaleString()} ${symbol}`;

    } catch (error) {
        console.log("Header wallet load error:", error);
        walletText.innerText = `0 ${symbol}`;
    }
}