"use strict";

const fs = require("fs");
const path = require("path");
const { buildOrderEmail, safePublicImageUrl } = require("../services/orderEmailService");
const { buildMarketingPreviewEmail, buildOtpEmail, buildSecurityAlertEmail } = require("../services/emailV3TemplateService");

const output = path.resolve(__dirname, "../../previews/email-v3");
const previewAssets = path.join(output, "assets");
const approvedImage = safePublicImageUrl("https://azielplay.com/uploads/media-assets/product_image/1784002074819-a2e5f7fe8fa2f599ace312d06e875c9b.webp");
const product = { imageUrl: approvedImage, altText: "Mobile Legends: Bang Bang product artwork" };
const previewAssetMap = new Map([
    ["https://azielplay.com/assets/email/aziel-logo-primary.png", "assets/aziel-logo-primary.png"],
    ["https://azielplay.com/assets/email/social/facebook-f.png", "assets/facebook-f.png"],
    ["https://azielplay.com/assets/email/social/telegram.png", "assets/telegram.png"],
    ["https://azielplay.com/assets/email/social/youtube.png", "assets/youtube.png"],
    ["https://azielplay.com/assets/email/social/discord.png", "assets/discord.png"],
    [approvedImage, "assets/product.webp"]
]);

function preparePreviewAssets() {
    fs.mkdirSync(previewAssets, { recursive: true });
    const copies = [
        ["../../frontend/assets/email/aziel-logo-primary.png", "aziel-logo-primary.png"],
        ["../../frontend/assets/email/social/facebook-f.png", "facebook-f.png"],
        ["../../frontend/assets/email/social/telegram.png", "telegram.png"],
        ["../../frontend/assets/email/social/youtube.png", "youtube.png"],
        ["../../frontend/assets/email/social/discord.png", "discord.png"],
        ["../uploads/media-assets/product_image/1784002074819-a2e5f7fe8fa2f599ace312d06e875c9b.webp", "product.webp"]
    ];
    copies.forEach(([source, destination]) => fs.copyFileSync(path.resolve(__dirname, source), path.join(previewAssets, destination)));
}

function resolveLocalPreviewAssets(html = "") {
    return [...previewAssetMap].reduce(
        (outputHtml, [productionUrl, localUrl]) => outputHtml.split(productionUrl).join(localUrl),
        String(html)
    );
}

function orderEmail(presentation = product) {
    return buildOrderEmail({
        orderId: "AZL-V3-PREVIEW-0001",
        product: { gameCode: "mlbb", gameName: "Mobile Legends: Bang Bang", packageName: "Fictional 100 Diamonds Preview Package" },
        commercial: { totalAmount: 3573, currency: "MMK" },
        payment: { paymentMethodId: "myanmyanpay_mmqr" },
        status: "completed",
        createdAt: "2026-09-30T08:00:00.000Z",
        statusHistory: [
            { field: "orderStatus", toStatus: "paid", changedAt: "2026-09-30T08:04:00.000Z" },
            { field: "orderStatus", toStatus: "processing", changedAt: "2026-09-30T08:08:00.000Z" },
            { field: "orderStatus", toStatus: "completed", changedAt: "2026-09-30T08:17:00.000Z" }
        ]
    }, "ORDER_COMPLETED", { presentation });
}

function main() {
    fs.mkdirSync(output, { recursive: true });
    preparePreviewAssets();
    const templates = [
        ["transactional-order-completed.html", "Transactional", orderEmail()],
        ["transactional-blocked-image.html", "Transactional · blocked-image fallback", orderEmail(null)],
        ["marketing-preview-only.html", "Marketing · preview only", buildMarketingPreviewEmail({ campaign: {
            previewOnly: true,
            title: "Level Up for Less — Fictional Preview",
            description: "Visual preview only. No campaign, discount or offer is active.",
            validity: "Fictional preview validity — not a production offer",
            heroImageUrl: approvedImage,
            heroAltText: "Mobile Legends: Bang Bang catalog artwork",
            ctaLabel: "Explore AZIEL",
            ctaHref: "/explore",
            offers: [
                { product: "Fictional Weekly Pass", price: "2,125", currency: "MMK", discountLabel: "Preview only" },
                { product: "Fictional 500 Diamonds", price: "6,800", currency: "MMK", discountLabel: "Preview only" },
                { product: "Fictional 1,000 Diamonds", price: "12,750", currency: "MMK", discountLabel: "Preview only" }
            ]
        } })],
        ["account-verification.html", "OTP / account verification", buildOtpEmail({ code: "729416", expiryMinutes: 10, purpose: "registration" })],
        ["security-alert.html", "Security alert", buildSecurityAlertEmail({
            title: "New Login Detected",
            explanation: "We noticed a new login to your fictional AZIEL preview account.",
            details: [
                { label: "Device", value: "Fictional preview device" },
                { label: "Time", value: "Sep 30, 2026, 20:02 (UTC+07)" }
            ],
            primaryAction: { label: "This Was Me", href: "/account?tab=security" },
            secondaryAction: { label: "Secure My Account", href: "/account?tab=security" }
        })]
    ];
    for (const [file, , message] of templates) fs.writeFileSync(path.join(output, file), resolveLocalPreviewAssets(message.html), "utf8");
    const panels = templates.map(([file, label]) => `<section><h2>${label}</h2><div class="views"><div><h3>Desktop · 760px</h3><iframe class="desktop" src="${file}"></iframe></div><div><h3>Mobile · 390px</h3><iframe class="mobile" src="${file}"></iframe></div></div></section>`).join("");
    fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AZIEL Email V3 Preview</title><style>body{margin:0;padding:24px;background:#03040c;color:white;font-family:Arial}main{max-width:1250px;margin:auto}.notice{color:#c7bdd8}section{padding:18px;margin:24px 0;border:1px solid #48256c;background:#080918}.views{display:flex;gap:18px;overflow:auto}iframe{display:block;height:1000px;border:1px solid #5a347d;background:#050611}.desktop{width:760px}.mobile{width:390px}@media(max-width:700px){body{padding:10px}.views{display:block}.desktop,.mobile{width:100%;height:820px}}</style></head><body><main><h1>AZIEL Email V3</h1><p class="notice">Actual production renderers with fictional preview data. Dark-mode reference view; no email was sent.</p>${panels}</main></body></html>`, "utf8");
    console.log(JSON.stringify({ result: "PASS", previews: templates.length, output }));
}

main();
