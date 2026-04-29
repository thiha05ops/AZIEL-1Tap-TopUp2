const fetch = require("node-fetch");
const fs = require("fs");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// TEXT MESSAGE
async function sendTelegramMessage(text) {
    try {
        if (!TOKEN || !CHAT_ID) return;

        const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text
            })
        });

        return await res.json();

    } catch (error) {
        console.log("Telegram message error:", error);
    }
}

// PHOTO (already yours)
async function sendTelegramPhoto(filePath, caption) {
    try {
        if (!TOKEN || !CHAT_ID) return;

        const url = `https://api.telegram.org/bot${TOKEN}/sendPhoto`;

        const form = new FormData();
        form.append("chat_id", CHAT_ID);
        form.append("caption", caption);
        form.append("photo", fs.createReadStream(filePath));

        const res = await fetch(url, {
            method: "POST",
            body: form
        });

        return await res.json();

    } catch (error) {
        console.log("Telegram send error:", error);
    }
}

module.exports = {
    sendTelegramMessage,
    sendTelegramPhoto
};