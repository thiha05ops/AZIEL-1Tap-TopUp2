"use strict";

const EMAIL_BRAND_ASSETS = Object.freeze({
    logo: "https://azielplay.com/assets/email/aziel-logo-primary.png"
});
const OFFICIAL_SOCIAL_LINKS = Object.freeze([
    ["Facebook", "https://www.facebook.com/share/1DhL7dQ16a/?mibextid=wwXIfr", "https://azielplay.com/assets/email/social/facebook-f.png"],
    ["Telegram", "https://t.me/aziel1tap", "https://azielplay.com/assets/email/social/telegram.png"],
    ["YouTube", "https://youtube.com/@aziel1tapshop", "https://azielplay.com/assets/email/social/youtube.png"],
    ["Discord", "https://discord.gg/txTGuTK76", "https://azielplay.com/assets/email/social/discord.png"]
]);
const AZIEL_ORIGIN = "https://azielplay.com";

function escapeHtml(value = "") {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[character]);
}

function safeAzielUrl(value = "") {
    try {
        const url = new URL(String(value || ""), AZIEL_ORIGIN);
        if (url.protocol !== "https:" || url.origin !== AZIEL_ORIGIN || url.username || url.href.includes("@")) return "";
        return url.href;
    } catch (_error) {
        return "";
    }
}

function button(label, href, { secondary = false } = {}) {
    const safeHref = safeAzielUrl(href);
    if (!safeHref) return "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0"><a href="${escapeHtml(safeHref)}" style="display:block;padding:13px 20px;border:1px solid ${secondary ? "#6d5a98" : "#ffd522"};border-radius:7px;background:${secondary ? "#0b0c1d" : "#ffd522"};color:${secondary ? "#ffffff" : "#17110a"};font-size:15px;font-weight:800;text-align:center;text-decoration:none">${escapeHtml(label)} →</a></td></tr></table>`;
}

function footer({ marketingPreview = false } = {}) {
    const socials = OFFICIAL_SOCIAL_LINKS.map(([label, href, iconUrl]) =>
        `<td align="center" valign="top" style="padding:4px 5px"><a href="${escapeHtml(href)}" aria-label="AZIEL on ${escapeHtml(label)}" style="display:block;color:#c9c4d5;font-size:10px;line-height:1.3;text-decoration:none"><img src="${escapeHtml(iconUrl)}" width="20" height="20" alt="" style="display:block;width:20px;height:20px;margin:0 auto 4px;border:0"><span>${escapeHtml(label)}</span></a></td>`
    ).join("");
    return `<tr><td style="padding:16px 22px;border-top:1px solid #29223f;background:#090a18;color:#b9b5c8;font-size:11px;line-height:1.6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding-right:10px"><strong style="color:#ffffff;font-size:14px">AZIEL</strong> 1Tap Shop<br><span style="color:#b66cff;font-weight:700">1 TAP. TOP UP. DONE.</span></td><td align="right" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" align="right"><tr>${socials}</tr></table></td></tr></table>${marketingPreview ? '<div style="margin-top:12px;text-align:center;color:#817b91">Preview only — production marketing is blocked until consent, unsubscribe and suppression authority exists.</div>' : ""}<!-- optional-lion-asset-slot --></td></tr>`;
}

function buildShell({ title, preheader = "", content = "", marketingPreview = false } = {}) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:#050611;color:#ffffff;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#050611"><tr><td align="center" style="padding:20px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#090a18;border:1px solid #4b2478;border-radius:12px;overflow:hidden"><tr><td style="padding:16px 22px;border-bottom:1px solid #29223f;background:#090a18"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="${EMAIL_BRAND_ASSETS.logo}" width="144" alt="AZIEL" style="display:block;width:144px;max-width:100%;height:auto;border:0;color:#ffffff;font-size:22px;font-weight:900"></td><td align="right" valign="middle" style="color:#c062ff;font-size:11px;font-weight:800;letter-spacing:.5px">1 TAP. TOP UP. DONE.</td></tr></table></td></tr>${content}${footer({ marketingPreview })}</table></td></tr></table></body></html>`;
}

