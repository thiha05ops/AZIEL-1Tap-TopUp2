const EmailDelivery = require("../models/EmailDelivery");
const User = require("../models/User");
const {
    classifyTransportError,
    hashRecipient,
    maskEmail,
    sendEmail
} = require("./emailTransportService");
const { normalizeEmail } = require("./orderCustomerSnapshotService");

const STALE_PENDING_MS = 2 * 60 * 1000;

const STATUS_EVENT_MAP = Object.freeze({
    paid: "PAYMENT_CONFIRMED",
    processing: "ORDER_PROCESSING",
    completed: "ORDER_COMPLETED",
    cancelled: "ORDER_CANCELLED",
    failed: "ORDER_FAILED",
    refund_requested: "REFUND_REQUESTED",
    refund_pending: "REFUND_REQUESTED",
    refund_rejected: "REFUND_REJECTED",
    refunded: "REFUND_COMPLETED"
});

const EVENT_COPY = Object.freeze({
    PAYMENT_SLIP_SUBMITTED: {
        subject: "Payment received for review",
        title: "Payment received for review",
        nextStep: "Your payment evidence was submitted and is awaiting verification."
    },
    PAYMENT_CONFIRMED: {
        subject: "Payment confirmed",
        title: "Payment confirmed",
        nextStep: "Your payment has been confirmed. Your order will proceed according to the current fulfillment flow."
    },
    ORDER_PROCESSING: {
        subject: "Your order is processing",
        title: "Your order is processing",
        nextStep: "Fulfillment has started. You can track the latest status anytime."
    },
    ORDER_COMPLETED: {
        subject: "Your top-up is completed",
        title: "Your top-up is completed",
        nextStep: "Please verify the top-up in your game or account. Contact Support if it has not appeared."
    },
    ORDER_FAILED: {
        subject: "Action needed for your order",
        title: "Action needed for your order",
        nextStep: "Your order could not be completed. You may be eligible to request a wallet refund from tracking."
    },
    ORDER_CANCELLED: {
        subject: "Your order was cancelled",
        title: "Your order was cancelled",
        nextStep: "Your order was cancelled. If payment was already confirmed, you may be eligible to request a wallet refund from tracking."
    },
    REFUND_REQUESTED: {
        subject: "Refund request received",
        title: "Refund request received",
        nextStep: "Your refund request was submitted and is under review."
    },
    REFUND_COMPLETED: {
        subject: "Refund completed",
        title: "Refund completed",
        nextStep: "Your refund has been returned to your AZIEL Wallet."
    },
    REFUND_REJECTED: {
        subject: "Refund request update",
        title: "Refund request update",
        nextStep: "Your refund request was not approved. Contact Support if you need more help."
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

function formatMoney(order = {}) {
    const amount = Number(order.amount || order.finalAmount || 0);
    return `${amount.toLocaleString()} ${String(order.currency || "").toUpperCase() || "MMK"}`;
}

function statusLabel(status = "") {
    return String(status || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function trackingPath(order = {}) {
    return `/tracking.html?orderId=${encodeURIComponent(order.orderId || "")}`;
}

function buildOrderEmail(order = {}, eventType) {
    const copy = EVENT_COPY[eventType];
    if (!copy) return null;

    const orderId = String(order.orderId || "");
    const trackingUrl = absoluteUrl(trackingPath(order));
    const supportUrl = absoluteUrl("/support.html");
    const refundDestination = eventType === "REFUND_COMPLETED"
        ? `Refund destination: ${order.refundMethod === "wallet" || !order.refundMethod ? "AZIEL Wallet" : statusLabel(order.refundMethod)}`
        : "";
    const rejectedReason = eventType === "REFUND_REJECTED" && order.refundRejectedReason
        ? `Reason: ${order.refundRejectedReason}`
        : "";

    const fields = [
        ["Order ID", orderId],
        ["Product", order.productName || order.game || ""],
        ["Package", order.packageName || ""],
        ["Amount", formatMoney(order)],
        ["Current status", statusLabel(order.status)]
    ].filter(([, value]) => String(value || "").trim());

    const text = [
        "AZIEL 1Tap Shop",
        "",
        copy.title,
        "",
        ...fields.map(([label, value]) => `${label}: ${value}`),
        refundDestination,
        rejectedReason,
        "",
        copy.nextStep,
        "",
        `Track order: ${trackingUrl}`,
        `Support Center: ${supportUrl}`
    ].filter(line => line !== "").join("\n");

    const rows = fields.map(([label, value]) => `
        <tr>
            <td style="padding:8px 0;color:#64748b">${escapeHtml(label)}</td>
            <td style="padding:8px 0;text-align:right;font-weight:700;color:#111827">${escapeHtml(value)}</td>
        </tr>
    `).join("");

    const extra = [refundDestination, rejectedReason]
        .filter(Boolean)
        .map(line => `<p style="margin:8px 0;color:#334155">${escapeHtml(line)}</p>`)
        .join("");

    const html = `
        <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#111827">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
                <div style="padding:20px 22px;border-bottom:1px solid #e5e7eb">
                    <strong style="font-size:14px;color:#7c3aed">AZIEL 1Tap Shop</strong>
                    <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25">${escapeHtml(copy.title)}</h1>
                </div>
                <div style="padding:20px 22px">
                    <table style="width:100%;border-collapse:collapse">${rows}</table>
                    ${extra}
                    <p style="margin:18px 0;color:#334155;line-height:1.55">${escapeHtml(copy.nextStep)}</p>
                    <p style="margin:18px 0">
                        <a href="${escapeHtml(trackingUrl)}" style="display:inline-block;padding:11px 16px;border-radius:10px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700">Track order</a>
                    </p>
                    <p style="margin:0;color:#64748b;font-size:13px">Need help? Visit the <a href="${escapeHtml(supportUrl)}" style="color:#7c3aed">Support Center</a>.</p>
                </div>
            </div>
        </div>
    `;

    return {
        subject: `${copy.subject} — ${orderId}`,
        text,
        html
    };
}

async function resolveRecipient(order = {}) {
    const snapshotEmail = normalizeEmail(order.customerEmail);
    if (snapshotEmail) return snapshotEmail;

    const userId = String(order.customerUserId || "").trim();
    if (userId) {
        const user = await User.findById(userId).select("email").lean();
        const email = normalizeEmail(user?.email);
        if (email) return email;
    }

    if (order?.username && order.username !== "guest") {
        const user = await User.findOne({ username: order.username }).select("email").lean();
        const email = normalizeEmail(user?.email);
        if (email) return email;
    }

    const legacyEmail = normalizeEmail(order.email || order.userEmail || order.customer_email);
    if (legacyEmail) return legacyEmail;

    return "";
}

async function acquireDelivery({ deliveryKey, messageType, orderId, recipient }) {
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
                    orderId,
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

async function deliverOrderEmail(order, eventType) {
    const recipient = await resolveRecipient(order);
    if (!recipient) {
        return { skipped: true, reason: "missing_recipient" };
    }

    const message = buildOrderEmail(order, eventType);

    const deliveryKey = `${order.orderId}:${eventType}`;
    const delivery = await acquireDelivery({
        deliveryKey,
        messageType: eventType,
        orderId: order.orderId,
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
            operation: "order.lifecycle.email"
        });
        await markDelivered(delivery, result);
        return { delivered: true };
    } catch (error) {
        await markFailed(delivery, error);
        throw error;
    }
}

function eventTypeForTransition(entry = {}) {
    return STATUS_EVENT_MAP[String(entry.status || "").toLowerCase()] || "";
}

async function notifyOrderTransition(order, entry = {}) {
    const eventType = eventTypeForTransition(entry);
    if (!eventType) {
        return { skipped: true, reason: "status_unmapped" };
    }
    return deliverOrderEmail(order, eventType);
}

async function notifyManualPaymentSubmitted(order) {
    return deliverOrderEmail(order, "PAYMENT_SLIP_SUBMITTED");
}

module.exports = {
    EVENT_COPY,
    STATUS_EVENT_MAP,
    absoluteUrl,
    buildOrderEmail,
    deliverOrderEmail,
    eventTypeForTransition,
    notifyManualPaymentSubmitted,
    notifyOrderTransition
};
