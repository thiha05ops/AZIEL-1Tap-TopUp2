const assert = require("assert");
const Module = require("module");
const path = require("path");
const nodemailer = require("nodemailer");

const ROOT = path.resolve(__dirname, "../..");
const originalLoad = Module._load;
const threads = new Map();
const deliveries = new Map();
const sent = [];
let providerCounter = 0;
let failNextSend = false;

const query = value => ({ select: () => ({ lean: async () => value }) });

const ThreadModel = {
    async findOneAndUpdate(filter, update) {
        const key = filter.commerceOrderId;
        if (!threads.has(key)) threads.set(key, { ...update.$setOnInsert });
        return { ...threads.get(key) };
    },
    async findOne({ commerceOrderId }) {
        return threads.has(commerceOrderId) ? { ...threads.get(commerceOrderId) } : null;
    },
    async updateOne(filter, update) {
        const current = threads.get(filter.commerceOrderId);
        if (current && (!filter.recipientHash || current.recipientHash === filter.recipientHash)) {
            threads.set(filter.commerceOrderId, { ...current, ...update.$set });
        }
    }
};

const DeliveryModel = {
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
            ...(existing || update.$setOnInsert),
            _id: filter.deliveryKey,
            ...update.$set,
            attemptCount: Number(existing?.attemptCount || 0) + 1,
            updatedAt: Date.now()
        };
        deliveries.set(filter.deliveryKey, value);
        return { ...value };
    },
    async updateOne(filter, update) {
        const current = deliveries.get(filter._id);
        if (current) deliveries.set(filter._id, { ...current, ...update.$set, updatedAt: Date.now() });
    }
};

const transportMock = {
    classifyTransportError: error => error.code || "EMAIL_SEND_FAILED",
    hashRecipient: email => require("crypto").createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 16),
    maskEmail: () => "masked",
    async sendEmail(message) {
        if (failNextSend) {
            failNextSend = false;
            const error = new Error("offline simulated failure");
            error.code = "EMAIL_SEND_FAILED";
            throw error;
        }
        sent.push({ ...message });
        providerCounter += 1;
        return { providerMessageId: `provider-api-${providerCounter}`, provider: "offline" };
    }
};

const CatalogModel = { findOne: () => query(null) };
const MediaModel = { findOne: () => query(null) };
const UserModel = { findById: () => query(null), findOne: () => query(null) };

Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === path.join(ROOT, "backend/models/OrderEmailThread.js")) return ThreadModel;
    if (resolved === path.join(ROOT, "backend/models/EmailDelivery.js")) return DeliveryModel;
    if (resolved === path.join(ROOT, "backend/models/CatalogProduct.js")) return CatalogModel;
    if (resolved === path.join(ROOT, "backend/models/MediaAsset.js")) return MediaModel;
    if (resolved === path.join(ROOT, "backend/models/User.js")) return UserModel;
    if (resolved === path.join(ROOT, "backend/services/emailTransportService.js")) return transportMock;
    return originalLoad.apply(this, arguments);
};

function loadServiceFresh() {
    const servicePath = require.resolve("../services/orderEmailService");
    delete require.cache[servicePath];
    return require(servicePath);
}

function order(orderId, recipient = "thread-test@example.com") {
    return {
        orderId,
        customerEmail: recipient,
        status: "pending_payment",
        product: { gameCode: "missing", gameName: "Snapshot Product", packageName: "Package" },
        commercial: { totalAmount: 1000, currency: "MMK" },
        payment: { paymentMethodId: "mmqr" },
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        statusHistory: []
    };
}

async function compileMime(message) {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const result = await transport.sendMail({
        from: "AZIEL <noreply@azielplay.com>",
        to: "thread-test@example.com",
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId: message.messageId,
        inReplyTo: message.inReplyTo || undefined,
        references: message.references?.length ? message.references : undefined
    });
    return result.message.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
}

