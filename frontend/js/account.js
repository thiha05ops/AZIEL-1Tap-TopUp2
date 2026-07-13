// frontend/js/account.js - AZIEL V3 i18n Account Flow

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initButtons();
    initMobileMenu();
    initAccount();
});

let currentUser = null;
let accountRefreshTimer = null;
let securityState = {
    overview: null,
    sessions: [],
    events: [],
    legacySession: false,
    loading: false,
    pendingTwoFactorSetup: null
};

function t(key, fallback = "") {
    if (window.AZIEL_I18N?.t) {
        return window.AZIEL_I18N.t(key, fallback);
    }

    return fallback || key;
}

function accountApiUrl(path) {
    if (window.AZIEL?.apiUrl) {
        return window.AZIEL.apiUrl(path);
    }

    const base =
        location.port === "5500"
            ? "http://localhost:3000"
            : "";

    return `${base}${path}`;
}

async function initAccount() {
    const token = window.AZIEL?.getToken?.();

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    await ensureAZIELState();

    currentUser = window.AZIEL?.user || null;

    if (!currentUser) {
        window.location.href = "login.html";
        return;
    }

    renderAccount();
    await refreshAccountData();
    await loadSecurityData();

    window.addEventListener("aziel:ready", async () => {
        currentUser = window.AZIEL?.user || currentUser;
        renderAccount();
        await refreshAccountData();
        await loadSecurityData();
    });

    window.addEventListener("aziel:userChanged", async () => {
        currentUser = window.AZIEL?.user || currentUser;
        renderAccount();
        await refreshAccountData();
        await loadSecurityData();
    });

    window.addEventListener("aziel:walletChanged", () => {
        renderWallet();
    });

    window.addEventListener("aziel:shopRegionChanged", async () => {
        await window.AZIEL?.loadWallet?.();
        renderAccount();
    });

    window.addEventListener("aziel:languageChanged", () => {
        renderAccount();
        refreshAccountData();
        if (location.hash === "#security") {
            loadSecurityData();
        }
        window.AZIEL_I18N?.translatePage?.(document);
    });

    accountRefreshTimer = setInterval(async () => {
        await window.AZIEL?.loadWallet?.();
        await refreshAccountData();
        renderAccount();
    }, 10000);
}

window.addEventListener("beforeunload", () => {
    if (accountRefreshTimer) {
        clearInterval(accountRefreshTimer);
        accountRefreshTimer = null;
    }
});

async function refreshAccountData() {
    if (!window.AZIEL?.getToken?.()) {
        if (accountRefreshTimer) {
            clearInterval(accountRefreshTimer);
            accountRefreshTimer = null;
        }
        return;
    }

    await loadHistory();
    await loadBellOrders();
}

