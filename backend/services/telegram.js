const fetch = require("node-fetch");
const fs = require("fs");
const FormData = require("form-data");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot8707178938:AAGTRfi4GeNowgQQmrlLybpkVwVClSYDbkI/sendMessage`;

    await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            chat_id: CHAT_ID,
            text
        })
    });
}

async function sendTelegramPhoto(filePath, caption) {
    const url = `https://api.telegram.org/bot8707178938:AAGTRfi4GeNowgQQmrlLybpkVwVClSYDbkI/sendPhoto`;

    const form = new FormData();
    form.append("chat_id", 8707178938);
    form.append("caption", caption);
    form.append("photo", fs.createReadStream(filePath));

    await fetch(url, {
        method: "POST",
        body: form
    });
}

module.exports = {
    sendTelegramMessage,
    sendTelegramPhoto
};