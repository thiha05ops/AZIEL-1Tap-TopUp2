const assert = require("assert");
const Module = require("module");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const originalLoad = Module._load;
const oldEnv = { FRONTEND_URL: process.env.FRONTEND_URL, CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME };
process.env.FRONTEND_URL = "https://azielplay.com";
process.env.CLOUDINARY_CLOUD_NAME = "aziel-test";

const sent = [];
const deliveries = new Map();
let sendFailure = null;
let catalogFailure = false;
const users = new Map([
    ["legacy_user", { _id: "66f000000000000000000101", username: "legacy_user", email: "legacy.user@example.com" }],
    ["google_user", { _id: "66f000000000000000000102", username: "google_user", email: "google.user@example.com" }],
    ["local_user", { _id: "66f000000000000000000103", username: "local_user", email: "local.user@example.com" }],
    ["missing_email", { _id: "66f000000000000000000104", username: "missing_email", email: "" }]
]);
const byId = new Map([...users.values()].map(user => [String(user._id), user]));
const query = value => ({ select: () => ({ lean: async () => value }) });

const EmailDeliveryMock = {
    async findOneAndUpdate(filter, update) {
        const existing = deliveries.get(filter.deliveryKey);
        const retryable = !existing || existing.status === "failed" ||
            (existing.status === "pending" && Date.now() - existing.updatedAt > 120000);
        if (!retryable) {
            const error = new Error("duplicate key");
            error.code = 11000;
            throw error;
        }
        const value = {
            _id: filter.deliveryKey,
            deliveryKey: filter.deliveryKey,
            status: update.$set.status,
            attemptCount: Number(existing?.attemptCount || 0) + 1,
            updatedAt: Date.now()
        };
        deliveries.set(filter.deliveryKey, value);
        return value;
    },
    async updateOne(filter, update) {
        deliveries.set(filter._id, { ...deliveries.get(filter._id), ...update.$set, updatedAt: Date.now() });
    }
};
const UserMock = {
    findById: id => query(byId.get(String(id)) || null),
    findOne: ({ username }) => query(users.get(String(username)) || null)
};
const CatalogProductMock = {
    findOne({ productCode }) {
        if (catalogFailure) throw new Error("catalog unavailable");
        if (productCode === "mlbb" || productCode === "unsafe") {
            return query({ name: "Mobile Legends", presentation: { imageAssetId: `asset-${productCode}` }, deletedAt: null });
        }
        return query(null);
    }
};
const MediaAssetMock = {
    findOne({ assetId }) {
        const safe = assetId === "asset-mlbb";
        return query(assetId ? {
            assetId,
            secureUrl: safe
                ? "https://res.cloudinary.com/aziel-test/image/upload/v1/catalog/mlbb.webp"
                : "https://example.invalid/private.webp",
            altText: "Mobile Legends & Diamonds",
            category: "product_image",
            status: "active"
        } : null);
    }
};
const transportMock = {
    classifyTransportError: error => error.code || "EMAIL_SEND_FAILED",
    hashRecipient: email => `hash:${email}`,
    maskEmail: email => email,
    async sendEmail(message) {
        if (sendFailure) throw sendFailure;
        sent.push(message);
        return { messageId: `msg-${sent.length}`, provider: "mock" };
    }
};

Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === path.join(ROOT, "backend/models/EmailDelivery.js")) return EmailDeliveryMock;
    if (resolved === path.join(ROOT, "backend/models/User.js")) return UserMock;
    if (resolved === path.join(ROOT, "backend/models/CatalogProduct.js")) return CatalogProductMock;
    if (resolved === path.join(ROOT, "backend/models/MediaAsset.js")) return MediaAssetMock;
    if (resolved === path.join(ROOT, "backend/services/emailTransportService.js")) return transportMock;
    return originalLoad.apply(this, arguments);
};

const service = require("../services/orderEmailService");

