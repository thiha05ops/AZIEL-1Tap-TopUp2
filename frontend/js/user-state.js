// frontend/js/user-state.js - AZIEL V2.5 Production Global State
// Shop Region = price/payment preference only
// User Data = backend truth

window.AZIEL = window.AZIEL || {};

AZIEL.user = null;
AZIEL.wallet = null;

// ============================
// TOKEN
// ============================

AZIEL.getToken = function () {
    return localStorage.getItem("token") || sessionStorage.getItem("token");
};

// ============================
// SHOP REGION / CURRENCY
// ============================
// This is for prices, wallet topup, payment methods only.
// Do NOT use this to rewrite old orders / tracking / notifications.

AZIEL.getShopRegion = function () {
    return (
        localStorage.getItem("shopRegion") ||
        localStorage.getItem("selectedRegion") ||
        localStorage.getItem("region") ||
        "MM"
    );
};

AZIEL.getShopCurrency = function () {
    return AZIEL.getShopRegion() === "TH" ? "THB" : "MMK";
};

AZIEL.getShopSymbol = function () {
    return AZIEL.getShopCurrency() === "THB" ? "฿" : "Ks";
};

AZIEL.setShopRegion = function (region, options = {}) {
    const finalRegion = region === "TH" ? "TH" : "MM";
    const currency = finalRegion === "TH" ? "THB" : "MMK";

    localStorage.setItem("shopRegion", finalRegion);
    localStorage.setItem("selectedRegion", finalRegion);
    localStorage.setItem("region", finalRegion);

    localStorage.setItem("shopCurrency", currency);
    localStorage.setItem("selectedCurrency", currency);
    localStorage.setItem("currency", currency);

    window.dispatchEvent(new CustomEvent("aziel:shopRegionChanged", {
        detail: {
            region: finalRegion,
            currency
        }
    }));

    // Backward compatibility for existing files
    window.dispatchEvent(new CustomEvent("aziel:regionChanged", {
        detail: {
            region: finalRegion,
            currency
        }
    }));

    if (options.reload === true) {
        window.location.reload();
    }
};

// Backward compatibility
AZIEL.getRegion = AZIEL.getShopRegion;
AZIEL.getCurrency = AZIEL.getShopCurrency;
AZIEL.getSymbol = AZIEL.getShopSymbol;
AZIEL.setRegion = AZIEL.setShopRegion;

// ============================
// USER
// ============================

AZIEL.getDisplayName = function (user = AZIEL.user) {
    return user?.displayName || user?.username || "User";
};

AZIEL.loadUser = async function () {
    const token = AZIEL.getToken();

    if (!token) {
        AZIEL.user = null;
        window.dispatchEvent(new Event("aziel:userChanged"));
        return null;
    }

    try {
        const res = await fetch("/api/profile/me", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await res.json();

        if (!data.success || !data.user) {
            AZIEL.user = null;
            window.dispatchEvent(new Event("aziel:userChanged"));
            return null;
        }

        AZIEL.user = data.user;

        localStorage.setItem("username", data.user.username || "");
        localStorage.setItem("displayName", AZIEL.getDisplayName(data.user));

        window.dispatchEvent(new Event("aziel:userChanged"));

        return data.user;

    } catch (error) {
        console.log("AZIEL load user error:", error);
        AZIEL.user = null;
        window.dispatchEvent(new Event("aziel:userChanged"));
        return null;
    }
};

// ============================
// WALLET
// ============================
// Wallet balance follows shop currency for topup/use.
// Wallet history must still display saved item.currency from backend.

AZIEL.loadWallet = async function () {
    const user = AZIEL.user || await AZIEL.loadUser();

    const currency = AZIEL.getShopCurrency();

    if (!user?.username) {
        AZIEL.wallet = {
            balance: 0,
            currency,
            symbol: AZIEL.getShopSymbol()
        };

        window.dispatchEvent(new Event("aziel:walletChanged"));
        return AZIEL.wallet;
    }

    try {
        const res = await fetch(
            `/api/wallet/${encodeURIComponent(user.username)}?currency=${currency}`
        );

        const data = await res.json();

        AZIEL.wallet = {
            balance: data.success ? Number(data.balance || 0) : 0,
            currency,
            symbol: AZIEL.getShopSymbol()
        };

        window.dispatchEvent(new Event("aziel:walletChanged"));

        return AZIEL.wallet;

    } catch (error) {
        console.log("AZIEL load wallet error:", error);

        AZIEL.wallet = {
            balance: 0,
            currency,
            symbol: AZIEL.getShopSymbol()
        };

        window.dispatchEvent(new Event("aziel:walletChanged"));

        return AZIEL.wallet;
    }
};

// ============================
// TARGETED REGION HELPERS
// ============================
// For future announcement / promotion / delay filtering.

AZIEL.shouldShowForShopRegion = function (targetRegion) {
    const region = AZIEL.getShopRegion();
    const target = targetRegion || "ALL";

    return target === "ALL" || target === region;
};

AZIEL.notificationTypes = {
    ANNOUNCEMENT: "announcement",
    PROMOTION: "promotion",
    DELAY: "delay"
};

// ============================
// INIT
// ============================

AZIEL.init = async function () {
    const region = AZIEL.getShopRegion();

    AZIEL.setShopRegion(region);

    await AZIEL.loadUser();
    await AZIEL.loadWallet();

    window.dispatchEvent(new Event("aziel:ready"));
};

document.addEventListener("DOMContentLoaded", () => {
    AZIEL.init();
});