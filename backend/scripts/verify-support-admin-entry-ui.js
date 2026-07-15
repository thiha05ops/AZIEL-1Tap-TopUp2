const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function verifySupportInfrastructure() {
    const supportHtml = read("frontend/support.html");

    [
        'id="azHeaderMount" data-nav="support"',
        "css/theme/aziel-header.css",
        "css/theme/aziel-design-system.css",
        "css/support/support.css",
        "css/support/live-chat.css",
        "js/theme.js",
        "js/header-loader.js",
        "js/support.js",
        "js/live-chat.js"
    ].forEach(snippet => {
        assert(supportHtml.includes(snippet), `frontend/support.html: missing shared support infrastructure ${snippet}`);
    });

    notMatches("frontend/support.html", /localhost|127\.0\.0\.1|JWT_SECRET|SESSION_SECRET|OMISE_SECRET|EMAIL_PASS/i, "Support page must not expose local URLs or secrets.");
}

function verifySupportReadabilityCss() {
    const css = read("frontend/css/support/support.css");

    [
        "PHASE 16.3 LIGHT THEME READABILITY CLOSURE",
        "body.theme-light .support-page",
        "body.theme-light .support-hero h1",
        "body.theme-light .section-heading h2",
        "body.theme-light .status-card h2",
        "body.theme-light .category-card strong",
        "body.theme-light .faq-question",
        "body.theme-light .support-form label",
        "body.theme-light .support-form input",
        "body.theme-light .support-form select",
        "body.theme-light .support-form textarea",
        "body.theme-light .contact-item strong",
        "body.theme-light .ticket-title",
        "body.theme-light .ticket-message",
        "body.theme-light .ticket-reply",
        "body.theme-light .support-msg.success",
        "body.theme-light .support-msg.error"
    ].forEach(snippet => {
        assert(css.includes(snippet), `frontend/css/support/support.css: missing repaired selector ${snippet}`);
    });

    assert(!/\*\s*\{[^}]*color\s*:/s.test(css), "frontend/css/support/support.css: destructive global color override is not allowed.");
}

function verifySupportJsOwnership() {
    const supportJs = read("frontend/js/support.js");

    [
        'supportApiUrl("/api/support/ticket")',
        "supportApiUrl(`/api/support/my/${encodeURIComponent(username)}`)",
        "Live Chat is handled by frontend/js/live-chat.js",
        "supportSocketStarted",
        "supportUpdated"
    ].forEach(snippet => {
        assert(supportJs.includes(snippet), `frontend/js/support.js: support JS ownership changed or missing ${snippet}`);
    });

    assert(!/addEventListener\(["']wheel["']/.test(supportJs), "frontend/js/support.js: JS wheel interception must not be introduced.");
    assert(!/classList\.(add|remove|toggle)\(["']theme-(light|dark)["']/.test(supportJs), "frontend/js/support.js: support JS must not monkey-patch theme classes.");
}

function verifyLiveChatReadabilityAndOwnership() {
    const css = read("frontend/css/support/live-chat.css");
    const js = read("frontend/js/live-chat.js");

    [
        ".chat-message.bot",
        ".chat-message.user",
        "body.theme-light .chat-message.bot",
        "body.theme-light .chat-message.user",
        "body.theme-light .chat-message.bot small",
        "body.theme-light .chat-message.user small",
        "body.theme-light .typing-indicator",
        "body.theme-light .chat-input-row input",
        "body:has(.support-page) .live-chat-panel"
    ].forEach(snippet => {
        assert(css.includes(snippet), `frontend/css/support/live-chat.css: missing live chat contrast/collision selector ${snippet}`);
    });

    [
        "setInterval(() =>",
        "window.AZIEL.realtime.on(\"adminLiveReply\"",
        "apiUrl(\"/api/live-chat/send\")",
        "apiUrl(`/api/live-chat/user/${encodeURIComponent(AZIEL_CHAT.username)}`)",
        "apiUrl(`/api/live-chat/user/${encodeURIComponent(AZIEL_CHAT.username)}/unread`)",
        "apiUrl(`/api/live-chat/user/${encodeURIComponent(AZIEL_CHAT.username)}/read`)"
    ].forEach(snippet => {
        assert(js.includes(snippet), `frontend/js/live-chat.js: live chat request/realtime ownership changed or missing ${snippet}`);
    });

    assert(!/addEventListener\(["']wheel["']/.test(js), "frontend/js/live-chat.js: JS wheel interception must not be introduced.");
    assert(!/classList\.(add|remove|toggle)\(["']theme-(light|dark)["']/.test(js), "frontend/js/live-chat.js: live chat JS must not monkey-patch theme classes.");
}

function verifyAdminLoginEntry() {
    const html = read("frontend/admin-login.html");
    const js = read("frontend/js/admin-login.js");

    [
        'id="adminLoginForm"',
        'id="adminUsername"',
        'id="adminPassword"',
        'id="adminTwoFactorCode"',
        'id="adminLoginBtn"',
        'id="resetAdminSessionBtn"',
        'id="adminMsg"'
    ].forEach(snippet => {
        assert(html.includes(snippet), `frontend/admin-login.html: required admin login form element missing ${snippet}`);
    });

    [
        "AZIEL",
        "Control Center",
        "Secure operations access",
        "Continue to Console",
        "Protected administrative area",
        "Session and security controls are enforced."
    ].forEach(snippet => {
        assert(html.includes(snippet), `frontend/admin-login.html: modern admin entry copy missing ${snippet}`);
    });

    assert(html.includes("#adminLoginBtn") && html.includes("#resetAdminSessionBtn"), "frontend/admin-login.html: login and reset actions must have separate selectors.");
    assert(/#adminLoginBtn\s*\{[\s\S]*background:\s*linear-gradient/.test(html), "frontend/admin-login.html: primary login action must keep primary visual treatment.");
    assert(/#resetAdminSessionBtn\s*\{[\s\S]*background:\s*transparent/.test(html), "frontend/admin-login.html: reset action must be secondary/subtle.");

    [
        "/api/admin/login",
        "/api/admin/login/2fa",
        "localStorage.removeItem(\"adminToken\")",
        "localStorage.removeItem(\"adminUsername\")",
        "localStorage.removeItem(\"adminRole\")",
        "window.location.href = \"/admin.html\"",
        "adminLoginChallengeId"
    ].forEach(snippet => {
        assert(js.includes(snippet), `frontend/js/admin-login.js: auth/session ownership changed or missing ${snippet}`);
    });

    assert(!html.includes("azHeaderMount"), "frontend/admin-login.html: public header must not be added to admin login.");
    assert(!/<footer\b/i.test(html), "frontend/admin-login.html: public footer must not be added to admin login.");
    notMatches("frontend/admin-login.html", /localhost|127\.0\.0\.1|JWT_SECRET|SESSION_SECRET|OMISE_SECRET|EMAIL_PASS|ADMIN_PASSWORD/i, "Admin login must not expose local URLs or secrets.");
}

function main() {
    verifySupportInfrastructure();
    verifySupportReadabilityCss();
    verifySupportJsOwnership();
    verifyLiveChatReadabilityAndOwnership();
    verifyAdminLoginEntry();
    console.log("Support, Live Chat, and Admin Entry UI verification passed.");
}

main();