async function ensureAZIELState() {
    if (!window.AZIEL) {
        console.error("AZIEL user-state.js not loaded");
        return;
    }

    if (!window.AZIEL.user) {
        await window.AZIEL.loadUser?.();
    }

    if (!window.AZIEL.wallet) {
        await window.AZIEL.loadWallet?.();
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text ?? "";
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? "";
}

function getDisplayName(user = currentUser) {
    return (
        window.AZIEL?.getDisplayName?.(user) ||
        user?.displayName ||
        user?.username ||
        t("user", "User")
    );
}

function getRegion() {
    return window.AZIEL?.getShopRegion?.() || window.AZIEL?.getRegion?.() || "MM";
}

function getCurrency() {
    return (
        window.AZIEL?.getShopCurrency?.() ||
        window.AZIEL?.getCurrency?.() ||
        (getRegion() === "TH" ? "THB" : "MMK")
    );
}

function getSymbol() {
    return (
        window.AZIEL?.getShopSymbol?.() ||
        window.AZIEL?.getSymbol?.() ||
        (getCurrency() === "THB" ? "฿" : "Ks")
    );
}

function formatDate(dateValue) {
    if (!dateValue) return "-";

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleDateString();
}

function isVerified(user = currentUser) {
    return Boolean(user?.emailVerified || user?.isVerified || user?.isEmailVerified || user?.verified);
}

function renderAccount() {
    currentUser = window.AZIEL?.user || currentUser;

    if (!currentUser) return;

    renderProfile();
    renderSecurity();
    renderWallet();

    window.AZIEL_I18N?.translatePage?.(document);
}

function renderProfile() {
    const user = currentUser;
    const name = getDisplayName(user);
    const region = getRegion();
    const verified = isVerified(user);

    setText("profileName", name);
    setText("avatarText", name.charAt(0).toUpperCase());
    setText("profileRegion", `${t("region", "Region")}: ${region}`);

    setValue("displayName", name);
    setValue("profileUsername", user.username || "");
    setValue("profileEmail", user.email || "");

    setValue(
        "profileRegionReadOnly",
        region === "TH"
            ? t("regionThailand", "Thailand - THB")
            : t("regionMyanmar", "Myanmar - MMK")
    );

    setValue("profileCreatedAt", formatDate(user.createdAt));

    const verifiedBadge = document.querySelector(".verified-badge");

    if (verifiedBadge) {
        verifiedBadge.innerHTML = verified
            ? `<i class="fa-solid fa-circle-check"></i> ${t("verified", "Verified")}`
            : `<i class="fa-solid fa-circle-exclamation"></i> ${t("notVerified", "Not Verified")}`;
    }
}

function renderSecurity() {
    const overview = securityState.overview || {};
    const user = currentUser;
    const verified = Boolean(overview.emailVerified ?? isVerified(user));
    const googleLinked = Boolean(overview.google?.linked ?? overview.googleLinked);
    const hasPassword = Boolean(overview.hasPassword);
    const twoFactor = overview.twoFactor || {};
    const twoFactorEnabled = Boolean(twoFactor.enabled ?? overview.twoFactorEnabled);
    const recoveryCodesRemaining = Number(twoFactor.recoveryCodesRemaining || 0);

    setText(
        "securityEmailText",
        overview.emailVerifiedAt
            ? `${overview.email || user?.email || "-"} • Verified ${formatDate(overview.emailVerifiedAt)}`
            : (overview.email || user?.email || "-")
    );
    setText(
        "emailVerifiedStatus",
        verified ? t("verified", "Verified") : t("notVerified", "Not Verified")
    );

    setText(
        "passwordStatusText",
        hasPassword
            ? "Password configured for this account."
            : "Password is managed by your sign-in provider."
    );

    setText(
        "googleLinkedText",
        googleLinked
            ? t("googleLinkedDesc", "Your Google account is linked to AZIEL.")
            : t("googleNotLinkedDesc", "Google account is not linked yet.")
    );

    setText(
        "googleLinkedStatus",
        googleLinked ? t("linked", "Linked") : t("notLinked", "Not Linked")
    );

    setText(
        "twoFactorText",
        twoFactorEnabled
            ? `Authenticator app enabled${twoFactor.enabledAt ? ` on ${formatDate(twoFactor.enabledAt)}` : ""}.`
            : "Require an authenticator code when signing in."
    );
    setText(
        "twoFactorStatus",
        twoFactorEnabled
            ? `Enabled • ${recoveryCodesRemaining} recovery code${recoveryCodesRemaining === 1 ? "" : "s"} left`
            : "Not enabled"
    );

    const changeBtn = document.getElementById("changePasswordBtn");
    if (changeBtn) {
        changeBtn.hidden = !hasPassword;
    }

    const startTwoFactorBtn = document.getElementById("startTwoFactorSetupBtn");
    if (startTwoFactorBtn) {
        startTwoFactorBtn.hidden = twoFactorEnabled;
    }

    const manageTwoFactorBtn = document.getElementById("manageTwoFactorBtn");
    if (manageTwoFactorBtn) {
        manageTwoFactorBtn.hidden = !twoFactorEnabled;
    }

    renderSecuritySessions();
    renderSecurityEvents();
}

async function loadSecurityData() {
    if (!window.AZIEL?.getToken?.()) return;

    securityState.loading = true;

    try {
        const overviewRes = await window.AZIEL.authFetch("/api/security/overview");
        const overviewData = await overviewRes.json();

        if (overviewRes.status === 401 || overviewData.forceLogout) {
            return;
        }

        const [sessionsRes, eventsRes] = await Promise.all([
            window.AZIEL.authFetch("/api/security/sessions"),
            window.AZIEL.authFetch("/api/security/events?limit=20")
        ]);

        const [sessionsData, eventsData] = await Promise.all([
            sessionsRes.json(),
            eventsRes.json()
        ]);

        if (overviewData.success) securityState.overview = overviewData.overview;
        if (sessionsData.success) {
            securityState.sessions = sessionsData.sessions || [];
            securityState.legacySession = Boolean(sessionsData.legacySession || sessionsData.legacyAuth);
        }
        if (overviewData.success) {
            securityState.legacySession = Boolean(
                securityState.legacySession ||
                overviewData.overview?.legacySession ||
                overviewData.overview?.legacyAuth
            );
        }
        if (eventsData.success) securityState.events = eventsData.events || [];

        renderSecurity();
    } catch (error) {
        console.log("Security data error:", error);
    } finally {
        securityState.loading = false;
    }
}

function renderSecuritySessions() {
    const box = document.getElementById("securitySessionsList");
    if (!box) return;

    if (securityState.legacySession && !securityState.sessions.length) {
        box.innerHTML = `
            <p>
                This sign-in was created before device management was enabled.
                Sign out and sign in again to register this device.
            </p>
        `;
        return;
    }

    if (!securityState.sessions.length) {
        box.innerHTML = `<p>No active session records yet.</p>`;
        return;
    }

    box.innerHTML = securityState.sessions.map(session => `
        <div class="security-list-item">
            <div>
                <strong>${escapeHTML(session.deviceLabel || session.deviceName || "Unknown Device")}</strong>
                ${session.isCurrentSession ? `<span class="security-current">Current device</span>` : ""}
                <small>
                    ${escapeHTML([session.browser, session.platform].filter(Boolean).join(" • ") || "Browser session")}
                </small>
                <small>Last active ${escapeHTML(formatDateTime(session.lastSeenAt))}</small>
            </div>
            ${session.isCurrentSession ? "" : `
                <button class="security-btn danger" type="button" data-revoke-session="${escapeHTML(session.sessionId)}">
                    Revoke
                </button>
            `}
        </div>
    `).join("");

    box.querySelectorAll("[data-revoke-session]").forEach(btn => {
        btn.addEventListener("click", () => revokeSession(btn.dataset.revokeSession));
    });
}

function renderSecurityEvents() {
    const box = document.getElementById("securityEventsList");
    if (!box) return;

    if (!securityState.events.length) {
        box.innerHTML = `<p>No recent security activity yet.</p>`;
        return;
    }

    box.innerHTML = securityState.events.map(event => `
        <div class="security-list-item">
            <div>
                <strong>${escapeHTML(event.title || formatEventType(event.type))}</strong>
                <small>${escapeHTML(formatDateTime(event.createdAt))}</small>
            </div>
        </div>
    `).join("");
}

function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleString();
}

