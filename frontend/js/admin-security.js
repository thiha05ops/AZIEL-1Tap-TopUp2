// frontend/js/admin-security.js
// Admin identity, sessions, 2FA, and audit log controller.

let adminAuditPage = 1;
let adminSecurityLastFocused = null;
const adminAuditPaging = {
    limit: 25,
    nextCursor: "",
    hasMore: false,
    cursorStack: [""]
};
let admin2FASetupInFlight = false;

document.addEventListener("DOMContentLoaded", () => {
    initAdminSecurityController();
});

function initAdminSecurityController() {
    document.querySelectorAll("#section-admin-security [data-admin-security-view]").forEach(button => {
        button.addEventListener("click", () => openAdminSecurityView(button.dataset.adminSecurityView));
    });

    document.getElementById("refreshAdminSecurityBtn")?.addEventListener("click", refreshActiveAdminSecurityView);
    document.getElementById("addAdminAccountBtn")?.addEventListener("click", openAdminAccountModal);
    document.getElementById("revokeOtherAdminSessionsBtn")?.addEventListener("click", confirmRevokeOtherAdminSessions);
    document.getElementById("startAdmin2FABtn")?.addEventListener("click", startAdmin2FASetup);
    document.getElementById("disableAdmin2FABtn")?.addEventListener("click", openDisableAdmin2FAModal);
    document.getElementById("adminSessionsList")?.addEventListener("click", handleAdminSessionsClick);
    document.getElementById("adminAuditSearchBtn")?.addEventListener("click", () => {
        resetAdminAuditPaging();
        loadAdminAuditLogs();
    });
    document.getElementById("adminAuditPrevBtn")?.addEventListener("click", () => {
        if (adminAuditPage <= 1) return;
        adminAuditPaging.cursorStack.pop();
        adminAuditPage = Math.max(1, adminAuditPage - 1);
        loadAdminAuditLogs();
    });
    document.getElementById("adminAuditNextBtn")?.addEventListener("click", () => {
        if (!adminAuditPaging.hasMore) return;
        adminAuditPaging.cursorStack[adminAuditPage] = adminAuditPaging.nextCursor;
        adminAuditPage += 1;
        loadAdminAuditLogs();
    });

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "admin-security") loadAdminSecurity();
    });
    window.addEventListener("aziel:admin-auth-ready", () => {
        window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.();
        renderAdmin2FAState();
    });
}

async function refreshActiveAdminSecurityView() {
    const activeView = document.querySelector("#section-admin-security .admin-security-view.active")?.id || "";
    const refreshBtn = document.getElementById("refreshAdminSecurityBtn");

    try {
        setAdminSecurityButtonLoading(refreshBtn, adminT("refreshing", "Refreshing"));

        if (activeView === "adminSecuritySessionsView") {
            await loadAdminSessions({ showLoading: true, surfaceErrors: true });
        } else if (activeView === "adminSecurityAuditView") {
            await loadAdminAuditLogs();
        } else if (activeView === "adminSecurityAccountsView") {
            await loadAdminAccounts();
        } else {
            await loadAdminSecurity();
        }
    } finally {
        resetAdminSecurityButton(refreshBtn);
    }
}

function openAdminSecurityView(view) {
    document.querySelectorAll("#section-admin-security [data-admin-security-view]").forEach(button => {
        button.classList.toggle("active", button.dataset.adminSecurityView === view);
    });
    document.querySelectorAll("#section-admin-security .admin-security-view").forEach(panel => panel.classList.remove("active"));
    document.getElementById(`adminSecurity${capitalize(view)}View`)?.classList.add("active");
    loadAdminSecurity();
}

async function loadAdminSecurity() {
    window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.();
    renderAdmin2FAState();
    if (window.AZIEL_ADMIN_AUTH?.hasPermission?.("ADMIN_ACCOUNTS_READ")) loadAdminAccounts();
    if (window.AZIEL_ADMIN_AUTH?.hasPermission?.("ADMIN_SESSIONS_READ")) loadAdminSessions();
    if (window.AZIEL_ADMIN_AUTH?.hasPermission?.("AUDIT_LOG_READ")) loadAdminAuditLogs();
}

