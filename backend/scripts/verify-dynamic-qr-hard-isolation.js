const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function body(source, name, next) {
    const pattern = new RegExp(`(?:async\\s+)?function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n    \\}\\n\\n    ${next ? `(?:async\\s+)?function ${next}` : ""}`);
    const match = source.match(pattern);
    assert(match, `${name} must exist.`);
    return match[1];
}

function main() {
    const checkout = read("frontend/js/payment/payment-checkout-sheet.js");
    const route = read("backend/routes/paymentMethods.js");

    assert(route.includes('const isDynamicPromptPayQr = obj.qrMode === "aziel_promptpay_dynamic";'), "public projection must identify dynamic PromptPay QR mode.");
    assert(route.includes("const qrImage = isDynamicPromptPayQr ? null : configuredQrImage;"), "public dynamic PaymentMethod response must expose no static QR URL.");
    assert(route.includes("const configuredQrImage = safePublicAssetUrl("), "admin projection must still access configured QR image for editing.");
    assert(route.includes("qrImage: configuredQrImage") && route.includes("qrImageUrl: configuredQrImage") && route.includes("uploadedQrImage: configuredQrImage"), "admin response must retain uploaded/static QR fields.");

    const createDynamic = body(checkout, "createActiveDynamicQr", "activeQrMatchesCheckout");
    assert(createDynamic.includes("Object.freeze"), "activeDynamicQr must be immutable.");
    assert(createDynamic.includes('mode: "aziel_promptpay_dynamic"'), "activeDynamicQr must own dynamic mode.");
    assert(createDynamic.includes('sourceType: "dynamic_response"'), "activeDynamicQr must own dynamic response source type.");
    assert(createDynamic.includes("imageDataUrl: String(response.qrImage || \"\")"), "activeDynamicQr must store response.qrImage only.");
    assert(createDynamic.includes("payload: String(response.qrPayload || \"\")"), "activeDynamicQr must store response.qrPayload.");
    assert(!createDynamic.includes("qrImageUrl") && !createDynamic.includes("paymentMethod"), "activeDynamicQr creation must not access static QR fields.");

    const saveDynamic = body(checkout, "saveDynamicQr", "saveUploadedStaticQr");
    assert(!/saveDynamicQr\([^)]*paymentMethod/.test(checkout), "saveDynamicQr must not accept paymentMethod.");
    assert(saveDynamic.includes('activeDynamicQr.mode !== "aziel_promptpay_dynamic"'), "saveDynamicQr must assert dynamic mode.");
    assert(saveDynamic.includes('activeDynamicQr.sourceType !== "dynamic_response"'), "saveDynamicQr must assert dynamic response source.");
    assert(saveDynamic.includes('!activeDynamicQr.imageDataUrl.startsWith("data:image/")'), "saveDynamicQr must require generated data URL.");
    assert(saveDynamic.includes("const blob = dataUrlToBlob(activeDynamicQr.imageDataUrl);"), "saveDynamicQr must decode activeDynamicQr image locally.");
    assert(saveDynamic.includes("scb-${safeFilePart(activeDynamicQr.reference || \"qr\")}-${safeFilePart(activeDynamicQr.generatedAt || Date.now())}.png"), "dynamic filename must include reference and timestamp.");
    assert(!saveDynamic.includes("paymentMethod") && !saveDynamic.includes("qrImageUrl"), "saveDynamicQr must not access payment method/static QR fields.");
    assert(!saveDynamic.includes("getQrProxyUrl") && !saveDynamic.includes("qr-download"), "saveDynamicQr must not call QR proxy.");
    assert(!saveDynamic.includes("fetchImageBlob") && !saveDynamic.includes("resolveQrBlob"), "saveDynamicQr must not use generic QR fallback resolver.");

    const saveStatic = body(checkout, "saveUploadedStaticQr", "saveProviderQr");
    const saveProvider = body(checkout, "saveProviderQr", "saveQrAsset");
    assert(saveStatic.includes('sourceType: "uploaded_static"'), "uploaded-static save function must remain explicit.");
    assert(saveProvider.includes('sourceType: "provider_generated"'), "provider-generated save function must remain explicit.");
    assert(saveStatic.includes("resolveQrBlob") && saveProvider.includes("resolveQrBlob"), "static/provider modes may still use generic resolver.");

    const download = checkout.match(/async function downloadQr\(options = \{\}\) \{([\s\S]*?)\n    \}\n\n    function setQrLoading/);
    assert(download, "downloadQr must exist.");
    assert(download[1].includes("await saveDynamicQr(activeDynamicQr);"), "dynamic Save QR button must call only saveDynamicQr.");
    assert(download[1].includes("await saveUploadedStaticQr(saveConfig);"), "uploaded-static Save QR button must call saveUploadedStaticQr.");
    assert(download[1].includes("await saveProviderQr(saveConfig);"), "provider Save QR button must call saveProviderQr.");
    assert(!download[1].includes("getQrProxyUrl") && !download[1].includes("qr-download"), "Save QR dispatch must not directly call QR proxy.");
    assert(!download[1].includes("currentSrc") && !download[1].includes("qrImg") && !download[1].includes(".src"), "Save QR dispatch must not read DOM image source.");

    const resolve = body(checkout, "resolveQrBlob", "shareOrDownloadQr");
    assert(!resolve.includes("isDynamicPromptPayMode"), "generic QR resolver must not handle dynamic mode.");
    assert(resolve.includes("getQrProxyUrl(options)"), "generic resolver may keep proxy fallback for static/provider QR only.");

    const share = body(checkout, "shareOrDownloadQr", "saveDynamicQr");
    assert(share.includes("if (!activeDynamicQr)"), "mobile share must hard fail when dynamic QR state is missing.");
    assert(share.includes('activeDynamicQr.sourceType !== "dynamic_response"'), "mobile share must hard fail on non-dynamic source.");
    assert(share.includes('!activeDynamicQr.imageDataUrl.startsWith("data:image/")'), "mobile share must hard fail on non-data URL.");
    assert(share.includes("new File([blob], safeFilename, { type })"), "mobile File must be created from the supplied Blob.");
    assert(!share.includes("getQrProxyUrl") && !share.includes("fetchImageBlob"), "mobile share fallback must not fetch/proxy a replacement QR.");

    assert(checkout.includes("const qr = dynamicQr\n            ? \"\""), "dynamic checkout must prefer regenerating over restoring image state.");
    assert(checkout.includes("clearActiveDynamicQr();"), "dynamic QR state must be cleared on invalidation paths.");
    assert(checkout.includes("activeState.activeDynamicQr"), "checkout must store activeDynamicQr separately from static/provider activeQr.");
    assert(checkout.includes("setQrImage(data.qrImage, \"dynamic_response\", data.qrPayload)"), "Tag 62 payload changes must flow to rendered dynamic image and saved QR together.");

    console.log("Dynamic QR hard isolation verification passed.");
}

main();
