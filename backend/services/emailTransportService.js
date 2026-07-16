const crypto = require("crypto");
const dns = require("dns");
const nodemailer = require("nodemailer");

const SAFE_EMAIL_FAILURE_MESSAGE = "Email service is temporarily unavailable. Please try again shortly.";
const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 465;
const DEFAULT_TIMEOUT_MS = Number(process.env.EMAIL_TIMEOUT_MS || 10000);

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
    if (["ENETUNREACH", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
        return "EMAIL_NETWORK_UNAVAILABLE";
    }

    return "EMAIL_SEND_FAILED";
}

function assertEmailConfig(env = process.env) {
    if (!String(env.EMAIL_USER || "").trim() || !String(env.EMAIL_PASS || "").trim()) {
        throw new EmailTransportError("EMAIL_CONFIG_MISSING");
    }
}

function lookupIpv4(hostname, options, callback) {
    return dns.lookup(hostname, { ...options, family: 4 }, callback);
}

function createTransport(env = process.env) {
    assertEmailConfig(env);

    return nodemailer.createTransport({
        host: DEFAULT_SMTP_HOST,
        port: DEFAULT_SMTP_PORT,
        secure: true,
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
            servername: DEFAULT_SMTP_HOST
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
    sendEmail,
    verifyTransport
};
