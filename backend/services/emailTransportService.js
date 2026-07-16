const crypto = require("crypto");
const dns = require("dns");
const nodemailer = require("nodemailer");

const SAFE_EMAIL_FAILURE_MESSAGE = "Email service is temporarily unavailable. Please try again shortly.";
const DEFAULT_SMTP_HOST = String(process.env.EMAIL_SMTP_HOST || "smtp.gmail.com").trim();
const DEFAULT_SMTP_PORT = Number(process.env.EMAIL_SMTP_PORT || 587);
const SMTP_SECURE_SETTING = String(process.env.EMAIL_SMTP_SECURE || "").trim().toLowerCase();
const DEFAULT_SMTP_SECURE = SMTP_SECURE_SETTING
    ? SMTP_SECURE_SETTING === "true"
    : DEFAULT_SMTP_PORT === 465;
const DEFAULT_TIMEOUT_MS = Number(process.env.EMAIL_TIMEOUT_MS || 30000);

let transporter = null;

class EmailTransportError extends Error {
    constructor(code, message = SAFE_EMAIL_FAILURE_MESSAGE, cause = null) {
        super(message);
        this.name = "EmailTransportError";
        this.code = code;
        this.cause = cause;
        this.safeMessage = SAFE_EMAIL_FAILURE_MESSAGE;
    }
}

function maskEmail(email = "") {
    const [name = "", domain = ""] = String(email || "").split("@");
    if (!name || !domain) return "";
    return `${name.slice(0, 2)}***@${domain}`;
}

function hashRecipient(email = "") {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) return "";
    return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function classifyTransportError(error = {}) {
    const code = String(error.code || "").toUpperCase();
    const command = String(error.command || "").toUpperCase();
    const responseCode = Number(error.responseCode || 0);

    if (code === "EAUTH" || command === "AUTH" || responseCode === 535) return "EMAIL_AUTH_FAILED";
    if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || /timeout/i.test(error.message || "")) return "EMAIL_TIMEOUT";
    if (["ESOCKET", "ENETUNREACH", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
        return "EMAIL_NETWORK_UNAVAILABLE";
    }

    return "EMAIL_SEND_FAILED";
}

function sanitizeSmtpField(value = "") {
    let sanitized = String(value || "");
    [
        process.env.EMAIL_PASS,
        process.env.EMAIL_USER
    ].filter(Boolean).forEach(secret => {
        sanitized = sanitized.split(String(secret)).join("[redacted]");
    });
    return sanitized.slice(0, 500);
}

function normalizeSmtpError(error = {}) {
    return {
        code: sanitizeSmtpField(error.code || ""),
        message: sanitizeSmtpField(error.message || ""),
        command: sanitizeSmtpField(error.command || ""),
        response: sanitizeSmtpField(error.response || ""),
        responseCode: error.responseCode || "",
        errno: sanitizeSmtpField(error.errno || ""),
        syscall: sanitizeSmtpField(error.syscall || ""),
        address: sanitizeSmtpField(error.address || ""),
        port: error.port || ""
    };
}

function assertEmailConfig(env = process.env) {
    if (!String(env.EMAIL_USER || "").trim() || !String(env.EMAIL_PASS || "").trim()) {
        throw new EmailTransportError("EMAIL_CONFIG_MISSING");
    }
}

function lookupIpv4(hostname, options, callback) {
    const lookupOptions = typeof options === "function" ? {} : { ...(options || {}) };
    const done = typeof options === "function" ? options : callback;
    return dns.lookup(hostname, { ...lookupOptions, family: 4, all: false }, done);
}

function createTransport(env = process.env) {
    assertEmailConfig(env);

    return nodemailer.createTransport({
        host: DEFAULT_SMTP_HOST,
        port: DEFAULT_SMTP_PORT,
        secure: DEFAULT_SMTP_SECURE,
        requireTLS: !DEFAULT_SMTP_SECURE,
        auth: {
            user: env.EMAIL_USER,
            pass: env.EMAIL_PASS
        },
        connectionTimeout: DEFAULT_TIMEOUT_MS,
        greetingTimeout: DEFAULT_TIMEOUT_MS,
        socketTimeout: DEFAULT_TIMEOUT_MS,
        dnsTimeout: DEFAULT_TIMEOUT_MS,
        lookup: lookupIpv4,
        tls: {
            servername: DEFAULT_SMTP_HOST,
            minVersion: "TLSv1.2",
            rejectUnauthorized: true
        }
    });
}

function getTransporter() {
    if (!transporter) {
        transporter = createTransport();
    }
    return transporter;
}

function buildFrom(env = process.env) {
    return `"AZIEL 1Tap Shop" <${String(env.EMAIL_USER || "").trim()}>`;
}

function logEmailFailure({ operation = "email.send", to = "", messageType = "" } = {}, error) {
    const normalizedCode = error instanceof EmailTransportError
        ? error.code
        : classifyTransportError(error);

    console.log("Email delivery failed:", {
        operation,
        messageType,
        recipient: maskEmail(to),
        recipientHash: hashRecipient(to),
        code: normalizedCode,
        providerCode: error?.code || "",
        smtp: normalizeSmtpError(error),
        transport: {
            host: DEFAULT_SMTP_HOST,
            port: DEFAULT_SMTP_PORT,
            secure: DEFAULT_SMTP_SECURE,
            requireTLS: !DEFAULT_SMTP_SECURE,
            timeoutMs: DEFAULT_TIMEOUT_MS
        },
        responseCode: error?.responseCode || "",
        at: new Date().toISOString()
    });
}

async function sendEmail({ to, subject, html, text, messageType = "transactional", operation = "email.send" } = {}) {
    assertEmailConfig();

    try {
        const result = await getTransporter().sendMail({
            from: buildFrom(),
            to,
            subject,
            html,
            text
        });

        console.log("Email delivered:", {
            operation,
            messageType,
            recipient: maskEmail(to),
            recipientHash: hashRecipient(to),
            messageId: result?.messageId || "",
            at: new Date().toISOString()
        });

        return result;
    } catch (error) {
        const normalized = error instanceof EmailTransportError
            ? error
            : new EmailTransportError(classifyTransportError(error), SAFE_EMAIL_FAILURE_MESSAGE, error);
        logEmailFailure({ operation, to, messageType }, error);
        throw normalized;
    }
}

async function verifyTransport() {
    assertEmailConfig();
    return getTransporter().verify();
}

module.exports = {
    EmailTransportError,
    SAFE_EMAIL_FAILURE_MESSAGE,
    classifyTransportError,
    createTransport,
    getTransporter,
    hashRecipient,
    lookupIpv4,
    maskEmail,
    normalizeSmtpError,
    sendEmail,
    verifyTransport
};
