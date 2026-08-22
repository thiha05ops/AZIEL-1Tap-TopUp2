const User = require("../models/User");
const { classifyTransportError, sendEmail } = require("./emailTransportService");

function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[character]);
}

function buildBroadcastEmail({ title, message, type = "announcement" } = {}) {
    const safeTitle = String(title || "").trim();
    const safeMessage = String(message || "").trim();
    if (!safeTitle || !safeMessage) throw new Error("Broadcast title and message are required.");
    const label = type === "promo" ? "AZIEL Promotion" : "AZIEL Update";
    return {
        subject: `${label}: ${safeTitle}`,
        text: `AZIEL 1Tap Shop\n\n${safeTitle}\n\n${safeMessage}`,
        html: `<div style="font-family:Arial,sans-serif;padding:24px"><strong style="color:#7c3aed">${label}</strong><h1>${escapeHtml(safeTitle)}</h1><p style="line-height:1.6">${escapeHtml(safeMessage).replace(/\n/g, "<br>")}</p></div>`
    };
}

async function resolveBroadcastAudience({ usernames = [], audience = "" } = {}) {
    const requested = Array.isArray(usernames) ? usernames.map(value => String(value || "").trim()).filter(Boolean) : [];
    const query = audience === "ALL_ACTIVE_CUSTOMERS"
        ? { isBlocked: { $ne: true }, email: { $type: "string", $ne: "" } }
        : { username: { $in: requested }, isBlocked: { $ne: true }, email: { $type: "string", $ne: "" } };
    return User.find(query).select("username email").lean();
}

async function deliverAdminBroadcastEmails(input = {}) {
    const recipients = await resolveBroadcastAudience(input);
    const message = buildBroadcastEmail(input);
    const outcomes = await Promise.allSettled(recipients.map(user => sendEmail({
        to: user.email,
        ...message,
        messageType: input.type === "promo" ? "promotional" : "announcement",
        operation: "admin.broadcast.email"
    })));
    const summary = { attempted: recipients.length, delivered: 0, suppressed: 0, failed: 0, failureCodes: [] };
    outcomes.forEach(outcome => {
        if (outcome.status === "fulfilled") {
            if (outcome.value?.suppressed) summary.suppressed += 1;
            else summary.delivered += 1;
            return;
        }
        summary.failed += 1;
        summary.failureCodes.push(classifyTransportError(outcome.reason));
    });
    summary.failureCodes = [...new Set(summary.failureCodes)];
    return { recipients, summary };
}

module.exports = { buildBroadcastEmail, deliverAdminBroadcastEmails, resolveBroadcastAudience };