function formatEventType(type) {
    return String(type || "")
        .replaceAll(".", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}

function renderWallet() {
    const wallet = window.AZIEL?.wallet || {};
    const symbol = wallet.symbol || getSymbol();
    const balance = Number(wallet.balance || 0);

    setText("overviewWalletBalance", `${balance.toLocaleString()} ${symbol}`);
    setText("walletBalanceBig", `${balance.toLocaleString()} ${symbol}`);
}
async function saveProfile() {
    const token = window.AZIEL?.getToken?.();

    if (!token) {
        window.location.href = "login.html";
        return;
    }

    const displayName =
        document.getElementById("displayName")?.value.trim() || "";

    if (!displayName) {
        showAccountToast(t("displayNameRequired", "Display name is required"), "error");
        return;
    }

    try {
        const res = await fetch(accountApiUrl("/api/profile/me"), {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ displayName })
        });

        const data = await res.json();

        if (!data.success || !data.user) {
            showAccountToast(data.message || t("profileSaveFailed", "Profile save failed"), "error");
            return;
        }

        window.AZIEL.user = data.user;
        currentUser = data.user;

        localStorage.setItem("username", data.user.username || "");
        localStorage.setItem("displayName", getDisplayName(data.user));

        window.dispatchEvent(new Event("aziel:userChanged"));

        renderAccount();

        showAccountToast(t("profileSaved", "Profile saved"), "success");
    } catch (error) {
        console.log("Save profile error:", error);
        showAccountToast(t("serverError", "Server error"), "error");
    }
}

function showAccountToast(message, type = "info") {
    const method = type === "success"
        ? "success"
        : type === "error"
            ? "error"
            : "info";

    window.AZIEL_UI?.toast?.[method]?.(message);
}

