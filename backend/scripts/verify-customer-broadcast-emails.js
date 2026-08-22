"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.resolve(__dirname, "../..");
const originalLoad = Module._load;
let lastQuery = null;
let sent = [];

const users = [
    { username: "active", email: "active@example.com" },
    { username: "e2e", email: "aziel-e2e-user@example.com" },
    { username: "failure", email: "failure@example.com" }
];

const UserMock = {
    find(query) {
        lastQuery = query;
        return { select() { return { lean: async () => users }; } };
    }
};

const transportMock = {
    classifyTransportError(error) { return error?.code || "EMAIL_SEND_FAILED"; },
    async sendEmail(message) {
        sent.push(message);
        if (message.to === "failure@example.com") throw Object.assign(new Error("safe failure"), { code: "EMAIL_NETWORK_UNAVAILABLE" });
        if (message.to.includes("aziel-e2e")) return { suppressed: true, messageId: "aziel-e2e-suppressed" };
        return { messageId: "mock-delivered" };
    }
};

Module._load = function patchedLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === path.join(ROOT, "backend/models/User.js")) return UserMock;
    if (resolved === path.join(ROOT, "backend/services/emailTransportService.js")) return transportMock;
    return originalLoad.apply(this, arguments);
};

async function main() {
    const service = require("../services/broadcastEmailService");
    const announcement = service.buildBroadcastEmail({ title: "Maintenance", message: "Tonight", type: "announcement" });
    const promotion = service.buildBroadcastEmail({ title: "Discount", message: "This week", type: "promo" });
    assert(announcement.subject.startsWith("AZIEL Update:"));
    assert(promotion.subject.startsWith("AZIEL Promotion:"));

    const result = await service.deliverAdminBroadcastEmails({
        audience: "ALL_ACTIVE_CUSTOMERS",
        title: "Maintenance",
        message: "Tonight",
        type: "announcement"
    });
    assert.deepStrictEqual(lastQuery, { isBlocked: { $ne: true }, email: { $type: "string", $ne: "" } });
    assert.deepStrictEqual(result.summary, {
        attempted: 3,
        delivered: 1,
        suppressed: 1,
        failed: 1,
        failureCodes: ["EMAIL_NETWORK_UNAVAILABLE"]
    });
    assert.strictEqual(sent.length, 3);

    const adminSource = fs.readFileSync(path.join(ROOT, "frontend/js/admin-app.js"), "utf8");
    const routeSource = fs.readFileSync(path.join(ROOT, "backend/routes/notification.js"), "utf8");
    assert(adminSource.includes('audience: "ALL_ACTIVE_CUSTOMERS"'), "Admin action must explicitly request its audience.");
    assert(!adminSource.includes("sendEmail("), "Frontend must not own email delivery.");
    assert(routeSource.includes("deliverAdminBroadcastEmails"), "Backend broadcast action must cross the email boundary.");
    console.log("Customer broadcast email verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
}).finally(() => {
    Module._load = originalLoad;
});
