const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), `${file}: ${message}`);
}

function verifyModels() {
    includes("backend/models/AdminAccount.js", "mongoose.model(\"AdminAccount\"", "AdminAccount model must exist.");
    includes("backend/models/AdminAccount.js", "usernameNormalized", "Admin username must be normalized.");
    includes("backend/models/AdminAccount.js", "passwordHash", "Admin password must be hashed, not plaintext.");
    includes("backend/models/AdminAccount.js", "OWNER", "Canonical OWNER role must exist.");
    includes("backend/models/AdminAccount.js", "ACTIVE", "Canonical ACTIVE status must exist.");
    includes("backend/models/AdminSession.js", "mongoose.model(\"AdminSession\"", "AdminSession model must exist.");
    assert(!read("backend/models/AdminSession.js").includes("jwt"), "AdminSession must not store raw JWT.");
    includes("backend/models/AdminAuditLog.js", "mongoose.model(\"AdminAuditLog\"", "AdminAuditLog model must exist.");
    assert(!read("backend/models/AdminAccount.js").includes("ref: \"User\""), "AdminAccount must not reuse customer User identity.");
}

function verifyAuthorization() {
    includes("backend/services/adminAuthorizationService.js", "ADMIN_ACCOUNTS_MANAGE", "Permission codes must be backend-owned.");
    includes("backend/services/adminAuthorizationService.js", "OWNER: Object.freeze(Object.values(PERMISSIONS))", "OWNER must have all permissions.");
    includes("backend/services/adminAuthorizationService.js", "requireAdminPermission", "Permission middleware must exist.");
    includes("backend/services/adminAuthorizationService.js", "ADMIN_PERMISSION_DENIED", "Missing permission must return stable 403 error.");
}

