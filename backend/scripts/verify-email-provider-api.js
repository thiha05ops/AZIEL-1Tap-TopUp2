const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

const {
    buildBrevoPayload,
    classifyTransportError,
    getEmailProvider,
    normalizeSmtpError,
    SUPPORTED_EMAIL_PROVIDERS
} = require("../services/emailTransportService");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function verifyProviderSelection() {
    assert(SUPPORTED_EMAIL_PROVIDERS.has("brevo"), "Brevo provider must be supported.");
    assert(SUPPORTED_EMAIL_PROVIDERS.has("gmail_smtp"), "Gmail SMTP fallback provider must be supported.");

    assert.strictEqual(
        getEmailProvider({ NODE_ENV: "production", BREVO_API_KEY: "brevo-key" }),
        "brevo",
        "Production with BREVO_API_KEY must default to Brevo."
    );
    assert.strictEqual(
        getEmailProvider({ NODE_ENV: "development", BREVO_API_KEY: "brevo-key" }),
        "brevo",
        "Development with Brevo key and no Gmail user should select Brevo."
    );
    assert.strictEqual(
        getEmailProvider({ NODE_ENV: "development", EMAIL_USER: "dev@example.com", EMAIL_PASS: "app-password" }),
        "gmail_smtp",
        "Development Gmail SMTP fallback must remain available."
    );
    assert.strictEqual(
        getEmailProvider({ NODE_ENV: "production", EMAIL_PROVIDER: "gmail_smtp", EMAIL_USER: "smtp@example.com", EMAIL_PASS: "app-password" }),
        "gmail_smtp",
        "Explicit paid infrastructure SMTP fallback must remain available."
    );
    assert.throws(
        () => getEmailProvider({ EMAIL_PROVIDER: "sendmail" }),
        error => error?.code === "EMAIL_PROVIDER_UNSUPPORTED",
        "Unsupported providers must fail closed."
    );
}

function verifyBrevoPayload() {
    const payload = buildBrevoPayload({
        to: "customer@example.com",
        subject: "Subject",
        html: "<p>Hello</p>",
        text: "Hello"
    }, {
        EMAIL_FROM: "noreply@aziel.example.com",
        EMAIL_FROM_NAME: "AZIEL 1Tap Shop",
        EMAIL_REPLY_TO: "support@aziel.example.com"
    });

    assert.deepStrictEqual(payload.sender, {
        email: "noreply@aziel.example.com",
        name: "AZIEL 1Tap Shop"
    });
    assert.deepStrictEqual(payload.to, [{ email: "customer@example.com" }]);
    assert.strictEqual(payload.subject, "Subject");
    assert.strictEqual(payload.htmlContent, "<p>Hello</p>");
    assert.strictEqual(payload.textContent, "Hello");
    assert.deepStrictEqual(payload.replyTo, { email: "support@aziel.example.com" });
}

function verifyErrorMappingAndRedaction() {
    assert.strictEqual(classifyTransportError({ status: 401 }), "EMAIL_AUTH_FAILED");
    assert.strictEqual(classifyTransportError({ status: 403 }), "EMAIL_AUTH_FAILED");
    assert.strictEqual(classifyTransportError({ status: 500 }), "EMAIL_NETWORK_UNAVAILABLE");
    assert.strictEqual(classifyTransportError({ code: "ETIMEDOUT" }), "EMAIL_TIMEOUT");
    assert.strictEqual(classifyTransportError({ code: "ESOCKET" }), "EMAIL_NETWORK_UNAVAILABLE");

    const previousKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = "super-secret-brevo-key";
    const normalized = normalizeSmtpError({
        provider: "brevo",
        status: 401,
        response: "invalid key super-secret-brevo-key"
    });
    assert(!JSON.stringify(normalized).includes("super-secret-brevo-key"), "Brevo API key must be redacted from normalized errors.");
    if (previousKey === undefined) {
        delete process.env.BREVO_API_KEY;
    } else {
        process.env.BREVO_API_KEY = previousKey;
    }
}

function verifySourceContracts() {
    const transport = "backend/services/emailTransportService.js";
    includes(transport, "BREVO_SEND_EMAIL_URL", "Brevo send endpoint must be centralized.");
    includes(transport, "https://api.brevo.com/v3/smtp/email", "Brevo transactional HTTPS endpoint missing.");
    includes(transport, "sendBrevoEmail", "Brevo sender function missing.");
    includes(transport, "verifyBrevoTransport", "Brevo provider verification missing.");
    includes(transport, "node-fetch", "Brevo provider must use HTTPS fetch.");
    includes(transport, "nodemailer.createTransport", "Gmail SMTP fallback must remain available.");
    includes(transport, "dns.promises.lookup(hostname, { family: 4 })", "Gmail fallback must pre-resolve IPv4.");
    includes(transport, "tls:", "Gmail fallback TLS config missing.");
    includes(transport, "servername: TLS_SERVERNAME", "Gmail fallback must preserve smtp.gmail.com TLS verification.");
    includes(transport, "htmlContent", "Brevo payload must preserve HTML templates.");
    includes(transport, "textContent", "Brevo payload must preserve text templates.");
    includes(transport, "EMAIL_FROM", "EMAIL_FROM env support missing.");
    includes(transport, "EMAIL_FROM_NAME", "EMAIL_FROM_NAME env support missing.");
    includes(transport, "EMAIL_REPLY_TO", "EMAIL_REPLY_TO env support missing.");
    includes(transport, "BREVO_API_KEY", "BREVO_API_KEY env support missing.");
    notMatches(transport, /console[^;\n]*BREVO_API_KEY|BREVO_API_KEY[^,\n]*console/i, "Brevo API key must not be logged.");

    includes("backend/services/mail.js", "sendEmail", "OTP helpers must still use centralized sendEmail.");
    includes("backend/services/orderEmailService.js", "sendEmail", "Order lifecycle emails must still use centralized sendEmail.");
    includes("backend/services/orderEmailService.js", "deliveryKey", "EmailDelivery idempotency key must remain.");
    includes("backend/services/orderEmailService.js", "duplicate_or_pending", "EmailDelivery duplicate protection must remain.");
    includes("backend/services/orderEmailService.js", "status: \"failed\"", "Order email failure isolation/retry state must remain.");
    includes("backend/services/orderStateService.js", "orderEmailService.notifyOrderTransition(order, entry).catch", "Order lifecycle email failures must remain isolated.");
}

function main() {
    verifyProviderSelection();
    verifyBrevoPayload();
    verifyErrorMappingAndRedaction();
    verifySourceContracts();
    console.log("Email provider API verification passed.");
}

main();
