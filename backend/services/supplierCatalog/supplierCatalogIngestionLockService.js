"use strict";
const crypto = require("crypto");
const Lock = require("../../models/SupplierCatalogIngestionLock");
class SupplierCatalogLockError extends Error { constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; } }
function createSupplierCatalogIngestionLockService({ Model = Lock, clock = () => new Date(), ownerId = () => `${process.pid}:${crypto.randomUUID()}` } = {}) {
    async function acquire({ supplierId, supplierCode, runKey, ttlMs, requestedOwnerId }) {
        const now = clock(), owner = requestedOwnerId || ownerId(), lockKey = `SUPPLIER_CATALOG_INGESTION:${supplierCode}`;
        const replacement = { supplierId, supplierCode, ownerId: owner, acquiredAt: now, heartbeatAt: now, expiresAt: new Date(now.getTime() + ttlMs), runKey };
        let lock = await Model.findOneAndUpdate({ lockKey, expiresAt: { $lte: now } }, { $set: replacement, $inc: { version: 1 } }, { returnDocument: "after", runValidators: true });
        if (!lock) {
            try { lock = await Model.create({ lockKey, ...replacement, version: 1 }); }
            catch (error) { if (error?.code !== 11000) throw error; }
        }
        if (!lock || String(lock.ownerId) !== owner) throw new SupplierCatalogLockError("SUPPLIER_CATALOG_INGESTION_ALREADY_RUNNING", `${supplierCode} catalog ingestion is already running.`, { supplierCode });
        return lock;
    }
    async function renew(lock, ttlMs) {
        const now = clock();
        const renewed = await Model.findOneAndUpdate({ _id: lock._id, ownerId: lock.ownerId, expiresAt: { $gt: now } }, { $set: { heartbeatAt: now, expiresAt: new Date(now.getTime() + ttlMs) } }, { returnDocument: "after", runValidators: true });
        if (!renewed) throw new SupplierCatalogLockError("SUPPLIER_CATALOG_INGESTION_LOCK_LOST", "Supplier catalog ingestion lease was lost.");
        return renewed;
    }
    async function release(lock) { return Model.deleteOne({ _id: lock._id, ownerId: lock.ownerId }); }
    return Object.freeze({ acquire, renew, release });
}
module.exports = Object.freeze({ SupplierCatalogLockError, createSupplierCatalogIngestionLockService });