async function loadHistory() {
    if (!currentUser?.username) return;

    try {
        const res = await window.AZIEL.authFetch(
            `/api/history/${encodeURIComponent(currentUser.username)}`
        );

        const data = await res.json();

        if (!data.success || !Array.isArray(data.orders)) {
            renderEmpty();
            return;
        }

        renderStats(data.orders);
        renderHistory(data.orders);
        renderRecent(data.orders);
    } catch (error) {
        console.log("History error:", error);
        renderEmpty();
    }
}

function renderStats(orders) {
    const completed = orders.filter(order => order.status === "completed");
    const active = orders.filter(order => order.status !== "completed");

    setText("totalOrders", orders.length);
    setText("pendingOrders", active.length);
    setText("completedOrders", completed.length);
}

function renderHistory(orders) {
    const box = document.getElementById("historyList");
    if (!box) return;

    if (!orders.length) {
        box.innerHTML = `
            <div class="empty-orders">
                <i class="fa-regular fa-folder-open"></i>

                <h3>${t("noOrdersYet", "No Orders Yet")}</h3>

                <p>${t("ordersAppearHere", "Your recent top-up orders will appear here.")}</p>

                <a href="home.html">
                    ${t("startTopUp", "Start Top Up")}
                </a>
            </div>
        `;
        return;
    }

    box.innerHTML = orders.map(orderCard).join("");
}

function renderRecent(orders) {
    const box = document.getElementById("recentOrders");
    if (!box) return;

    if (!orders.length) {
        box.innerHTML = `<p>${t("noRecentOrders", "No recent orders.")}</p>`;
        return;
    }

    box.innerHTML = orders.slice(0, 3).map(order => `
        <div class="recent-order-item"
             onclick="window.location.href='tracking.html?orderId=${escapeHTML(order.orderId)}'">

            <div>
                <strong>${escapeHTML(order.game || t("game", "Game"))}</strong>
                <small>${escapeHTML(order.packageName || t("package", "Package"))}</small>
            </div>

            <span class="${statusClass(order.status)}">
                ${escapeHTML(formatAccountStatus(order.status))}
            </span>
        </div>
    `).join("");
}

function orderCard(order) {
    const status = order.status || "pending";
    const orderId = order.orderId || "";

    return `
        <div class="order-card">
            <div class="order-top">
                <h3>#${escapeHTML(orderId)}</h3>

                <span class="status ${statusClass(status)}">
                    ${escapeHTML(formatAccountStatus(status))}
                </span>
            </div>

            <div class="order-game">
                ${escapeHTML(order.game || t("game", "Game"))}
            </div>

            <div class="order-package">
                ${escapeHTML(order.packageName || t("package", "Package"))}
            </div>

            <div class="order-bottom">
                <strong>
                    ${Number(order.amount || 0).toLocaleString()}
                    ${escapeHTML(order.currency || getCurrency())}
                </strong>

                <a href="tracking.html?orderId=${encodeURIComponent(orderId)}">
                    ${t("trackOrder", "Track Order")}
                </a>
            </div>
        </div>
    `;
}

function renderEmpty() {
    setText("totalOrders", "0");
    setText("pendingOrders", "0");
    setText("completedOrders", "0");

    const history = document.getElementById("historyList");
    const recent = document.getElementById("recentOrders");

    if (history) {
        history.innerHTML = `<p>${t("noOrdersYet", "No orders yet.")}</p>`;
    }

    if (recent) {
        recent.innerHTML = `<p>${t("noRecentOrders", "No recent orders.")}</p>`;
    }
}