async function loadAdminAccounts() {
    const list = document.getElementById("adminAccountsList");
    if (!list) return;
    list.innerHTML = `<div class="admin-dashboard-skeleton"></div>`;
    const data = await adminFetch("/api/admin/accounts");
    if (!data?.success) {
        list.innerHTML = `<p class="admin-empty-state">${escapeAdminSecurity(data?.message || "Admin accounts unavailable")}</p>`;
        return;
    }
    const accounts = data.accounts || [];
    list.innerHTML = accounts.length ? accounts.map(renderAdminAccount).join("") : `<p class="admin-empty-state">${adminT("no_admin_accounts", "No admin accounts")}</p>`;
    list.querySelectorAll("[data-admin-account-edit]").forEach(button => {
        button.addEventListener("click", () => openAdminAccountModal(accounts.find(item => item.id === button.dataset.adminAccountEdit)));
    });
}

function renderAdminAccount(account) {
    return `
        <article class="admin-security-card">
            <div>
                <strong>${escapeAdminSecurity(account.displayName || account.username)}</strong>
                <small>${escapeAdminSecurity(account.username)} · ${escapeAdminSecurity(account.role)} · ${escapeAdminSecurity(account.status)}</small>
                <small>${account.twoFactorEnabled ? adminT("two_factor_enabled", "2FA enabled") : adminT("two_factor_disabled", "2FA disabled")} · ${adminT("last_login", "Last Login")}: ${formatAdminSecurityDate(account.lastLoginAt)}</small>
            </div>
            <button class="admin-secondary-btn" type="button" data-admin-account-edit="${escapeAdminSecurity(account.id)}" data-admin-permission="ADMIN_ACCOUNTS_MANAGE">${adminT("edit", "Edit")}</button>
        </article>
    `;
}

function renderAdmin2FAState() {
    const admin = window.AZIEL_ADMIN_AUTH?.state?.admin || null;
    const enabled = Boolean(admin?.twoFactorEnabled);
    const startBtn = document.getElementById("startAdmin2FABtn");
    const disableBtn = document.getElementById("disableAdmin2FABtn");
    const container = document.querySelector(".admin-security-2fa");
    let status = document.getElementById("admin2FAStateText");

    if (!container) return;
    if (!status) {
        status = document.createElement("p");
        status.id = "admin2FAStateText";
        status.className = "admin-security-state-text";
        container.querySelector("h4")?.after(status);
    }

    status.textContent = enabled
        ? adminT("two_factor_protected", "Protected with an authenticator app")
        : adminT("two_factor_not_enabled", "Not enabled");

    if (startBtn) startBtn.hidden = enabled;
    if (disableBtn) disableBtn.hidden = !enabled;
}