const EVENTS = [
    ["pending_payment", "ORDER_CREATED_PENDING_PAYMENT"],
    ["paid", "PAYMENT_CONFIRMED"],
    ["processing", "ORDER_PROCESSING"],
    ["completed", "ORDER_COMPLETED"],
    ["failed", "ORDER_FAILED"],
    ["cancelled", "ORDER_CANCELLED"],
    ["refund_requested", "REFUND_REQUESTED"],
    ["refund_rejected", "REFUND_REJECTED"],
    ["refunded", "REFUND_COMPLETED"]
];
const EVENT_ACCENTS = {
    pending_payment: "#7c3aed",
    paid: "#16a34a",
    processing: "#7c3aed",
    completed: "#16a34a",
    failed: "#dc2626",
    cancelled: "#dc2626",
    refund_requested: "#7c3aed",
    refund_rejected: "#dc2626",
    refunded: "#16a34a"
};

function order(status, id = status.toUpperCase()) {
    return {
        orderId: `QA-${id}`,
        username: "local_user",
        customerEmail: "local.user@example.com",
        customerUserId: "66f000000000000000000103",
        product: { gameCode: "mlbb", gameName: "Mobile Legends", packageName: "7740+1548 Diamonds" },
        commercial: { totalAmount: 1490, currency: "THB" },
        payment: { paymentMethodId: "promptpay" },
        createdAt: new Date("2026-09-30T08:00:00.000Z"),
        statusHistory: [
            { field: "orderStatus", toStatus: "paid", changedAt: new Date("2026-09-30T08:05:00.000Z") },
            { field: "paymentStatus", toStatus: "paid", changedAt: new Date("2026-09-30T08:05:00.000Z") },
            { field: "orderStatus", toStatus: status, changedAt: new Date("2026-09-30T08:10:00.000Z") }
        ],
        status
    };
}

async function verifyEveryEvent() {
    assert.deepStrictEqual(
        Object.keys(service.EVENT_COPY).sort(),
        [...EVENTS.map(([, event]) => event), "PAYMENT_SLIP_SUBMITTED"].sort()
    );
    for (const [status, event] of EVENTS) {
        assert.strictEqual(service.eventTypeForTransition({ status }), event);
        const item = order(status);
        assert.deepStrictEqual(await service.notifyOrderTransition(item, { status }), { delivered: true });
        const message = sent.at(-1);
        assert.strictEqual(message.messageType, event);
        assert(message.subject.includes(item.orderId));
        assert(message.html.startsWith("<!doctype html>"));
        assert(message.html.includes('name="viewport"'));
        assert(message.html.includes('role="presentation"'));
        assert(message.html.includes("max-width:640px"));
        assert(message.html.includes(">View Order Details →</a>"));
        assert(message.html.includes("https://azielplay.com/orders?orderId="));
        assert(message.html.includes("border-radius:999px"), `${status}: accessible status badge missing.`);
        assert(message.html.includes("border-radius:10px"), `${status}: compact order details card missing.`);
        assert(message.html.includes("color:#ffd522;font-size:15px"), `${status}: total must be emphasized in AZIEL yellow.`);
        assert(message.text.includes("View order: https://azielplay.com/orders?orderId="));
        assert(message.text.includes("Order timeline:"));
        assert(message.text.includes("Product: Mobile Legends"));
        assert(message.text.includes("Package: 7740+1548 Diamonds"));
        assert(message.text.includes("Total: 1,490 THB"));
        assert(message.text.includes(`Current status: ${status.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase())}`));
        assert(message.html.includes(`color:${EVENT_ACCENTS[status]}`), `${status}: event status accent missing.`);
        assert(!/<script|<style|data:image|tracking.?pixel/i.test(message.html));
        assert.deepStrictEqual(await service.notifyOrderTransition(item, { status }), {
            skipped: true, reason: "duplicate_or_pending"
        });
    }
    const manual = order("pending_payment", "MANUAL-SLIP");
    assert.deepStrictEqual(await service.notifyManualPaymentSubmitted(manual), { delivered: true });
    assert.strictEqual(sent.at(-1).messageType, "PAYMENT_SLIP_SUBMITTED");
}

