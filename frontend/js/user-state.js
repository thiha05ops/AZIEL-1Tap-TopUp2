// frontend/js/user-state.js - AZIEL V2.5 Production Global State

window.AZIEL = window.AZIEL || {};

const AZIEL_API_BASE =
    location.port === "5500"
        ? `${location.protocol}//${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000`
        : "";

AZIEL.apiUrl = function (path) {
    return `${AZIEL_API_BASE}${path}`;
};

AZIEL.user = null;
AZIEL.wallet = null;
AZIEL.walletRealtimeReady = false;

// TOKEN
AZIEL.getToken = function () {
    return localStorage.getItem("token") || sessionStorage.getItem("token");
};

AZIEL.clearAuthState = function () {
    [
        "token",
        "username",
        "displayName",
        "email",
        "role",
        "user",
        "azielUser"
    ].forEach(key => localStorage.removeItem(key));

    sessionStorage.removeItem("token");
    AZIEL.user = null;
    AZIEL.wallet = null;
    window.dispatchEvent(new Event("aziel:userChanged"));
    window.dispatchEvent(new Event("aziel:walletChanged"));
};

AZIEL.authHeaders = function (extra = {}) {
    const token = AZIEL.getToken();

    return {
        ...extra,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
};

AZIEL.handleAuthFailure = function (message = "Session expired. Please login again.") {
    AZIEL.clearAuthState();
    localStorage.setItem("authMessage", message);

    if (!/login\.html$/.test(window.location.pathname)) {
        window.location.href = "login.html";
    }
};

AZIEL.authFetch = async function (url, options = {}) {
    const headers = AZIEL.authHeaders(options.headers || {});

    const res = await fetch(AZIEL.apiUrl(url), {
        ...options,
        headers
    });

    if (res.status === 401) {
        let data = {};

        try {
            data = await res.clone().json();
        } catch {
            data = {};
        }

        AZIEL.handleAuthFailure(data.message);
    }

    return res;
};

// SHOP REGION / CURRENCY
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

    const oldRegion = localStorage.getItem("shopRegion");
    const oldCurrency = localStorage.getItem("shopCurrency");

    localStorage.setItem("shopRegion", finalRegion);
    localStorage.setItem("selectedRegion", finalRegion);
    localStorage.setItem("region", finalRegion);

    localStorage.setItem("shopCurrency", currency);
    localStorage.setItem("selectedCurrency", currency);
    localStorage.setItem("currency", currency);

    const changed = oldRegion !== finalRegion || oldCurrency !== currency;

    if (changed && options.silent !== true) {
        window.dispatchEvent(new CustomEvent("aziel:shopRegionChanged", {
            detail: { region: finalRegion, currency }
        }));

        window.dispatchEvent(new CustomEvent("aziel:regionChanged", {
            detail: { region: finalRegion, currency }
        }));
    }

    if (options.reload === true) {
        window.location.reload();
    }
};

// Backward compatibility
AZIEL.getRegion = AZIEL.getShopRegion;
AZIEL.getCurrency = AZIEL.getShopCurrency;
AZIEL.getSymbol = AZIEL.getShopSymbol;
AZIEL.setRegion = AZIEL.setShopRegion;

// USER
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

    const cachedUser = (() => {
        try {
            return JSON.parse(
                localStorage.getItem("azielUser") ||
                localStorage.getItem("user") ||
                "null"
            );
        } catch {
            return null;
        }
    })();

    try {
        const res = await fetch(AZIEL.apiUrl("/api/profile/me"), {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const data = await res.json();

        if (res.status === 401 || data.forceLogout) {
            AZIEL.handleAuthFailure(data.message);
            return null;
        }

        if (data.success && data.user) {
            AZIEL.user = data.user;

            localStorage.setItem("username", data.user.username || "");
            localStorage.setItem("displayName", AZIEL.getDisplayName(data.user));
            localStorage.setItem("email", data.user.email || "");
            localStorage.setItem("region", data.user.region || "MM");
            localStorage.setItem("role", data.user.role || "user");

            localStorage.setItem("user", JSON.stringify(data.user));
            localStorage.setItem("azielUser", JSON.stringify(data.user));

            window.dispatchEvent(new Event("aziel:userChanged"));
            return data.user;
        }

        if (cachedUser) {
            AZIEL.user = cachedUser;
            window.dispatchEvent(new Event("aziel:userChanged"));
            return cachedUser;
        }

        AZIEL.user = null;
        window.dispatchEvent(new Event("aziel:userChanged"));
        return null;

    } catch (error) {
        console.log("AZIEL load user error:", error);

        if (cachedUser) {
            AZIEL.user = cachedUser;
            window.dispatchEvent(new Event("aziel:userChanged"));
            return cachedUser;
        }

        AZIEL.user = null;
        window.dispatchEvent(new Event("aziel:userChanged"));
        return null;
    }
};

// WALLET
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
        const res = await AZIEL.authFetch(
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

AZIEL.applyWalletUpdate = function (data = {}) {
    const currency = data.currency || AZIEL.wallet?.currency || AZIEL.getShopCurrency();
    const symbol = currency === "THB" ? "฿" : "Ks";
    const balance = Number(data.balance ?? data.amount ?? 0);

    AZIEL.wallet = {
        balance,
        currency,
        symbol,
        latestTransaction: data.latestTransaction || null,
        updatedAt: data.updatedAt || new Date()
    };

    window.dispatchEvent(new Event("aziel:walletChanged"));
    return AZIEL.wallet;
};

AZIEL.initWalletRealtime = function () {
    if (AZIEL.walletRealtimeReady || !AZIEL.realtime?.on || !AZIEL.getToken()) return;

    const handler = data => {
        AZIEL.applyWalletUpdate(data);
    };

    AZIEL.realtime.on("wallet:updated", handler);
    AZIEL.realtime.on("wallet:balance-changed", handler);
    AZIEL.realtime.on("walletUpdated", handler);
    AZIEL.walletRealtimeReady = true;
};

// TARGETED REGION HELPERS
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

// INIT
AZIEL.init = async function () {
    const region = AZIEL.getShopRegion();

    AZIEL.setShopRegion(region, {
        silent: true
    });

    await AZIEL.loadUser();
    await AZIEL.loadWallet();
    AZIEL.initWalletRealtime();

    window.dispatchEvent(new Event("aziel:ready"));
};

document.addEventListener("DOMContentLoaded", () => {
    AZIEL.init();
});