function verifyAuthService() {
    const service = read("backend/services/adminAuthService.js");
    assert(service.includes("bootstrapFirstOwnerIfAllowed"), "Legacy bootstrap path must be explicit.");
    assert(service.includes("AdminAccount.countDocuments()"), "Bootstrap must only apply when no AdminAccount exists.");
    assert(service.includes("bcrypt.hash"), "Admin passwords must be hashed.");
    assert(service.includes("bcrypt.compare"), "Admin login must verify hashed passwords.");
    assert(service.includes("status !== STATUSES.ACTIVE"), "Disabled admins must be rejected.");
    assert(service.includes("AdminSession.create"), "Login must create AdminSession.");
    assert(service.includes("sessionId") && service.includes("jwt.sign"), "Admin JWT must include durable session id.");
    assert(service.includes("AdminLoginChallenge.create"), "2FA login challenge must be backend-owned.");
    assert(service.includes("twoFactorRequired"), "2FA enabled login must not issue full JWT immediately.");
    assert(service.includes("verifyTotp"), "TOTP must use maintained otplib-backed service.");
    assert(service.includes("require(\"qrcode\")") && service.includes("QRCode.toDataURL"), "Admin 2FA QR must be generated locally.");
    assert(service.includes("encryptSecret") && service.includes("decryptSecret"), "TOTP secrets must use application encryption.");
    assert(service.includes("readAdminTotpSecret"), "Admin TOTP secret decryption must be wrapped.");
    assert(service.includes("ADMIN_2FA_SECRET_UNAVAILABLE"), "Unreadable Admin TOTP secrets must return a controlled auth error.");
    assert(service.includes("Admin 2FA secret decrypt failed"), "Unreadable Admin TOTP secrets must produce safe server diagnostics.");
    assert(service.includes("FINAL_ACTIVE_OWNER_PROTECTED"), "Final active owner must be server-protected.");
    assert(!/console\.log\(.*password|console\.log\(.*secret|console\.log\(.*token/i.test(service), "Admin auth service must not log secrets.");
}

function verifyRoutes() {
    includes("backend/routes/adminAuth.js", "router.get(\"/admin/me\"", "Admin me endpoint must exist.");
    includes("backend/routes/adminAuth.js", "router.post(\"/admin/logout\"", "Logout endpoint must revoke session.");
    includes("backend/routes/adminAuth.js", "router.post(\"/admin/login/2fa\"", "2FA login verification endpoint must exist.");
    includes("backend/routes/adminAuth.js", "router.get(\"/admin/accounts\"", "Admin accounts API must exist.");
    includes("backend/routes/adminAuth.js", "router.get(\"/admin/sessions\"", "Admin sessions API must exist.");
    includes("backend/routes/adminAuth.js", "router.get(\"/admin/audit-logs\"", "Audit log API must exist.");
    includes("backend/routes/adminAuth.js", "adminLoginLimiter", "Admin login must be rate limited.");
    includes("backend/routes/adminAuth.js", "adminSensitiveLimiter", "Sensitive Admin routes must be rate limited.");
    includes("backend/routes/adminAuth.js", "Admin auth route error", "Admin auth route diagnostics must identify unexpected route errors.");
    includes("backend/routes/adminAuth.js", "process.env.NODE_ENV !== \"production\"", "Admin auth stack traces must be development-only.");
}

function verifyRoutePermissions() {
    const expectations = [
        ["backend/routes/adminStats.js", "DASHBOARD_READ"],
        ["backend/routes/order.js", "ORDERS_READ"],
        ["backend/routes/order.js", "ORDERS_MANAGE"],
        ["backend/routes/wallet.js", "WALLET_APPROVE"],
        ["backend/routes/wallet.js", "WALLET_REJECT"],
        ["backend/routes/catalog.js", "CATALOG_MANAGE"],
        ["backend/routes/catalog.js", "MEDIA_MANAGE"],
        ["backend/routes/homeBanners.js", "SITE_CONTENT_MANAGE"],
        ["backend/routes/sitePlacements.js", "SITE_CONTENT_MANAGE"],
        ["backend/routes/campaigns.js", "CAMPAIGNS_MANAGE"],
        ["backend/routes/promos.js", "PROMOS_MANAGE"],
        ["backend/routes/paymentMethods.js", "PAYMENT_METHODS_MANAGE"],
        ["backend/routes/settings.js", "SETTINGS_MANAGE"],
        ["backend/routes/support.js", "SUPPORT_MANAGE"],
        ["backend/routes/liveChat.js", "LIVE_CHAT_MANAGE"],
        ["backend/routes/adminAuth.js", "ADMIN_ACCOUNTS_MANAGE"],
        ["backend/routes/adminAuth.js", "AUDIT_LOG_READ"]
    ];

    expectations.forEach(([file, permission]) => {
        includes(file, permission, `${permission} must be enforced.`);
    });
}

function verifyAuditCoverage() {
    const files = [
        "backend/routes/adminAuth.js",
        "backend/routes/order.js",
        "backend/routes/wallet.js",
        "backend/routes/catalog.js",
        "backend/routes/homeBanners.js",
        "backend/routes/sitePlacements.js",
        "backend/routes/campaigns.js",
        "backend/routes/promos.js",
        "backend/routes/paymentMethods.js",
        "backend/routes/settings.js",
        "backend/services/adminAuthService.js"
    ].map(read).join("\n");

    [
        "ADMIN_LOGIN_SUCCESS",
        "ADMIN_SESSION_REVOKED",
        "ORDER_STATUS_CHANGED",
        "WALLET_TOPUP_APPROVED",
        "WALLET_TOPUP_REJECTED",
        "CATALOG_PRODUCT_UPDATED",
        "CATALOG_PACKAGE_CREATED",
        "CATALOG_PACKAGE_UPDATED",
        "GAME_BANNER_CREATED",
        "MEDIA_UPLOADED",
        "HOME_BANNER_CREATED",
        "SITE_PLACEMENT_UPDATED",
        "CAMPAIGN_CREATED",
        "PROMO_CREATED",
        "PAYMENT_METHOD_UPDATED",
        "SETTINGS_UPDATED"
    ].forEach(action => assert(files.includes(action), `Missing audit action ${action}`));

    includes("backend/services/adminAuditService.js", "sanitizeAuditMetadata", "Audit metadata must be sanitized.");
    assert(!/passwordHash|Authorization header|raw request body/.test(read("backend/services/adminAuditService.js")), "Audit service must not store sensitive payloads.");
}

function verifyFrontend() {
    const adminSecurity = read("frontend/js/admin-security.js");
    includes("frontend/js/admin-auth.js", "AZIEL_ADMIN_AUTH", "Shared Admin permission helper must exist.");
    includes("frontend/js/admin-auth.js", "data-admin-permission", "Permission visibility helper must use data attributes.");
    includes("frontend/js/admin-api.js", "/api/admin/logout", "Admin logout must call server revoke endpoint.");
    includes("frontend/js/admin-api.js", "res.status === 403", "403 must be handled cleanly.");
    includes("frontend/js/admin-login.js", "/api/admin/login/2fa", "Login UI must support 2FA challenge.");
    assert(!read("frontend/js/admin-login.js").includes("localStorage.setItem(\"adminLoginChallenge"), "2FA challenge must not be stored in localStorage.");
    includes("frontend/admin.html", "id=\"section-admin-security\"", "Admin Security section must exist.");
    includes("frontend/js/admin-security.js", "/api/admin/audit-logs", "Audit UI must use paginated API.");
    includes("frontend/js/admin-security.js", "escapeAdminSecurity", "Audit UI must render safely.");
    includes("frontend/js/admin-security.js", "renderAuditEventElement", "Audit cards must use safe DOM rendering.");
    includes("frontend/js/admin-security.js", "metadata.textContent", "Audit metadata must render as text.");
    includes("frontend/js/admin-security.js", "humanizeAuditResourceType", "Audit UI must show human-readable resource type.");
    includes("frontend/js/admin-security.js", "safeAuditResourceId", "Audit UI must abbreviate or mask resource ids.");
    includes("frontend/js/admin-security.js", "resourceType === \"AdminSession\"", "Audit UI must not show full AdminSession ids.");
    assert(!adminSecurity.includes("${escapeAdminSecurity(event.resourceId || \"\")}") && !adminSecurity.includes("event.resourceId || \"\"}</small>"), "Audit UI must not render raw resourceId in default cards.");
    includes("backend/models/AdminAuditLog.js", "resourceId", "Canonical audit database truth must retain resourceId.");
    includes("frontend/js/admin-security.js", "renderAdmin2FAState", "2FA actions must be state-aware.");
    includes("frontend/js/admin-security.js", "twoFactorEnabled", "2FA state must derive from backend admin truth.");
    includes("frontend/js/admin-security.js", "startBtn.hidden = enabled", "2FA enabled must hide Enable 2FA.");
    includes("frontend/js/admin-security.js", "disableBtn.hidden = !enabled", "2FA disabled must hide Disable 2FA.");
    includes("frontend/js/admin-security.js", "summarizeAdminSessionDevice", "Sessions must use concise device projection.");
    includes("frontend/js/admin-security.js", "detectAdminOs", "Sessions must show OS-family device label.");
    includes("frontend/js/admin-security.js", "detectAdminBrowser", "Sessions must show browser summary.");
    assert(!adminSecurity.includes("${escapeAdminSecurity(session.userAgentSummary || \"Unknown device\")}") && !adminSecurity.includes("Mozilla/5.0"), "Sessions UI must not render raw User-Agent strings.");
    assert(!/fingerprint/i.test(adminSecurity), "Admin sessions UI must not introduce browser fingerprinting.");
    includes("frontend/js/admin-security.js", "refreshActiveAdminSecurityView", "Admin Security refresh must use an active-view handler.");
    includes("frontend/js/admin-security.js", "loadAdminSessions({ showLoading: true, surfaceErrors: true })", "Session refresh/revoke must refetch backend truth with visible feedback.");
    includes("frontend/js/admin-security.js", "adminSessionsList\")?.addEventListener(\"click\", handleAdminSessionsClick", "Dynamic session rows must use list-level event delegation.");
    includes("frontend/js/admin-security.js", "data-admin-session-card", "Session rows must carry canonical session id internally.");
    includes("frontend/js/admin-security.js", "data-current-session", "Session rows must mark current session explicitly.");
    includes("frontend/js/admin-security.js", "if (!sessionId || isCurrent)", "Current session must not be revokable through other-session actions.");
    includes("frontend/js/admin-security.js", "confirmRevokeAdminSession", "Single-session revoke must be confirmed.");
    includes("frontend/js/admin-security.js", "`/api/admin/sessions/${encodeURIComponent(sessionId)}`", "Single-session revoke must call canonical backend session API.");
    includes("frontend/js/admin-security.js", "/api/admin/sessions/revoke-others", "Revoke-all-other-sessions API must be wired.");
    includes("frontend/js/admin-security.js", "setAdminSecurityButtonLoading", "Session actions must expose button loading states.");
    includes("frontend/css/admin/admin-design-system.css", ".admin-2fa-qr", "2FA setup container must be constrained.");
    includes("frontend/js/admin-security.js", "qrDataUrl", "2FA setup UI must render backend-generated QR data URL.");
    includes("frontend/js/admin-security.js", "enable_two_factor_authentication", "2FA setup modal must use clear title copy.");
    includes("frontend/js/admin-security.js", "admin-2fa-steps", "2FA setup modal must show numbered setup steps.");
    includes("frontend/js/admin-security.js", "admin-2fa-manual", "Manual setup key must be secondary/collapsible.");
    includes("frontend/js/admin-security.js", "setup_key_warning", "Manual setup key must include a privacy warning.");
    includes("frontend/js/admin-security.js", "autocomplete=\"one-time-code\"", "2FA code input must support one-time-code autocomplete.");
    includes("frontend/js/admin-security.js", "pattern=\"\\\\d{6}\"", "2FA code input must declare 6-digit numeric pattern.");
    matches("frontend/js/admin-security.js", /\/\^\\d\{6\}\$\/\.test\(code\)/, "2FA setup must validate exactly 6 numeric digits before submit.");
    includes("frontend/js/admin-security.js", "replace(/\\D/g, \"\").slice(0, 6)", "2FA setup input must normalize to six numeric digits.");
    includes("frontend/js/admin-security.js", "saveButton.textContent = adminT(\"enable_2fa\"", "2FA setup primary action must say Enable 2FA.");
    includes("frontend/js/admin-security.js", "await window.AZIEL_ADMIN_AUTH?.loadMe?.()", "Successful 2FA setup must refresh backend admin truth.");
    includes("frontend/js/admin-security.js", "modal.id === \"admin2FAModal\"", "Closing setup modal must clear transient setup DOM state.");
    includes("frontend/css/admin/admin-design-system.css", ".admin-2fa-manual-key", "Manual setup key must be visually distinct and bounded.");
    matches("frontend/css/admin/admin-design-system.css", /@media\s*\(max-width:\s*767px\)[\s\S]*\.admin-security-card/, "Admin security UI must use the canonical phone breakpoint.");
    includes("frontend/lang/admin/en.js", "admin_accounts", "English admin security i18n must exist.");
    includes("frontend/lang/admin/my.js", "admin_accounts", "Myanmar admin security i18n must exist.");
    includes("frontend/lang/admin/en.js", "enable_two_factor_authentication", "English 2FA setup i18n must exist.");
    includes("frontend/lang/admin/my.js", "enable_two_factor_authentication", "Myanmar 2FA setup i18n must exist.");
}

function verifyRegressionBoundaries() {
    const forbidden = [
        ["backend/services/promoCodeService.js", "AdminAccount"],
        ["backend/services/sitePlacementService.js", "discountAmount"],
        ["backend/services/campaignService.js", "AdminAccount"],
        ["backend/services/walletService.js", "AdminAccount"],
        ["backend/services/paymentStateService.js", "AdminAccount"]
    ];

    forbidden.forEach(([file, term]) => {
        assert(!read(file).includes(term), `${file}: Phase 12 must not change ownership with ${term}.`);
    });
}

function main() {
    verifyModels();
    verifyAuthorization();
    verifyAuthService();
    verifyRoutes();
    verifyRoutePermissions();
    verifyAuditCoverage();
    verifyFrontend();
    verifyRegressionBoundaries();
    console.log("Admin security verification passed.");
}

main();
