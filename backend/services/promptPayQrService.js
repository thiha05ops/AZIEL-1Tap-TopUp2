const QRCode = require("qrcode");

const RECIPIENT_TYPES = Object.freeze({
    PHONE: "PHONE",
    NATIONAL_ID: "NATIONAL_ID",
    TAX_ID: "TAX_ID"
});

function emv(id, value) {
    const text = String(value || "");
    return `${id}${String(text.length).padStart(2, "0")}${text}`;
}

function crc16Ccitt(value) {
    let crc = 0xFFFF;
    for (let i = 0; i < value.length; i++) {
        crc ^= value.charCodeAt(i) << 8;
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 0x8000
                ? (crc << 1) ^ 0x1021
                : crc << 1;
            crc &= 0xFFFF;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
}

function normalizeRecipientType(value = "") {
    const type = String(value || "").trim().toUpperCase();
    return RECIPIENT_TYPES[type] || "";
}

function digitsOnly(value = "") {
    return String(value || "").replace(/\D/g, "");
}

function normalizePromptPayRecipient(type, value) {
    const recipientType = normalizeRecipientType(type);
    const digits = digitsOnly(value);

    if (recipientType === RECIPIENT_TYPES.PHONE) {
        let phone = digits;
        if (phone.startsWith("66") && phone.length === 11) phone = `0${phone.slice(2)}`;
        if (phone.startsWith("0066") && phone.length === 13) phone = `0${phone.slice(4)}`;
        if (!/^0[689]\d{8}$/.test(phone)) {
            throw Object.assign(new Error("Invalid PromptPay phone number"), {
                code: "PROMPTPAY_RECIPIENT_INVALID"
            });
        }
        return {
            recipientType,
            proxyType: "01",
            proxyValue: `0066${phone.slice(1)}`
        };
    }

    if (recipientType === RECIPIENT_TYPES.NATIONAL_ID || recipientType === RECIPIENT_TYPES.TAX_ID) {
        if (!/^\d{13}$/.test(digits)) {
            throw Object.assign(new Error("Invalid PromptPay ID"), {
                code: "PROMPTPAY_RECIPIENT_INVALID"
            });
        }
        return {
            recipientType,
            proxyType: "02",
            proxyValue: digits
        };
    }

    throw Object.assign(new Error("PromptPay recipient type is required"), {
        code: "PROMPTPAY_RECIPIENT_TYPE_INVALID"
    });
}

function maskPromptPayRecipient(value = "") {
    const digits = digitsOnly(value);
    if (!digits) return "";
    if (digits.length <= 4) return "*".repeat(digits.length);
    return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeAmount(amount) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw Object.assign(new Error("Invalid PromptPay amount"), {
            code: "PROMPTPAY_AMOUNT_INVALID"
        });
    }

    const text = String(amount);
    const decimal = text.includes(".") ? text.split(".")[1] : "";
    if (decimal.length > 2) {
        throw Object.assign(new Error("PromptPay amount supports at most two decimals"), {
            code: "PROMPTPAY_AMOUNT_INVALID"
        });
    }

    return Number(numeric.toFixed(2));
}

function validateCurrency(currency) {
    if (String(currency || "").toUpperCase() !== "THB") {
        throw Object.assign(new Error("PromptPay dynamic QR requires THB"), {
            code: "PROMPTPAY_CURRENCY_INVALID"
        });
    }
}

function buildPromptPayPayload({ recipientType, recipientValue, amount }) {
    const recipient = normalizePromptPayRecipient(recipientType, recipientValue);
    const normalizedAmount = normalizeAmount(amount);

    const merchantAccountInfo = [
        emv("00", "A000000677010111"),
        emv("01", recipient.proxyType),
        emv("02", recipient.proxyValue)
    ].join("");

    const payloadWithoutCrc = [
        emv("00", "01"),
        emv("01", "12"),
        emv("29", merchantAccountInfo),
        emv("53", "764"),
        emv("54", normalizedAmount.toFixed(2)),
        emv("58", "TH"),
        "6304"
    ].join("");

    return `${payloadWithoutCrc}${crc16Ccitt(payloadWithoutCrc)}`;
}

function validatePromptPayPayloadCrc(payload = "") {
    const text = String(payload || "");
    if (!/6304[0-9A-F]{4}$/i.test(text)) return false;
    const withoutCrc = text.slice(0, -4);
    return crc16Ccitt(withoutCrc) === text.slice(-4).toUpperCase();
}

async function createPromptPayQr({ method, amount, currency, orderReference }) {
    validateCurrency(currency);
    const normalizedAmount = normalizeAmount(amount);
    const qrPayload = buildPromptPayPayload({
        recipientType: method.promptPayRecipientType,
        recipientValue: method.promptPayRecipientValue,
        amount: normalizedAmount
    });
    const qrImage = await QRCode.toDataURL(qrPayload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 640
    });
    const minutes = Number(method.dynamicQrExpiryMinutes || 15);
    const expiresAt = new Date(Date.now() + (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000);

    return {
        paymentMethodKey: method.key,
        amount: normalizedAmount,
        currency: "THB",
        orderReference: String(orderReference || ""),
        qrPayload,
        qrImage,
        expiresAt: expiresAt.toISOString()
    };
}

module.exports = {
    RECIPIENT_TYPES,
    buildPromptPayPayload,
    createPromptPayQr,
    crc16Ccitt,
    maskPromptPayRecipient,
    normalizeAmount,
    normalizePromptPayRecipient,
    validatePromptPayPayloadCrc
};
