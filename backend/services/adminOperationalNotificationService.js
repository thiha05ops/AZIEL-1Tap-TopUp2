"use strict";

const AdminOperationalNotification = require("../models/AdminOperationalNotification");
const { PERMISSIONS } = require("./adminAuthorizationService");

function text(value) {
    return String(value ?? "").trim();
}

function money(amount, currency) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) return "";
    const code = text(currency);
    return `${numeric.toLocaleString("en-US")} ${code}`.trim();
}

function safeMetadata(payload = {}) {
    const metadata = {};

    const stringFields = [
        "username",
        "orderId",
        "ticketId",
        "chatId",
        "topupId",
        "transactionId",
        "game",
        "currency",
        "status",
        "paymentStatus"
    ];

    for (const field of stringFields) {
        const value = text(payload[field]);
        if (value) metadata[field] = value;
    }

    const amount = Number(payload.amount);
    if (Number.isFinite(amount)) {
        metadata.amount = amount;
    }

    return metadata;
}

function classify(payload = {}) {
    const type = text(payload.type).toLowerCase();

    if (type === "support_ticket") {
        return {
            category: "support",
            severity: "info",
            title: "New support ticket",
            message: text(payload.subject) || `Support request from ${text(payload.username) || "customer"}`,
            resourceType: "SupportTicket",
            resourceId: text(payload.ticketId),
            requiredPermission: PERMISSIONS.SUPPORT_READ,
            action: payload.ticketId
                ? {
                    type: "admin_section",
                    section: "support",
                    resourceId: text(payload.ticketId)
                }
                : null
        };
    }

    if (type === "live_chat") {
        const username = text(payload.username);

        return {
            category: "live_chat",
            severity: "info",
            title: "New live chat message",
            message: text(payload.message) || (username ? `Message from ${username}` : "New customer message"),
            resourceType: "LiveChat",
            resourceId: text(payload.chatId),
            requiredPermission: PERMISSIONS.LIVE_CHAT_READ,
            action: payload.chatId
                ? {
                    type: "admin_section",
                    section: "live-chat",
                    resourceId: text(payload.chatId)
                }
                : null
        };
    }

    if (
        type.includes("wallet") ||
        type.includes("topup")
    ) {
        const amount = money(payload.amount, payload.currency);

        return {
            category: "wallet",
            severity:
                type.includes("fail") || type.includes("reject")
                    ? "critical"
                    : type.includes("pending")
                        ? "warning"
                        : "info",
            title:
                type.includes("topup")
                    ? "Wallet top-up update"
                    : "Wallet update",
            message: [
                text(payload.username),
                amount
            ].filter(Boolean).join(" · "),
            resourceType: "Wallet",
            resourceId: text(payload.topupId || payload.transactionId || payload.username),
            requiredPermission: PERMISSIONS.WALLET_READ,
            action: {
                type: "admin_section",
                section: "wallet"
            }
        };
    }

    if (
        type.includes("payment") ||
        type.includes("slip")
    ) {
        const amount = money(payload.amount, payload.currency);

        return {
            category: "payments",
            severity:
                type.includes("fail") || type.includes("reject")
                    ? "critical"
                    : type.includes("uploaded") || type.includes("pending")
                        ? "warning"
                        : "info",
            title:
                type === "payment_slip_uploaded"
                    ? "Payment slip submitted"
                    : "Payment update",
            message: [
                text(payload.game),
                amount,
                text(payload.username)
            ].filter(Boolean).join(" · "),
            resourceType: "Order",
            resourceId: text(payload.orderId),
            requiredPermission: PERMISSIONS.ORDERS_READ,
            action: payload.orderId
                ? {
                    type: "admin_section",
                    section: "orders",
                    resourceId: text(payload.orderId)
                }
                : {
                    type: "admin_section",
                    section: "orders"
                }
        };
    }

    if (
        type.includes("refund") ||
        type.includes("order")
    ) {
        const amount = money(payload.amount, payload.currency);

        let severity = "info";
        if (type.includes("refund_requested")) severity = "warning";
        if (type.includes("failed") || type.includes("cancelled")) severity = "critical";
        if (type.includes("refunded") || type.includes("completed")) severity = "success";

        const titleMap = {
            refund_requested: "Refund requested",
            order_refunded: "Order refunded",
            order_completed: "Order completed",
            order_failed: "Order failed"
        };

        return {
            category: "orders",
            severity,
            title: titleMap[type] || "Order update",
            message: [
                text(payload.orderId),
                text(payload.username),
                amount
            ].filter(Boolean).join(" · "),
            resourceType: "Order",
            resourceId: text(payload.orderId),
            requiredPermission: PERMISSIONS.ORDERS_READ,
            action: payload.orderId
                ? {
                    type: "admin_section",
                    section: "orders",
                    resourceId: text(payload.orderId)
                }
                : {
                    type: "admin_section",
                    section: "orders"
                }
        };
    }

    return {
        category: "system",
        severity: "info",
        title: text(payload.title) || "Operational update",
        message: text(payload.message),
        resourceType: text(payload.resourceType),
        resourceId: text(payload.resourceId),
        requiredPermission: PERMISSIONS.DASHBOARD_READ,
        action: payload.action || null
    };
}

function buildDedupeKey(payload = {}) {
    return text(payload.dedupeKey) || undefined;
}

async function createAdminOperationalNotification(payload = {}) {
    const normalized = classify(payload);

    return AdminOperationalNotification.create({
        type: text(payload.type) || "operational_update",
        category: normalized.category,
        severity: normalized.severity,
        title: normalized.title,
        message: normalized.message,
        resourceType: normalized.resourceType,
        resourceId: normalized.resourceId,
        requiredPermission: normalized.requiredPermission,
        action: normalized.action,
        metadata: safeMetadata(payload),
        source: text(payload.source) || "realtime",
        dedupeKey: buildDedupeKey(payload)
    });
}

module.exports = {
    classify,
    createAdminOperationalNotification
};
