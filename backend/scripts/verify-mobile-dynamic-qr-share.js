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
    assert(shareBody.includes("const activeQr = context.activeQr || null;"), "mobile share must receive activeQr context.");
    assert(shareBody.includes("const dynamicShare = isDynamicPromptPayMode(options);"), "mobile share must branch on dynamic QR mode.");
    assert(shareBody.includes("activeQr?.sourceType !== \"dynamic_response\""), "dynamic mobile share must assert dynamic_response source.");
    assert(shareBody.includes("Mobile dynamic QR source ownership violation"), "dynamic mobile share must throw on wrong source type.");
    assert(shareBody.includes("!activeQr?.imageUrlOrDataUrl?.startsWith(\"data:image/\")"), "dynamic mobile share must require generated image data URL.");
    assert(shareBody.includes("Mobile dynamic QR is not a generated data URL"), "dynamic mobile share must throw on non-data URL.");
    assert(shareBody.includes("const file = new File([blob], safeFilename, { type });"), "mobile File must be created from the resolved activeQr Blob.");
    assert(shareBody.includes("console.info(\"[AZIEL MOBILE QR SHARE]\""), "mobile share must include development diagnostics at share boundary.");
    assert(shareBody.includes("sourcePrefix: activeQr?.imageUrlOrDataUrl?.slice(0, 80)"), "mobile diagnostic must identify activeQr source prefix.");
    assert(shareBody.includes("fileName: file?.name"), "mobile diagnostic must include File name.");
    assert(shareBody.includes("fileType: file?.type"), "mobile diagnostic must include File type.");
    assert(shareBody.includes("fileSize: file?.size"), "mobile diagnostic must include File size.");
    assert(shareBody.includes("staticQrUrl: options.qrImageUrl || \"\""), "mobile diagnostic must show any configured static QR URL.");
    assert(shareBody.includes("navigator.canShare?.({ files: [file] })"), "mobile share must use file-capability check.");
    assert(shareBody.includes("await navigator.share({"), "mobile share must use Web Share files when available.");
    assert(shareBody.includes("files: [file]"), "mobile share must pass the same File to navigator.share.");
    assert(shareBody.includes("URL.createObjectURL(blob)"), "mobile canShare fallback must use the same local Blob.");
    assert(!shareBody.includes("getQrProxyUrl"), "mobile share/canShare fallback must not call /qr-download.");
    assert(!shareBody.includes("fetchImageBlob"), "mobile share/canShare fallback must not fetch a replacement QR.");
    assert(!shareBody.includes("qrImageUrl") || shareBody.includes("staticQrUrl: options.qrImageUrl || \"\""), "mobile share must not use qrImageUrl except diagnostics.");
    assert(!shareBody.includes("currentSrc") && !shareBody.includes("qrImg") && !shareBody.includes(".src"), "mobile share must not read DOM image source.");

    const resolveMatch = source.match(/async function resolveQrBlob\(\{ href, qrCanvas, options, sourceType \}\) \{([\s\S]*?)\n    \}\n\n    async function shareOrDownloadQr/);
    assert(resolveMatch, "resolveQrBlob must exist.");
    const resolveBody = resolveMatch[1];
    const dynamicBranch = resolveBody.slice(
        resolveBody.indexOf("const dynamicSave = isDynamicPromptPayMode(options);"),
        resolveBody.indexOf("if (qrCanvas?.toBlob)")
    );
    assert(dynamicBranch.includes("blob: dataUrlToBlob(href)"), "desktop and mobile dynamic branches must receive Blob bytes from activeQr data URL.");
    assert(dynamicBranch.includes("source: \"dynamic_data_url\""), "dynamic branch must mark local data URL Blob source.");
    assert(!dynamicBranch.includes("getQrProxyUrl"), "dynamic Blob resolution must never call /qr-download.");

    const saveAssetMatch = source.match(/async function saveQrAsset\(config = \{\}\) \{([\s\S]*?)\n    \}\n\n    async function downloadQr/);
    assert(saveAssetMatch, "saveQrAsset must exist.");
    const saveAssetBody = saveAssetMatch[1];
    assert(saveAssetBody.includes("activeQr: config.activeQr || null"), "saveQrAsset must pass activeQr into mobile share path.");
    assert(saveAssetBody.includes("options: config.options || {}"), "saveQrAsset must pass options into mobile share path.");
    assert(saveAssetBody.includes("? \"Dynamic QR could not be saved. Please try again.\""), "dynamic mobile share failure must not fall back silently.");
    assert(!saveAssetBody.includes("updateChecklist(\"save_qr\")"), "saveQrAsset must not complete checklist after failed share.");

    const downloadMatch = source.match(/async function downloadQr\(options = \{\}\) \{([\s\S]*?)\n    \}\n\n    function setQrLoading/);
    assert(downloadMatch, "downloadQr must exist.");
    const downloadBody = downloadMatch[1];
    assert(downloadBody.includes("throw new Error(\"Dynamic QR save source ownership violation\")"), "Save QR click must assert dynamic source before share.");
    assert(downloadBody.includes("href: activeQr.imageUrlOrDataUrl"), "Save QR click must pass activeQr image into Blob resolver.");
    assert(downloadBody.includes("activeQr,"), "Save QR click must pass activeQr into mobile share path.");
    assert(downloadBody.includes("if (!isDynamicPromptPayMode(options) || activeQr.sourceType === \"dynamic_response\")"), "checklist completes only after dynamic response share/download starts.");

    console.log("Mobile dynamic QR share verification passed.");
}

main();