async function loadBellOrders() {
    if (!currentUser?.username) return;

    const panel = document.getElementById("notiPanel");
    const count = document.getElementById("notiCount");

    if (!panel || !count) return;

    try {
        const res = await window.AZIEL.authFetch(
            `/api/history/${encodeURIComponent(currentUser.username)}`
        );

        const data = await res.json();

        if (!data.success || !Array.isArray(data.orders) || !data.orders.length) {
            count.innerText = "0";
            panel.innerHTML = `
                <div class="noti-item">
                    ${t("noOrderNotifications", "No order notifications")}
                </div>
            `;
            return;
        }

        const activeOrders = data.orders.filter(order => order.status !== "completed");

        count.innerText = activeOrders.length;

        panel.innerHTML = data.orders.slice(0, 8).map(order => `
            <div class="noti-item"
                 onclick="window.location.href='tracking.html?orderId=${escapeHTML(order.orderId)}'">

                🔔 <b>${escapeHTML(order.game || t("game", "Game"))}</b><br>

                ${escapeHTML(order.packageName || t("package", "Package"))}<br>

                <small>${escapeHTML(order.orderId || "")}</small><br>

                <span class="${statusClass(order.status)}">
                    ${escapeHTML(formatAccountStatus(order.status))}
                </span>
            </div>
        `).join("");
    } catch (error) {
        console.log("Bell order error:", error);
        panel.innerHTML = `
            <div class="noti-item">
                ${t("serverError", "Server error")}
            </div>
        `;
    }
}

async function confirmSecurityAction(title, message, confirmText = "Confirm") {
    if (window.AZIEL_UI?.confirm) {
        return window.AZIEL_UI.confirm({
            title,
            message,
            confirmText,
            cancelText: "Cancel"
        });
    }

    return window.confirm(message);
}

async function revokeSession(sessionId) {
    if (!sessionId) return;

    const confirmed = await confirmSecurityAction(
        "Revoke session?",
        "This device will be signed out of AZIEL.",
        "Revoke"
    );

    if (!confirmed) return;

    try {
        const res = await window.AZIEL.authFetch(`/api/security/sessions/${encodeURIComponent(sessionId)}`, {
            method: "DELETE"
        });
        const data = await res.json();

        if (!data.success) {
            showAccountToast(data.message || "Could not revoke session", "error");
            return;
        }

        showAccountToast(data.message || "Session revoked", "success");

        if (data.forceLogout) {
            window.AZIEL.handleAuthFailure?.("Session revoked. Please sign in again.");
            return;
        }

        await loadSecurityData();
    } catch (error) {
        console.log("Revoke session error:", error);
        showAccountToast("Server error", "error");
    }
}

async function revokeOtherSessions() {
    const confirmed = await confirmSecurityAction(
        "Log out other devices?",
        "All other active AZIEL sessions will be revoked.",
        "Log out others"
    );

    if (!confirmed) return;

    await postSecurityAction("/api/security/sessions/revoke-others", false);
}

async function revokeAllSessions() {
    const confirmed = await confirmSecurityAction(
        "Log out all devices?",
        "All AZIEL sessions, including this one, will be revoked.",
        "Log out all"
    );

    if (!confirmed) return;

    await postSecurityAction("/api/security/sessions/revoke-all", true);
}

async function postSecurityAction(path, forceLogoutOnSuccess) {
    try {
        const res = await window.AZIEL.authFetch(path, { method: "POST" });
        const data = await res.json();

        if (!data.success) {
            showAccountToast(data.message || "Security action failed", "error");
            return;
        }

        showAccountToast(data.message || "Security action complete", "success");

        if (forceLogoutOnSuccess || data.forceLogout) {
            window.AZIEL.handleAuthFailure?.("Please sign in again.");
            return;
        }

        await loadSecurityData();
    } catch (error) {
        console.log("Security action error:", error);
        showAccountToast("Server error", "error");
    }
}

function getTwoFactorModal() {
    return document.getElementById("twoFactorModal");
}

function setTwoFactorView(viewName) {
    document.querySelectorAll(".two-factor-view").forEach(view => {
        view.hidden = true;
    });

    const view = document.getElementById(`twoFactor${viewName}View`);
    if (view) view.hidden = false;
}

function setButtonLoading(btn, isLoading, text) {
    if (!btn) return;

    if (isLoading) {
        window.AZIEL_UI?.button?.setLoading?.(btn, { text });
        if (!window.AZIEL_UI?.button) btn.disabled = true;
        return;
    }

    window.AZIEL_UI?.button?.reset?.(btn);
    if (!window.AZIEL_UI?.button) btn.disabled = false;
}

function openTwoFactorModal(viewName) {
    const modal = getTwoFactorModal();
    if (!modal) return;

    setTwoFactorView(viewName);
    modal.hidden = false;
}

function closeTwoFactorModal() {
    const modal = getTwoFactorModal();
    if (modal) modal.hidden = true;

    securityState.pendingTwoFactorSetup = null;
    setValue("twoFactorSetupCode", "");
    setValue("twoFactorCurrentPassword", "");
    setValue("twoFactorManageCode", "");
}

