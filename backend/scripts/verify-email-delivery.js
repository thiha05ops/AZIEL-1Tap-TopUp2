const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function verifyTransportOwnership() {
    const backendFiles = [];
    function walk(dir) {
        fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(entry => {
            const relative = path.join(dir, entry.name);
            if (entry.isDirectory()) return walk(relative);
            if (entry.isFile() && entry.name.endsWith(".js")) backendFiles.push(relative);
        });
    }
    walk("backend");

    const createTransportOwners = backendFiles
        .filter(file => !file.startsWith("backend/scripts/"))
        .filter(file => read(file).includes("nodemailer.createTransport"));
    assert.deepStrictEqual(createTransportOwners, ["backend/services/emailTransportService.js"], "Exactly one canonical Nodemailer transporter owner is allowed.");

    includes("backend/services/emailTransportService.js", "host: DEFAULT_SMTP_HOST", "Transport must use explicit Gmail SMTP host.");
    includes("backend/services/emailTransportService.js", "port: DEFAULT_SMTP_PORT", "Transport must use explicit SMTP port.");
    includes("backend/services/emailTransportService.js", "secure: true", "Gmail 465 transport must be secure.");
    includes("backend/services/emailTransportService.js", "lookup: lookupIpv4", "Transport must force/prefer IPv4 DNS lookup.");
    includes("backend/services/emailTransportService.js", "dns.lookup(hostname, { ...options, family: 4 }, callback)", "IPv4 lookup must use dns.lookup family 4.");
    includes("backend/services/emailTransportService.js", "connectionTimeout", "Transport must set connection timeout.");
    includes("backend/services/emailTransportService.js", "socketTimeout", "Transport must set socket timeout.");
    includes("backend/services/emailTransportService.js", "EMAIL_CONFIG_MISSING", "Transport must classify missing config.");
    includes("backend/services/emailTransportService.js", "EMAIL_AUTH_FAILED", "Transport must classify auth failure.");
    includes("backend/services/emailTransportService.js", "EMAIL_NETWORK_UNAVAILABLE", "Transport must classify network failure.");
    includes("backend/services/emailTransportService.js", "EMAIL_TIMEOUT", "Transport must classify timeout.");
    includes("backend/services/emailTransportService.js", "EMAIL_SEND_FAILED", "Transport must classify generic send failure.");
    notMatches("backend/services/emailTransportService.js", /EMAIL_PASS[^,\n]*console|console[^;\n]*EMAIL_PASS/i, "Transport must not log EMAIL_PASS.");
}

function verifyOtpIntegration() {
    includes("backend/services/mail.js", "sendEmail", "OTP mail helper must use shared transport.");
    includes("backend/services/mail.js", "registration_otp", "Registration OTP must identify message type.");
    includes("backend/services/mail.js", "password_reset_otp", "Password reset OTP must identify message type.");
    includes("backend/services/registrationService.js", "deleteOne", "Unsent registration OTP challenge must be cleaned up.");
    includes("backend/services/registrationService.js", "Email service is temporarily unavailable. Please try again shortly.", "Registration OTP failure must be customer safe.");
    includes("backend/routes/password.js", "clearResetOTP(user)", "Unsent password reset OTP must be invalidated.");
    includes("backend/routes/password.js", "PASSWORD_RESET_EMAIL_SEND_FAILED", "Password reset OTP must expose stable failure code.");
    includes("backend/routes/password.js", "SAFE_EMAIL_FAILURE_MESSAGE", "Password reset OTP must use safe failure message.");

    const registration = read("backend/services/registrationService.js");
    ["REGISTER_OTP_MAX_ATTEMPTS", "REGISTER_OTP_TTL_MS", "REGISTER_OTP_COOLDOWN_MS", "generateOtp", "hashOtp"].forEach(pattern => {
        assert(registration.includes(pattern), `Registration OTP semantic owner missing ${pattern}`);
    });
}

