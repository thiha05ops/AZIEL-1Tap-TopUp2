const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function main() {
    const file = "frontend/js/payment/payment-checkout-sheet.js";
    const source = read(file);

    const shareMatch = source.match(/async function shareOrDownloadQr\(blob, filename, context = \{\}\) \{([\s\S]*?)\n    \}\n\n    function knownChecklistAction/);
    assert(shareMatch, "shareOrDownloadQr mobile/share function must exist.");
    const shareBody = shareMatch[1];

    assert(shareBody.includes("const options = context.options || {};"), "mobile share must receive checkout options context.");
    assert(shareBody.includes("const activeDynamicQr = context.activeDynamicQr || null;"), "mobile share must receive activeDynamicQr context.");
    assert(shareBody.includes("const dynamicShare = isDynamicPromptPayMode(options);"), "mobile share must branch on dynamic QR mode.");
    assert(shareBody.includes("activeDynamicQr.sourceType !== \"dynamic_response\""), "dynamic mobile share must assert dynamic_response source.");
    assert(shareBody.includes("Mobile dynamic QR source ownership violation"), "dynamic mobile share must throw on wrong source type.");
    assert(shareBody.includes("!activeDynamicQr.imageDataUrl.startsWith(\"data:image/\")"), "dynamic mobile share must require generated image data URL.");
    assert(shareBody.includes("Mobile dynamic QR is not a generated data URL"), "dynamic mobile share must throw on non-data URL.");
    assert(shareBody.includes("const file = new File([blob], safeFilename, { type });"), "mobile File must be created from the resolved activeQr Blob.");
    assert(shareBody.includes("console.info(\"[AZIEL MOBILE QR SHARE]\""), "mobile share must include development diagnostics at share boundary.");
    assert(shareBody.includes("sourcePrefix: activeDynamicQr?.imageDataUrl?.slice(0, 80)"), "mobile diagnostic must identify activeDynamicQr source prefix.");
    assert(shareBody.includes("fileName: file?.name"), "mobile diagnostic must include File name.");
    assert(shareBody.includes("fileType: file?.type"), "mobile diagnostic must include File type.");
    assert(shareBody.includes("fileSize: file?.size"), "mobile diagnostic must include File size.");
    assert(shareBody.includes("staticQrUrl: \"\""), "mobile diagnostic must not expose configured static QR URL.");
    assert(shareBody.includes("navigator.canShare?.({ files: [file] })"), "mobile share must use file-capability check.");
    assert(shareBody.includes("await navigator.share({"), "mobile share must use Web Share files when available.");
    assert(shareBody.includes("files: [file]"), "mobile share must pass the same File to navigator.share.");
    assert(shareBody.includes("URL.createObjectURL(blob)"), "mobile canShare fallback must use the same local Blob.");
    assert(!shareBody.includes("getQrProxyUrl"), "mobile share/canShare fallback must not call /qr-download.");
    assert(!shareBody.includes("fetchImageBlob"), "mobile share/canShare fallback must not fetch a replacement QR.");
    assert(!shareBody.includes("qrImageUrl"), "mobile share must not use qrImageUrl.");
    assert(!shareBody.includes("currentSrc") && !shareBody.includes("qrImg") && !shareBody.includes(".src"), "mobile share must not read DOM image source.");

    const resolveMatch = source.match(/async function resolveQrBlob\(\{ href, qrCanvas, options, sourceType \}\) \{([\s\S]*?)\n    \}\n\n    async function shareOrDownloadQr/);
    assert(resolveMatch, "resolveQrBlob must exist.");
    const resolveBody = resolveMatch[1];
    assert(!resolveBody.includes("isDynamicPromptPayMode"), "generic resolver must not handle dynamic QR mode.");

    const saveAssetMatch = source.match(/async function saveQrAsset\(config = \{\}\) \{([\s\S]*?)\n    \}\n\n    async function downloadQr/);
    assert(saveAssetMatch, "saveQrAsset must exist.");
    const saveAssetBody = saveAssetMatch[1];
    assert(saveAssetBody.includes("activeDynamicQr: config.activeDynamicQr || null"), "saveQrAsset must pass activeDynamicQr into mobile share path when used.");
    assert(saveAssetBody.includes("options: config.options || {}"), "saveQrAsset must pass options into mobile share path.");
    assert(saveAssetBody.includes("? \"Dynamic QR could not be saved. Please try again.\""), "dynamic mobile share failure must not fall back silently.");
    assert(!saveAssetBody.includes("updateChecklist(\"save_qr\")"), "saveQrAsset must not complete checklist after failed share.");

    const downloadMatch = source.match(/async function downloadQr\(options = \{\}\) \{([\s\S]*?)\n    \}\n\n    function setQrLoading/);
    assert(downloadMatch, "downloadQr must exist.");
    const downloadBody = downloadMatch[1];
    assert(downloadBody.includes("await saveDynamicQr(activeDynamicQr);"), "Save QR click must call dedicated dynamic save path.");
    assert(downloadBody.includes("updateChecklist(\"save_qr\")"), "checklist completes after dynamic share/download starts.");

    console.log("Mobile dynamic QR share verification passed.");
}

main();
