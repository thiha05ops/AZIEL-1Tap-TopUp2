"use strict";

const assert = require("assert");
const { createManualPaymentApplicationService, ManualPaymentApplicationError } = require("../services/commerce/manualPaymentApplicationService");
const { PAYMENT_STATES } = require("../services/commerce/paymentOrchestrator");
const { createCommerceManualPaymentController } = require("../controllers/commerceManualPaymentController");
const { createCommerceManualPaymentRoutes } = require("../routes/commerceManualPaymentRoutes");

const NOW = new Date("2026-07-26T12:00:00.000Z");

function clone(value) {
    return structuredClone(value);
}

function owner(id = "user-1") {
    return { type: "USER", userId: id, sessionId: "" };
}

function admin(overrides = {}) {
    return { adminId: "admin-1", username: "owner", role: "OWNER", permissions: ["ORDERS_MANAGE"], ...overrides };
}

function order(overrides = {}) {
    return {
        orderId: "AZL-ORDER-0001",
        quoteId: "AZQ-0001",
        status: "pending_payment",
        paymentStatus: "unpaid",
        owner: owner(),
        commercial: { totalAmount: 1490, currency: "THB", region: "TH" },
        payment: {
            paymentMethodId: "promptpay",
            paymentChannel: "manual",
            provider: "MANUAL_PROMPTPAY",
            providerType: "manual_promptpay",
            confirmationMode: "manual_admin",
            status: "unpaid"
        },
        fulfilment: { status: "not_started" },
        ...overrides
    };
}

function matchesOwner(recordOwner = {}, expected = {}) {
    return expected.userId ? recordOwner.userId === expected.userId : recordOwner.sessionId === expected.sessionId;
}

function createQrService(store) {
    return async function fakeQrService({ method, amount, currency, orderReference }) {
        store.qrCalls.push({ method: clone(method), amount, currency, orderReference });
        assert.strictEqual(method.promptPayRecipientValue, "0812345678", "recipient comes from server configuration.");
        return {
            amount,
            currency,
            orderReference,
            encodedReference: orderReference,
            qrPayload: `PAYLOAD|${Number(amount).toFixed(2)}|${orderReference}`,
            encodedAmount: Number(amount).toFixed(2),
            qrImagePayloadMatches: true,
            qrImage: `data:image/png;base64,${Buffer.from(orderReference).toString("base64")}`,
            expiresAt: "2026-07-26T12:15:00.000Z"
        };
    };
}

function createStore(overrides = {}) {
    return {
        orders: [order(overrides.order || {})],
        attempts: [],
        audits: [],
        notifications: [],
        transactions: 0,
        qrCalls: [],
        failReceiptBinding: false,
        ...overrides
    };
}

function currentPaymentStatus(record) {
    return String(record.paymentStatus || record.payment?.status || "unpaid");
}

function createOrderRepository(store) {
    return {
        async findOwnedOrderById({ orderId, owner: requestedOwner }) {
            return clone(store.orders.find(item => item.orderId === orderId && matchesOwner(item.owner, requestedOwner)) || null);
        },
        async findOrderById(orderOrInput) {
            const orderId = typeof orderOrInput === "object" ? orderOrInput.orderId : orderOrInput;
            return clone(store.orders.find(item => item.orderId === orderId) || null);
        },
        async updatePaymentStatus({ orderId, fromStatuses, toStatus }) {
            const item = store.orders.find(candidate => candidate.orderId === orderId);
            assert(item, "order exists for payment update.");
            assert(fromStatuses.includes(currentPaymentStatus(item)), "order payment update is conditional.");
            item.paymentStatus = toStatus;
            item.payment.status = toStatus;
            item.updatedAt = NOW.toISOString();
            return clone(item);
        },
        async appendOperationalReference({ orderId, reference }) {
            const item = store.orders.find(candidate => candidate.orderId === orderId);
            item.operationalReferences = [...(item.operationalReferences || []), clone(reference)];
            return clone(item);
        }
    };
}

