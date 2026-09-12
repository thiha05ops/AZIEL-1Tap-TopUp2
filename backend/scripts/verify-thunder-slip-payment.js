"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createPaymentOrchestrator } = require("../services/commerce/paymentOrchestrator");
const { createThunderPromptPayAdapter } = require("../services/commerce/providers/thunderPromptPayAdapter");
const { createThunderSlipPaymentService, ThunderSlipPaymentError } = require("../services/commerce/thunderSlipPaymentService");

const NOW = new Date("2026-09-12T03:00:00.000Z");
const OWNER = { type: "USER", userId: "U1", sessionId: "" };

function clone(value) { return structuredClone(value); }
function fixture(id = "1") {
    return {
        attempt: { attemptId: `A${id}`, orderId: `O${id}`, ownerId: "U1", owner: OWNER, provider: "THUNDER_PROMPTPAY", providerType: "", paymentMethod: "thunder_promptpay", paymentMethodId: "thunder_promptpay", paymentChannel: "THUNDER_PROMPTPAY", confirmationMode: "thunder_slip", status: "PENDING", amount: 125, currency: "THB", providerReference: `P${id}`, verifiedTransactionRef: "", eventHistory: [], createdAt: new Date(NOW.getTime() - 60000), expiresAt: new Date(NOW.getTime() + 600000) },
        order: { orderId: `O${id}`, owner: OWNER, status: "pending_payment", paymentStatus: "pending", payment: { provider: "THUNDER_PROMPTPAY", paymentMethodId: "thunder_promptpay", confirmationMode: "thunder_slip" }, commercial: { totalAmount: 125, currency: "THB", region: "TH" }, createdAt: new Date(NOW.getTime() - 60000) }
    };
}

function harness(count = 1) {
    const attempts = new Map(); const orders = new Map();
    for (let i = 1; i <= count; i += 1) { const item = fixture(String(i)); attempts.set(item.attempt.attemptId, item.attempt); orders.set(item.order.orderId, item.order); }
    let forceRollback = false;
    const attemptPort = {
        findAttemptByIdForOwner: async ({ attemptId }) => clone(attempts.get(attemptId)),
        findAttemptByProviderReference: async ({ providerReference }) => clone([...attempts.values()].find(a => a.providerReference === providerReference)),
        bindVerifiedTransactionRef: async ({ attemptId, verifiedTransactionRef }) => {
            const conflict = [...attempts.values()].find(a => a.attemptId !== attemptId && a.verifiedTransactionRef === verifiedTransactionRef);
            if (conflict) { const error = new Error("duplicate"); error.code = "PAYMENT_VERIFIED_TRANSACTION_EXISTS"; throw error; }
            const attempt = attempts.get(attemptId); attempt.verifiedTransactionRef = verifiedTransactionRef; return clone(attempt);
        },
        appendProviderEvent: async ({ attemptId, providerEvent }) => { const attempt = attempts.get(attemptId); if (attempt.eventHistory.some(e => e.providerEventId === providerEvent.providerEventId)) { const e = new Error("duplicate event"); e.code = "PAYMENT_DUPLICATE_EVENT"; throw e; } attempt.eventHistory.push(clone(providerEvent)); return clone(attempt); },
        updateAttemptStatus: async ({ attemptId, fromStatuses, toStatus }) => { const attempt = attempts.get(attemptId); if (!fromStatuses.includes(attempt.status)) throw new Error("status conflict"); attempt.status = toStatus; return clone(attempt); }
    };
    const orderRepository = {
        findOwnedOrderById: async ({ orderId }) => clone(orders.get(orderId)),
        findOrderById: async orderId => clone(orders.get(orderId)),
        updatePaymentStatus: async ({ orderId, toStatus }) => { if (forceRollback) throw new Error("forced transaction failure"); const order = orders.get(orderId); order.paymentStatus = toStatus; if (toStatus === "paid" && order.status === "pending_payment") order.status = "paid"; return clone(order); }
    };
    const adapter = createThunderPromptPayAdapter({ configuration: { enabled: true, recipientType: "PHONE", recipientValue: "0812345678" }, qrService: async () => ({ qrImage: "image" }) });
    const orchestrator = createPaymentOrchestrator({
        orderRepository, paymentAttemptPort: attemptPort, providerResolver: async () => adapter, clock: () => new Date(NOW),
        transactionRunner: async callback => { const beforeAttempts = clone([...attempts]); const beforeOrders = clone([...orders]); try { return await callback({ mongoSession: { id: "test" } }); } catch (error) { attempts.clear(); beforeAttempts.forEach(([k, v]) => attempts.set(k, v)); orders.clear(); beforeOrders.forEach(([k, v]) => orders.set(k, v)); throw error; } }
    });
    return { attempts, orders, attemptPort, orderRepository, orchestrator, setForceRollback: value => { forceRollback = value; } };
}

