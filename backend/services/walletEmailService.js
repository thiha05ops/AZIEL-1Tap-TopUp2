const EmailDelivery = require("../models/EmailDelivery");
const User = require("../models/User");
const {
    classifyTransportError,
    hashRecipient,
    maskEmail,
    sendEmail
} = require("./emailTransportService");
const { normalizeEmail } = require("./orderCustomerSnapshotService");
const { formatPaymentDisplayName } = require("./paymentDisplayNameService");

const STALE_PENDING_MS = 2 * 60 * 1000;

const WALLET_EMAIL_EVENTS = Object.freeze({
    APPROVED: "WALLET_TOPUP_APPROVED",
    REJECTED: "WALLET_TOPUP_REJECTED"
});

const EVENT_COPY = Object.freeze({
    WALLET_TOPUP_APPROVED: {
        subject: "Wallet top-up approved",
        title: "Wallet top-up approved",
        nextStep: "The approved amount has been added to your AZIEL Wallet balance."
    },
    WALLET_TOPUP_REJECTED: {
        subject: "Wallet top-up update",
        title: "Wallet top-up was not approved",
        nextStep: "Your wallet top-up was not approved. Please visit the Support Center if you need help reviewing the payment evidence."
    }
});

function getPublicBaseUrl() {
    const raw = String(
        process.env.FRONTEND_URL ||
        process.env.PUBLIC_URL ||
        process.env.APP_URL ||
        ""
    ).trim();

    if (!raw || /localhost|127\.0\.0\.1/i.test(raw)) return "";

    try {
        const url = new URL(raw);
        if (!["https:", "http:"].includes(url.protocol)) return "";
        return url.origin;
    } catch (_error) {
        return "";
    }
}

function absoluteUrl(path) {
    const base = getPublicBaseUrl();
    const cleanPath = String(path || "/").startsWith("/") ? path : `/${path}`;
    return base ? `${base}${cleanPath}` : cleanPath;
}