function normalizeOwnerForAttempt(recordOwner = {}) {
    return {
        type: recordOwner.type || (recordOwner.userId ? "USER" : "SESSION"),
        userId: recordOwner.userId || "",
        sessionId: recordOwner.sessionId || "",
        ownerId: recordOwner.userId || recordOwner.sessionId || ""
    };
}

function createPaymentAttemptRepository(store) {
    return {
        async createAttempt(payload) {
            const ownerInfo = normalizeOwnerForAttempt(payload.owner || {});
            if (payload.idempotencyKey) {
                const existing = store.attempts.find(item => (
                    item.provider === payload.provider &&
                    item.ownerId === ownerInfo.ownerId &&
                    item.idempotencyKey === payload.idempotencyKey &&
                    item.operation === payload.operation
                ));
                if (existing) {
                    if (existing.requestFingerprint !== payload.requestFingerprint) {
                        throw Object.assign(new Error("idempotency conflict"), { code: "PAYMENT_IDEMPOTENCY_CONFLICT" });
                    }
                    return clone(existing);
                }
            }
            const attempt = {
                ...clone(payload),
                ownerId: ownerInfo.ownerId,
                owner: { type: ownerInfo.type, userId: ownerInfo.userId, sessionId: ownerInfo.sessionId },
                paymentMethod: payload.paymentMethod || payload.paymentMethodId,
                paymentMethodId: payload.paymentMethodId || payload.paymentMethod,
                eventHistory: [],
                safeMetadata: {},
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString()
            };
            delete attempt.transactionContext;
            store.attempts.push(attempt);
            return clone(attempt);
        },
        async findAttemptById({ attemptId }) {
            return clone(store.attempts.find(item => item.attemptId === attemptId) || null);
        },
        async findAttemptByIdForOwner({ attemptId, owner: requestedOwner }) {
            return clone(store.attempts.find(item => item.attemptId === attemptId && matchesOwner(item.owner, requestedOwner)) || null);
        },
        async findActiveAttemptForOrder({ orderId, owner: requestedOwner }) {
            return clone(store.attempts.find(item => item.orderId === orderId && matchesOwner(item.owner, requestedOwner) && ["INITIATING", "PENDING"].includes(item.status)) || null);
        },
        async findAttemptByIdempotency({ orderId, owner: requestedOwner, idempotencyKey, operation }) {
            return clone(store.attempts.find(item => item.orderId === orderId && matchesOwner(item.owner, requestedOwner) && item.idempotencyKey === idempotencyKey && item.operation === operation) || null);
        },
        async findAttemptByProviderReference({ providerReference, providerEventId }) {
            const attempt = store.attempts.find(item => item.providerReference === providerReference);
            if (attempt && providerEventId && (attempt.eventHistory || []).some(event => event.providerEventId === providerEventId)) return clone(attempt);
            return clone(attempt || null);
        },
        async setProviderReference({ attemptId, providerReference, providerTransactionId, rawProviderStatus }) {
            const attempt = store.attempts.find(item => item.attemptId === attemptId);
            attempt.providerReference = providerReference;
            attempt.providerTransactionId = providerTransactionId;
            attempt.rawProviderStatus = rawProviderStatus;
            return clone(attempt);
        },
        async updateAttemptStatus({ attemptId, fromStatuses, toStatus }) {
            const attempt = store.attempts.find(item => item.attemptId === attemptId);
            assert(fromStatuses.includes(attempt.status), "attempt update is conditional.");
            attempt.status = toStatus;
            attempt.updatedAt = NOW.toISOString();
            return clone(attempt);
        },
        async appendProviderEvent({ attemptId, providerEvent }) {
            const attempt = store.attempts.find(item => item.attemptId === attemptId);
            if ((attempt.eventHistory || []).some(event => event.providerEventId === providerEvent.providerEventId)) {
                throw Object.assign(new Error("duplicate event"), { code: "PAYMENT_DUPLICATE_EVENT" });
            }
            attempt.eventHistory = [...(attempt.eventHistory || []), clone(providerEvent)];
            return clone(attempt);
        },
        async attachReceiptEvidence({ attemptId, evidence }) {
            if (store.failReceiptBinding) throw Object.assign(new Error("db unavailable"), { code: "WRITE_CONFLICT" });
            const attempt = store.attempts.find(item => item.attemptId === attemptId);
            if (!attempt) return null;
            if (attempt.safeMetadata?.receiptEvidence?.checksum && evidence.checksum && attempt.safeMetadata.receiptEvidence.checksum === evidence.checksum) return clone(attempt);
            if (attempt.status !== PAYMENT_STATES.PENDING) throw Object.assign(new Error("invalid state"), { code: "PAYMENT_INVALID_TRANSITION" });
            attempt.safeMetadata = { ...(attempt.safeMetadata || {}), receiptEvidence: clone(evidence), receiptAttached: true };
            attempt.eventHistory = [...(attempt.eventHistory || []), {
                providerEventId: `receipt:${attemptId}:${evidence.receiptId}`,
                provider: attempt.provider,
                providerReference: attempt.providerReference,
                eventType: "RECEIPT_EVIDENCE_ATTACHED",
                status: attempt.status,
                receivedAt: NOW.toISOString(),
                safeMetadata: { receiptId: evidence.receiptId, checksum: evidence.checksum }
            }];
            return clone(attempt);
        },
        async recordFailure() {}
    };
}

