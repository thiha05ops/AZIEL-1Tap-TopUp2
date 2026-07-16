const assert = require("assert");
const Module = require("module");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const originalLoad = Module._load;
const sentMessages = [];
const deliveries = new Map();

function deliveryMatchesCurrentFilter(existing) {
    if (!existing) return true;
    if (existing.status === "failed") return true;
    if (!existing.status) return true;
    if (existing.status === "pending") {
        return Date.now() - Number(existing.updatedAt || 0) > 2 * 60 * 1000;
    }
    return false;
}

const EmailDeliveryMock = {
    async findOneAndUpdate(filter, update) {
        const key = filter.deliveryKey;
        const existing = deliveries.get(key);
        if (!deliveryMatchesCurrentFilter(existing)) {
            const duplicate = new Error("duplicate key");
            duplicate.code = 11000;
            throw duplicate;
        }

        const next = {
            _id: key,
            deliveryKey: key,
            messageType: update.$setOnInsert?.messageType || existing?.messageType || "",
            orderId: update.$setOnInsert?.orderId || existing?.orderId || "",
            recipientHash: update.$setOnInsert?.recipientHash || existing?.recipientHash || "",
            recipientMasked: update.$setOnInsert?.recipientMasked || existing?.recipientMasked || "",
            status: update.$set?.status || "pending",
            lastAttemptAt: update.$set?.lastAttemptAt || new Date(),
            attemptCount: Number(existing?.attemptCount || 0) + Number(update.$inc?.attemptCount || 0),
            updatedAt: Date.now()
        };
        deliveries.set(key, next);
        return next;
    },
    async updateOne(filter, update) {
        const key = filter._id;
        const existing = deliveries.get(key) || { _id: key, deliveryKey: key };
        deliveries.set(key, {
            ...existing,
            ...(update.$set || {}),
            updatedAt: Date.now()
        });
        return { modifiedCount: 1 };
    }
};

const UserMock = {
    findOne(query) {
        return {
            select() {
                return {
                    lean: async () => ({
                        username: query.username,
                        email: `${query.username || "customer"}@example.com`
                    })
                };
            }
        };
    }
};

const emailTransportMock = {
    classifyTransportError(error) {
        return error?.code || "EMAIL_SEND_FAILED";
    },
    hashRecipient(email = "") {
        return `hash:${email}`;
    },
    maskEmail(email = "") {
        return email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
    },
    async sendEmail(message) {
        sentMessages.push(message);
        return {
            messageId: `msg-${sentMessages.length}`,
            provider: "mock"
        };
    }
};

Module._load = function patchedLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === path.join(ROOT, "backend/models/EmailDelivery.js")) return EmailDeliveryMock;
    if (resolved === path.join(ROOT, "backend/models/User.js")) return UserMock;
    if (resolved === path.join(ROOT, "backend/services/emailTransportService.js")) return emailTransportMock;
    return originalLoad.apply(this, arguments);
};

const orderEmailService = require("../services/orderEmailService");

async function verifyLifecycleStatus(status, eventType) {
    const order = {
        orderId: `QA-${status.toUpperCase()}`,
        username: `customer_${status}`,
        game: "Mobile Legends",
        productName: "Mobile Legends",
        packageName: "7740+1548 Diamonds",
        amount: 1490,
        currency: "THB",
        status
    };

    const before = sentMessages.length;
    const first = await orderEmailService.notifyOrderTransition(order, { status });
    assert.deepStrictEqual(first, { delivered: true }, `${status}: first transition should deliver.`);
    assert.strictEqual(sentMessages.length, before + 1, `${status}: provider should receive one message.`);

    const sent = sentMessages[sentMessages.length - 1];
    assert.strictEqual(sent.messageType, eventType, `${status}: wrong message type.`);
    assert(sent.subject && sent.subject.includes(order.orderId), `${status}: subject should include order id.`);
    assert(sent.html.includes("AZIEL 1Tap Shop"), `${status}: branded HTML template missing.`);
    assert(sent.html.includes("/tracking.html?orderId="), `${status}: tracking link missing.`);
    assert(sent.html.includes("/support.html"), `${status}: support link missing.`);
    assert(sent.text.includes("Track order:"), `${status}: plain text tracking link missing.`);

    const second = await orderEmailService.notifyOrderTransition(order, { status });
    assert.strictEqual(second.skipped, true, `${status}: duplicate transition should be skipped.`);
    assert.strictEqual(second.reason, "duplicate_or_pending", `${status}: duplicate reason should be stable.`);
    assert.strictEqual(sentMessages.length, before + 1, `${status}: duplicate should not send again.`);
}

async function main() {
    const statuses = [
        ["paid", "PAYMENT_CONFIRMED"],
        ["processing", "ORDER_PROCESSING"],
        ["completed", "ORDER_COMPLETED"],
        ["failed", "ORDER_FAILED"],
        ["cancelled", "ORDER_CANCELLED"]
    ];

    statuses.forEach(([status, eventType]) => {
        assert.strictEqual(
            orderEmailService.eventTypeForTransition({ status }),
            eventType,
            `${status}: transition event map is incorrect.`
        );
    });

    for (const [status, eventType] of statuses) {
        await verifyLifecycleStatus(status, eventType);
    }

    console.log("Order status email notification verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
}).finally(() => {
    Module._load = originalLoad;
});