function escapeHtml(value = "") {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatMoney(topup = {}) {
    const amount = Number(topup.amount || 0);
    return `${amount.toLocaleString()} ${String(topup.currency || "").toUpperCase() || "MMK"}`;
}

function statusLabel(status = "") {
    return String(status || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function paymentLabel(value = "") {
    return formatPaymentDisplayName(value, statusLabel(value));
}

function buildWalletTopupEmail(topup = {}, eventType) {
    const copy = EVENT_COPY[eventType];
    if (!copy) return null;

    const topupId = String(topup.topupId || "");
    const walletUrl = absoluteUrl("/wallet.html");
    const supportUrl = absoluteUrl("/support.html");
    const fields = [
        ["Top-up ID", topupId],
        ["Amount", formatMoney(topup)],
        ["Payment method", paymentLabel(topup.paymentSnapshot?.method || topup.paymentMethod || "")],
        ["Current status", statusLabel(topup.status)]
    ].filter(([, value]) => String(value || "").trim());

    const text = [
        "AZIEL 1Tap Shop",
        "",
        copy.title,
        "",
        ...fields.map(([label, value]) => `${label}: ${value}`),
        "",
        copy.nextStep,
        "",
        `Open wallet: ${walletUrl}`,
        `Support Center: ${supportUrl}`
    ].filter(line => line !== "").join("\n");

    const rows = fields.map(([label, value]) => `
        <tr>
            <td style="padding:8px 0;color:#64748b">${escapeHtml(label)}</td>
            <td style="padding:8px 0;text-align:right;font-weight:700;color:#111827">${escapeHtml(value)}</td>
        </tr>
    `).join("");

    const html = `
        <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#111827">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
                <div style="padding:20px 22px;border-bottom:1px solid #e5e7eb">
                    <strong style="font-size:14px;color:#7c3aed">AZIEL 1Tap Shop</strong>
                    <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25">${escapeHtml(copy.title)}</h1>
                </div>
                <div style="padding:20px 22px">
                    <table style="width:100%;border-collapse:collapse">${rows}</table>
                    <p style="margin:18px 0;color:#334155;line-height:1.55">${escapeHtml(copy.nextStep)}</p>
                    <p style="margin:18px 0">
                        <a href="${escapeHtml(walletUrl)}" style="display:inline-block;padding:11px 16px;border-radius:10px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700">Open wallet</a>
                    </p>
                    <p style="margin:0;color:#64748b;font-size:13px">Need help? Visit the <a href="${escapeHtml(supportUrl)}" style="color:#7c3aed">Support Center</a>.</p>
                </div>
            </div>
        </div>
    `;

    return {
        subject: `${copy.subject} — ${topupId}`,
        text,
        html
    };
}

async function resolveRecipient(topup = {}) {
    const snapshotEmail = normalizeEmail(topup.customerEmail);
    if (snapshotEmail) return snapshotEmail;

    const userId = String(topup.customerUserId || "").trim();
    if (userId) {
        const user = await User.findById(userId).select("email").lean();
        const email = normalizeEmail(user?.email);
        if (email) return email;
    }

    if (topup?.username && topup.username !== "guest") {
        const user = await User.findOne({ username: topup.username }).select("email").lean();
        const email = normalizeEmail(user?.email);
        if (email) return email;
    }

    const legacyEmail = normalizeEmail(topup.email || topup.userEmail || topup.customer_email);
    if (legacyEmail) return legacyEmail;

    return "";
}

async function acquireDelivery({ deliveryKey, messageType, topupId, recipient }) {
    const staleBefore = new Date(Date.now() - STALE_PENDING_MS);

    try {
        const delivery = await EmailDelivery.findOneAndUpdate(
            {
                deliveryKey,
                $or: [
                    { status: "failed" },
                    { status: "pending", updatedAt: { $lt: staleBefore } },
                    { status: { $exists: false } }
                ]
            },
            {
                $setOnInsert: {
                    deliveryKey,
                    messageType,
                    orderId: topupId,
                    recipientHash: hashRecipient(recipient),
                    recipientMasked: maskEmail(recipient)
                },
                $set: {
                    status: "pending",
                    lastAttemptAt: new Date(),
                    lastErrorCode: ""
                },
                $inc: {
                    attemptCount: 1
                }
            },
            {
                new: true,
                upsert: true
            }
        );
        return delivery;
    } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
    }
}

async function markDelivered(delivery, result) {
    if (!delivery?._id) return;
    await EmailDelivery.updateOne(
        { _id: delivery._id },
        {
            $set: {
                status: "delivered",
                deliveredAt: new Date(),
                providerMessageId: result?.messageId || "",
                lastErrorCode: ""
            }
        }
    );
}

async function markFailed(delivery, error) {
    if (!delivery?._id) return;
    await EmailDelivery.updateOne(
        { _id: delivery._id },
        {
            $set: {
                status: "failed",
                lastErrorCode: classifyTransportError(error)
            }
        }
    );
}

async function deliverWalletTopupEmail(topup, eventType) {
    const recipient = await resolveRecipient(topup);
    if (!recipient) {
        return { skipped: true, reason: "missing_recipient" };
    }

    const message = buildWalletTopupEmail(topup, eventType);
    const topupId = String(topup.topupId || topup._id || "");
    const deliveryKey = `${topupId}:${eventType}`;
    const delivery = await acquireDelivery({
        deliveryKey,
        messageType: eventType,
        topupId,
        recipient
    });

    if (!delivery) {
        return { skipped: true, reason: "duplicate_or_pending" };
    }

    if (!message) {
        return { skipped: true, reason: "event_unmapped" };
    }

    try {
        const result = await sendEmail({
            to: recipient,
            subject: message.subject,
            html: message.html,
            text: message.text,
            messageType: eventType,
            operation: "wallet.topup.lifecycle.email"
        });
        await markDelivered(delivery, result);
        return { delivered: true };
    } catch (error) {
        await markFailed(delivery, error);
        throw error;
    }
}

async function notifyWalletTopupApproved(topup) {
    return deliverWalletTopupEmail(topup, WALLET_EMAIL_EVENTS.APPROVED);
}

async function notifyWalletTopupRejected(topup) {
    return deliverWalletTopupEmail(topup, WALLET_EMAIL_EVENTS.REJECTED);
}

module.exports = {
    EVENT_COPY,
    WALLET_EMAIL_EVENTS,
    buildWalletTopupEmail,
    deliverWalletTopupEmail,
    notifyWalletTopupApproved,
    notifyWalletTopupRejected
};