function createService(store = createStore()) {
    const paymentAttemptRepository = createPaymentAttemptRepository(store);
    const commerceOrderRepository = createOrderRepository(store);
    const service = createManualPaymentApplicationService({
        commerceOrderRepository,
        paymentAttemptRepository,
        manualPromptPayConfigurationProvider: async () => ({
            enabled: true,
            recipientType: "PHONE",
            recipientValue: "0812345678",
            recipientDisplayName: "AZIEL PromptPay",
            defaultExpiryMinutes: 15,
            environment: "test",
            referencePrefix: "AZL"
        }),
        providerOptions: { qrService: createQrService(store) },
        transactionRunner: async callback => {
            store.transactions += 1;
            return callback({ mongoSession: `session-${store.transactions}` });
        },
        auditLogger: { write: async event => store.audits.push(clone(event)) },
        notificationPort: { publish: async (event, payload) => store.notifications.push({ event, payload: clone(payload) }) },
        clock: () => new Date(NOW.getTime()),
        idGenerator(prefix) {
            return `${prefix}-${store.attempts.length + 1}`;
        },
        logger: { warn() {}, info() {}, error() {} }
    });
    return { store, service };
}

async function expectAppError(fn, code, label) {
    await Promise.resolve()
        .then(fn)
        .then(() => {
            throw new Error(`Expected ${code}: ${label}`);
        })
        .catch(error => {
            assert(error instanceof ManualPaymentApplicationError, `${label}: expected app error, got ${error.name || "Error"} ${error.code || ""}`);
            assert.strictEqual(error.code, code, label);
        });
}

function receipt(overrides = {}) {
    return {
        receiptId: "receipt-1",
        fileReference: "storage/payment/receipt-1.png",
        mimeType: "image/png",
        fileSize: 1234,
        checksum: "sha256-a",
        uploadedAt: NOW.toISOString(),
        ...overrides
    };
}

async function testInitiationAndOwnerSafety() {
    const { store, service } = createService();
    const first = await service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "idem-1", recipientValue: "client-bad" });
    assert.strictEqual(first.paymentStatus, "pending", "initiation returns pending.");
    assert.strictEqual(first.amount, 1490, "amount comes from CommerceOrder.");
    assert.strictEqual(first.currency, "THB", "currency comes from CommerceOrder.");
    assert.strictEqual(store.orders[0].fulfilment.status, "not_started", "fulfilment remains not_started.");
    assert.strictEqual(store.qrCalls.length, 1, "one QR generated.");
    assert(!JSON.stringify(first).includes("0812345678"), "raw recipient is redacted.");

    await expectAppError(
        () => service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner("user-2"), idempotencyKey: "idem-x" }),
        "NOT_FOUND",
        "another owner cannot initiate"
    );

    const second = await service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "idem-1" });
    assert.strictEqual(second.attemptId, first.attemptId, "same idempotency key returns same attempt.");
    const third = await service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "idem-2" });
    assert.strictEqual(third.attemptId, first.attemptId, "active attempt prevents duplicate QR.");
    assert.strictEqual(store.qrCalls.length, 1, "active attempt reuse avoids second QR.");
}

