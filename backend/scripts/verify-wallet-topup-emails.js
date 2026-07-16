const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const originalLoad = Module._load;
const sentMessages = [];
const deliveries = new Map();
const usersByUsername = new Map([
    ["legacy_wallet", { _id: "66f000000000000000000201", username: "legacy_wallet", email: "legacy.wallet@example.com" }],
    ["google_wallet", { _id: "66f000000000000000000202", username: "google_wallet", email: "google.wallet@example.com", authProvider: "google" }],
    ["local_wallet", { _id: "66f000000000000000000203", username: "local_wallet", email: "local.wallet@example.com", authProvider: "local" }],
    ["missing_wallet", { _id: "66f000000000000000000204", username: "missing_wallet", email: "" }]
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
            messageId: `wallet-msg-${sentMessages.length}`,
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

const walletEmailService = require("../services/walletEmailService");
const { buildOrderCustomerSnapshot } = require("../services/orderCustomerSnapshotService");

function baseTopup(overrides = {}) {
    return {
        topupId: overrides.topupId || `WALLET-QA-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        username: "local_wallet",
        ...buildOrderCustomerSnapshot(usersByUsername.get("local_wallet")),
        amount: 50000,
        currency: "MMK",
        paymentMethod: "wavepay",
        paymentSnapshot: {
            method: "WavePay"
        },
        status: "approved",
        ...overrides
    };
}

async function verifyLifecycleEvent({ label, eventType, notify, topup }) {
    const before = sentMessages.length;
    const first = await notify(topup);
    assert.deepStrictEqual(first, { delivered: true }, `${label}: first notification should deliver.`);
    assert.strictEqual(sentMessages.length, before + 1, `${label}: provider should receive one message.`);

    const sent = sentMessages[sentMessages.length - 1];
    assert.strictEqual(sent.to, "local.wallet@example.com", `${label}: customer email snapshot should be used.`);
    assert.strictEqual(sent.messageType, eventType, `${label}: wrong message type.`);
    assert(sent.subject.includes(topup.topupId), `${label}: subject should include top-up id.`);
    assert(sent.html.includes("AZIEL 1Tap Shop"), `${label}: branded HTML template missing.`);
    assert(sent.html.includes("/wallet.html"), `${label}: wallet link missing.`);
    assert(sent.html.includes("/support.html"), `${label}: support link missing.`);
    assert(sent.text.includes("Open wallet:"), `${label}: plain-text wallet link missing.`);

    const delivery = deliveries.get(`${topup.topupId}:${eventType}`);
    assert(delivery, `${label}: EmailDelivery lock should be created.`);
    assert.strictEqual(delivery.orderId, topup.topupId, `${label}: top-up id should be stored for traceability.`);
    assert.strictEqual(delivery.status, "delivered", `${label}: delivery should be marked delivered.`);

    const second = await notify(topup);
    assert.strictEqual(second.skipped, true, `${label}: duplicate notification should be skipped.`);
    assert.strictEqual(second.reason, "duplicate_or_pending", `${label}: duplicate skip reason should be stable.`);
    assert.strictEqual(sentMessages.length, before + 1, `${label}: duplicate should not send again.`);
}

async function verifyRecipientFallbacks() {
    const cases = [
        {
            label: "linked_user_id",
            topup: baseTopup({
                topupId: "WALLET-QA-LINKED-ID",
                username: "unknown_wallet",
                customerEmail: "",
                customerUserId: usersByUsername.get("google_wallet")._id
            }),
            expectedRecipient: "google.wallet@example.com"
        },
        {
            label: "legacy_username",
            topup: baseTopup({
                topupId: "WALLET-QA-LEGACY-USERNAME",
                username: "legacy_wallet",
                customerEmail: "",
                customerUserId: null
            }),
            expectedRecipient: "legacy.wallet@example.com"
        },
        {
            label: "legacy_email_field",
            topup: baseTopup({
                topupId: "WALLET-QA-LEGACY-EMAIL",
                username: "guest",
                customerEmail: "",
                customerUserId: null,
                email: "legacy.wallet.field@example.com"
            }),
            expectedRecipient: "legacy.wallet.field@example.com"
        }
    ];

    for (const item of cases) {
        const before = sentMessages.length;
        const result = await walletEmailService.notifyWalletTopupApproved(item.topup);
        assert.deepStrictEqual(result, { delivered: true }, `${item.label}: should deliver.`);
        assert.strictEqual(sentMessages.length, before + 1, `${item.label}: should send once.`);
        assert.strictEqual(sentMessages[sentMessages.length - 1].to, item.expectedRecipient, `${item.label}: wrong recipient.`);
    }

    const missing = await walletEmailService.notifyWalletTopupRejected(baseTopup({
        topupId: "WALLET-QA-MISSING-EMAIL",
        username: "missing_wallet",
        customerEmail: "",
        customerUserId: null,
        status: "rejected"
    }));
    assert.strictEqual(missing.skipped, true, "Missing email should skip safely.");
    assert.strictEqual(missing.reason, "missing_recipient", "Missing email skip reason should be stable.");
}

function verifyStaticIntegration() {
    const walletRoute = fs.readFileSync(path.join(ROOT, "backend/routes/wallet.js"), "utf8");
    const paymentRoute = fs.readFileSync(path.join(ROOT, "backend/routes/payment.js"), "utf8");
    const topupModel = fs.readFileSync(path.join(ROOT, "backend/models/WalletTopup.js"), "utf8");
    const intentModel = fs.readFileSync(path.join(ROOT, "backend/models/WalletTopupIntent.js"), "utf8");

    assert(topupModel.includes("customerEmail"), "WalletTopup should include a customerEmail snapshot.");
    assert(topupModel.includes("customerUserId"), "WalletTopup should include a customerUserId snapshot.");
    assert(intentModel.includes("customerEmail"), "WalletTopupIntent should include a customerEmail snapshot.");
    assert(intentModel.includes("customerUserId"), "WalletTopupIntent should include a customerUserId snapshot.");
    assert(walletRoute.includes("...buildOrderCustomerSnapshot(req.user)"), "Wallet route should snapshot authenticated customer on creation.");
    assert(walletRoute.includes("customerEmail: intent.customerEmail || \"\""), "Manual top-up should copy customerEmail from intent.");
    assert(walletRoute.includes("notifyWalletTopupApproved(topup)"), "Admin approval should trigger wallet approved email.");
    assert(walletRoute.includes("notifyWalletTopupRejected(topup)"), "Admin rejection should trigger wallet rejected email.");
    assert(paymentRoute.includes("notifyWalletTopupApproved(topup)"), "Provider wallet payment completion should trigger wallet approved email.");
}

async function main() {
    assert.strictEqual(
        walletEmailService.WALLET_EMAIL_EVENTS.APPROVED,
        "WALLET_TOPUP_APPROVED",
        "Approved event constant should be stable."
    );
    assert.strictEqual(
        walletEmailService.WALLET_EMAIL_EVENTS.REJECTED,
        "WALLET_TOPUP_REJECTED",
        "Rejected event constant should be stable."
    );

    await verifyLifecycleEvent({
        label: "approved",
        eventType: "WALLET_TOPUP_APPROVED",
        notify: walletEmailService.notifyWalletTopupApproved,
        topup: baseTopup({ topupId: "WALLET-QA-APPROVED", status: "approved" })
    });

    await verifyLifecycleEvent({
        label: "rejected",
        eventType: "WALLET_TOPUP_REJECTED",
        notify: walletEmailService.notifyWalletTopupRejected,
        topup: baseTopup({ topupId: "WALLET-QA-REJECTED", status: "rejected" })
    });

    await verifyRecipientFallbacks();
    verifyStaticIntegration();

    console.log("Wallet top-up email notification verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
}).finally(() => {
    Module._load = originalLoad;
});