async function verifyImages() {
    await service.notifyOrderTransition(order("processing", "IMAGE"), { status: "processing" });
    assert(sent.at(-1).html.includes('src="https://res.cloudinary.com/aziel-test/image/upload/v1/catalog/mlbb.webp"'));
    assert(sent.at(-1).html.includes('alt="Mobile Legends &amp; Diamonds"'));
    assert(sent.at(-1).html.includes('width="166"'), "Product thumbnail must use the bounded email-safe width.");
    assert(sent.at(-1).html.includes("width:166px;max-width:100%;height:auto"));
    assert(!/object-fit|background-image/i.test(sent.at(-1).html), "Hero must not depend on unsupported cropping CSS.");
    for (const unsafe of [
        "http://res.cloudinary.com/aziel-test/x.webp",
        "https://evil.example/x.webp",
        "https://res.cloudinary.com/wrong-cloud/x.webp",
        "https://res.cloudinary.com/aziel-test/x.webp?token=secret",
        "https://user:pass@res.cloudinary.com/aziel-test/x.webp"
    ]) assert.strictEqual(service.safePublicImageUrl(unsafe), "");

    const fallback = order("processing", "UNSAFE-IMAGE");
    fallback.product.gameCode = "unsafe";
    await service.notifyOrderTransition(fallback, { status: "processing" });
    assert(!sent.at(-1).html.includes("example.invalid"));
    assert(sent.at(-1).html.includes("Mobile Legends"));

    catalogFailure = true;
    await service.notifyOrderTransition(order("processing", "CATALOG-FAIL"), { status: "processing" });
    catalogFailure = false;
    assert(sent.at(-1).html.includes("Mobile Legends"), "Catalog failure must use fallback and still send.");
}

