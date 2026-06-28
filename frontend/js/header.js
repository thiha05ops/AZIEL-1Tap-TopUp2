// frontend/js/header.js - AZIEL V2.5 Global Header Renderer

document.addEventListener("DOMContentLoaded", () => {
    renderHeader();

    window.addEventListener("aziel:ready", renderHeader);
    window.addEventListener("aziel:userChanged", renderHeader);
    window.addEventListener("aziel:walletChanged", renderHeader);

    window.addEventListener("aziel:regionChanged", async () => {
        renderHeader();

        if (window.AZIEL?.loadWallet) {
            await window.AZIEL.loadWallet();
        }

        renderHeader();
    });
});

function renderHeader() {
    const walletText = document.getElementById("headerWalletText");
    const avatarText = document.getElementById("avatarText");
    const localeFlag = document.getElementById("localeFlag");
    const profileBox = document.getElementById("profileBox");

    const region = window.AZIEL?.getRegion?.() || "MM";
    const symbol = window.AZIEL?.getSymbol?.() || (region === "TH" ? "฿" : "Ks");

    const user = window.AZIEL?.user || null;
    const wallet = window.AZIEL?.wallet || null;

    if (localeFlag) {
        localeFlag.innerText = region === "TH" ? "🇹🇭" : "🇲🇲";
    }

    if (!user) {
        if (walletText) walletText.innerText = `0 ${symbol}`;
        if (avatarText) avatarText.innerText = "G";
        if (profileBox) profileBox.href = "login.html";
        return;
    }

    const name =
        window.AZIEL?.getDisplayName?.(user) ||
        user.displayName ||
        user.username ||
        "User";

    if (avatarText) {
        avatarText.innerText = name.charAt(0).toUpperCase();
    }

    if (profileBox) {
        profileBox.href = "account.html";
    }

    const balance = Number(wallet?.balance || 0);

    if (walletText) {
        walletText.innerText = `${balance.toLocaleString()} ${symbol}`;
    }
}