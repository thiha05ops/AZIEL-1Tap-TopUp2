"use strict";
const Run = require("../../models/SupplierCatalogIngestionRun"), Lock = require("../../models/SupplierCatalogIngestionLock"), Supplier = require("../../models/Supplier"), Offer = require("../../models/SupplierCatalogOffer"), Availability = require("../../models/SupplierOfferAvailability"), Mapping = require("../../models/SupplierProductMapping");
const { readSupplierCatalogIngestionPolicy } = require("../../config/supplierCatalogIngestionPolicy");
const { scheduler } = require("./supplierCatalogIngestionScheduler");
function createSupplierCatalogIngestionHealthService({ models = { Run, Lock, Supplier, Offer, Availability, Mapping }, policyReader = () => readSupplierCatalogIngestionPolicy(), schedulerSnapshot = () => scheduler.snapshot(), clock = () => new Date() } = {}) {
    async function getHealth() {
        const policy = policyReader(), suppliers = await models.Supplier.find({ supplierCode: { $in: Object.keys(policy.suppliers) } }).select("_id supplierCode").lean(), now = clock();
        const rows = [];
        for (const supplier of suppliers) {
            const [lastRun, activeLock, offers, mappings] = await Promise.all([models.Run.findOne({ supplierId: supplier._id }).sort({ startedAt: -1 }).lean(), models.Lock.findOne({ supplierId: supplier._id, expiresAt: { $gt: now } }).lean(), models.Offer.find({ supplierId: supplier._id }).select("_id lastObservedAt").lean(), models.Mapping.countDocuments({ supplierId: supplier._id })]);
            const ids = offers.map(x => x._id), availability = ids.length ? await models.Availability.find({ supplierCatalogOfferId: { $in: ids } }).select("state staleAt").lean() : [];
            rows.push({ supplierCode: supplier.supplierCode, policy: policy.suppliers[supplier.supplierCode], lastRun, activeLock: activeLock ? { acquiredAt: activeLock.acquiredAt, heartbeatAt: activeLock.heartbeatAt, expiresAt: activeLock.expiresAt, runKey: activeLock.runKey } : null, offers: offers.length, mappings, availability: availability.reduce((a, x) => (a[x.state] = (a[x.state] || 0) + 1, a), {}), staleOffers: availability.filter(x => x.staleAt && new Date(x.staleAt) <= now).length });
        }
        return { gates: { executionEnabled: policy.executionEnabled, automatedEnabled: policy.automatedEnabled }, scheduler: schedulerSnapshot(), suppliers: rows };
    }
    return Object.freeze({ getHealth });
}
module.exports = Object.freeze({ createSupplierCatalogIngestionHealthService, getSupplierCatalogIngestionHealth: createSupplierCatalogIngestionHealthService().getHealth });