function verifyOrderEmailOwnership() {
    includes("backend/models/EmailDelivery.js", "deliveryKey", "Email delivery model must own semantic delivery key.");
    includes("backend/models/EmailDelivery.js", "unique: true", "Email delivery key must be unique.");
    includes("backend/services/orderEmailService.js", "STATUS_EVENT_MAP", "Order email event map must be centralized.");
    [
        "PAYMENT_SLIP_SUBMITTED",
        "PAYMENT_CONFIRMED",
        "ORDER_PROCESSING",
        "ORDER_COMPLETED",
        "ORDER_FAILED",
        "REFUND_REQUESTED",
        "REFUND_COMPLETED",
        "REFUND_REJECTED"
    ].forEach(eventType => includes("backend/services/orderEmailService.js", eventType, `Missing lifecycle email mapping ${eventType}.`));

    includes("backend/services/orderStateService.js", "notifyOrderTransition(order, entry)", "Order transitions must trigger lifecycle email from canonical state owner.");
    includes("backend/services/orderStateService.js", "orderEmailService.notifyOrderTransition(order, entry).catch", "Email failure must be isolated from order transition.");
    includes("backend/routes/payment.js", "notifyManualPaymentSubmitted(order)", "Payment slip submitted email must be sent after slip save.");
    includes("backend/routes/order.js", "notifyManualPaymentSubmitted(order)", "Legacy manual slip path must use same email owner.");
    includes("backend/services/orderEmailService.js", "status: \"delivered\"", "Delivered lifecycle emails must be marked.");
    includes("backend/services/orderEmailService.js", "status: \"failed\"", "Failed lifecycle emails must be retryable.");
    includes("backend/services/orderEmailService.js", "duplicate_or_pending", "Duplicate semantic lifecycle emails must be skipped.");
}

function verifyTemplateAndLinkSafety() {
    const service = read("backend/services/orderEmailService.js");
    assert(service.includes("FRONTEND_URL"), "Order emails must use environment-owned public URL.");
    assert(service.includes("/tracking.html?orderId="), "Order emails must include tracking link contract.");
    assert(service.includes("/support.html"), "Order emails must include Support Center link.");
    assert(service.includes("text,") && service.includes("html,"), "Order emails must include plain text and HTML.");
    assert(!/https?:\/\/(?:localhost|127\.0\.0\.1)/.test(service), "Order email templates must not hardcode localhost URLs.");
    ["password", "OTP", "paymentEvidence", "supplierReference", "supplier credentials", "Admin-only"].forEach(term => {
        assert(!service.includes(term), `Order email service must not include unsafe term ${term}.`);
    });
}

function verifyFrontendErrorSafety() {
    includes("frontend/register.js", "safeEmailMessage", "Register UI must sanitize email transport failures.");
    includes("frontend/js/forgot-password.js", "safeEmailMessage", "Forgot password UI must sanitize email transport failures.");
    includes("frontend/register.js", "Email service is temporarily unavailable. Please try again shortly.", "Register UI must use safe email fallback.");
    includes("frontend/js/forgot-password.js", "Email service is temporarily unavailable. Please try again shortly.", "Forgot UI must use safe email fallback.");
}

function verifyScopeBoundaries() {
    const changed = [
        "backend/services/emailTransportService.js",
        "backend/services/mail.js",
        "backend/services/orderEmailService.js",
        "backend/services/orderStateService.js",
        "backend/routes/password.js",
        "backend/routes/payment.js",
        "backend/routes/order.js"
    ].map(read).join("\n");

    ["BullMQ", "Kafka", "RabbitMQ", "Redis", "newsletter", "marketing"].forEach(term => {
        assert(!changed.includes(term), `Focused pass must not add ${term}.`);
    });
}

function main() {
    verifyTransportOwnership();
    verifyOtpIntegration();
    verifyOrderEmailOwnership();
    verifyTemplateAndLinkSafety();
    verifyFrontendErrorSafety();
    verifyScopeBoundaries();
    console.log("verify-email-delivery: ok");
}

main();
