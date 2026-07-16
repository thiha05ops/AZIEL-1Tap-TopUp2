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
const TLS_SERVERNAME = "smtp.gmail.com";

let transporter = null;
let transporterPromise = null;
let resolvedSmtpAddress = "";

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
    const original = error?.cause || error;
    return {
        code: sanitizeSmtpField(original.code || error.code || ""),
        message: sanitizeSmtpField(original.message || error.message || ""),
        command: sanitizeSmtpField(original.command || error.command || ""),
        response: sanitizeSmtpField(original.response || error.response || ""),
        responseCode: original.responseCode || error.responseCode || "",
        errno: sanitizeSmtpField(original.errno || error.errno || ""),
        syscall: sanitizeSmtpField(original.syscall || error.syscall || ""),
        address: sanitizeSmtpField(original.address || error.address || ""),
        port: original.port || error.port || ""
    };
}

function assertEmailConfig(env = process.env) {
    if (!String(env.EMAIL_USER || "").trim() || !String(env.EMAIL_PASS || "").trim()) {
        throw new EmailTransportError("EMAIL_CONFIG_MISSING");
    }
}

async function resolveSmtpIpv4(hostname = DEFAULT_SMTP_HOST) {
    let result;
    try {
        result = await dns.promises.lookup(hostname, { family: 4 });
    } catch (error) {
        throw new EmailTransportError("EMAIL_NETWORK_UNAVAILABLE", SAFE_EMAIL_FAILURE_MESSAGE, error);
    }

    const address = String(result?.address || "").trim();
    if (!address || address.includes(":")) {
        throw new EmailTransportError("EMAIL_NETWORK_UNAVAILABLE", SAFE_EMAIL_FAILURE_MESSAGE, new Error(`SMTP IPv4 resolution returned invalid address for ${hostname}`));
    }
    resolvedSmtpAddress = address;
    console.log("Email SMTP IPv4 resolved:", {
        host: hostname,
        address,
        port: DEFAULT_SMTP_PORT,
        secure: DEFAULT_SMTP_SECURE,
        requireTLS: !DEFAULT_SMTP_SECURE
    });
    return address;
}

async function createTransport(env = process.env) {
    assertEmailConfig(env);
    const smtpAddress = await resolveSmtpIpv4(DEFAULT_SMTP_HOST);

    return nodemailer.createTransport({
        host: smtpAddress,
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
        tls: {
            servername: TLS_SERVERNAME,
            minVersion: "TLSv1.2",
            rejectUnauthorized: true
        }
    });
}

async function getTransporter() {
    if (!transporter) {
        transporterPromise = transporterPromise || createTransport();
        transporter = await transporterPromise;
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
            resolvedAddress: resolvedSmtpAddress,
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
        const activeTransporter = await getTransporter();
        const result = await activeTransporter.sendMail({
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
    const activeTransporter = await getTransporter();
    return activeTransporter.verify();
}

module.exports = {
    EmailTransportError,
    SAFE_EMAIL_FAILURE_MESSAGE,
    classifyTransportError,
    createTransport,
    getTransporter,
    hashRecipient,
    maskEmail,
    normalizeSmtpError,
    resolveSmtpIpv4,
    sendEmail,
    verifyTransport
};
