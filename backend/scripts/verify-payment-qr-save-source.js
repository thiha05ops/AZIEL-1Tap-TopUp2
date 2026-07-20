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

function main() {
    const file = "frontend/js/payment/payment-checkout-sheet.js";
    const source = read(file);

    includes(file, "activeDynamicQr", "checkout must maintain explicit active dynamic QR state.");
    includes(file, "imageDataUrl", "activeDynamicQr must own the exact generated image data URL to save.");
    includes(file, "payload", "activeDynamicQr must preserve dynamic QR payload for source equivalence.");
    includes(file, "amount: normalizedComparableAmount(options.amount)", "activeQr must be bound to amount.");
    includes(file, "reference: String(options.reference || \"\")", "activeQr must be bound to payment reference.");
    includes(file, "methodCode: checkoutMethodCode(options)", "activeQr must be bound to payment method.");
    includes(file, "activeDynamicQrMatchesCheckout", "Save QR must validate active dynamic QR identity before saving.");
    includes(file, "await saveDynamicQr(activeDynamicQr);", "Dynamic Save QR must use only activeDynamicQr.");
    includes(file, "setQrImage(data.qrImage, \"dynamic_response\", data.qrPayload)", "Dynamic mode must render and save the dynamic endpoint response image/payload.");
    includes(file, "setActiveDynamicQr(createActiveDynamicQr", "Rendered dynamic QR must create activeDynamicQr from the same image and payload.");
    includes(file, "if (!activeDynamicQrMatchesCheckout(activeDynamicQr, options))", "Dynamic Save QR must fail closed when activeDynamicQr is missing or stale.");
    includes(file, "clearActiveQr();", "Dynamic retries must invalidate previous active static/provider QR state.");
    includes(file, "clearActiveDynamicQr();", "Dynamic retries must invalidate previous active dynamic QR state.");
    includes(file, "activeState.qrImageUrl = \"\";", "Dynamic retries must invalidate previous QR image URL.");
    includes(file, "activeState.dynamicQr = null;", "Dynamic retries must invalidate previous dynamic payload state.");
    includes(file, "await saveDynamicQr(activeDynamicQr);", "Dynamic save_qr checklist must complete only after saving a dynamic response QR.");
    includes(file, "options.qrMode === \"uploaded_static\" && qr", "Uploaded static mode must keep saving the uploaded static QR.");
    includes(file, "options.qrMode === \"provider_generated\" && qr", "Provider-generated mode must keep saving the provider QR.");

    const downloadQr = source.match(/async function downloadQr\(options = \{\}\) \{([\s\S]*?)\n    \}\n\n    function setQrLoading/);
    assert(downloadQr, "downloadQr function must be present.");
    assert(!downloadQr[1].includes("qrImg") && !downloadQr[1].includes("currentSrc") && !downloadQr[1].includes("querySelector"), "Save QR must not derive source from rendered DOM image.");
    assert(!downloadQr[1].includes("options.qrImageUrl") && !downloadQr[1].includes("options.qrImage"), "Save QR must not derive source from paymentMethod.qrImageUrl or generic options.");
    assert(downloadQr[1].includes("await saveDynamicQr(activeDynamicQr);"), "Dynamic Save QR must use activeDynamicQr.");

    const qrSelection = source.match(/const qr = dynamicQr\s*\?\s*([\s\S]*?)\s*:\s*([\s\S]*?);/);
    assert(qrSelection, "checkout must have explicit QR selection branch.");
    assert.strictEqual(qrSelection[1].trim(), '""', "Dynamic mode must not restore or read static QR before fresh generation.");
    assert(qrSelection[2].includes("options.qrImageUrl || options.qrImage"), "Static/provider modes must retain configured QR source.");

    notMatches(file, /downloadQr[\s\S]*paymentMethod\.qrImageUrl/, "Save QR must not use paymentMethod.qrImageUrl.");

    console.log("Payment QR save source verification passed.");
}

main();