async function testReadAndReceiptEvidence() {
    const { store, service } = createService();
    const initiated = await service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "idem-1" });
    const view = await service.getManualPayment({ orderId: "AZL-ORDER-0001", attemptId: initiated.attemptId, owner: owner() });
    assert.strictEqual(view.attemptId, initiated.attemptId, "owner reads safe payment.");
    assert(!JSON.stringify(view).includes("eventHistory"), "customer response hides event history.");
    await expectAppError(
        () => service.getManualPayment({ orderId: "AZL-ORDER-0001", attemptId: initiated.attemptId, owner: owner("user-2") }),
        "NOT_FOUND",
        "another owner cannot read payment"
    );

    const attached = await service.attachReceiptEvidence({ orderId: "AZL-ORDER-0001", attemptId: initiated.attemptId, owner: owner(), evidence: receipt() });
    assert.strictEqual(attached.paymentStatus, "pending", "receipt upload does not mark paid.");
    assert.strictEqual(attached.receiptEvidence.attached, true, "receipt evidence attached.");
    assert.strictEqual(store.orders[0].operationalReferences[0].type, "manual_payment_receipt", "order receives safe operational reference.");
    const duplicate = await service.attachReceiptEvidence({ orderId: "AZL-ORDER-0001", attemptId: initiated.attemptId, owner: owner(), evidence: receipt() });
    assert.strictEqual(duplicate.receiptEvidence.checksum, "sha256-a", "duplicate checksum is idempotent.");

    await expectAppError(
        () => service.attachReceiptEvidence({ orderId: "OTHER", attemptId: initiated.attemptId, owner: owner(), evidence: receipt({ receiptId: "receipt-x" }) }),
        "NOT_FOUND",
        "receipt order mismatch rejects"
    );
    store.attempts[0].status = PAYMENT_STATES.PAID;
    await expectAppError(
        () => service.attachReceiptEvidence({ orderId: "AZL-ORDER-0001", attemptId: initiated.attemptId, owner: owner(), evidence: receipt({ receiptId: "receipt-paid", checksum: "sha256-paid" }) }),
        "INVALID_STATE",
        "receipt on paid attempt rejects"
    );
}

async function testApprovalRejectionRetryAndStateBoundaries() {
    const { store, service } = createService();
    const initiated = await service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "approve" });
    await service.attachReceiptEvidence({ orderId: "AZL-ORDER-0001", attemptId: initiated.attemptId, owner: owner(), evidence: receipt() });
    await expectAppError(
        () => service.approveManualPayment({ attemptId: initiated.attemptId, admin: {} }),
        "UNAUTHENTICATED",
        "customer cannot approve"
    );
    const approved = await service.approveManualPayment({ attemptId: initiated.attemptId, admin: admin(), providerEventId: "evt-approve" });
    assert.strictEqual(approved.paymentStatus, "paid", "authorised admin approves.");
    assert.strictEqual(store.orders[0].paymentStatus, "paid", "CommerceOrder payment is paid.");
    assert.strictEqual(store.orders[0].fulfilment.status, "not_started", "approval does not complete fulfilment.");
    const approvedAgain = await service.approveManualPayment({ attemptId: initiated.attemptId, admin: admin(), providerEventId: "evt-approve" });
    assert.strictEqual(approvedAgain.paymentStatus, "paid", "duplicate approval is idempotent.");
    await expectAppError(
        () => service.rejectManualPayment({ attemptId: initiated.attemptId, admin: admin(), providerEventId: "evt-race", reason: "race" }),
        "INVALID_STATE",
        "conflicting reject after approve loses conditionally"
    );

    const rejectionHarness = createService(createStore());
    const rejectedInit = await rejectionHarness.service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "reject" });
    await rejectionHarness.service.attachReceiptEvidence({ orderId: "AZL-ORDER-0001", attemptId: rejectedInit.attemptId, owner: owner(), evidence: receipt() });
    const rejected = await rejectionHarness.service.rejectManualPayment({ attemptId: rejectedInit.attemptId, admin: admin(), providerEventId: "evt-reject", reason: "Slip mismatch" });
    assert.strictEqual(rejected.paymentStatus, "failed", "admin rejection maps to failed.");
    const retry = await rejectionHarness.service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "retry" });
    assert.notStrictEqual(retry.attemptId, rejectedInit.attemptId, "retry after failed creates a new attempt.");
    assert.notStrictEqual(rejectionHarness.store.attempts[1].providerReference, rejectionHarness.store.attempts[0].providerReference, "old provider reference is not reused.");
    assert(rejectionHarness.store.attempts[0].safeMetadata.receiptEvidence, "old receipt remains on old attempt.");

    const expiryHarness = createService(createStore());
    const expiring = await expiryHarness.service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "expire" });
    await expiryHarness.service.cancelManualPayment({ attemptId: expiring.attemptId, owner: owner() });
    const cancelledAgain = await expiryHarness.service.cancelManualPayment({ attemptId: expiring.attemptId, owner: owner() });
    assert.strictEqual(cancelledAgain.paymentStatus, "cancelled", "cancellation is idempotent.");
}