function buildOtpEmail({ code, expiryMinutes, purpose = "verification" } = {}) {
    const safeCode = String(code || "").trim();
    const minutes = Math.max(1, Math.ceil(Number(expiryMinutes || 0)));
    if (!/^\d{6}$/.test(safeCode) || !Number.isFinite(minutes)) throw new Error("EMAIL_V3_OTP_INPUT_INVALID");
    const heading = purpose === "password_reset" ? "Reset Verification Code" : "Your Verification Code";
    const digits = [...safeCode].map(digit => `<td align="center" style="width:16.66%;padding:14px 4px;border:4px solid #090a18;border-radius:8px;background:#18172d;color:#b75cff;font-size:28px;font-weight:900">${digit}</td>`).join("");
    const content = `<tr><td style="padding:34px 28px"><div style="color:#c062ff;font-size:12px;font-weight:800;letter-spacing:.7px">ACCOUNT VERIFICATION</div><h1 style="margin:10px 0 8px;color:#ffffff;font-size:30px;line-height:1.2">${heading}</h1><p style="margin:0;color:#d1cede;font-size:14px;line-height:1.6">Use the code below for your AZIEL account. It expires in ${minutes} minutes.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0">${`<tr>${digits}</tr>`}</table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#121323;border:1px solid #27283d;border-radius:9px"><tr><td style="padding:16px;color:#d1cede;font-size:13px;line-height:1.7">Security code for your account.<br>Expires in ${minutes} minutes.<br>Never share this code with anyone.</td></tr></table><p style="margin:22px 0 8px;text-align:center;color:#d1cede;font-size:12px">Didn’t request this code? Ignore this email or contact support.</p>${button("Contact Support", "/support", { secondary: true })}</td></tr>`;
    return {
        subject: purpose === "password_reset" ? "AZIEL Password Reset Code" : "Verify your AZIEL account",
        text: `AZIEL\n\n${heading}\n\nYour code: ${safeCode}\nExpires in ${minutes} minutes.\nNever share this code with anyone.\n\nSupport: ${AZIEL_ORIGIN}/support`,
        html: buildShell({ title: heading, preheader: `Your AZIEL code expires in ${minutes} minutes.`, content })
    };
}

