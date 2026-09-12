"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createPaymentOrchestrator } = require("../services/commerce/paymentOrchestrator");
const { createThunderPromptPayAdapter } = require("../services/commerce/providers/thunderPromptPayAdapter");
const { createThunderSlipPaymentService, ThunderSlipPaymentError } = require("../services/commerce/thunderSlipPaymentService");
const { createThunderApiClient, ThunderApiError } = require("../services/thunderApiClient");
const { createCommerceManualPaymentController } = require("../controllers/commerceManualPaymentController");

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
function captureLogger() {
    const records = [];
    const write = (...args) => records.push(args);
    return { records, logger: { info: write, warn: write, error: write, log: write } };
}
function service(h, providerResponse, options = {}) {
    return createThunderSlipPaymentService({ paymentAttemptRepository: h.attemptPort, orderRepository: h.orderRepository, paymentOrchestrator: h.orchestrator, receiverBankAccount: "1234567890", clock: () => new Date(NOW), logger: options.logger || captureLogger().logger, decodeSlipQr: async () => { if (options.decodeError) throw Object.assign(new Error("A valid bank slip QR code could not be found."), { code: "SLIP_QR_NOT_FOUND" }); return "payload"; }, thunderClient: { verifyBank: async () => { if (options.timeout) throw Object.assign(new Error("Payment verification timed out. Please retry."), { code: "THUNDER_TIMEOUT", retryable: true }); return clone(providerResponse); } } });
}
async function rejectsWithoutPaid(h, promise, code) { await assert.rejects(promise, error => error instanceof ThunderSlipPaymentError && error.code === code); assert.notStrictEqual(h.attempts.get("A1").status, "PAID"); assert.notStrictEqual(h.orders.get("O1").paymentStatus, "paid"); }