async function testCompensationAndUnsupportedPayment() {
    const unsupported = createService(createStore({ order: { payment: { ...order().payment, provider: "wallet", paymentMethodId: "wallet" } } }));
    await expectAppError(
        () => unsupported.service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "unsupported" }),
        "UNSUPPORTED_PAYMENT_METHOD",
        "non Manual PromptPay order is rejected"
    );

    const failing = createService(createStore());
    const initiated = await failing.service.initiateManualPayment({ orderId: "AZL-ORDER-0001", owner: owner(), idempotencyKey: "receipt-fail" });
    failing.store.failReceiptBinding = true;
    await expectAppError(
        () => failing.service.attachReceiptEvidence({
            orderId: "AZL-ORDER-0001",
            attemptId: initiated.attemptId,
            owner: owner(),
            evidence: receipt({ receiptId: "receipt-db", checksum: "sha256-db" }),
            storageCommitted: true
        }),
        "PERSISTENCE_ERROR",
        "file storage success plus DB failure is surfaced"
    );
}

function testRouteControllerDelegation() {
    const calls = [];
    const service = {
        initiateManualPayment: async input => { calls.push(["initiate", input.orderId]); return { attemptId: "ATT-1" }; },
        getManualPayment: async input => { calls.push(["get", input.orderId]); return { attemptId: "ATT-1" }; },
        attachReceiptEvidence: async input => { calls.push(["receipt", input.attemptId]); return { attemptId: "ATT-1" }; },
        approveManualPayment: async input => { calls.push(["approve", input.attemptId]); return { attemptId: "ATT-1" }; },
        rejectManualPayment: async input => { calls.push(["reject", input.attemptId]); return { attemptId: "ATT-1" }; },
        cancelManualPayment: async input => { calls.push(["cancel", input.attemptId]); return { attemptId: "ATT-1" }; }
    };
    const controller = createCommerceManualPaymentController({ service });
    assert(controller.initiate && controller.approve, "controller exposes route handlers.");
    const router = createCommerceManualPaymentRoutes({ controller });
    const stackText = JSON.stringify(router.stack.map(layer => layer.route?.path || ""));
    assert(stackText.includes("manual-promptpay/initiate"), "routes include initiate endpoint.");
    const routeSource = require("fs").readFileSync(require("path").join(__dirname, "../routes/commerceManualPaymentRoutes.js"), "utf8");
    assert(!/update(?:Payment)?Status|PaymentAttempt\.|CommerceOrder\./.test(routeSource), "route does not directly mutate payment status.");
}

async function run() {
    await testInitiationAndOwnerSafety();
    await testReadAndReceiptEvidence();
    await testApprovalRejectionRetryAndStateBoundaries();
    await testCompensationAndUnsupportedPayment();
    testRouteControllerDelegation();
    console.log("Commerce manual payment application verification passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
