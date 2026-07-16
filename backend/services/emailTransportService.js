const crypto = require("crypto");
const dns = require("dns");
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");

const SAFE_EMAIL_FAILURE_MESSAGE = "Email service is temporarily unavailable. Please try again shortly.";
const SUPPORTED_EMAIL_PROVIDERS = new Set(["brevo", "gmail_smtp"]);
const BREVO_SEND_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account";
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
let activeProvider = "";

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
    const status = Number(error.status || error.statusCode || 0);

    if (code.startsWith("EMAIL_")) return code;
    if (code === "EAUTH" || command === "AUTH" || responseCode === 535 || status === 401 || status === 403) return "EMAIL_AUTH_FAILED";
    if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || /timeout/i.test(error.message || "")) return "EMAIL_TIMEOUT";
    if (status === 408 || status === 425 || status === 429 || status >= 500) return "EMAIL_NETWORK_UNAVAILABLE";
    if (["ESOCKET", "ENETUNREACH", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
        return "EMAIL_NETWORK_UNAVAILABLE";
    }

    return "EMAIL_SEND_FAILED";
}

function sanitizeSmtpField(value = "") {
    let sanitized = String(value || "");
    [
        process.env.BREVO_API_KEY,
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
        port: original.port || error.port || "",
        status: original.status || error.status || error.statusCode || "",
        provider: error.provider || activeProvider || ""
    };
}

function normalizeProvider(value = "") {
    return String(value || "").trim().toLowerCase();
}

function getEmailProvider(env = process.env) {
    const configured = normalizeProvider(env.EMAIL_PROVIDER);
    if (configured) {
        if (!SUPPORTED_EMAIL_PROVIDERS.has(configured)) {
            throw new EmailTransportError("EMAIL_PROVIDER_UNSUPPORTED");
        }
        return configured;
    }

    if (env.NODE_ENV === "production" && String(env.BREVO_API_KEY || "").trim()) return "brevo";
    if (String(env.BREVO_API_KEY || "").trim() && !String(env.EMAIL_USER || "").trim()) return "brevo";
    return "gmail_smtp";
}

function buildFromAddress(env = process.env) {
    return String(env.EMAIL_FROM || env.EMAIL_USER || "").trim();
}

function buildFromName(env = process.env) {
    return String(env.EMAIL_FROM_NAME || "AZIEL 1Tap Shop").trim();
}

function buildReplyTo(env = process.env) {
    return String(env.EMAIL_REPLY_TO || "").trim();
}

function assertBrevoConfig(env = process.env) {
    if (!String(env.BREVO_API_KEY || "").trim() || !buildFromAddress(env)) {
        throw new EmailTransportError("EMAIL_CONFIG_MISSING");
    }
}

function assertGmailSmtpConfig(env = process.env) {
    if (!String(env.EMAIL_USER || "").trim() || !String(env.EMAIL_PASS || "").trim()) {
        throw new EmailTransportError("EMAIL_CONFIG_MISSING");
    }
}

function assertEmailConfig(env = process.env) {
    const provider = getEmailProvider(env);
    if (provider === "brevo") return assertBrevoConfig(env);
    return assertGmailSmtpConfig(env);
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
    assertGmailSmtpConfig(env);
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
    return `"${buildFromName(env)}" <${buildFromAddress(env)}>`;
}

function brevoHeaders(env = process.env) {
    return {
        "accept": "application/json",
        "api-key": String(env.BREVO_API_KEY || "").trim(),
        "content-type": "application/json"
    };
}

function buildBrevoPayload({ to, subject, html, text } = {}, env = process.env) {
    const payload = {
        sender: {
            email: buildFromAddress(env),
            name: buildFromName(env)
        },
        to: [{ email: String(to || "").trim() }],
        subject: String(subject || ""),
        htmlContent: String(html || ""),
        textContent: String(text || "")
    };

    const replyTo = buildReplyTo(env);
    if (replyTo) payload.replyTo = { email: replyTo };

    return payload;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (error?.name === "AbortError") {
            const timeoutError = new Error(`Brevo API request timed out after ${timeoutMs}ms`);
            timeoutError.code = "ETIMEDOUT";
            timeoutError.provider = "brevo";
            throw timeoutError;
        }
        error.provider = "brevo";
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function parseBrevoError(response) {
    let responseBody = "";
    try {
        responseBody = await response.text();
    } catch (_error) {
        responseBody = "";
    }

    const error = new Error(`Brevo API request failed with HTTP ${response.status}`);
    error.provider = "brevo";
    error.status = response.status;
    error.responseCode = response.status;
    error.response = responseBody.slice(0, 500);
    error.code = response.status === 401 || response.status === 403
        ? "EAUTH"
        : `BREVO_HTTP_${response.status}`;
    return error;
}

async function sendBrevoEmail(message = {}, env = process.env) {
    assertBrevoConfig(env);

    const response = await fetchWithTimeout(
        BREVO_SEND_EMAIL_URL,
        {
            method: "POST",
            headers: brevoHeaders(env),
            body: JSON.stringify(buildBrevoPayload(message, env))
        },
        DEFAULT_TIMEOUT_MS
    );

    if (!response.ok) throw await parseBrevoError(response);

    const data = await response.json().catch(() => ({}));
    return {
        messageId: data.messageId || data.messageIds?.[0] || "",
        provider: "brevo",
        response: data
    };
}

async function verifyBrevoTransport(env = process.env) {
    assertBrevoConfig(env);

    const response = await fetchWithTimeout(
        BREVO_ACCOUNT_URL,
        {
            method: "GET",
            headers: brevoHeaders(env)
        },
        DEFAULT_TIMEOUT_MS
    );

    if (!response.ok) throw await parseBrevoError(response);

    return {
        provider: "brevo",
        ready: true
    };
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
            provider: activeProvider || "",
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
    const provider = getEmailProvider();
    activeProvider = provider;

    try {
        const message = { to, subject, html, text };
        const result = provider === "brevo"
            ? await sendBrevoEmail(message)
            : await (await getTransporter()).sendMail({
                from: buildFrom(),
                to,
                subject,
                html,
                text
            });

        console.log("Email delivered:", {
            operation,
            messageType,
            provider,
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
    const provider = getEmailProvider();
    activeProvider = provider;
    if (provider === "brevo") return verifyBrevoTransport();
    const activeTransporter = await getTransporter();
    return activeTransporter.verify();
}

module.exports = {
    EmailTransportError,
    SAFE_EMAIL_FAILURE_MESSAGE,
    SUPPORTED_EMAIL_PROVIDERS,
    buildBrevoPayload,
    buildFrom,
    classifyTransportError,
    createTransport,
    getEmailProvider,
    getTransporter,
    hashRecipient,
    maskEmail,
    normalizeSmtpError,
    sendBrevoEmail,
    resolveSmtpIpv4,
    sendEmail,
    verifyTransport
};
