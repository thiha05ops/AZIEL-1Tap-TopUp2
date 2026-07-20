const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function includes(file, snippet, message) {
    assert(read(file).includes(snippet), `${file}: ${message}`);
}

function notMatches(file, pattern, message) {
    assert(!pattern.test(read(file)), `${file}: ${message}`);
}

function verifySharedQrSaver() {
    const file = "frontend/js/payment/payment-checkout-sheet.js";

    includes(file, "window.PaymentQrSaver", "shared QR saver must be exposed for all payment QR flows.");
    includes(file, "await fetchImageBlob(href)", "Save QR must fetch the rendered QR as a Blob.");
    includes(file, "URL.createObjectURL(blob)", "Save QR must download from a local Blob URL.");
    includes(file, "navigator.share", "Save QR must support mobile Web Share.");
    includes(file, "files: [file]", "Web Share must use file sharing for mobile save flows.");
    includes(file, "getQrProxyUrl(options)", "cross-origin failures must fall back to the same-origin QR proxy.");
    includes(file, "QR ready to save", "successful save/share initiation must provide clear feedback.");
    includes(file, "Could not save QR. Long-press the image to save.", "Save QR failure must provide fallback guidance.");
    includes(file, "onSuccess: () => updateChecklist(\"save_qr\")", "save_qr checklist must update only after save/share initiation.");
    notMatches(file, /window\.open\(/, "Save QR must never use window.open.");
    notMatches(file, /anchor\.href\s*=\s*href[\s\S]{0,120}anchor\.download/, "Save QR must not download directly from the remote QR URL.");
}

function verifyPromptPayUsesSharedQrSaver() {
    const file = "frontend/js/payment/payment-promptpay.js";

    includes(file, "window.PaymentQrSaver.save", "PromptPay Save QR must use the shared Blob/share/download path.");
    includes(file, "onSuccess: () => completeGuideStep(\"save_qr\")", "PromptPay save_qr checklist must update after shared save success.");
    notMatches(file, /link\.href\s*=\s*href[\s\S]{0,120}link\.download/, "PromptPay must not use direct remote-anchor download.");
    notMatches(file, /window\.open\(/, "PromptPay Save QR must not navigate away.");
}

function verifyBackendProxy() {
    const file = "backend/routes/paymentMethods.js";

    includes(file, 'router.get("/payment-methods/:key/qr-download"', "same-origin QR download proxy route must exist.");
    includes(file, "PaymentMethod.findOne(filter)", "proxy must resolve stored PaymentMethod records instead of accepting arbitrary URLs.");
    includes(file, "enabled: true", "proxy must only serve enabled payment methods.");
    includes(file, "getConfiguredQrUrl(method", "proxy must use the configured payment method QR URL.");
    includes(file, "isTrustedCloudinaryQrUrl(qrUrl)", "proxy must allow-list trusted Cloudinary QR URLs.");
    includes(file, "isTrustedCloudinaryQrUrl(upstream.url || qrUrl)", "proxy must validate the final upstream URL after redirects.");
    includes(file, "contentType.startsWith(\"image/\")", "proxy must only stream image content.");
    includes(file, "Content-Disposition", "proxy must stream QR as an attachment.");
    includes(file, "Cache-Control", "proxy must use no-store.");
    notMatches(file, /req\.query\.url|req\.body\.url/, "proxy must not accept arbitrary client-supplied URLs.");
}

function main() {
    verifySharedQrSaver();
    verifyPromptPayUsesSharedQrSaver();
    verifyBackendProxy();
    console.log("Payment QR save verification passed.");
}

main();