function openAdminAccountModal(account = null) {
    const isEdit = Boolean(account);
    const modal = ensureAdminSecurityModal("adminAccountModal");
    modal.querySelector(".admin-security-modal-title").textContent = isEdit ? adminT("edit_admin", "Edit Admin") : adminT("add_admin", "Add Admin");
    modal.querySelector(".admin-security-modal-body").innerHTML = `
        ${isEdit ? "" : `<label>${adminT("username", "Username")}<input id="adminAccountUsername" type="text"></label>`}
        <label>${adminT("display_name", "Display Name")}<input id="adminAccountDisplayName" type="text" value="${escapeAdminSecurity(account?.displayName || "")}"></label>
        <label>${adminT("role", "Role")}<select id="adminAccountRole">
            ${["OWNER", "OPERATIONS", "FINANCE", "SUPPORT", "CATALOG"].map(role => `<option value="${role}" ${account?.role === role ? "selected" : ""}>${role}</option>`).join("")}
        </select></label>
        <label>${adminT("status", "Status")}<select id="adminAccountStatus">
            ${["ACTIVE", "DISABLED"].map(status => `<option value="${status}" ${account?.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select></label>
        ${isEdit ? "" : `<label>${adminT("initial_password", "Initial Password")}<input id="adminAccountPassword" type="password"></label>`}
    `;
    modal.querySelector(".admin-security-modal-save").onclick = () => saveAdminAccount(account);
    modal.__azielAdminModal?.open?.() || modal.classList.add("show");
}

async function saveAdminAccount(account = null) {
    const payload = {
        displayName: document.getElementById("adminAccountDisplayName")?.value || "",
        role: document.getElementById("adminAccountRole")?.value || "SUPPORT",
        status: document.getElementById("adminAccountStatus")?.value || "ACTIVE"
    };
    let url = `/api/admin/accounts/${encodeURIComponent(account?.id || "")}`;
    let method = "PATCH";
    if (!account) {
        payload.username = document.getElementById("adminAccountUsername")?.value || "";
        payload.password = document.getElementById("adminAccountPassword")?.value || "";
        url = "/api/admin/accounts";
        method = "POST";
    }
    const data = await adminFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (!data?.success) return;
    closeAdminSecurityModals();
    showAdminToast?.(adminT("admin_account_saved", "Admin account saved"), "success");
    loadAdminAccounts();
}

async function loadAdminSessions(options = {}) {
    const list = document.getElementById("adminSessionsList");
    if (!list) return;

    if (options.showLoading) {
        list.innerHTML = `<div class="admin-dashboard-skeleton"></div>`;
    }

    const data = await adminFetch("/api/admin/sessions");
    if (!data?.success) {
        list.innerHTML = `<p class="admin-empty-state">${escapeAdminSecurity(data?.message || "Sessions unavailable")}</p>`;
        if (options.surfaceErrors) {
            showAdminToast?.(data?.message || adminT("sessions_unavailable", "Sessions unavailable"), "error");
        }
        return;
    }
    const sessions = data.sessions || [];
    list.innerHTML = sessions.length ? sessions.map(renderAdminSession).join("") : `<p class="admin-empty-state">${adminT("no_sessions", "No sessions")}</p>`;
    window.AZIEL_ADMIN_AUTH?.applyPermissionVisibility?.(list);
}

function renderAdminSession(session) {
    const summary = summarizeAdminSessionDevice(session.userAgentSummary || "");

    return `
        <article class="admin-security-card" data-admin-session-card="${escapeAdminSecurity(session.id)}" data-current-session="${session.current ? "true" : "false"}">
            <div>
                <strong>${session.current ? adminT("current_session", "Current Session") : adminT("other_session", "Other Session")}</strong>
                <small>${escapeAdminSecurity(summary.deviceLabel)}</small>
                <small>${escapeAdminSecurity(summary.browserLabel)} • ${escapeAdminSecurity(summary.osLabel)}</small>
                <small>${adminT("last_seen", "Last Seen")}: ${formatAdminSecurityDate(session.lastSeenAt)}</small>
            </div>
            ${session.current ? "" : `<button class="admin-secondary-btn danger" type="button" data-admin-session-revoke="${escapeAdminSecurity(session.id)}" data-admin-permission="ADMIN_SESSIONS_REVOKE">${adminT("revoke_session", "Revoke Session")}</button>`}
        </article>
    `;
}

function summarizeAdminSessionDevice(userAgent = "") {
    const value = String(userAgent || "");
    const os = detectAdminOs(value);
    const browser = detectAdminBrowser(value);

    return {
        deviceLabel: `${os.device} Device`,
        browserLabel: browser,
        osLabel: os.label
    };
}

function detectAdminOs(value = "") {
    if (/iphone|ipad|ipod/i.test(value)) return { device: "iOS", label: "iOS" };
    if (/android/i.test(value)) return { device: "Android", label: "Android" };
    if (/windows/i.test(value)) return { device: "Windows", label: "Windows" };
    if (/mac os x|macintosh|macos/i.test(value)) return { device: "macOS", label: "macOS" };
    if (/linux/i.test(value)) return { device: "Linux", label: "Linux" };
    return { device: "Unknown", label: "Other" };
}

function detectAdminBrowser(value = "") {
    if (/SamsungBrowser/i.test(value)) return "Samsung Internet";
    if (/Edg\//i.test(value)) return "Edge";
    if (/Firefox\//i.test(value)) return "Firefox";
    if (/CriOS|Chrome\//i.test(value)) return "Chrome";
    if (/Safari\//i.test(value)) return "Safari";
    return "Other";
}

function handleAdminSessionsClick(event) {
    const revokeButton = event.target.closest("[data-admin-session-revoke]");
    if (!revokeButton) return;

    const card = revokeButton.closest("[data-admin-session-card]");
    const sessionId = revokeButton.dataset.adminSessionRevoke || card?.dataset.adminSessionCard || "";
    const isCurrent = card?.dataset.currentSession === "true";

    if (!sessionId || isCurrent) {
        showAdminToast?.(adminT("current_session_cannot_revoke", "Use logout to end the current session."), "error");
        return;
    }

    confirmRevokeAdminSession(sessionId, revokeButton);
}

async function confirmRevokeAdminSession(sessionId, sourceButton = null) {
    const result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
        title: adminT("revoke_session", "Revoke Session"),
        message: adminT("revoke_session_confirm", "Revoke this Admin session? That browser will lose Admin API access on its next request."),
        input: false,
        confirmText: adminT("revoke_session", "Revoke Session")
    });

    if (result && result.confirmed === false) return;

    await revokeAdminSession(sessionId, sourceButton);
}

async function revokeAdminSession(sessionId, sourceButton = null) {
    try {
        setAdminSecurityButtonLoading(sourceButton, adminT("revoking", "Revoking"));
        const data = await adminFetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("session_revoke_failed", "Session could not be revoked"), "error");
            return;
        }
        showAdminToast?.(adminT("session_revoked", "Session revoked"), "success");
        await loadAdminSessions({ showLoading: true, surfaceErrors: true });
    } finally {
        resetAdminSecurityButton(sourceButton);
    }
}

async function confirmRevokeOtherAdminSessions() {
    const result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
        title: adminT("revoke_all_other_sessions", "Revoke All Other Sessions"),
        message: adminT("revoke_all_other_sessions_confirm", "Keep this session active and revoke every other active Admin session for your account?"),
        input: false,
        confirmText: adminT("revoke_all_other_sessions", "Revoke All Other Sessions")
    });

    if (result && result.confirmed === false) return;
    await revokeOtherAdminSessions();
}

async function revokeOtherAdminSessions() {
    const button = document.getElementById("revokeOtherAdminSessionsBtn");

    try {
        setAdminSecurityButtonLoading(button, adminT("revoking", "Revoking"));
        const data = await adminFetch("/api/admin/sessions/revoke-others", { method: "POST" });
        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("session_revoke_failed", "Session could not be revoked"), "error");
            return;
        }
        showAdminToast?.(adminT("other_sessions_revoked", "Other sessions revoked"), "success");
        await loadAdminSessions({ showLoading: true, surfaceErrors: true });
    } finally {
        resetAdminSecurityButton(button);
    }
}

async function loadAdminAuditLogs() {
    const list = document.getElementById("adminAuditLogList");
    if (!list) return;
    const params = new URLSearchParams({
        limit: String(adminAuditPaging.limit)
    });
    const cursor = adminAuditPaging.cursorStack[adminAuditPage - 1] || "";
    const action = document.getElementById("adminAuditActionFilter")?.value.trim();
    const actor = document.getElementById("adminAuditActorFilter")?.value.trim();
    if (cursor) params.set("cursor", cursor);
    if (action) params.set("action", action);
    if (actor) params.set("actor", actor);

    const data = await adminFetch(`/api/admin/audit-logs?${params.toString()}`);
    if (!data?.success) {
        list.innerHTML = `<p class="admin-empty-state">${escapeAdminSecurity(data?.message || "Audit log unavailable")}</p>`;
        return;
    }
    renderAuditEvents(list, data.events || []);
    adminAuditPaging.hasMore = Boolean(data.pagination?.hasMore);
    adminAuditPaging.nextCursor = data.pagination?.nextCursor || "";
    document.getElementById("adminAuditPageInfo").textContent = adminAuditPaging.hasMore ? `${adminAuditPage} / …` : `${adminAuditPage}`;
    const prev = document.getElementById("adminAuditPrevBtn");
    const next = document.getElementById("adminAuditNextBtn");
    if (prev) prev.disabled = adminAuditPage <= 1;
    if (next) next.disabled = !adminAuditPaging.hasMore;
}

function resetAdminAuditPaging() {
    adminAuditPage = 1;
    adminAuditPaging.nextCursor = "";
    adminAuditPaging.hasMore = false;
    adminAuditPaging.cursorStack = [""];
}

function renderAuditEvents(list, events = []) {
    list.replaceChildren();

    if (!events.length) {
        const empty = document.createElement("p");
        empty.className = "admin-empty-state";
        empty.textContent = adminT("no_audit_events", "No audit events");
        list.appendChild(empty);
        return;
    }

    events.forEach(event => {
        list.appendChild(renderAuditEventElement(event));
    });
}

function renderAuditEventElement(event) {
    const card = document.createElement("article");
    card.className = "admin-security-card";

    const body = document.createElement("div");
    const action = document.createElement("strong");
    const actor = document.createElement("small");
    const resourceLabel = document.createElement("small");
    const metadata = document.createElement("pre");
    const safeResourceType = humanizeAuditResourceType(event.resourceType || "");
    const abbreviatedId = safeAuditResourceId(event.resourceType, event.resourceId);

    action.textContent = event.action || "";
    actor.textContent = `${event.actorUsernameSnapshot || "system"} · ${event.actorRoleSnapshot || ""} · ${formatAdminSecurityDate(event.createdAt)}`;
    resourceLabel.textContent = abbreviatedId
        ? `${adminT("resource", "Resource")}: ${safeResourceType} (${abbreviatedId})`
        : `${adminT("resource", "Resource")}: ${safeResourceType}`;
    metadata.textContent = JSON.stringify(event.metadata || {}, null, 2);

    body.append(action, actor, resourceLabel, metadata);
    card.appendChild(body);
    return card;
}

function humanizeAuditResourceType(resourceType = "") {
    const value = String(resourceType || "").trim();
    const labels = {
        AdminSession: "Admin Session",
        AdminAccount: "Admin Account",
        AdminAuditLog: "Admin Audit Log",
        Order: "Order",
        WalletTopup: "Wallet Top-up",
        CatalogProduct: "Catalog Product",
        CatalogPackage: "Catalog Package",
        GameBanner: "Game Banner",
        HomeBanner: "Home Banner",
        SitePlacement: "Site Placement",
        Campaign: "Campaign",
        PromoCode: "Promo Code",
        PaymentMethod: "Payment Method",
        Settings: "Settings",
        MediaAsset: "Media Asset"
    };

    if (labels[value]) return labels[value];
    return value.replace(/([a-z])([A-Z])/g, "$1 $2") || "Resource";
}

function safeAuditResourceId(resourceType = "", resourceId = "") {
    const value = String(resourceId || "").trim();
    if (!value || resourceType === "AdminSession") return "";
    if (value.length <= 10) return value;
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function startAdmin2FASetup() {
    if (admin2FASetupInFlight) return;
    admin2FASetupInFlight = true;
    const startButton = document.getElementById("startAdmin2FABtn");
    setAdminSecurityButtonLoading(startButton, adminT("loading", "Loading"));

    let data;
    try {
        data = await adminFetch("/api/admin/security/2fa/setup", { method: "POST" });
    } finally {
        admin2FASetupInFlight = false;
        resetAdminSecurityButton(startButton);
    }

    if (!data?.success) return;
    const setup = data.setup || {};
    const modal = ensureAdminSecurityModal("admin2FAModal");
    const saveButton = modal.querySelector(".admin-security-modal-save");
    modal.querySelector(".admin-security-modal-title").textContent = adminT("enable_two_factor_authentication", "Enable Two-Factor Authentication");
    modal.querySelector(".admin-security-modal-body").innerHTML = `
        <p class="admin-2fa-setup-intro">${adminT("two_factor_setup_intro", "Use an authenticator app to protect this Admin account before continuing.")}</p>
        <ol class="admin-2fa-steps">
            <li>${adminT("two_factor_step_1", "Open your authenticator app.")}</li>
            <li>${adminT("two_factor_step_2", "Scan this QR code.")}</li>
            <li>${adminT("two_factor_step_3", "If scanning is unavailable, enter the setup key manually.")}</li>
            <li>${adminT("two_factor_step_4", "Enter the 6-digit code from the app.")}</li>
        </ol>
        <div class="admin-2fa-qr" data-qr-uri="${escapeAdminSecurity(setup.provisioningUri || "")}" data-qr-image="${escapeAdminSecurity(setup.qrDataUrl || "")}"></div>
        <details class="admin-2fa-manual">
            <summary>${adminT("cant_scan_qr", "Can't scan the QR code?")}</summary>
            <label>${adminT("manual_setup_key", "Manual Setup Key")}<input class="admin-2fa-manual-key" type="text" readonly value="${escapeAdminSecurity(setup.manualKey || "")}"></label>
            <p class="admin-2fa-warning">${adminT("setup_key_warning", "Keep this setup key private. Anyone with it can generate codes for this Admin account.")}</p>
        </details>
        <label for="admin2FACode">${adminT("six_digit_verification_code", "6-digit verification code")}</label>
        <input id="admin2FACode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" aria-describedby="admin2FACodeHelp">
        <small id="admin2FACodeHelp" class="admin-2fa-code-help">${adminT("verification_code_help", "Enter exactly 6 digits from your authenticator app.")}</small>
    `;
    renderSimpleQr(modal.querySelector(".admin-2fa-qr"), setup.provisioningUri || "");
    const codeInput = modal.querySelector("#admin2FACode");
    codeInput?.addEventListener("input", () => {
        codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
    });
    if (saveButton) {
        saveButton.textContent = adminT("enable_2fa", "Enable 2FA");
        saveButton.onclick = verifyAdmin2FASetup;
    }
    adminSecurityLastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.__azielAdminModal?.open?.() || modal.classList.add("show");
    window.setTimeout(() => codeInput?.focus(), 30);
}

async function verifyAdmin2FASetup() {
    const saveButton = document.querySelector("#admin2FAModal .admin-security-modal-save");
    const codeInput = document.getElementById("admin2FACode");
    const code = String(codeInput?.value || "").trim();

    if (!/^\d{6}$/.test(code)) {
        showAdminToast?.(adminT("invalid_verification_code", "Enter the 6-digit authenticator code."), "error");
        codeInput?.focus();
        return;
    }

    try {
        setAdminSecurityButtonLoading(saveButton, adminT("verifying", "Verifying"));
        const data = await adminFetch("/api/admin/security/2fa/verify-setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });
        if (!data?.success) return;
        closeAdminSecurityModals();
        showAdminToast?.(adminT("two_factor_enabled", "2FA enabled"), "success");
        await window.AZIEL_ADMIN_AUTH?.loadMe?.();
        renderAdmin2FAState();
    } finally {
        resetAdminSecurityButton(saveButton);
    }
}

function openDisableAdmin2FAModal() {
    const modal = ensureAdminSecurityModal("adminDisable2FAModal");
    modal.querySelector(".admin-security-modal-title").textContent = adminT("disable_2fa", "Disable 2FA");
    modal.querySelector(".admin-security-modal-body").innerHTML = `
        <label>${adminT("current_password", "Current Password")}<input id="adminDisable2FAPassword" type="password"></label>
        <label>${adminT("verification_code", "Verification Code")}<input id="adminDisable2FACode" type="text" inputmode="numeric" maxlength="6"></label>
    `;
    const saveButton = modal.querySelector(".admin-security-modal-save");
    if (saveButton) {
        saveButton.textContent = adminT("disable_2fa", "Disable 2FA");
        saveButton.onclick = disableAdmin2FA;
    }
    adminSecurityLastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.__azielAdminModal?.open?.() || modal.classList.add("show");
}

async function disableAdmin2FA() {
    const data = await adminFetch("/api/admin/security/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            currentPassword: document.getElementById("adminDisable2FAPassword")?.value || "",
            code: document.getElementById("adminDisable2FACode")?.value || ""
        })
    });
    if (!data?.success) return;
    closeAdminSecurityModals();
    showAdminToast?.(adminT("two_factor_disabled", "2FA disabled"), "success");
    await window.AZIEL_ADMIN_AUTH?.loadMe?.();
    renderAdmin2FAState();
}

function ensureAdminSecurityModal(id) {
    let modal = document.getElementById(id);
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = id;
    modal.className = "admin-action-modal admin-security-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box admin-security-modal-box">
            <h3 class="admin-security-modal-title"></h3>
            <div class="admin-security-modal-body"></div>
            <div class="admin-action-modal-actions">
                <button type="button" class="admin-security-modal-cancel">${adminT("cancel", "Cancel")}</button>
                <button type="button" class="admin-security-modal-save">${adminT("save_changes", "Save Changes")}</button>
            </div>
        </div>
    `;
    if (window.AZIEL_ADMIN_UI?.modal?.createAdminModal) {
        modal.__azielAdminModal = window.AZIEL_ADMIN_UI.modal.createAdminModal({
            root: modal,
            closeOnBackdrop: true,
            closeOnEscape: true,
            onClose: () => cleanupAdminSecurityModal(modal)
        });
    } else {
        modal.addEventListener("click", event => {
            if (event.target === modal) closeAdminSecurityModals();
        });
    }
    modal.querySelector(".admin-security-modal-cancel").addEventListener("click", closeAdminSecurityModals);
    document.body.appendChild(modal);
    return modal;
}

function closeAdminSecurityModals() {
    document.querySelectorAll(".admin-security-modal").forEach(modal => {
        modal.classList.remove("show");
        cleanupAdminSecurityModal(modal);
    });
    adminSecurityLastFocused?.focus?.();
    adminSecurityLastFocused = null;
}

function cleanupAdminSecurityModal(modal) {
    const saveButton = modal.querySelector(".admin-security-modal-save");
    if (saveButton) {
        resetAdminSecurityButton(saveButton);
        saveButton.textContent = adminT("save_changes", "Save Changes");
        saveButton.onclick = null;
    }
    const qr = modal.querySelector(".admin-2fa-qr");
    if (qr) {
        qr.textContent = "";
        qr.dataset.qrUri = "";
        qr.dataset.qrImage = "";
    }
    if (modal.id === "admin2FAModal") {
        modal.querySelector(".admin-security-modal-body").replaceChildren();
    }
    adminSecurityLastFocused?.focus?.();
    adminSecurityLastFocused = null;
}

function renderSimpleQr(container, value) {
    if (!container) return;
    const image = container.dataset.qrImage || "";
    container.dataset.qrUri = value || "";
    container.innerHTML = image
        ? `<img src="${escapeAdminSecurity(image)}" alt="${adminT("scan_qr_code", "Scan QR Code")}">`
        : `<span>${adminT("manual_setup_key", "Manual Setup Key")}</span>`;
}

function capitalize(value = "") {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function formatAdminSecurityDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function escapeAdminSecurity(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function setAdminSecurityButtonLoading(button, text = "Loading") {
    if (!button) return;
    if (window.AZIEL_UI?.button) {
        window.AZIEL_UI.button.setLoading(button, { text });
        return;
    }
    if (!button.dataset.adminOriginalText) {
        button.dataset.adminOriginalText = button.textContent || "";
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = text;
}

function resetAdminSecurityButton(button) {
    if (!button) return;
    if (window.AZIEL_UI?.button) {
        window.AZIEL_UI.button.reset(button);
        return;
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.adminOriginalText) {
        button.textContent = button.dataset.adminOriginalText;
        delete button.dataset.adminOriginalText;
    }
}
