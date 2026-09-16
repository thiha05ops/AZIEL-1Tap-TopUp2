"use strict";

const WalletTopup = require("../../models/WalletTopup");
const { assertThWalletTopup } = require("../walletTopupPolicy");

function text(value) { return String(value || "").trim(); }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function cloneTopup(value = {}) {
    const plain = typeof value.toObject === "function" ? value.toObject() : value;
    return clone({ ...plain, customerUserId: text(plain.customerUserId) });
}

function createWalletTopupPayableSubjectAdapter(dependencies = {}) {
    const model = dependencies.model || WalletTopup;
    const error = dependencies.error || ((code, message, options = {}) => Object.assign(new Error(message), { code, ...options }));
    const clock = dependencies.clock || (() => new Date());

    async function execute(query, session = null) {
        let request = query;
        if (session?.mongoSession && typeof request.session === "function") request = request.session(session.mongoSession);
        if (typeof request.lean === "function") request = request.lean();
        return request.exec ? request.exec() : request;
    }

    async function loadOwnedSubject({ subjectId, owner, session = null }) {
        const ownerId = text(owner?.userId);
        if (!ownerId) throw error("PAYMENT_FORBIDDEN", "Authenticated wallet owner is required.", { stage: "subject" });
        const topup = await execute(model.findOne({ topupId: subjectId, customerUserId: ownerId }), session);
        if (!topup) throw error("PAYMENT_SUBJECT_NOT_FOUND", "Wallet top-up was not found for this owner.", { stage: "subject", metadata: { subjectId } });
        return cloneTopup(topup);
    }

    async function loadOperationalSubject({ subjectId, session = null }) {
        const topup = await execute(model.findOne({ topupId: subjectId }), session);
        if (!topup) throw error("PAYMENT_SUBJECT_NOT_FOUND", "Wallet top-up was not found.", { stage: "subject", metadata: { subjectId } });
        return cloneTopup(topup);
    }

    function getSubjectId(subject = {}) { return text(subject.topupId); }
    function getAuthoritativeAmount(subject = {}) { return Number(subject.amount); }
    function getCurrency(subject = {}) { return text(subject.currency).toUpperCase(); }
    function getRegion(subject = {}) { return text(subject.region).toUpperCase(); }
    function getPaymentSnapshot(subject = {}) { return clone(subject.paymentSnapshot || {}); }

    function assertPayable(subject = {}) {
        assertThWalletTopup({ amount: subject.amount, currency: subject.currency, region: subject.region });
        if (!subject.customerUserId) throw error("PAYMENT_FORBIDDEN", "Wallet top-up has no authenticated owner authority.", { stage: "subject" });
        if (["paid", "completed", "approved", "rejected", "cancelled"].includes(text(subject.status).toLowerCase()) ||
            ["paid", "cancelled"].includes(text(subject.paymentStatus).toLowerCase()) || text(subject.settlementStatus).toLowerCase() === "credited") {
            throw error("PAYMENT_NOT_PAYABLE", "Wallet top-up is not payable.", { stage: "subject", metadata: { subjectId: subject.topupId } });
        }
    }

    async function applyPaymentTransition({ subject, transition, attempt, reason, session = null }) {
        const paymentStatus = text(transition.to).toLowerCase();
        const set = { paymentStatus, updatedAt: clock() };
        if (attempt?.attemptId) set.paymentAttemptId = attempt.attemptId;
        if (paymentStatus === "paid") {
            set.status = "paid"; set.paidAt = clock(); set.settlementStatus = "pending";
        } else if (["failed", "expired", "cancelled"].includes(paymentStatus)) {
            set.status = paymentStatus === "expired" ? "failed" : paymentStatus;
            set.note = reason || `Payment ${paymentStatus}`;
        }
        const query = model.findOneAndUpdate(
            { topupId: subject.topupId, customerUserId: subject.customerUserId, $or: [{ paymentAttemptId: "" }, { paymentAttemptId: attempt?.attemptId }] },
            { $set: set },
            { returnDocument: "after", runValidators: true, session: session?.mongoSession || undefined }
        );
        const updated = query.exec ? await query.exec() : await query;
        if (!updated) throw error("PAYMENT_ATTEMPT_CONFLICT", "Wallet top-up is bound to another payment attempt.", { stage: "subject" });
        return cloneTopup(updated);
    }

    return Object.freeze({ loadOwnedSubject, loadOperationalSubject, getSubjectId, getAuthoritativeAmount, getCurrency, getRegion, getPaymentSnapshot, assertPayable, applyPaymentTransition });
}

module.exports = Object.freeze({ createWalletTopupPayableSubjectAdapter });