async function main() {
    let service = loadServiceFresh();
    const first = order("AZL-THREAD-ONE");
    await Promise.all([
        service.deliverOrderEmail(first, "ORDER_CREATED_PENDING_PAYMENT"),
        service.deliverOrderEmail(first, "ORDER_CREATED_PENDING_PAYMENT")
    ]);
    assert.strictEqual(sent.length, 1, "Duplicate root event must send once.");
    const root = sent[0];
    assert.strictEqual(root.subject, "AZIEL Order AZL-THREAD-ONE");
    assert.strictEqual(root.transportProvider, "gmail_smtp");
    assert.strictEqual(root.inReplyTo, "");
    assert.deepStrictEqual(root.references, []);
    assert.strictEqual(threads.get(first.orderId).rootDeliveryKey, `${first.orderId}:ORDER_CREATED_PENDING_PAYMENT`);
    assert.strictEqual(root.messageId, threads.get(first.orderId).rootMessageId);

    await Promise.all([
        service.deliverOrderEmail({ ...first, status: "paid" }, "PAYMENT_CONFIRMED"),
        service.deliverOrderEmail({ ...first, status: "processing" }, "ORDER_PROCESSING")
    ]);
    await service.deliverOrderEmail({ ...first, status: "completed" }, "ORDER_COMPLETED");
    const children = sent.slice(1);
    assert.strictEqual(children.length, 3);
    assert.strictEqual(new Set(children.map(item => item.messageId)).size, 3);
    children.forEach(item => {
        assert.notStrictEqual(item.messageId, root.messageId);
        assert.strictEqual(item.inReplyTo, root.messageId);
        assert.deepStrictEqual(item.references, [root.messageId]);
        assert.strictEqual(item.subject, root.subject);
    });
    assert.notStrictEqual(children[0].html, children[1].html, "Event-specific body copy must remain distinct.");

    const rootMime = await compileMime(root);
    assert(rootMime.includes(`Message-ID: ${root.messageId}`));
    assert(!/^In-Reply-To:/mi.test(rootMime));
    assert(!/^References:/mi.test(rootMime));
    const childMime = await compileMime(children[0]);
    assert(childMime.includes(`Message-ID: ${children[0].messageId}`));
    assert(childMime.includes(`In-Reply-To: ${root.messageId}`));
    assert(childMime.includes(`References: ${root.messageId}`));

    const second = order("AZL-THREAD-TWO", "second@example.com");
    await service.deliverOrderEmail(second, "ORDER_CREATED_PENDING_PAYMENT");
    const secondRoot = sent.at(-1);
    assert.notStrictEqual(secondRoot.messageId, root.messageId);
    assert.strictEqual(secondRoot.subject, "AZIEL Order AZL-THREAD-TWO");

    const race = order("AZL-THREAD-RACE");
    const raceStart = sent.length;
    await Promise.all([
        service.deliverOrderEmail(race, "PAYMENT_CONFIRMED"),
        service.deliverOrderEmail({ ...race, status: "processing" }, "ORDER_PROCESSING")
    ]);
    const raced = sent.slice(raceStart);
    assert.strictEqual(raced.length, 2);
    assert.strictEqual(raced.filter(item => !item.inReplyTo && item.references.length === 0).length, 1, "Concurrent first events must have exactly one root owner.");
    assert.strictEqual(raced.filter(item => item.inReplyTo === threads.get(race.orderId).rootMessageId).length, 1, "Concurrent loser must reference the winning root.");

    const retryOrder = order("AZL-THREAD-RETRY");
    failNextSend = true;
    await assert.rejects(() => service.deliverOrderEmail(retryOrder, "ORDER_CREATED_PENDING_PAYMENT"));
    const retryKey = `${retryOrder.orderId}:ORDER_CREATED_PENDING_PAYMENT`;
    const failedIdentity = deliveries.get(retryKey).rfcMessageId;
    service = loadServiceFresh();
    await service.deliverOrderEmail(retryOrder, "ORDER_CREATED_PENDING_PAYMENT");
    assert.strictEqual(deliveries.get(retryKey).rfcMessageId, failedIdentity, "Retry/restart must reuse RFC identity.");
    assert.strictEqual(sent.at(-1).messageId, failedIdentity);

    const beforeDuplicate = sent.length;
    const duplicate = await service.deliverOrderEmail(retryOrder, "ORDER_CREATED_PENDING_PAYMENT");
    assert.strictEqual(duplicate.reason, "duplicate_or_pending");
    assert.strictEqual(sent.length, beforeDuplicate);

    await assert.rejects(
        () => service.deliverOrderEmail(order(first.orderId, "different@example.com"), "REFUND_REQUESTED"),
        error => error?.code === "ORDER_EMAIL_THREAD_RECIPIENT_MISMATCH"
    );

    const forbidden = [
        "thread-test@example.com",
        "66f000000000000000000999",
        "paymentAttempt-secret",
        "provider-reference-secret",
        "credential-secret"
    ];
    [...threads.values()].forEach(thread => forbidden.forEach(value => assert(!thread.rootMessageId.includes(value))));
    [...deliveries.values()].forEach(delivery => {
        assert.notStrictEqual(delivery.providerMessageId, delivery.rfcMessageId);
        forbidden.forEach(value => assert(!String(delivery.rfcMessageId).includes(value)));
    });

    Module._load = originalLoad;
    console.log("verify-order-email-threading: ok");
}

main().catch(error => {
    Module._load = originalLoad;
    console.error(error);
    process.exitCode = 1;
});
