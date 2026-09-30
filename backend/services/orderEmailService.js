const EmailDelivery = require("../models/EmailDelivery");
const CatalogProduct = require("../models/CatalogProduct");
const MediaAsset = require("../models/MediaAsset");
const User = require("../models/User");
const {
    classifyTransportError,
    hashRecipient,
    maskEmail,
    sendEmail
} = require("./emailTransportService");
const { normalizeEmail } = require("./orderCustomerSnapshotService");
const { formatPaymentDisplayName } = require("./paymentDisplayNameService");
const { buildShell: buildEmailV3Shell, button: emailV3Button } = require("./emailV3TemplateService");

const STALE_PENDING_MS = 2 * 60 * 1000;
const CANONICAL_STOREFRONT_ORIGIN = "https://azielplay.com";
const STOREFRONT_ORIGINS = new Set([CANONICAL_STOREFRONT_ORIGIN, "https://www.azielplay.com"]);
const TIMELINE_LIMIT = 12;

const STATUS_EVENT_MAP = Object.freeze({
    pending: "ORDER_CREATED_PENDING_PAYMENT",
    pending_payment: "ORDER_CREATED_PENDING_PAYMENT",
    paid: "PAYMENT_CONFIRMED",
    processing: "ORDER_PROCESSING",
    completed: "ORDER_COMPLETED",
    cancelled: "ORDER_CANCELLED",
    failed: "ORDER_FAILED",
    payment_failed: "ORDER_FAILED",
    expired: "ORDER_CANCELLED",
    refund_requested: "REFUND_REQUESTED",
    refund_pending: "REFUND_REQUESTED",
    refund_rejected: "REFUND_REJECTED",
    refunded: "REFUND_COMPLETED"
});

const EVENT_COPY = Object.freeze({
    ORDER_CREATED_PENDING_PAYMENT: {
        subject: "Order created — payment pending",
        title: "Your order has been created",
        eyebrow: "Payment required",
        accent: "#7c3aed",
        nextStep: "Complete payment from your secure AZIEL order page to continue."
    },
    PAYMENT_SLIP_SUBMITTED: {
        subject: "Payment received for review",
        title: "Payment received for review",
        eyebrow: "Verification in progress",
        accent: "#7c3aed",
        nextStep: "Your payment evidence was submitted and is awaiting verification."
    },
    PAYMENT_CONFIRMED: {
        subject: "Payment confirmed",
        title: "Payment confirmed",
        eyebrow: "Payment complete",
        accent: "#16a34a",
        nextStep: "Your payment has been confirmed. Your order will proceed according to the current fulfillment flow."
    },
    ORDER_PROCESSING: {
        subject: "Your order is processing",
        title: "Your order is processing",
        eyebrow: "Fulfillment in progress",
        accent: "#7c3aed",
        nextStep: "Fulfillment has started. You can track the latest status anytime."
    },
    ORDER_COMPLETED: {
        subject: "Your top-up is completed",
        title: "Your top-up is completed",
        eyebrow: "Order complete",
        accent: "#16a34a",
        nextStep: "Please verify the top-up in your game or account. Contact Support if it has not appeared."
    },
    ORDER_FAILED: {
        subject: "Action needed for your order",
        title: "Action needed for your order",
        eyebrow: "Order update",
        accent: "#dc2626",
        nextStep: "Your order could not be completed. You may be eligible to request a wallet refund from tracking."
    },
    ORDER_CANCELLED: {
        subject: "Your order was cancelled",
        title: "Your order was cancelled",
        eyebrow: "Order cancelled",
        accent: "#dc2626",
        nextStep: "Your order was cancelled. If payment was already confirmed, you may be eligible to request a wallet refund from tracking."
    },
    REFUND_REQUESTED: {
        subject: "Refund request received",
        title: "Refund request received",
        eyebrow: "Refund review",
        accent: "#7c3aed",
        nextStep: "Your refund request was submitted and is under review."
    },
    REFUND_COMPLETED: {
        subject: "Refund completed",
        title: "Refund completed",
        eyebrow: "Refund complete",
        accent: "#16a34a",
        nextStep: "Your refund has been returned to your AZIEL Wallet."
    },
    REFUND_REJECTED: {
        subject: "Refund request update",
        title: "Refund request update",
        eyebrow: "Refund decision",
        accent: "#dc2626",
        nextStep: "Your refund request was not approved. Contact Support if you need more help."
    }
});

