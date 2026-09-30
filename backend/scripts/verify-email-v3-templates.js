"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    EMAIL_BRAND_ASSETS,
    OFFICIAL_SOCIAL_LINKS,
    buildMarketingPreviewEmail,
    buildOtpEmail,
    buildSecurityAlertEmail,
    buildShell,
    safeAzielUrl
} = require("../services/emailV3TemplateService");

function verifyShell() {
    const html = buildShell({ title: "Test", content: "<tr><td>Body</td></tr>" });
    assert(html.startsWith("<!doctype html>"));
    assert(html.includes("1 TAP. TOP UP. DONE."));
    assert(html.includes(`src="${EMAIL_BRAND_ASSETS.logo}"`));
    assert(html.includes('alt="AZIEL"'));
    assert(fs.existsSync(path.resolve(__dirname, "../../frontend/assets/email/aziel-logo-primary.png")));
    assert(html.includes('role="presentation"'));
    assert(html.includes("optional-lion-asset-slot"));
    assert(!/mascot|footer lion|lion promotional/i.test(html));
    assert(!/<script|<style|data:image|@font-face/i.test(html));
    OFFICIAL_SOCIAL_LINKS.forEach(([label, href, iconUrl]) => {
        assert(html.includes(href));
        assert(html.includes(`src="${iconUrl}"`));
        assert(html.includes(`aria-label="AZIEL on ${label}"`));
        assert(html.includes(`<span>${label}</span>`));
        assert(iconUrl.startsWith("https://azielplay.com/assets/email/social/"));
        const assetPath = path.resolve(__dirname, "../../frontend", new URL(iconUrl).pathname.replace(/^\//, ""));
        assert(fs.existsSync(assetPath), `${label} email icon must exist locally.`);
    });
    const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match => match[1]);
    assert(imageSources.length >= 5);
    imageSources.forEach(source => assert(source.startsWith("https://"), "Delivered email images must use absolute HTTPS URLs."));
    assert.strictEqual(safeAzielUrl("https://evil.example/account"), "");
}

function verifyOtp() {
    const message = buildOtpEmail({ code: "729416", expiryMinutes: 7, purpose: "registration" });
    assert(message.html.includes(">7<") && message.html.includes(">2<"));
    assert(message.html.includes("expires in 7 minutes"));
    assert(message.text.includes("Your code: 729416"));
    assert.throws(() => buildOtpEmail({ code: "invented", expiryMinutes: 10 }), /EMAIL_V3_OTP_INPUT_INVALID/);
}

function verifySecurity() {
    const message = buildSecurityAlertEmail({
        title: "New Login Detected",
        explanation: "Observed account activity.",
        details: [{ label: "Device", value: "Recorded Device" }],
        primaryAction: { label: "Review Security", href: "/account?tab=security" }
    });
    assert(message.html.includes("Recorded Device"));
    assert(!/location|ip address/i.test(message.html), "Unavailable security details must not be invented.");
    assert(message.text.includes("Device: Recorded Device"));
}

function verifyMarketingBlocked() {
    assert.throws(() => buildMarketingPreviewEmail({ campaign: { title: "Promo", description: "Text" } }), /EMAIL_V3_MARKETING_PREVIEW_ONLY/);
    const message = buildMarketingPreviewEmail({ campaign: {
        previewOnly: true,
        title: "Fictional Preview",
        description: "No active campaign.",
        heroImageUrl: "https://azielplay.com/uploads/media-assets/product_image/approved.webp",
        offers: [{ product: "Preview Product", price: "100", currency: "MMK" }]
    } });
    assert(message.subject.startsWith("[PREVIEW ONLY]"));
    assert(message.html.includes("Production sending is blocked"));
    assert(message.html.includes("approved.webp"));
    assert(!message.html.includes("href=\"undefined"));
    const unsafeImage = buildMarketingPreviewEmail({ campaign: {
        previewOnly: true,
        title: "Unsafe image preview",
        description: "No active campaign.",
        heroImageUrl: "https://evil.example/product.webp"
    } });
    assert(!unsafeImage.html.includes("evil.example"));
}

function verifyGeneratedPreviews() {
    const previewRoot = path.resolve(__dirname, "../../previews/email-v3");
    const transactional = fs.readFileSync(path.join(previewRoot, "transactional-order-completed.html"), "utf8");
    const fallback = fs.readFileSync(path.join(previewRoot, "transactional-blocked-image.html"), "utf8");
    const index = fs.readFileSync(path.join(previewRoot, "index.html"), "utf8");
    ["aziel-logo-primary.png", "facebook-f.png", "telegram.png", "youtube.png", "discord.png", "product.webp"]
        .forEach(file => assert(fs.existsSync(path.join(previewRoot, "assets", file)), `${file} must be available to local previews.`));
    assert(transactional.includes('src="assets/aziel-logo-primary.png"'));
    assert(transactional.includes('src="assets/product.webp"'));
    assert(!transactional.includes("https://azielplay.com/assets/email/"));
    assert(fallback.includes('src="assets/aziel-logo-primary.png"'));
    assert(!fallback.includes('src="assets/product.webp"'));
    assert(index.includes("Desktop · 760px"));
    assert(index.includes("Mobile · 390px"));
}

function main() {
    verifyShell();
    verifyOtp();
    verifySecurity();
    verifyMarketingBlocked();
    verifyGeneratedPreviews();
    console.log("Email V3 template verification passed.");
}

main();
