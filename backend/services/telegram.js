const fetch = require("node-fetch");
const fs = require("fs");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramPhoto(filePath, caption) {
    try {
        const url = `https://api.telegram.org/bot${TOKEN}/sendPhoto`;

        const form = new FormData();
        form.append("chat_id", CHAT_ID);
        form.append("caption", caption);
        form.append("photo", fs.createReadStream(filePath));

        const res = await fetch(url, {
            method: "POST",
            body: form
        });

        const data = await res.json();
        console.log("Telegram result:", data);
        return data;

    } catch (error) {
        console.log("Telegram send error:", error);
        throw error;
    }
}

module.exports = { sendTelegramPhoto };