function verifySafetyAndTimeline() {
    process.env.FRONTEND_URL = "https://attacker.example";
    assert.strictEqual(service.absoluteUrl("/orders"), "https://azielplay.com/orders");
    process.env.FRONTEND_URL = "https://azielplay.com";
    const hostile = {
        orderId: 'AZL-<script>alert("id")</script>',
        product: { gameName: '<img src=x onerror="bad">', packageName: "A&B <Premium>" },
        commercial: { totalAmount: 3573, currency: "MMK" },
        status: "refund_rejected",
        refundRejectedReason: "<script>secret()</script>",
        createdAt: "2026-09-30T08:00:00.000Z",
        statusHistory: [
            { field: "orderStatus", toStatus: "processing", changedAt: "2026-09-30T08:10:00.000Z" },
            { field: "orderStatus", toStatus: "completed", changedAt: "invalid" }
        ]
    };
    const message = service.buildOrderEmail(hostile, "REFUND_REJECTED");
    assert(!message.html.includes("<script>"));
    assert(!message.html.includes("<img src=x"));
    assert(message.html.includes("&lt;script&gt;secret()&lt;/script&gt;"));
    assert(message.html.includes("A&amp;B &lt;Premium&gt;"));
    assert(message.html.includes("orderId=AZL-%3Cscript%3E"));
    assert(!/token=|jwt=|player.?id/i.test(message.html));
    assert.deepStrictEqual(service.buildTimeline(hostile).map(item => item.status), ["pending_payment", "processing"]);
    assert(!message.html.includes(">Completed</div>"));
    const noHistory = service.buildOrderEmail({ orderId: "QA-NONE", status: "processing" }, "ORDER_PROCESSING");
    assert(!noHistory.html.includes("Order Timeline</h2>"));

    const longValue = "Fictional Ultra Long Package Name ".repeat(8).trim();
    const longMessage = service.buildOrderEmail({
        orderId: "QA-LONG-VALUE",
        product: { gameName: `${longValue} Product`, packageName: longValue },
        commercial: { totalAmount: 1234567, currency: "MMK" },
        status: "processing",
        createdAt: "2026-09-30T08:00:00.000Z"
    }, "ORDER_PROCESSING");
    assert(longMessage.html.includes("word-break:break-word"));
    assert(longMessage.html.includes("overflow-wrap:anywhere"));
    assert(longMessage.html.includes(longValue));
    assert(longMessage.text.includes(`Package: ${longValue}`));

    const failedOrder = order("failed", "TIMELINE-COLORS");
    failedOrder.statusHistory = [
        { field: "orderStatus", toStatus: "paid", changedAt: "2026-09-30T08:04:00.000Z" },
        { field: "orderStatus", toStatus: "processing", changedAt: "2026-09-30T08:08:00.000Z" },
        { field: "orderStatus", toStatus: "failed", changedAt: "2026-09-30T08:12:00.000Z" }
    ];
    const failedTimeline = service.buildOrderEmail(failedOrder, "ORDER_FAILED").html.split("Order Timeline</h2>")[1];
    assert.strictEqual((failedTimeline.match(/color:#dc2626/g) || []).length, 1, "Only the actual failed timeline step may be red.");
    assert((failedTimeline.match(/color:#16a34a/g) || []).length >= 2, "Successful historical steps must remain green.");
    assert(failedTimeline.includes("color:#64748b"), "Historical pending step must remain neutral.");
    assert(failedTimeline.includes(">✓</td>"), "Completed timeline evidence must use check markers.");
    assert(failedTimeline.includes(">!</td>"), "Actual failure must use a failure marker.");
    assert(failedTimeline.includes("border-left:2px solid #3a3151"), "Timeline markers must be visibly connected.");

    const processingTimeline = service.buildOrderEmail(order("processing", "CURRENT-PROCESSING"), "ORDER_PROCESSING").html.split("Order Timeline</h2>")[1];
    assert(processingTimeline.includes("color:#7c3aed"), "Current processing step must be purple.");
}

async function verifyRecipientsAndFailureIsolation() {
    const fallback = order("paid", "USER-FALLBACK");
    delete fallback.customerEmail;
    await service.notifyOrderTransition(fallback, { status: "paid" });
    assert.strictEqual(sent.at(-1).to, "local.user@example.com");
    const recipientCases = [
        [{ username: "legacy_user", customerEmail: "", customerUserId: "" }, "legacy.user@example.com"],
        [{ username: "unknown", customerEmail: "", customerUserId: "66f000000000000000000102" }, "google.user@example.com"],
        [{ username: "guest", customerEmail: "legacy.field@example.com", customerUserId: "" }, "legacy.field@example.com"]
    ];
    for (const [identity, recipient] of recipientCases) {
        const item = { ...order("completed", `RECIPIENT-${sent.length}`), ...identity };
        await service.notifyOrderTransition(item, { status: "completed" });
        assert.strictEqual(sent.at(-1).to, recipient);
        assert(sent.at(-1).text.includes("Current status: Completed"));
        assert(sent.at(-1).text.includes("1,490 THB"));
    }
    const missing = order("failed", "MISSING-EMAIL");
    missing.username = "missing_email";
    missing.customerEmail = "";
    missing.customerUserId = "";
    assert.deepStrictEqual(await service.notifyOrderTransition(missing, { status: "failed" }), {
        skipped: true, reason: "missing_recipient"
    });

    const failed = order("processing", "SEND-FAIL");
    const before = JSON.stringify(failed);
    sendFailure = Object.assign(new Error("unavailable"), { code: "EMAIL_NETWORK_UNAVAILABLE" });
    await assert.rejects(service.notifyOrderTransition(failed, { status: "processing" }),
        error => error.code === "EMAIL_NETWORK_UNAVAILABLE");
    sendFailure = null;
    assert.strictEqual(JSON.stringify(failed), before, "Email failure must not mutate the order.");
    assert.strictEqual(deliveries.get(`${failed.orderId}:ORDER_PROCESSING`).status, "failed");
}

async function main() {
    await verifyEveryEvent();
    await verifyImages();
    verifySafetyAndTimeline();
    await verifyRecipientsAndFailureIsolation();
    console.log("Order status email notification verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    Module._load = originalLoad;
    for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});
