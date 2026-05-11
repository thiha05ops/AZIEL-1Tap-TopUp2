const Notification =
    require("../models/Notification");

async function createNotification({
    username,
    title,
    message,
    type = "order",
    orderId = ""
}) {
    try {
        if (!username) return;

        await Notification.create({
            username,
            title,
            message,
            type,
            orderId,
            isRead: false
        });

    } catch (error) {
        console.log(
            "Create notification error:",
            error
        );
    }
}

module.exports = createNotification;