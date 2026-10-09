"use strict";
const crypto = require("crypto");
const Supplier = require("../../models/Supplier");
const Mapping = require("../../models/SupplierProductMapping");
const Product = require("../../models/SupplierCatalogProduct");
const Offer = require("../../models/SupplierCatalogOffer");
const Run = require("../../models/SupplierCatalogIngestionRun");
const { createSupplierCatalogMongoRepositories } = require("./supplierCatalogMongoRepositories");
const { createSupplierCatalogIngestionLockService } = require("./supplierCatalogIngestionLockService");
const { readSupplierCatalogIngestionPolicy } = require("../../config/supplierCatalogIngestionPolicy");
class SupplierCatalogIngestionError extends Error { constructor(code, message, statusCode = 400, details = {}) { super(message); this.code = code; this.statusCode = statusCode; this.details = details; } }
const wait = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.(); });
const retryable = error => error?.retryable === true || /TRANSPORT|TIMEOUT|HTTP_5|ECONN|NETWORK/i.test(String(error?.code || error?.message || ""));
function defaultProvider(code) {
    if (code === "FAZERCARDS") { const service = require("./providers/fazerCardsCatalogIngestionService"), adapter = require("../suppliers/fazercardsAdapter"); return { service, reader: service.createCatalogReader(adapter) }; }
    if (code === "WONDD") { const service = require("./providers/wonddCatalogIngestionService"), adapter = require("../suppliers/wonddAdapter"); return { service, reader: service.createCatalogReader(adapter) }; }
    throw new SupplierCatalogIngestionError("UNSUPPORTED_SUPPLIER", `Unsupported supplier ${code}.`, 404);
}
function createSupplierCatalogIngestionOrchestrator(options = {}) {
    const policyReader = options.policyReader || (() => readSupplierCatalogIngestionPolicy());
    const locks = options.locks || createSupplierCatalogIngestionLockService();
    const models = options.models || { Supplier, Mapping, Product, Offer, Run };
    const providerFactory = options.providerFactory || defaultProvider;
    const repositories = options.repositories || (() => createSupplierCatalogMongoRepositories());
    const sleep = options.sleep || wait, clock = options.clock || (() => new Date());
    function leaseGuardedRepositories(base, assertLease) {
        const wrap = group => Object.fromEntries(Object.entries(group || {}).map(([name,fn]) => [name, async (...args) => { await assertLease(); return fn(...args); }]));
        return { products: wrap(base.products), offers: wrap(base.offers), availability: wrap(base.availability), observations: wrap(base.observations), runs: wrap(base.runs) };
    }
    async function run(input = {}) {
        const supplierCode = String(input.supplierCode || "").trim().toUpperCase(), trigger = input.trigger || "SYSTEM", policy = policyReader(), supplierPolicy = policy.suppliers[supplierCode];
        if (!supplierPolicy) throw new SupplierCatalogIngestionError("UNSUPPORTED_SUPPLIER", "Unsupported supplier catalog.", 404);
        if (!policy.executionEnabled) throw new SupplierCatalogIngestionError("SUPPLIER_CATALOG_INGESTION_EXECUTION_DISABLED", "Supplier catalog ingestion execution is disabled.", 409);
        if (trigger === "SCHEDULED" && (!policy.automatedEnabled || !supplierPolicy.enabled)) throw new SupplierCatalogIngestionError("SUPPLIER_CATALOG_AUTOMATION_DISABLED", "Automated supplier catalog ingestion is disabled.", 409);
        const supplier = await models.Supplier.findOne({ supplierCode }).select("_id supplierCode").lean();
        if (!supplier) throw new SupplierCatalogIngestionError("SUPPLIER_NOT_FOUND", "Supplier record not found.", 404);
        const requestedAt = clock(), runKey = `${supplierCode}:AUTO:${requestedAt.toISOString()}:${crypto.randomUUID()}`, owner = `${process.pid}:${crypto.randomUUID()}`;
        const lock = await locks.acquire({ supplierId: supplier._id, supplierCode, runKey, ttlMs: supplierPolicy.lockTtlMs, requestedOwnerId: owner });
        let heartbeat, attempts = 0, leaseFailure = null;
        try {
            heartbeat = setInterval(() => locks.renew(lock, supplierPolicy.lockTtlMs).catch(error => { leaseFailure = error; }), Math.max(1000, Math.floor(supplierPolicy.lockTtlMs / 3))); heartbeat.unref?.();
            const { service, reader } = providerFactory(supplierCode), mappings = await models.Mapping.find({ supplierCode }).select("supplierCode supplierProductCode supplierPackageCode").lean();
            const scope = { supplierId: supplier._id, catalogNamespace: service.NAMESPACE };
            const [products, offers] = await Promise.all([models.Product.find(scope).lean(), models.Offer.find(scope).lean()]);
            let stage;
            while (attempts < supplierPolicy.maxAttempts) {
                attempts++;
                const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), supplierPolicy.timeoutMs); timeout.unref?.();
                try { stage = await service.stageCatalog({ reader, supplierId: supplier._id, mappings, observedAt: clock(), signal: controller.signal }); clearTimeout(timeout); if (stage.errors?.length && !stage.products?.length && attempts < supplierPolicy.maxAttempts && retryable(stage.errors[0])) throw Object.assign(new Error("Retryable supplier catalog read failure."), { code: stage.errors[0].code, retryable: true }); break; }
                catch (error) { clearTimeout(timeout); if (attempts >= supplierPolicy.maxAttempts || !retryable(error)) throw error; const delay = Math.min(supplierPolicy.retryMaxMs, supplierPolicy.retryBaseMs * (2 ** (attempts - 1))); await sleep(delay); }
            }
            const plan = service.planMutations(stage, { products, offers });
            const assertLease = async () => { if (leaseFailure) throw leaseFailure; await locks.renew(lock, supplierPolicy.lockTtlMs); };
            const result = await service.applyCatalogOnlyPlan(plan, leaseGuardedRepositories(repositories(), assertLease), { runKey });
            await models.Run.updateOne({ _id: result._id }, { $set: { trigger, requestedAt, attemptCount: attempts, lockOwnerId: owner, requestedBy: input.actor || {}, reason: String(input.reason || "") } });
            return { runKey, supplierCode, status: result.status, coverageState: result.coverageState, attempts, runId: String(result._id) };
        } catch (error) {
            const provider = (() => { try { return providerFactory(supplierCode).service; } catch { return null; } })();
            await models.Run.findOneAndUpdate({ supplierId: supplier._id, catalogNamespace: provider?.NAMESPACE || supplierCode, runKey }, { $setOnInsert: { supplierId: supplier._id, catalogNamespace: provider?.NAMESPACE || supplierCode, runKey, startedAt: requestedAt }, $set: { status: "FAILED", coverageState: "UNKNOWN", completedAt: clock(), trigger, requestedAt, attemptCount: attempts, lockOwnerId: owner, errorCategory: error.code || error.name || "INGESTION_FAILED", requestedBy: input.actor || {}, reason: String(input.reason || ""), errors: [{ code: error.code || error.name, message: String(error.message || "Ingestion failed").slice(0, 500) }] } }, { upsert: true, runValidators: true });
            throw error;
        } finally { if (heartbeat) clearInterval(heartbeat); await locks.release(lock).catch(() => null); }
    }
    return Object.freeze({ run, leaseGuardedRepositories });
}
const defaultOrchestrator = createSupplierCatalogIngestionOrchestrator();
module.exports = Object.freeze({ SupplierCatalogIngestionError, createSupplierCatalogIngestionOrchestrator, runSupplierCatalogIngestion: defaultOrchestrator.run, retryable });
