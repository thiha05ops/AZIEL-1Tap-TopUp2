"use strict";

const sharp = require("sharp");
const { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, QRCodeReader } = require("@zxing/library");

class PaymentSlipQrDecodeError extends Error {
    constructor(code, message) { super(message); this.name = "PaymentSlipQrDecodeError"; this.code = code; }
}

async function decodePaymentSlipQr(input, options = {}) {
    const buffer = Buffer.isBuffer(input) ? input : input?.buffer;
    if (!buffer?.length) throw new PaymentSlipQrDecodeError("SLIP_IMAGE_REQUIRED", "Please upload a payment slip image.");
    const maxInputBytes = Number(options.maxInputBytes) || 10 * 1024 * 1024;
    if (buffer.length > maxInputBytes) throw new PaymentSlipQrDecodeError("SLIP_IMAGE_TOO_LARGE", "The payment slip image is too large.");
    try {
        const { data, info } = await sharp(buffer, { limitInputPixels: 25_000_000, failOn: "error" })
            .rotate()
            .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const pixels = new Int32Array(info.width * info.height);
        for (let i = 0, p = 0; i < data.length; i += info.channels, p += 1) {
            pixels[p] = (255 << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        }
        const source = new RGBLuminanceSource(pixels, info.width, info.height);
        const reader = new QRCodeReader();
        const result = reader.decode(new BinaryBitmap(new HybridBinarizer(source)));
        const payload = String(result?.getText?.() || "").trim();
        if (!payload) throw new Error("empty payload");
        return payload;
    } catch (error) {
        if (error instanceof PaymentSlipQrDecodeError) throw error;
        throw new PaymentSlipQrDecodeError("SLIP_QR_NOT_FOUND", "A valid bank slip QR code could not be found.");
    }
}

module.exports = Object.freeze({ PaymentSlipQrDecodeError, decodePaymentSlipQr });
