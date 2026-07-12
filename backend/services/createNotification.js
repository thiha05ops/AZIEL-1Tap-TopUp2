const notificationService = require("./notificationService");

async function createNotification(data) {
    try {
        const result = await notificationService.createUserNotification({
            username: data.username,
            userId: data.userId,
            user: data.user,
            title: data.title,
            message: data.message || "",
            type: data.type || "general",
            category: data.category,
            orderId: data.orderId || "",
            ticketId: data.ticketId || "",
            topupId: data.topupId || "",
            action: data.action,
            metadata: data.metadata,
            source: data.source || "legacy_helper"
        });

        return result.notification;
    } catch (error) {
        console.log("Create notification error:", error.message);
        return null;
    }
}

module.exports = createNotification;