function getPublicBaseUrl(env = process.env) {
    const raw = String(
        env.FRONTEND_URL ||
        env.PUBLIC_URL ||
        env.APP_URL ||
        ""
    ).trim();

    if (!raw || /localhost|127\.0\.0\.1/i.test(raw)) return CANONICAL_STOREFRONT_ORIGIN;

    try {
        const url = new URL(raw);
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.href.includes("@") ||
            url.pathname !== "/" ||
            url.search ||
            url.hash ||
            !STOREFRONT_ORIGINS.has(url.origin)
        ) return CANONICAL_STOREFRONT_ORIGIN;
        return url.origin;
    } catch (_error) {
        return CANONICAL_STOREFRONT_ORIGIN;
    }
}

function absoluteUrl(path) {
    const base = getPublicBaseUrl();
    const cleanPath = String(path || "/").startsWith("/") ? path : `/${path}`;
    return base ? `${base}${cleanPath}` : cleanPath;
}

function normalizeProductCode(order = {}) {
    return String(
        order.product?.gameCode ||
        order.packageSnapshot?.gameCode ||
        order.quoteSnapshot?.packageSnapshot?.gameCode ||
        order.productCode ||
        ""
    ).trim().toLowerCase();
}

function safePublicImageUrl(value = "", env = process.env) {
    try {
        const raw = String(value || "").trim();
        const approvedRelativePath = raw.startsWith("/uploads/media-assets/") && !raw.startsWith("//");
        const url = approvedRelativePath
            ? new URL(raw, getPublicBaseUrl(env))
            : new URL(raw);
        if (url.protocol !== "https:" || url.username || url.href.includes("@") || url.search || url.hash) return "";

        if (url.hostname === "res.cloudinary.com") {
            const cloudName = String(env.CLOUDINARY_CLOUD_NAME || "").trim();
            const [assetCloudName] = url.pathname.split("/").filter(Boolean);
            return cloudName && assetCloudName === cloudName ? url.href : "";
        }

        return url.origin === getPublicBaseUrl(env) && url.pathname.startsWith("/uploads/media-assets/")
            ? url.href
            : "";
    } catch (_error) {
        return "";
    }
}

async function resolveProductPresentation(order = {}, deps = {}) {
    const productCode = normalizeProductCode(order);
    if (!productCode || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(productCode)) return null;

    const ProductModel = deps.ProductModel || CatalogProduct;
    const AssetModel = deps.AssetModel || MediaAsset;
    const product = await ProductModel.findOne({ productCode }).select("name presentation.imageAssetId deletedAt").lean();
    if (!product || product.deletedAt) return null;

    const presentation = {
        productName: String(product.name || "").trim()
    };
    const assetId = String(product?.presentation?.imageAssetId || "").trim();
    if (!assetId) return presentation;

    let asset = null;
    try {
        asset = await AssetModel.findOne({
            assetId,
            status: "active",
            category: "product_image"
        }).select("assetId secureUrl url altText category status").lean();
    } catch (_error) {
        return presentation;
    }
    if (!asset) return presentation;

    const imageUrl = safePublicImageUrl(asset.secureUrl || asset.url || "", deps.env || process.env);
    if (!imageUrl) return presentation;

    return {
        ...presentation,
        imageUrl,
        altText: String(asset.altText || `${product.name || "AZIEL product"} artwork`).trim().slice(0, 180)
    };
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
    const amount = Number(order.commercial?.totalAmount ?? order.amount ?? order.finalAmount ?? 0);
    const currency = order.commercial?.currency || order.currency || "MMK";
    return `${amount.toLocaleString()} ${String(currency).toUpperCase()}`;
}

function statusLabel(status = "") {
    return String(status || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function paymentLabel(value = "") {
    return formatPaymentDisplayName(value, statusLabel(value));
}

function validDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function formatTimelineDate(value) {
    const date = validDate(value);
    if (!date) return "";
    return new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC"
    }).format(date).replace(",", "") + " UTC";
}

function buildTimeline(order = {}) {
    const entries = [];
    const add = (status, at) => {
        const normalizedStatus = String(status || "").trim().toLowerCase();
        const date = validDate(at);
        if (!normalizedStatus || !date) return;
        const key = `${normalizedStatus}:${date.toISOString()}`;
        if (entries.some(item => item.key === key)) return;
        entries.push({ key, status: normalizedStatus, at: date });
    };

    if (order.createdAt) add("pending_payment", order.createdAt);
    (Array.isArray(order.timeline) ? order.timeline : []).forEach(entry => add(entry?.status, entry?.at));
    (Array.isArray(order.statusHistory) ? order.statusHistory : [])
        .filter(entry => !entry?.field || entry.field === "orderStatus")
        .forEach(entry => add(entry?.toStatus || entry?.status, entry?.changedAt || entry?.at));

    return entries
        .sort((left, right) => left.at.getTime() - right.at.getTime())
        .slice(-TIMELINE_LIMIT)
        .map(({ status, at }) => ({ status, label: statusLabel(status), timestamp: formatTimelineDate(at) }));
}

