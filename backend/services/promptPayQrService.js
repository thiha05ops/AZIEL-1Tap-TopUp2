const QRCode = require("qrcode");
const { PNG } = require("pngjs");

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
            proxyTag: "01",
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
            proxyTag: "02",
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
        emv(recipient.proxyTag, recipient.proxyValue)
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

function parseEmvPayload(payload = "") {
    const text = String(payload || "");
    const fields = [];
    let index = 0;

    while (index + 4 <= text.length) {
        const id = text.slice(index, index + 2);
        const length = Number(text.slice(index + 2, index + 4));
        if (!/^\d{2}$/.test(id) || !Number.isFinite(length) || length < 0) {
            throw Object.assign(new Error("Invalid EMV payload"), {
                code: "PROMPTPAY_PAYLOAD_INVALID"
            });
        }
        const valueStart = index + 4;
        const valueEnd = valueStart + length;
        if (valueEnd > text.length) {
            throw Object.assign(new Error("Invalid EMV payload length"), {
                code: "PROMPTPAY_PAYLOAD_INVALID"
            });
        }
        fields.push({
            id,
            length,
            value: text.slice(valueStart, valueEnd)
        });
        index = valueEnd;
    }

    if (index !== text.length) {
        throw Object.assign(new Error("Invalid EMV payload trailing data"), {
            code: "PROMPTPAY_PAYLOAD_INVALID"
        });
    }

    return fields;
}

function fieldValue(fields, id) {
    return fields.find(field => field.id === id)?.value || "";
}

function decodePromptPayPayload(payload = "") {
    const fields = parseEmvPayload(payload);
    const merchantInfo = parseEmvPayload(fieldValue(fields, "29"));
    const amountText = fieldValue(fields, "54");
    const amount = amountText ? Number(amountText) : null;
    return {
        payloadFormatIndicator: fieldValue(fields, "00"),
        pointOfInitiationMethod: fieldValue(fields, "01"),
        merchantAccountInfo: {
            applicationId: fieldValue(merchantInfo, "00"),
            proxyType: merchantInfo.some(field => field.id === "01") ? "PHONE" : "NATIONAL_ID_OR_TAX_ID",
            proxyTag: merchantInfo.find(field => field.id === "01" || field.id === "02")?.id || "",
            proxyValue: merchantInfo.find(field => field.id === "01" || field.id === "02")?.value || ""
        },
        currency: fieldValue(fields, "53"),
        amountText,
        amount,
        country: fieldValue(fields, "58"),
        crc: fieldValue(fields, "63"),
        crcValid: validatePromptPayPayloadCrc(payload)
    };
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
    const decodedPayload = decodePromptPayPayload(qrPayload);
    if (
        decodedPayload.amountText !== normalizedAmount.toFixed(2) ||
        decodedPayload.currency !== "764" ||
        decodedPayload.country !== "TH" ||
        decodedPayload.crcValid !== true
    ) {
        throw Object.assign(new Error("Generated PromptPay QR payload failed validation"), {
            code: "PROMPTPAY_PAYLOAD_INVALID"
        });
    }
    const qrImage = await QRCode.toDataURL(qrPayload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 640
    });
    const qrImagePayloadMatches = qrImageMatchesPayload(qrImage, qrPayload);
    if (!qrImagePayloadMatches) {
        throw Object.assign(new Error("Generated PromptPay QR image does not match payload"), {
            code: "PROMPTPAY_QR_IMAGE_MISMATCH"
        });
    }
    const minutes = Number(method.dynamicQrExpiryMinutes || 15);
    const expiresAt = new Date(Date.now() + (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000);

    return {
        paymentMethodKey: method.key,
        amount: normalizedAmount,
        currency: "THB",
        orderReference: String(orderReference || ""),
        qrPayload,
        encodedAmount: decodedPayload.amountText,
        decodedPayload,
        qrImagePayloadMatches,
        qrImage,
        expiresAt: expiresAt.toISOString()
    };
}

function parsePngDataUrl(dataUrl = "") {
    const match = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
    if (!match) {
        throw Object.assign(new Error("QR image must be a PNG data URL"), {
            code: "PROMPTPAY_QR_IMAGE_INVALID"
        });
    }
    return PNG.sync.read(Buffer.from(match[1], "base64"));
}

function pixelIsDark(png, x, y) {
    const clampedX = Math.max(0, Math.min(png.width - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(png.height - 1, Math.round(y)));
    const idx = (png.width * clampedY + clampedX) << 2;
    const alpha = png.data[idx + 3];
    if (alpha === 0) return false;
    const luminance = (png.data[idx] * 0.299) + (png.data[idx + 1] * 0.587) + (png.data[idx + 2] * 0.114);
    return luminance < 128;
}

function qrImageMatchesPayload(dataUrl, payload) {
    const png = parsePngDataUrl(dataUrl);
    const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
    const matrixSize = qr.modules.size;
    const quietZone = 1;
    const totalModules = matrixSize + quietZone * 2;
    const scaleX = png.width / totalModules;
    const scaleY = png.height / totalModules;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return false;

    for (let row = 0; row < matrixSize; row++) {
        for (let col = 0; col < matrixSize; col++) {
            const expected = qr.modules.data[row * matrixSize + col] === 1;
            const x = (quietZone + col + 0.5) * scaleX;
            const y = (quietZone + row + 0.5) * scaleY;
            if (pixelIsDark(png, x, y) !== expected) return false;
        }
    }

    return true;
}

module.exports = {
    RECIPIENT_TYPES,
    buildPromptPayPayload,
    createPromptPayQr,
    crc16Ccitt,
    decodePromptPayPayload,
    maskPromptPayRecipient,
    normalizeAmount,
    normalizePromptPayRecipient,
    qrImageMatchesPayload,
    validatePromptPayPayloadCrc
};
