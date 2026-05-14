const Notification =
    require("../models/Notification");

async function createNotification(data) {
    try {
        const notification =
            await Notification.create({
                username: data.username,
                title: data.title,
                message: data.message || "",
                type: data.type || "general",
                orderId: data.orderId || ""
            });

        return notification;

    } catch (error) {
        console.log(
            "Create notification error:",
            error
        );

        return null;
    }
}

module.exports = createNotification;