function timelineColor(status = "", isCurrent = false) {
    const value = String(status || "").toLowerCase();
    if (["failed", "payment_failed", "cancelled", "expired", "refund_rejected"].includes(value)) return "#dc2626";
    if (!isCurrent) return ["pending", "pending_payment"].includes(value) ? "#64748b" : "#16a34a";
    if (["paid", "completed", "refunded"].includes(value)) return "#16a34a";
    if (["pending", "pending_payment"].includes(value)) return "#b45309";
    return "#7c3aed";
}

function statusBadgeBackground(status = "") {
    const value = String(status || "").toLowerCase();
    if (["failed", "payment_failed", "cancelled", "expired", "refund_rejected"].includes(value)) return "#3a1024";
    if (["paid", "completed", "refunded"].includes(value)) return "#0c3b2b";
    if (["pending", "pending_payment"].includes(value)) return "#3d2b0f";
    return "#24163d";
}

function trackingPath(order = {}) {
    return `/orders?orderId=${encodeURIComponent(order.orderId || "")}`;
}

function buildOrderEmail(order = {}, eventType, options = {}) {
    const copy = EVENT_COPY[eventType];
    if (!copy) return null;

    const orderId = String(order.orderId || "");
    const trackingUrl = absoluteUrl(trackingPath(order));
    const supportUrl = absoluteUrl("/support");
    const presentation = options.presentation || null;
    const timeline = buildTimeline(order);
    const productName = presentation?.productName || order.product?.gameName || order.productName || order.game || "Your product";
    const refundDestination = eventType === "REFUND_COMPLETED"
        ? `Refund destination: ${order.refundMethod === "wallet" || !order.refundMethod ? "AZIEL Wallet" : paymentLabel(order.refundMethod)}`
        : "";
    const rejectedReason = eventType === "REFUND_REJECTED" && order.refundRejectedReason
        ? `Reason: ${order.refundRejectedReason}`
        : "";

    const primaryFields = [
        ["Order ID", orderId],
        ["Product", productName],
        ["Package", order.product?.packageName || order.packageName || ""],
        ["Total", formatMoney(order)]
    ].filter(([, value]) => String(value || "").trim());
    const secondaryFields = [
        ["Payment method", paymentLabel(order.payment?.paymentMethodId || order.paymentMethod || "")],
        ["Current status", statusLabel(order.status)]
    ].filter(([, value]) => String(value || "").trim());
    const fields = [...primaryFields, ...secondaryFields];

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
        ...(timeline.length ? ["", "Order timeline:", ...timeline.map(item => `${item.label} — ${item.timestamp}`)] : []),
        "",
        `View order: ${trackingUrl}`,
        `Support Center: ${supportUrl}`
    ].filter(line => line !== "").join("\n");

    const detailRows = fields.map(([label, value], index) => `
        <tr>
            <td width="34%" valign="top" style="width:34%;padding:${index ? "11px" : "0"} 12px ${index === fields.length - 1 ? "0" : "11px"} 0;color:#938da2;font-size:12px;line-height:1.45;${index === fields.length - 1 ? "" : "border-bottom:1px solid #292a3d"}">${escapeHtml(label)}</td>
            <td width="66%" valign="top" style="width:66%;padding:${index ? "11px" : "0"} 0 ${index === fields.length - 1 ? "0" : "11px"};text-align:right;font-weight:600;color:${label === "Total" ? "#ffd522" : "#ffffff"};font-size:${label === "Total" ? "15px" : "13px"};line-height:1.45;overflow-wrap:anywhere;word-break:break-word;${index === fields.length - 1 ? "" : "border-bottom:1px solid #292a3d"}">${escapeHtml(value)}</td>
        </tr>
    `).join("");

    const extra = [refundDestination, rejectedReason]
        .filter(Boolean)
        .map(line => `<p style="margin:8px 0;color:#d1cede">${escapeHtml(line)}</p>`)
        .join("");

    const hero = presentation?.imageUrl
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#101123"><tr><td width="206" valign="middle" style="width:206px;padding:20px"><img src="${escapeHtml(presentation.imageUrl)}" width="166" alt="${escapeHtml(presentation.altText || `${productName} artwork`)}" style="display:block;width:166px;max-width:100%;height:auto;border:0;line-height:100%"></td><td valign="middle" style="padding:20px 22px 20px 0;word-break:break-word"><div style="font-size:12px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#c062ff">Your product</div><div style="margin-top:6px;color:#ffffff;font-size:19px;font-weight:800;line-height:1.35">${escapeHtml(productName)}</div></td></tr></table>`
        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#101123"><tr><td style="padding:28px;color:#c062ff"><div style="font-size:12px;font-weight:700;letter-spacing:.8px;text-transform:uppercase">Your product</div><div style="margin-top:6px;font-size:19px;font-weight:800;line-height:1.35;word-break:break-word;color:#ffffff">${escapeHtml(productName)}</div></td></tr></table>`;
    const timelineRows = timeline.map((item, index) => {
        const isCurrent = index === timeline.length - 1;
        const color = timelineColor(item.status, isCurrent);
        const isFailure = ["failed", "payment_failed", "cancelled", "expired", "refund_rejected"].includes(item.status);
        const isCompleted = !isCurrent || ["paid", "completed", "refunded"].includes(item.status);
        const marker = isFailure ? "!" : isCompleted ? "✓" : "•";
        return `
        <tr>
            <td width="32" valign="top" align="center" style="width:32px;padding:0 10px 0 0">
                <table role="presentation" width="24" cellpadding="0" cellspacing="0"><tr><td width="24" height="24" align="center" valign="middle" style="width:24px;height:24px;border:2px solid ${color};border-radius:50%;color:${color};font-size:13px;font-weight:900;line-height:20px">${marker}</td></tr>${isCurrent ? "" : '<tr><td height="28" align="center" style="height:28px;border-left:2px solid #3a3151;font-size:0;line-height:0">&nbsp;</td></tr>'}</table>
            </td>
            <td valign="top" style="padding:1px 0 ${isCurrent ? "0" : "13px"}">
                <div style="font-size:13px;font-weight:700;line-height:1.35;color:#ffffff">${escapeHtml(item.label)}</div>
                <div style="margin-top:3px;font-size:11px;line-height:1.4;color:#938da2">${escapeHtml(item.timestamp)}</div>
            </td>
        </tr>
    `;
    }).join("");

    const content = `<tr><td>${hero}</td></tr><tr><td style="padding:22px 24px 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${statusBadgeBackground(order.status)}" style="padding:6px 10px;border:1px solid ${copy.accent};border-radius:999px;color:${copy.accent};font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase">${escapeHtml(statusLabel(order.status))}</td></tr></table><div style="margin-top:13px;color:${copy.accent};font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase">${escapeHtml(copy.eyebrow)}</div><h1 style="margin:6px 0 8px;color:#ffffff;font-size:27px;line-height:1.2">${escapeHtml(copy.title)}</h1><p style="margin:0;color:#d1cede;font-size:14px;line-height:1.6">${escapeHtml(copy.nextStep)}</p></td></tr><tr><td style="padding:16px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;background:#111222;border:1px solid #302944;border-radius:10px"><tr><td style="padding:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRows}</table></td></tr></table>${extra}</td></tr>${timelineRows ? `<tr><td style="padding:3px 24px 10px"><h2 style="margin:0 0 15px;font-size:17px;color:#ffffff">Order Timeline</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${timelineRows}</table></td></tr>` : ""}<tr><td style="padding:10px 24px 20px">${emailV3Button("View Order Details", trackingUrl)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#111222;border:1px solid #292a3d;border-radius:9px"><tr><td style="padding:15px;color:#d1cede;font-size:12px;line-height:1.6"><strong style="color:#ffffff">Need Help?</strong><br>Visit the <a href="${escapeHtml(supportUrl)}" style="color:#c062ff">Support Center</a> for order assistance.</td></tr></table></td></tr>`;
    const html = buildEmailV3Shell({ title: copy.title, preheader: copy.nextStep, content });

    return {
        subject: `${copy.subject} — ${orderId}`,
        text,
        html
    };
}

async function resolveRecipient(order = {}) {
    const snapshotEmail = normalizeEmail(order.customer?.contact?.email || order.customerEmail);
    if (snapshotEmail) return snapshotEmail;

    const userId = String(order.owner?.userId || order.customerUserId || "").trim();
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
                returnDocument: "after",
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

    let presentation = null;
    try {
        presentation = await resolveProductPresentation(order);
    } catch (_error) {
        presentation = null;
    }
    const message = buildOrderEmail(order, eventType, { presentation });

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
    buildTimeline,
    deliverOrderEmail,
    eventTypeForTransition,
    notifyManualPaymentSubmitted,
    notifyOrderTransition,
    resolveProductPresentation,
    safePublicImageUrl
};
