const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function functionBody(source, name, nextName) {
    const pattern = new RegExp(`(?:async\\s+)?function ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\([^)]*\\) \\{([\\s\\S]*?)\\n    \\}\\n\\n    ${nextName ? `(?:async\\s+)?function ${nextName}` : ""}`);
    const match = source.match(pattern);
    assert(match, `${name} function must exist.`);
    return match[1];
}

function main() {
    const checkoutFile = "frontend/js/payment/payment-checkout-sheet.js";
    const promptPayFile = "frontend/js/payment/payment-promptpay.js";
    const checkout = read(checkoutFile);
    const promptPay = read(promptPayFile);

    const resolveQrBlob = functionBody(checkout, "resolveQrBlob", "shareOrDownloadQr");
    const downloadQr = checkout.match(/async function downloadQr\(options = \{\}\) \{([\s\S]*?)\n    \}\n\n    function setQrLoading/);
    const saveQrAsset = checkout.match(/async function saveQrAsset\(config = \{\}\) \{([\s\S]*?)\n    \}\n\n    async function downloadQr/);
    assert(downloadQr, "downloadQr function must exist.");
    assert(saveQrAsset, "saveQrAsset function must exist.");

    assert(checkout.includes("function dataUrlToBlob(dataUrl)"), "dynamic Save QR must decode data URLs locally.");
    assert(checkout.includes("atob(match[2])"), "dataUrlToBlob must decode the base64 QR payload directly.");
    assert(checkout.includes("return new Blob([bytes], { type: mimeType });"), "dataUrlToBlob must return an image Blob.");
    assert(checkout.includes("setQrImage(data.qrImage, \"dynamic_response\", data.qrPayload)"), "dynamic response image and payload must be stored together.");
    assert(checkout.includes("payload: String(response.qrPayload || \"\")"), "activeDynamicQr must keep the dynamic response payload.");

    assert(!resolveQrBlob.includes("isDynamicPromptPayMode"), "resolveQrBlob must not branch for dynamic PromptPay.");
    const saveDynamicQr = functionBody(checkout, "saveDynamicQr", "saveUploadedStaticQr");
    assert(saveDynamicQr.includes("const blob = dataUrlToBlob(activeDynamicQr.imageDataUrl);"), "dynamic Save QR must convert data URL directly to Blob.");
    assert(!saveDynamicQr.includes("getQrProxyUrl"), "dynamic Save QR must never call /qr-download proxy.");
    assert(!saveDynamicQr.includes("fetchImageBlob"), "dynamic Save QR data URL must not use fetch/proxy.");
    assert(!saveDynamicQr.includes("qrImageUrl"), "dynamic Save QR must not reference configured static QR fields.");

    assert(downloadQr[1].includes("console.info(\"[AZIEL QR SAVE]\""), "Save QR click boundary must include development diagnostics.");
    assert(downloadQr[1].includes("fallbackEndpointUsed: false"), "Save QR diagnostics must show proxy fallback is not used.");
    assert(downloadQr[1].includes("await saveDynamicQr(activeDynamicQr);"), "dynamic Save QR must use dedicated saveDynamicQr path.");
    assert(!downloadQr[1].includes("qrImg") && !downloadQr[1].includes("currentSrc") && !downloadQr[1].includes("querySelector"), "Save QR must not read the DOM image source.");
    assert(!downloadQr[1].includes("options.qrImageUrl") && !downloadQr[1].includes("options.qrImage"), "Save QR must not read configured QR fields.");
    assert(!downloadQr[1].includes("getQrProxyUrl"), "Save QR click path must not call proxy directly.");

    assert(saveQrAsset[1].includes("? \"Dynamic QR could not be saved. Please try again.\""), "dynamic save failure must show dynamic-specific error.");
    assert(!saveQrAsset[1].includes("updateChecklist(\"save_qr\")"), "saveQrAsset must not complete checklist directly.");

    assert(checkout.includes("await saveDynamicQr(activeDynamicQr);"), "save_qr checklist must only complete after dynamic response save starts.");
    assert(checkout.includes("activeState.qrImageUrl = \"\";"), "dynamic retry must invalidate old QR image URL.");
    assert(checkout.includes("activeState.dynamicQr = null;"), "dynamic retry must invalidate old payload state.");
    assert(checkout.includes("const qr = dynamicQr\n            ? \"\""), "dynamic checkout must not restore or read static QR before fresh generation.");

    assert(checkout.includes("const proxyUrl = getQrProxyUrl(options);"), "static/provider QR modes may still use the QR proxy fallback.");
    assert(checkout.includes("options.qrMode === \"uploaded_static\" && qr"), "uploaded_static source type must remain supported.");
    assert(checkout.includes("options.qrMode === \"provider_generated\" && qr"), "provider_generated source type must remain supported.");

    const checkoutSaveHandlers = Array.from(checkout.matchAll(/azPaymentSheetSaveQr|saveQr\.onclick|addEventListener\("click"[\s\S]{0,80}downloadQr/g));
    assert(checkout.includes("saveQr.onclick = canSaveQr ? () => downloadQr(activeState) : null;"), "checkout Save QR button must have one canonical onclick owner.");
    assert.strictEqual((checkout.match(/saveQr\.onclick/g) || []).length, 1, "checkout Save QR onclick should have exactly one owner.");
    assert(!checkout.includes("addEventListener(\"click\", () => downloadQr"), "checkout must not register duplicate Save QR click listeners.");

    assert(promptPay.includes("document.getElementById(\"promptPaySaveQr\")?.addEventListener(\"click\", () => savePromptPayQr(state));"), "legacy automatic PromptPay guide has its own distinct Save QR handler.");
    assert(!promptPay.includes("azPaymentSheetSaveQr"), "automatic PromptPay guide must not attach to checkout sheet Save QR button.");

    console.log("Dynamic QR save runtime path verification passed.");
}

main();
