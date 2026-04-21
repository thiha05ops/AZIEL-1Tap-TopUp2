const express = require("express");
const router = express.Router();

const sendTelegramMessage = require("../services/telegram");

router.post("/order", async (req, res) => {
    const { username, packageName, userId, serverId } = req.body;

    const text = `
🔥 New Order

👤 User: ${username}
💎 Package: ${packageName}
🆔 User ID: ${userId}
🌍 Server: ${serverId}
`;

    await sendTelegramMessage(text);

    res.json({
        success: true,
        message: "Order sent"
    });
});

module.exports = router;