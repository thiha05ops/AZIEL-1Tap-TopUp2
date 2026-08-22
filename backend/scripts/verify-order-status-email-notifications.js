const assert = require("assert");
const Module = require("module");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const originalLoad = Module._load;
const sentMessages = [];
const deliveries = new Map();
const usersByUsername = new Map([
    ["legacy_user", { _id: "66f000000000000000000101", username: "legacy_user", email: "legacy.user@example.com", authProvider: "local" }],
    ["google_user", { _id: "66f000000000000000000102", username: "google_user", email: "google.user@example.com", authProvider: "google" }],
    ["local_user", { _id: "66f000000000000000000103", username: "local_user", email: "local.user@example.com", authProvider: "local" }],
    ["missing_email", { _id: "66f000000000000000000104", username: "missing_email", email: "", authProvider: "local" }]
]);
const usersById = new Map([...usersByUsername.values()].map(user => [String(user._id), user]));

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
    findById(id) {
        return {
            select() {
                return {
                    lean: async () => usersById.get(String(id)) || null
                };
            }
        };
    },
    findOne(query) {
        return {
            select() {
                return {
                    lean: async () => usersByUsername.get(String(query.username || "")) || null
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
const { buildOrderCustomerSnapshot } = require("../services/orderCustomerSnapshotService");

async function verifyLifecycleStatus(status, eventType) {
    const order = {
        orderId: `QA-${status.toUpperCase()}`,
        username: "local_user",
        ...buildOrderCustomerSnapshot(usersByUsername.get("local_user")),
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
    assert.strictEqual(sent.to, "local.user@example.com", `${status}: customerEmail snapshot should be used.`);
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

async function verifyRecipientFallbacks() {
    assert.deepStrictEqual(
        buildOrderCustomerSnapshot(usersByUsername.get("google_user")),
        {
            customerEmail: "google.user@example.com",
            customerUserId: "66f000000000000000000102"
        },
        "Google-auth user snapshot should include canonical email and user id."
    );
    assert.deepStrictEqual(
        buildOrderCustomerSnapshot(usersByUsername.get("local_user")),
        {
            customerEmail: "local.user@example.com",
            customerUserId: "66f000000000000000000103"
        },
        "Username/password user snapshot should include canonical email and user id."
    );

    const cases = [
        {
            label: "legacy_username",
            order: {
                orderId: "QA-LEGACY-USERNAME",
                username: "legacy_user",
                status: "paid",
                game: "Mobile Legends",
                packageName: "Weekly Diamond Pass",
                amount: 55,
                currency: "THB"
            },
            expectedRecipient: "legacy.user@example.com"
        },
        {
            label: "linked_user_id",
            order: {
                orderId: "QA-LINKED-ID",
                username: "unknown_username",
                customerUserId: usersByUsername.get("google_user")._id,
                status: "processing",
                game: "Mobile Legends",
                packageName: "Weekly Diamond Pass",
                amount: 55,
                currency: "THB"
            },
            expectedRecipient: "google.user@example.com"
        },
        {
            label: "legacy_email_field",
            order: {
                orderId: "QA-LEGACY-EMAIL",
                username: "guest",
                email: "legacy.field@example.com",
                status: "completed",
                game: "Mobile Legends",
                packageName: "Weekly Diamond Pass",
                amount: 55,
                currency: "THB"
            },
            expectedRecipient: "legacy.field@example.com"
        }
    ];

    for (const item of cases) {
        const before = sentMessages.length;
        const result = await orderEmailService.notifyOrderTransition(item.order, { status: item.order.status });
        assert.deepStrictEqual(result, { delivered: true }, `${item.label}: should deliver.`);
        assert.strictEqual(sentMessages.length, before + 1, `${item.label}: should send once.`);
        assert.strictEqual(sentMessages[sentMessages.length - 1].to, item.expectedRecipient, `${item.label}: wrong recipient.`);
    }

    const missing = await orderEmailService.notifyOrderTransition({
        orderId: "QA-MISSING-EMAIL",
        username: "missing_email",
        status: "failed",
        game: "Mobile Legends",
        packageName: "Weekly Diamond Pass",
        amount: 55,
        currency: "THB"
    }, { status: "failed" });
    assert.strictEqual(missing.skipped, true, "Missing email should skip safely.");
    assert.strictEqual(missing.reason, "missing_recipient", "Missing email skip reason should be stable.");
}

async function verifyCanonicalCommerceOrder() {
    const order = {
        orderId: "QA-COMMERCE-COMPLETED",
        owner: { type: "USER", userId: usersByUsername.get("google_user")._id },
        customer: { contact: { email: "commerce.customer@example.com" } },
        product: { gameName: "Canonical Product", packageName: "Canonical Package" },
        commercial: { totalAmount: 2490, currency: "THB" },
        payment: { paymentMethodId: "promptpay" },
        status: "completed"
    };
    const before = sentMessages.length;
    await orderEmailService.notifyOrderTransition(order, { status: "completed" });
    const sent = sentMessages[sentMessages.length - 1];
    assert.strictEqual(sentMessages.length, before + 1);
    assert.strictEqual(sent.to, "commerce.customer@example.com");
    assert(sent.text.includes("Canonical Product"));
    assert(sent.text.includes("Canonical Package"));
    assert(sent.text.includes("2,490 THB"));
    assert(sent.text.includes("PromptPay"));
}

async function main() {
    const statuses = [
        ["pending_payment", "ORDER_CREATED_PENDING_PAYMENT"],
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
    await verifyRecipientFallbacks();
    await verifyCanonicalCommerceOrder();

    console.log("Order status email notification verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
}).finally(() => {
    Module._load = originalLoad;
});