async function startTwoFactorSetup() {
    const btn = document.getElementById("startTwoFactorSetupBtn");
    setButtonLoading(btn, true, "Starting...");

    try {
        const res = await window.AZIEL.authFetch("/api/security/2fa/setup", {
            method: "POST"
        });
        const data = await res.json();

        if (!data.success || !data.setup) {
            showAccountToast(data.message || "Could not start two-factor setup", "error");
            return;
        }

        securityState.pendingTwoFactorSetup = data.setup;
        setValue("twoFactorManualKey", data.setup.manualKey || "");
        const uri = document.getElementById("twoFactorProvisioningUri");
        if (uri) uri.value = data.setup.provisioningUri || "";
        setValue("twoFactorSetupCode", "");

        setText("twoFactorModalTitle", "Enable Two-Factor Authentication");
        openTwoFactorModal("Setup");
        document.getElementById("twoFactorSetupCode")?.focus();
    } catch (error) {
        console.log("2FA setup start error:", error);
        showAccountToast("Server error", "error");
    } finally {
        setButtonLoading(btn, false);
    }
}

async function verifyTwoFactorSetup() {
    const btn = document.getElementById("verifyTwoFactorSetupBtn");
    const code = document.getElementById("twoFactorSetupCode")?.value.trim() || "";

    if (!code) {
        showAccountToast("Enter the authenticator code", "error");
        return;
    }

    setButtonLoading(btn, true, "Verifying...");

    try {
        const res = await window.AZIEL.authFetch("/api/security/2fa/verify-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });
        const data = await res.json();

        if (!data.success) {
            showAccountToast(data.message || "Invalid authenticator code", "error");
            return;
        }

        showRecoveryCodes(data.recoveryCodes || []);
        showAccountToast(data.message || "Two-factor authentication enabled", "success");
        await loadSecurityData();
    } catch (error) {
        console.log("2FA setup verify error:", error);
        showAccountToast("Server error", "error");
    } finally {
        setButtonLoading(btn, false);
    }
}

function showRecoveryCodes(codes) {
    const list = document.getElementById("twoFactorRecoveryCodes");
    if (list) {
        list.innerHTML = codes.map(code => `
            <code>${escapeHTML(code)}</code>
        `).join("");
    }

    const ack = document.getElementById("ackRecoveryCodes");
    const done = document.getElementById("closeTwoFactorAfterCodesBtn");
    if (ack) ack.checked = false;
    if (done) done.disabled = true;

    setText("twoFactorModalTitle", "Save Recovery Codes");
    openTwoFactorModal("Recovery");
}

function openTwoFactorManage() {
    const overview = securityState.overview || {};
    const twoFactor = overview.twoFactor || {};
    const remaining = Number(twoFactor.recoveryCodesRemaining || 0);

    setText(
        "twoFactorManageStatus",
        `Two-factor authentication is enabled. ${remaining} recovery code${remaining === 1 ? "" : "s"} remaining.`
    );
    setValue("twoFactorCurrentPassword", "");
    setValue("twoFactorManageCode", "");

    setText("twoFactorModalTitle", "Manage Two-Factor Authentication");
    openTwoFactorModal("Manage");
}

function getTwoFactorManagePayload() {
    const currentPassword = document.getElementById("twoFactorCurrentPassword")?.value || "";
    const value = document.getElementById("twoFactorManageCode")?.value.trim() || "";
    const recoveryMode = /^[A-Za-z0-9]{8}-[A-Za-z0-9]{8}$/.test(value);

    return {
        currentPassword,
        ...(recoveryMode ? { recoveryCode: value } : { code: value })
    };
}

function validateTwoFactorManagePayload(payload) {
    if (!payload.currentPassword) {
        showAccountToast("Current password is required", "error");
        return false;
    }

    if (!payload.code && !payload.recoveryCode) {
        showAccountToast("Authenticator or recovery code is required", "error");
        return false;
    }

    return true;
}

async function regenerateRecoveryCodes() {
    const payload = getTwoFactorManagePayload();
    if (!validateTwoFactorManagePayload(payload)) return;

    const confirmed = await confirmSecurityAction(
        "Generate new recovery codes?",
        "Your old recovery codes will stop working.",
        "Generate"
    );

    if (!confirmed) return;

    const btn = document.getElementById("regenerateRecoveryCodesBtn");
    setButtonLoading(btn, true, "Generating...");

    try {
        const res = await window.AZIEL.authFetch("/api/security/2fa/recovery-codes/regenerate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!data.success) {
            showAccountToast(data.message || "Could not regenerate recovery codes", "error");
            return;
        }

        showRecoveryCodes(data.recoveryCodes || []);
        showAccountToast("Recovery codes regenerated", "success");
        await loadSecurityData();
    } catch (error) {
        console.log("2FA recovery regenerate error:", error);
        showAccountToast("Server error", "error");
    } finally {
        setButtonLoading(btn, false);
    }
}

async function disableTwoFactor() {
    const payload = getTwoFactorManagePayload();
    if (!validateTwoFactorManagePayload(payload)) return;

    const confirmed = await confirmSecurityAction(
        "Disable two-factor authentication?",
        "Your account will no longer require an authenticator code at sign-in.",
        "Disable"
    );

    if (!confirmed) return;

    const btn = document.getElementById("disableTwoFactorBtn");
    setButtonLoading(btn, true, "Disabling...");

    try {
        const res = await window.AZIEL.authFetch("/api/security/2fa/disable", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!data.success) {
            showAccountToast(data.message || "Could not disable two-factor authentication", "error");
            return;
        }

        showAccountToast(data.message || "Two-factor authentication disabled", "success");
        closeTwoFactorModal();
        await loadSecurityData();
    } catch (error) {
        console.log("2FA disable error:", error);
        showAccountToast("Server error", "error");
    } finally {
        setButtonLoading(btn, false);
    }
}

function openChangePasswordModal() {
    const modal = document.getElementById("changePasswordModal");
    if (!modal) return;

    document.getElementById("changePasswordForm")?.reset();
    modal.hidden = false;
}

function closeChangePasswordModal() {
    const modal = document.getElementById("changePasswordModal");
    if (modal) modal.hidden = true;
}

async function submitChangePassword(event) {
    event.preventDefault();

    const btn = document.getElementById("submitChangePasswordBtn");
    const currentPassword = document.getElementById("currentPassword")?.value || "";
    const newPassword = document.getElementById("newPassword")?.value || "";
    const confirmPassword = document.getElementById("confirmNewPassword")?.value || "";

    if (newPassword.length < 8) {
        showAccountToast("Password must be at least 8 characters", "error");
        return;
    }

    if (newPassword !== confirmPassword) {
        showAccountToast("Passwords do not match", "error");
        return;
    }

    window.AZIEL_UI?.button?.setLoading?.(btn, { text: "Updating..." });

    try {
        const res = await window.AZIEL.authFetch("/api/security/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();

        if (!data.success) {
            showAccountToast(data.message || "Password change failed", "error");
            window.AZIEL_UI?.button?.reset?.(btn);
            return;
        }

        showAccountToast(data.message || "Password changed", "success");
        closeChangePasswordModal();
        window.AZIEL.handleAuthFailure?.("Password changed. Please sign in again.");
    } catch (error) {
        console.log("Change password error:", error);
        showAccountToast("Server error", "error");
        window.AZIEL_UI?.button?.reset?.(btn);
    }
}

function formatAccountStatus(status) {
    const value = String(status || "pending").toLowerCase();

    const map = {
        pending: t("statusPending", "Pending"),
        pending_payment: t("statusPending", "Pending"),
        paid: t("statusPaid", "Paid"),
        processing: t("statusProcessing", "Processing"),
        completed: t("statusCompleted", "Completed"),
        cancelled: t("statusCancelled", "Cancelled"),
        canceled: t("statusCancelled", "Cancelled"),
        failed: t("statusFailed", "Failed"),
        refund_requested: t("statusRefundRequested", "Refund Requested"),
        refund_pending: t("statusRefundRequested", "Refund Requested"),
        refund_rejected: t("statusRefundRejected", "Refund Rejected"),
        refunded: t("statusRefunded", "Refunded")
    };

    return map[value] || value;
}

function statusClass(status) {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "paid") return "status-paid";
    if (normalized === "processing") return "status-processing";
    if (normalized === "completed") return "status-completed";
    if (
        normalized === "cancelled" ||
        normalized === "canceled" ||
        normalized === "failed"
    ) {
        return "status-failed";
    }

    if (
        normalized === "refund_requested" ||
        normalized === "refund_pending"
    ) {
        return "status-processing";
    }

    if (normalized === "refunded") return "status-completed";
    if (normalized === "refund_rejected") return "status-failed";

    return "status-pending";
}

function showAccountTab(tabName) {
    if (!tabName) return;

    const panel = document.getElementById(tabName);
    if (!panel) return;

    document.querySelectorAll(".side-link[data-tab]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tabName);
    });

    document.querySelectorAll(".tab-panel").forEach(item => {
        item.classList.toggle("active", item.id === tabName);
    });

    document.querySelector(".az-profile-dropdown")?.classList.remove("show");

    if (tabName === "history") {
        loadHistory();
    }

    if (tabName === "overview") {
        renderAccount();
        loadHistory();
    }

    if (tabName === "security") {
        loadSecurityData();
    }

    window.AZIEL_I18N?.translatePage?.(document);
}