function buildSecurityAlertEmail({ title, explanation, details = [], primaryAction, secondaryAction } = {}) {
    const rows = details.filter(item => item?.label && item?.value).map(item => `<tr><td width="32%" style="padding:11px;color:#aaa5ba;border-bottom:1px solid #292a3d">${escapeHtml(item.label)}</td><td style="padding:11px;color:#ffffff;border-bottom:1px solid #292a3d;word-break:break-word">${escapeHtml(item.value)}</td></tr>`).join("");
    const content = `<tr><td style="padding:34px 28px"><div style="display:inline-block;padding:7px 10px;border-radius:6px;background:#3a1024;color:#ff376e;font-size:12px;font-weight:800">SECURITY ALERT</div><h1 style="margin:14px 0 8px;color:#ffffff;font-size:30px;line-height:1.2">${escapeHtml(title)}</h1><p style="margin:0;color:#d1cede;font-size:14px;line-height:1.6">${escapeHtml(explanation)}</p>${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background:#121323;border:1px solid #27283d;border-radius:9px">${rows}</table>` : ""}${primaryAction ? button(primaryAction.label, primaryAction.href) : ""}${secondaryAction ? button(secondaryAction.label, secondaryAction.href, { secondary: true }) : ""}<table role="presentation" width="100%" style="margin-top:22px;background:#121323;border:1px solid #27283d;border-radius:9px"><tr><td style="padding:16px;color:#d1cede;font-size:13px;line-height:1.6"><strong style="color:#ffffff">Keep Your Account Secure</strong><br>If you do not recognize this activity, secure your account and contact support.</td></tr></table></td></tr>`;
    return { subject: `AZIEL Security Alert: ${String(title || "Account activity")}`, text: `AZIEL Security Alert\n\n${title}\n${explanation}\n\n${details.filter(item => item?.label && item?.value).map(item => `${item.label}: ${item.value}`).join("\n")}\n\nSupport: ${AZIEL_ORIGIN}/support`, html: buildShell({ title, preheader: explanation, content }) };
}

function buildMarketingPreviewEmail({ campaign } = {}) {
    if (!campaign?.previewOnly || !campaign?.title || !campaign?.description) throw new Error("EMAIL_V3_MARKETING_PREVIEW_ONLY");
    const heroImageUrl = safeAzielUrl(campaign.heroImageUrl);
    const hero = heroImageUrl
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#111222;border:1px solid #292a40;border-radius:9px"><tr><td width="182" valign="middle" style="padding:16px"><img src="${escapeHtml(heroImageUrl)}" width="150" alt="${escapeHtml(campaign.heroAltText || "AZIEL catalog product artwork")}" style="display:block;width:150px;max-width:100%;height:auto;border:0;border-radius:7px"></td><td valign="middle" style="padding:16px 16px 16px 0;color:#d1cede;font-size:13px;line-height:1.6"><strong style="display:block;color:#ffffff;font-size:16px">Featured in this visual preview</strong>Existing approved AZIEL catalog artwork. No campaign is active.</td></tr></table>`
        : "";
    const offers = (Array.isArray(campaign.offers) ? campaign.offers : []).filter(offer => offer?.product && offer?.price && offer?.currency).map(offer => `<td width="33.33%" valign="top" style="padding:5px"><table role="presentation" width="100%" style="background:#111222;border:1px solid #292a40"><tr><td style="padding:14px;color:#ffffff;font-size:13px;line-height:1.55"><strong>${escapeHtml(offer.product)}</strong><br><span style="color:#ffd522;font-size:16px;font-weight:900">${escapeHtml(offer.price)} ${escapeHtml(offer.currency)}</span>${offer.discountLabel ? `<br><span style="color:#c062ff">${escapeHtml(offer.discountLabel)}</span>` : ""}</td></tr></table></td>`).join("");
    const content = `<tr><td style="padding:34px 28px"><div style="color:#c062ff;font-size:12px;font-weight:800">PREVIEW-ONLY PROMOTION</div><h1 style="margin:10px 0 8px;color:#ffffff;font-size:31px">${escapeHtml(campaign.title)}</h1><p style="color:#d1cede;font-size:14px;line-height:1.6">${escapeHtml(campaign.description)}</p>${campaign.validity ? `<p style="color:#aaa5ba;font-size:12px">${escapeHtml(campaign.validity)}</p>` : ""}${hero}<table role="presentation" width="100%"><tr>${offers}</tr></table>${button(campaign.ctaLabel || "View Products", campaign.ctaHref || "/explore")}<p style="text-align:center;color:#817b91;font-size:11px">Unsubscribe is intentionally unavailable in this preview. Production sending is blocked.</p></td></tr>`;
    return { subject: `[PREVIEW ONLY] ${campaign.title}`, text: `AZIEL Promotion Preview\n\n${campaign.title}\n${campaign.description}\n\nProduction sending blocked: consent, unsubscribe and suppression authority are not implemented.`, html: buildShell({ title: campaign.title, preheader: campaign.description, content, marketingPreview: true }) };
}

module.exports = { AZIEL_ORIGIN, EMAIL_BRAND_ASSETS, OFFICIAL_SOCIAL_LINKS, buildMarketingPreviewEmail, buildOtpEmail, buildSecurityAlertEmail, buildShell, button, escapeHtml, safeAzielUrl };