function response(overrides = {}) {
    return { success: true, data: { matchedAccount: { bankNumber: "1234567890" }, isAmountMatched: true, amountInSlip: 125, isDuplicate: false, rawSlip: { transRef: "TX-1", date: NOW.toISOString(), amount: { amount: 125 }, receiver: { account: { bank: { account: "xxx-x-x5678-x" } } } }, ...overrides } };
}
function service(h, providerResponse, options = {}) {
    return createThunderSlipPaymentService({ paymentAttemptRepository: h.attemptPort, orderRepository: h.orderRepository, paymentOrchestrator: h.orchestrator, receiverBankAccount: "1234567890", clock: () => new Date(NOW), decodeSlipQr: async () => { if (options.decodeError) throw Object.assign(new Error("A valid bank slip QR code could not be found."), { code: "SLIP_QR_NOT_FOUND" }); return "payload"; }, thunderClient: { verifyBank: async () => { if (options.timeout) throw Object.assign(new Error("Payment verification timed out. Please retry."), { code: "THUNDER_TIMEOUT", retryable: true }); return clone(providerResponse); } } });
}
async function rejectsWithoutPaid(h, promise, code) { await assert.rejects(promise, error => error instanceof ThunderSlipPaymentError && error.code === code); assert.notStrictEqual(h.attempts.get("A1").status, "PAID"); assert.notStrictEqual(h.orders.get("O1").paymentStatus, "paid"); }

async function main() {
    let h = harness(); let out = await service(h, response()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }); assert.strictEqual(out.paymentStatus, "paid");
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ matchedAccount: null })).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "THUNDER_RECEIVER_MISMATCH");
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ matchedAccount: { bankNumber: "9999999999" } })).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "THUNDER_RECEIVER_MISMATCH");
    h = harness(); out = await service(h, response()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }); assert.strictEqual(out.paymentStatus, "paid", "masked raw receiver must not false-reject an exact matchedAccount");
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ amountInSlip: 124 })).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "THUNDER_AMOUNT_MISMATCH");
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ rawSlip: { ...response().data.rawSlip, date: "2025-01-01T00:00:00.000Z" } })).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "THUNDER_SLIP_STALE");
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ rawSlip: { ...response().data.rawSlip, transRef: "" } })).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "THUNDER_RESPONSE_INVALID");
    h = harness(2); await service(h, response()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }); await assert.rejects(service(h, response()).verify({ orderId: "O2", attemptId: "A2", owner: OWNER, fileBuffer: Buffer.from("x") })); assert.strictEqual(h.attempts.get("A2").status, "PENDING");
    h = harness(2); const concurrent = await Promise.allSettled([service(h, response()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), service(h, response()).verify({ orderId: "O2", attemptId: "A2", owner: OWNER, fileBuffer: Buffer.from("x") })]); assert.strictEqual(concurrent.filter(x => x.status === "fulfilled").length, 1);
    h = harness(); h.setForceRollback(true); await assert.rejects(service(h, response()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") })); assert.strictEqual(h.attempts.get("A1").verifiedTransactionRef, ""); assert.strictEqual(h.attempts.get("A1").status, "PENDING");
    h = harness(); await service(h, response()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }); out = await service(h, response()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }); assert.strictEqual(out.idempotent, true);
    h = harness(); out = await service(h, { status: "SLIP_PENDING" }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }); assert.strictEqual(out.verificationStatus, "pending"); assert.strictEqual(h.attempts.get("A1").status, "PENDING");
    const existingEvidence = { receiptId: "R1", fileReference: "authoritative.jpg", checksum: "same", fileSize: 10, uploadedAt: NOW };
    const existingAttempt = { ...fixture().attempt, safeMetadata: { receiptEvidence: existingEvidence } };
    const query = value => ({ lean() { return this; }, session() { return this; }, exec: async () => clone(value) });
    const repository = require("../services/commerce/paymentAttemptRepository");
    const duplicateBinding = await repository.attachReceiptEvidence({ attemptId: "A1", orderId: "O1", evidence: { ...existingEvidence, receiptId: "R2", fileReference: "duplicate.jpg" }, returnBindingOutcome: true }, { model: { findOne: () => query(existingAttempt), findOneAndUpdate: () => { throw new Error("duplicate evidence must not overwrite authoritative evidence"); } } });
    assert.strictEqual(duplicateBinding.reusedExisting, true); assert.strictEqual(duplicateBinding.evidenceBound, false); assert.strictEqual(duplicateBinding.attempt.safeMetadata.receiptEvidence.fileReference, "authoritative.jpg");
    h = harness(); await rejectsWithoutPaid(h, service(h, response(), { timeout: true }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "THUNDER_TIMEOUT");
    h = harness(); await rejectsWithoutPaid(h, service(h, response(), { decodeError: true }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "SLIP_QR_NOT_FOUND");
    const root = path.join(__dirname, ".."); const manual = fs.readFileSync(path.join(root, "services/commerce/providers/manualPromptPayAdapter.js"), "utf8"); const wallet = fs.readFileSync(path.join(root, "services/commerce/customerWalletCheckoutService.js"), "utf8"); const thunder = fs.readFileSync(path.join(root, "services/commerce/thunderSlipPaymentService.js"), "utf8"); const controller = fs.readFileSync(path.join(root, "controllers/commerceManualPaymentController.js"), "utf8"); const frontend = fs.readFileSync(path.join(root, "../frontend/js/payment/payment-manual.js"), "utf8");
    assert(manual.includes('confirmationMode: "manual_admin"')); assert(wallet.length > 0); assert(!/WonDD|FazerCards|ensurePaidOrderFulfillmentWork|paidFulfillmentRoutingService/.test(thunder)); assert(controller.includes('duplicate_unbound')); assert(controller.includes('delete payment._receiptUploadDisposition')); assert(frontend.includes('result.code === "SLIP_PENDING"')); assert(frontend.includes("if (!pending && (!thunderVerified || authoritativePaid))"));
    console.log("Thunder verified-slip correction verification passed (17 focused cases).");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