function initTabs() {
    document.querySelectorAll(".side-link[data-tab]").forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab;
            showAccountTab(tab);
            history.replaceState(null, "", `#${tab}`);
        });
    });

    function openHashTab() {
        const tab = location.hash.replace("#", "") || "overview";
        showAccountTab(tab);
    }

    openHashTab();

    window.addEventListener("hashchange", openHashTab);
}

function initButtons() {
    document
        .getElementById("saveProfileBtn")
        ?.addEventListener("click", saveProfile);

    document
        .getElementById("goWalletTopupBtn")
        ?.addEventListener("click", () => {
            window.location.href = "wallet.html";
        });

    document
        .getElementById("goWalletHistoryBtn")
        ?.addEventListener("click", () => {
            window.location.href = "wallet.html#history";
        });

    document
        .getElementById("changePasswordBtn")
        ?.addEventListener("click", openChangePasswordModal);

    document
        .getElementById("closeChangePasswordModal")
        ?.addEventListener("click", closeChangePasswordModal);

    document
        .getElementById("changePasswordModal")
        ?.addEventListener("click", event => {
            if (event.target.id === "changePasswordModal") closeChangePasswordModal();
        });

    document
        .getElementById("changePasswordForm")
        ?.addEventListener("submit", submitChangePassword);

    document
        .getElementById("startTwoFactorSetupBtn")
        ?.addEventListener("click", startTwoFactorSetup);

    document
        .getElementById("manageTwoFactorBtn")
        ?.addEventListener("click", openTwoFactorManage);

    document
        .getElementById("closeTwoFactorModal")
        ?.addEventListener("click", closeTwoFactorModal);

    document
        .getElementById("twoFactorModal")
        ?.addEventListener("click", event => {
            if (event.target.id === "twoFactorModal") closeTwoFactorModal();
        });

    document
        .getElementById("verifyTwoFactorSetupBtn")
        ?.addEventListener("click", verifyTwoFactorSetup);

    document
        .getElementById("ackRecoveryCodes")
        ?.addEventListener("change", event => {
            const done = document.getElementById("closeTwoFactorAfterCodesBtn");
            if (done) done.disabled = !event.target.checked;
        });

    document
        .getElementById("closeTwoFactorAfterCodesBtn")
        ?.addEventListener("click", closeTwoFactorModal);

    document
        .getElementById("regenerateRecoveryCodesBtn")
        ?.addEventListener("click", regenerateRecoveryCodes);

    document
        .getElementById("disableTwoFactorBtn")
        ?.addEventListener("click", disableTwoFactor);

    document
        .getElementById("revokeOtherSessionsBtn")
        ?.addEventListener("click", revokeOtherSessions);

    document
        .getElementById("revokeAllSessionsBtn")
        ?.addEventListener("click", revokeAllSessions);
}

function initMobileMenu() {
    const btn = document.getElementById("accountMenuBtn");
    const sidebar = document.querySelector(".account-sidebar");
    const overlay = document.getElementById("accountDrawerOverlay");

    btn?.addEventListener("click", () => {
        sidebar?.classList.add("show");
        overlay?.classList.add("show");
    });

    overlay?.addEventListener("click", () => {
        sidebar?.classList.remove("show");
        overlay?.classList.remove("show");
    });
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
