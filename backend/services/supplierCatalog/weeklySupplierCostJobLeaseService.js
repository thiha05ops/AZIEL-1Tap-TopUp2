"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const Model = require("../../models/WeeklySupplierCostJobLease");

class WeeklySupplierCostJobLeaseError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

function createWeeklySupplierCostJobLeaseService({ Lease = Model, clock = () => new Date(), ownerId = () => `${process.pid}:${crypto.randomUUID()}`, startSession = () => mongoose.startSession() } = {}) {
    async function acquire({ runKey, ttlMs, requestedOwnerId }) {
        const now = clock(), owner = requestedOwnerId || ownerId(), replacement = { ownerId: owner, runKey, acquiredAt: now, heartbeatAt: now, expiresAt: new Date(now.getTime() + ttlMs) };
        let lease = await Lease.findOneAndUpdate({ _id: "WEEKLY_SUPPLIER_COST_SYNC", expiresAt: { $lte: now } }, { $set: replacement, $inc: { version: 1 } }, { returnDocument: "after", runValidators: true });
        if (!lease) {
            try { lease = await Lease.create({ _id: "WEEKLY_SUPPLIER_COST_SYNC", jobKey: "WEEKLY_SUPPLIER_COST_SYNC", ...replacement, version: 1 }); }
            catch (error) { if (error?.code !== 11000) throw error; }
        }
        if (!lease || String(lease.ownerId) !== owner) throw new WeeklySupplierCostJobLeaseError("WEEKLY_SUPPLIER_COST_SYNC_ALREADY_RUNNING", "A weekly supplier-cost job is already running.");
        return lease;
    }
    async function renew(lease, ttlMs) {
        const now = clock();
        const renewed = await Lease.findOneAndUpdate({ _id: lease._id, ownerId: lease.ownerId, version: lease.version, expiresAt: { $gt: now } }, { $set: { heartbeatAt: now, expiresAt: new Date(now.getTime() + ttlMs) } }, { returnDocument: "after", runValidators: true });
        if (!renewed) throw new WeeklySupplierCostJobLeaseError("WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST", "The weekly supplier-cost job lease was lost.");
        return renewed;
    }
    async function assertOwned(lease) {
        const current = await Lease.findOne({ _id: lease._id, ownerId: lease.ownerId, version: lease.version, expiresAt: { $gt: clock() } });
        if (!current) throw new WeeklySupplierCostJobLeaseError("WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST", "The weekly supplier-cost job lease was lost.");
        return current;
    }
    async function withOwnedLeaseTransaction(lease, ttlMs, operation) {
        const session = await startSession();
        let output;
        try {
            await session.withTransaction(async () => {
                const now = clock();
                const renewed = await Lease.findOneAndUpdate(
                    { _id: lease._id, ownerId: lease.ownerId, version: lease.version, expiresAt: { $gt: now } },
                    { $set: { heartbeatAt: now, expiresAt: new Date(now.getTime() + ttlMs) } },
                    { returnDocument: "after", runValidators: true, session }
                );
                if (!renewed) throw new WeeklySupplierCostJobLeaseError("WEEKLY_SUPPLIER_COST_SYNC_LEASE_LOST", "The weekly supplier-cost job lease was lost.");
                output = { lease: renewed, result: await operation({ session, lease: renewed }) };
            });
            return output;
        } finally {
            await session.endSession();
        }
    }
    async function release(lease) { return Lease.deleteOne({ _id: lease._id, ownerId: lease.ownerId, version: lease.version }); }
    return Object.freeze({ acquire, renew, assertOwned, withOwnedLeaseTransaction, release });
}

module.exports = Object.freeze({ WeeklySupplierCostJobLeaseError, createWeeklySupplierCostJobLeaseService });