async function main() {
    async function apiFailure(providerCode, expectedCode, status = 400, expectedProviderCode = providerCode) {
        const client = createThunderApiClient({ apiKey: "SECRET-API-KEY-SENTINEL", logger: captureLogger().logger, fetch: async () => ({ ok: false, status, json: async () => ({ error: { code: providerCode, message: "provider detail" } }) }) });
        await assert.rejects(client.verifyBank({ payload: "QR-PAYLOAD-SENTINEL" }), error => error instanceof ThunderApiError && error.code === expectedCode && error.providerCode === expectedProviderCode);
    }
    await apiFailure("INVALID_API_KEY", "THUNDER_AUTHENTICATION_FAILED", 401);
    await apiFailure("IP_NOT_ALLOWED", "THUNDER_IP_RESTRICTED", 403);
    await apiFailure("QUOTA_EXCEEDED", "THUNDER_QUOTA_EXCEEDED", 429);
    await apiFailure("DUPLICATE_SLIP", "THUNDER_DUPLICATE", 409);
    await apiFailure("INVALID_PAYLOAD", "THUNDER_SLIP_REJECTED", 422);
    const unknownDiagnostics = captureLogger();
    let client = createThunderApiClient({ apiKey: "key", logger: unknownDiagnostics.logger, fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: "ACCOUNT_1234567890_private_detail" } }) }) });
    await assert.rejects(client.verifyBank({ payload: "payload" }), error => error.code === "THUNDER_REJECTED" && error.providerCode === "UNKNOWN_PROVIDER_CODE");
    assert(!JSON.stringify(unknownDiagnostics.records).includes("1234567890_private_detail"));
    await apiFailure("SOMETHING_NEW", "THUNDER_REJECTED", 400, "UNKNOWN_PROVIDER_CODE");
    await apiFailure("SOMETHING_NEW", "THUNDER_AUTHENTICATION_FAILED", 401, "UNKNOWN_PROVIDER_CODE");
    await apiFailure("SOMETHING_NEW", "THUNDER_ACCESS_RESTRICTED", 403, "UNKNOWN_PROVIDER_CODE");
    await apiFailure("SOMETHING_NEW", "THUNDER_QUOTA_EXCEEDED", 429, "UNKNOWN_PROVIDER_CODE");
    client = createThunderApiClient({ apiKey: "key", logger: captureLogger().logger, fetch: async () => ({ ok: false, status: 202, json: async () => ({ error: { code: "SLIP_PENDING" } }) }) });
    assert.strictEqual((await client.verifyBank({ payload: "payload" })).status, "SLIP_PENDING");
    for (const status of [200, 422, 500]) {
        client = createThunderApiClient({ apiKey: "key", logger: captureLogger().logger, fetch: async () => ({ ok: status === 200, status, json: async () => { throw new SyntaxError("bad json"); } }) });
        await assert.rejects(client.verifyBank({ payload: "payload" }), error => error.code === "THUNDER_INVALID_RESPONSE" && error.retryable === true);
    }
    client = createThunderApiClient({ apiKey: "key", logger: captureLogger().logger, fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }) });
    await assert.rejects(client.verifyBank({ payload: "payload" }), error => error.code === "THUNDER_INVALID_RESPONSE" && error.retryable === true);
    client = createThunderApiClient({ apiKey: "key", logger: captureLogger().logger, fetch: async () => { throw new Error("offline"); } });
    await assert.rejects(client.verifyBank({ payload: "payload" }), error => error.code === "THUNDER_UNAVAILABLE");
    client = createThunderApiClient({ apiKey: "key", logger: captureLogger().logger, fetch: async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; } });
    await assert.rejects(client.verifyBank({ payload: "payload" }), error => error.code === "THUNDER_TIMEOUT");

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
    const throwingLogger = { info() { throw new Error("logger failed"); }, warn() { throw new Error("logger failed"); }, get log() { throw new Error("malformed logger"); } };
    h = harness(); out = await service(h, response(), { logger: throwingLogger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }); assert.strictEqual(out.paymentStatus, "paid");
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ matchedAccount: null }), { logger: throwingLogger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "THUNDER_RECEIVER_MISMATCH");
    client = createThunderApiClient({ apiKey: "key", logger: throwingLogger, fetch: async () => ({ ok: true, status: 200, json: async () => response() }) });
    assert.strictEqual((await client.verifyBank({ payload: "payload" })).success, true);
    const diagnostics = captureLogger();
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ matchedAccount: null }), { logger: diagnostics.logger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("QR-PAYLOAD-SENTINEL"), correlationId: "corr" }), "THUNDER_RECEIVER_MISMATCH");
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ amountInSlip: 124 }), { logger: diagnostics.logger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x"), correlationId: "corr" }), "THUNDER_AMOUNT_MISMATCH");
    h = harness(); await rejectsWithoutPaid(h, service(h, response({ rawSlip: { ...response().data.rawSlip, date: "2025-01-01T00:00:00.000Z" } }), { logger: diagnostics.logger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x"), correlationId: "corr" }), "THUNDER_SLIP_STALE");
    h = harness(); h.setForceRollback(true); await rejectsWithoutPaid(h, service(h, response(), { logger: diagnostics.logger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x"), correlationId: "corr" }), "THUNDER_PAYMENT_COMMIT_FAILED");
    h = harness(); await service(h, response(), { logger: diagnostics.logger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x"), correlationId: "corr" });
    h = harness(); await rejectsWithoutPaid(h, service(h, response(), { decodeError: true, logger: diagnostics.logger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x"), correlationId: "corr" }), "SLIP_QR_NOT_FOUND");
    const serializedDiagnostics = JSON.stringify(diagnostics.records);
    for (const event of ["THUNDER_QR_DECODE_STARTED", "THUNDER_QR_DECODE_COMPLETED", "THUNDER_VALIDATION", "THUNDER_PAYMENT_COMMIT_STARTED", "THUNDER_PAYMENT_COMMIT_FAILED", "THUNDER_PAYMENT_COMMIT_COMPLETED", "THUNDER_TRANSACTION_REF_BINDING"]) assert(serializedDiagnostics.includes(event), `missing diagnostic ${event}`);
    for (const secret of ["SECRET-API-KEY-SENTINEL", "QR-PAYLOAD-SENTINEL", "1234567890", "TX-1"]) assert(!serializedDiagnostics.includes(secret), `diagnostics leaked ${secret}`);
    const clientDiagnostics = captureLogger();
    client = createThunderApiClient({ apiKey: "SECRET-API-KEY-SENTINEL", logger: clientDiagnostics.logger, fetch: async () => ({ ok: false, status: 409, json: async () => ({ error: { code: "DUPLICATE_SLIP" }, receiver: "1234567890", transRef: "TX-1" }) }) });
    await assert.rejects(client.verifyBank({ payload: "QR-PAYLOAD-SENTINEL", correlationId: "corr" }));
    const serializedClientDiagnostics = JSON.stringify(clientDiagnostics.records);
    assert(serializedClientDiagnostics.includes("THUNDER_DUPLICATE"));
    for (const secret of ["SECRET-API-KEY-SENTINEL", "QR-PAYLOAD-SENTINEL", "1234567890", "TX-1"]) assert(!serializedClientDiagnostics.includes(secret), `client diagnostics leaked ${secret}`);
    const recoveredDiagnostics = captureLogger();
    h = harness();
    const recoveringOrchestrator = {
        handleProviderEvent: async ({ verifiedTransactionRef }) => { const attempt = h.attempts.get("A1"); attempt.status = "PAID"; attempt.verifiedTransactionRef = verifiedTransactionRef; h.orders.get("O1").paymentStatus = "paid"; throw new Error("concurrent completion"); },
        getPaymentResult: async () => ({ paymentStatus: "paid", orderStatus: "paid" })
    };
    out = await createThunderSlipPaymentService({ paymentAttemptRepository: h.attemptPort, orderRepository: h.orderRepository, paymentOrchestrator: recoveringOrchestrator, receiverBankAccount: "1234567890", clock: () => new Date(NOW), logger: recoveredDiagnostics.logger, decodeSlipQr: async () => "payload", thunderClient: { verifyBank: async () => response() } }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") });
    assert.strictEqual(out.paymentStatus, "paid");
    const recoveryCompletions = recoveredDiagnostics.records.filter(([, record]) => record.event === "THUNDER_PAYMENT_COMMIT_COMPLETED");
    assert.strictEqual(recoveryCompletions.length, 1); assert.strictEqual(recoveryCompletions[0][1].reusedExisting, true);
    const normalCommitDiagnostics = captureLogger();
    h = harness(); await service(h, response(), { logger: normalCommitDiagnostics.logger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") });
    const normalCompletions = normalCommitDiagnostics.records.filter(([, record]) => record.event === "THUNDER_PAYMENT_COMMIT_COMPLETED");
    assert.strictEqual(normalCompletions.length, 1); assert.strictEqual(normalCompletions[0][1].reusedExisting, false);
    const commitFailureDiagnostics = captureLogger();
    h = harness(); h.setForceRollback(true); await rejectsWithoutPaid(h, service(h, response(), { logger: commitFailureDiagnostics.logger }).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") }), "THUNDER_PAYMENT_COMMIT_FAILED");
    assert(!commitFailureDiagnostics.records.some(([, record]) => record.event === "THUNDER_TRANSACTION_REF_BINDING" && record.passed === false), "non-uniqueness commit failure must not claim binding failure");
    const uniquenessDiagnostics = captureLogger();
    h = harness(2); await service(h, response()).verify({ orderId: "O1", attemptId: "A1", owner: OWNER, fileBuffer: Buffer.from("x") });
    await assert.rejects(service(h, response(), { logger: uniquenessDiagnostics.logger }).verify({ orderId: "O2", attemptId: "A2", owner: OWNER, fileBuffer: Buffer.from("x") }), error => error.code === "THUNDER_TRANSACTION_REUSED");
    assert(uniquenessDiagnostics.records.some(([, record]) => record.event === "THUNDER_TRANSACTION_REF_BINDING" && record.passed === false && record.azielErrorCode === "THUNDER_TRANSACTION_REUSED"));
    assert(!uniquenessDiagnostics.records.some(([, record]) => record.event === "THUNDER_PAYMENT_COMMIT_COMPLETED"));
    const controllerDiagnostics = captureLogger();
    const receiptController = createCommerceManualPaymentController({ logger: controllerDiagnostics.logger, uploadFile: async ({ file }) => ({ url: "storage-secret-reference", key: "storage-secret-key", provider: "test", mimeType: file.mimetype, size: file.buffer.length }), service: { attachReceiptEvidence: async () => ({ paymentStatus: "pending" }) } });
    const req = { headers: { "x-request-id": "email@example.com TOKEN_123 account_987654321" }, id: "", params: { orderId: "O-sensitive", attemptId: "A-sensitive" }, body: {}, user: { id: "U1" }, sessionID: "" };
    req.file = { mimetype: "image/jpeg", size: 24, buffer: Buffer.from("SLIP_IMAGE_BUFFER_SECRET") };
    const res = { statusCode: 0, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return value; } };
    await receiptController.attachReceipt(req, res);
    const controllerLog = JSON.stringify(controllerDiagnostics.records);
    for (const event of ["PAYMENT_RECEIPT_ACCEPTED", "PAYMENT_RECEIPT_STORAGE_COMPLETED", "PAYMENT_RECEIPT_RESPONSE"]) assert(controllerLog.includes(event), `controller diagnostics missing ${event}`);
    for (const secret of ["email@example.com", "TOKEN_123", "987654321", "O-sensitive", "A-sensitive", "SLIP_IMAGE_BUFFER_SECRET", "storage-secret-reference", "storage-secret-key"]) assert(!controllerLog.includes(secret), `controller diagnostics leaked ${secret}`);
    const malformedLoggerController = createCommerceManualPaymentController({ logger: { get info() { throw new Error("bad logger"); } }, service: { attachReceiptEvidence: async () => ({ paymentStatus: "pending" }) } });
    await malformedLoggerController.attachReceipt({ ...req, headers: {}, file: null }, res); assert.strictEqual(res.body.success, true);
    const root = path.join(__dirname, ".."); const manual = fs.readFileSync(path.join(root, "services/commerce/providers/manualPromptPayAdapter.js"), "utf8"); const wallet = fs.readFileSync(path.join(root, "services/commerce/customerWalletCheckoutService.js"), "utf8"); const thunder = fs.readFileSync(path.join(root, "services/commerce/thunderSlipPaymentService.js"), "utf8"); const controller = fs.readFileSync(path.join(root, "controllers/commerceManualPaymentController.js"), "utf8"); const frontend = fs.readFileSync(path.join(root, "../frontend/js/payment/payment-manual.js"), "utf8");
    assert(manual.includes('confirmationMode: "manual_admin"')); assert(wallet.length > 0); assert(!/WonDD|FazerCards|ensurePaidOrderFulfillmentWork|paidFulfillmentRoutingService/.test(thunder)); assert(controller.includes('duplicate_unbound')); assert(controller.includes('delete payment._receiptUploadDisposition')); assert(frontend.includes('result.code === "SLIP_PENDING"')); assert(frontend.includes("if (!pending && (!thunderVerified || authoritativePaid))"));
    console.log("Thunder verified-slip diagnostics verification passed (55 focused cases).");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
