const Supplier = require("../models/Supplier");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { getSupplierAdapter } = require("./supplierAdapterRegistry");

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_STALE_MS = 15 * 60 * 1000;
const SUPPLIER_BALANCE_TIMEOUT_MS = 4500;
const SUPPLIER_PACKAGE_AVAILABILITY_TIMEOUT_MS = 15000;
const snapshotCache = new Map();
const inFlight = new Map();

const text = (value, max = 240) => String(value || "").trim().slice(0, max);
const upper = value => text(value, 80).toUpperCase();

function errorPayload(error) {
    const errorCode = text(error?.code || error?.name || "SUPPLIER_OPERATION_FAILED", 80);
    const errorMessage = errorCode === "SUPPLIER_OPERATION_TIMEOUT"
        ? "Supplier operation timed out."
        : errorCode.endsWith("_NOT_CONFIGURED")
            ? "Supplier API is not configured."
            : "Supplier operation is temporarily unavailable.";
    return {
        errorCode,
        errorMessage
    };
}

async function withTimeout(operation, timeoutMs = SUPPLIER_BALANCE_TIMEOUT_MS) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            const error = new Error("Supplier operation timed out.");
            error.code = "SUPPLIER_OPERATION_TIMEOUT";
            reject(error);
        }, timeoutMs);
    });
    try {
        return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

function balanceThresholds(supplier, currency) {
    const supplierKey = upper(supplier?.supplierCode).replace(/[^A-Z0-9]/g, "_");
    const currencyKey = upper(currency).replace(/[^A-Z0-9]/g, "_");
    const envConfigured = supplierKey && currencyKey ? {
        low: process.env[`SUPPLIER_${supplierKey}_${currencyKey}_LOW_BALANCE`],
        critical: process.env[`SUPPLIER_${supplierKey}_${currencyKey}_CRITICAL_BALANCE`]
    } : null;
    const configured = supplier?.metadata?.operationalThresholds?.balance?.[upper(currency)]
        || supplier?.metadata?.balanceThresholds?.[upper(currency)]
        || envConfigured
        || null;
    const low = Number(configured?.low);
    const critical = Number(configured?.critical);
    if (!Number.isFinite(low) || !Number.isFinite(critical) || critical < 0 || low < critical) return null;
    return { low, critical };
}

function balanceHealth(amount, thresholds, available = true) {
    if (!available) return "UNAVAILABLE";
    if (!thresholds || !Number.isFinite(Number(amount))) return "UNKNOWN";
    if (Number(amount) <= thresholds.critical) return "CRITICAL";
    if (Number(amount) <= thresholds.low) return "LOW";
    return "HEALTHY";
}

function isStale(fetchedAt, now = new Date()) {
    const timestamp = fetchedAt ? new Date(fetchedAt).getTime() : 0;
    return !timestamp || now.getTime() - timestamp > SNAPSHOT_STALE_MS;
}

function unsupportedBalance(message = "API balance not supported") {
    return { supported: false, amount: null, currency: "", status: "UNKNOWN", fetchedAt: null, stale: false, errorCode: "BALANCE_NOT_SUPPORTED", errorMessage: message };
}

function unsupportedAvailability(mappings = [], message = "Package availability API not supported") {
    return {
        supported: false,
        fetchedAt: null,
        stale: false,
        errorCode: "PACKAGE_AVAILABILITY_NOT_SUPPORTED",
        errorMessage: message,
        summary: null,
        packages: mappings.map(mapping => projectMappingAvailability(mapping, "NOT_MONITORED", "CAPABILITY_NOT_SUPPORTED", null))
    };
}

function projectMappingAvailability(mapping, availability, evidence, fetchedAt) {
    return {
        supplierCode: upper(mapping.supplierCode),
        productCode: text(mapping.productCode, 120).toLowerCase(),
        packageCode: upper(mapping.packageCode),
        supplierProductCode: text(mapping.supplierProductCode, 120),
        supplierPackageCode: text(mapping.supplierPackageCode, 120),
        packageName: text(mapping.supplierDisplayName || mapping.packageCode, 160),
        region: upper(mapping.region),
        availability,
        evidence,
        fetchedAt
    };
}

function availabilitySummary(packages = []) {
    const summary = { AVAILABLE: 0, OUT_OF_STOCK: 0, UNAVAILABLE: 0, UNKNOWN: 0 };
    packages.forEach(item => { summary[item.availability] = (summary[item.availability] || 0) + 1; });
    return summary;
}

function normalizeAvailabilityEvidence(result, mappings, fetchedAt) {
    const rows = Array.isArray(result?.packages) ? result.packages : [];
    const returned = new Map();
    rows.forEach(row => {
        const code = text(row.supplierPackageCode, 120);
        if (!returned.has(code)) returned.set(code, []);
        returned.get(code).push(row);
    });
    const packages = mappings.map(mapping => {
        const candidates = returned.get(text(mapping.supplierPackageCode, 120)) || [];
        const mappingProduct = text(mapping.supplierProductCode, 120).toLowerCase();
        const exactCandidates = candidates.filter(row => text(row.supplierProductCode, 120).toLowerCase() === mappingProduct);
        const evidence = exactCandidates.length === 1 ? exactCandidates[0] : (!exactCandidates.length && candidates.length === 1 ? candidates[0] : null);
        if (!evidence) return projectMappingAvailability(mapping, "UNKNOWN", candidates.length > 1 ? "AMBIGUOUS_SUPPLIER_OFFER_IDENTITY" : "NOT_RETURNED_NOT_AUTHORITATIVE", fetchedAt);
        const state = ["AVAILABLE", "OUT_OF_STOCK", "UNAVAILABLE"].includes(upper(evidence.availability))
            ? upper(evidence.availability)
            : "UNKNOWN";
        return projectMappingAvailability(mapping, state, text(result.evidence || "SUPPLIER_EVIDENCE", 120), fetchedAt);
    });
    return { packages, summary: availabilitySummary(packages) };
}

async function fetchBalance({ supplier, adapter, previous, now, SupplierModel, timeoutMs = SUPPLIER_BALANCE_TIMEOUT_MS }) {
    if (upper(supplier.mode) === "MANUAL" || typeof adapter?.getBalance !== "function") {
        return unsupportedBalance(upper(supplier.mode) === "MANUAL" ? "Manual supplier balance is not fetched automatically." : undefined);
    }
    try {
        const result = await withTimeout(signal => adapter.getBalance({ signal }), timeoutMs);
        const amount = Number(result?.rawMetadata?.balance);
        const currency = upper(result?.rawMetadata?.currency || supplier.balanceCurrency || supplier.supplierCurrency);
        if (result?.status !== "SUCCEEDED" || !Number.isFinite(amount) || amount < 0) throw Object.assign(new Error(result?.safeMessage || "Supplier returned an invalid balance."), { code: result?.failureCode || "SUPPLIER_BALANCE_INVALID" });
        const fetchedAt = now.toISOString();
        const thresholds = balanceThresholds(supplier, currency);
        await SupplierModel.updateOne({ _id: supplier._id }, { $set: { balanceAmount: amount, balanceCurrency: currency, balanceSource: "API", lastBalanceSyncAt: now } });
        return { supported: true, amount, currency, status: balanceHealth(amount, thresholds), fetchedAt, stale: false, thresholdsConfigured: Boolean(thresholds) };
    } catch (error) {
        const persistedAmount = previous?.amount ?? supplier.balanceAmount;
        const persistedCurrency = previous?.currency || supplier.balanceCurrency || supplier.supplierCurrency || "";
        const persistedAt = previous?.fetchedAt || supplier.lastBalanceSyncAt || null;
        const failure = errorPayload(error);
        if (Number.isFinite(Number(persistedAmount)) && persistedAt) {
            return { supported: true, amount: Number(persistedAmount), currency: upper(persistedCurrency), status: balanceHealth(Number(persistedAmount), balanceThresholds(supplier, persistedCurrency)), fetchedAt: persistedAt, stale: true, ...failure };
        }
        return { supported: true, amount: null, currency: upper(persistedCurrency), status: "UNAVAILABLE", fetchedAt: null, stale: true, ...failure };
    }
}

async function fetchAvailability({ adapter, mappings, previous, now, timeoutMs = SUPPLIER_PACKAGE_AVAILABILITY_TIMEOUT_MS }) {
    if (typeof adapter?.getPackageAvailability !== "function") return unsupportedAvailability(mappings);
    try {
        const categoryIds = [...new Set(mappings.map(mapping => text(mapping.supplierProductCode, 120)).filter(Boolean))];
        const result = await withTimeout(signal => adapter.getPackageAvailability({ signal, categoryIds }), timeoutMs);
        if (result?.supported !== true) return unsupportedAvailability(mappings);
        const fetchedAt = now.toISOString();
        const normalized = normalizeAvailabilityEvidence(result, mappings, fetchedAt);
        return { supported: true, fetchedAt, stale: false, ...normalized };
    } catch (error) {
        const failure = errorPayload(error);
        if (previous?.supported && Array.isArray(previous.packages)) return { ...previous, stale: true, ...failure };
        const packages = mappings.map(mapping => projectMappingAvailability(mapping, "UNKNOWN", "SUPPLIER_FETCH_FAILED", null));
        return { supported: true, fetchedAt: null, stale: true, packages, summary: availabilitySummary(packages), ...failure };
    }
}

function coverageState(confirmedAvailableSuppliers, monitoredSuppliers) {
    if (confirmedAvailableSuppliers >= 2) return "AVAILABLE_FROM_2";
    if (confirmedAvailableSuppliers === 1) return "AVAILABLE_FROM_1";
    return monitoredSuppliers > 0 ? "NONE_CONFIRMED" : "UNKNOWN";
}

function participatesInLiveOperations(snapshot = {}) {
    if (typeof snapshot.liveOperationsVisible === "boolean") return snapshot.liveOperationsVisible;
    return snapshot.balance?.supported === true || snapshot.packageAvailability?.supported === true;
}

function buildProductPackageCoverage({ snapshots = [], products = [], packages = [], mappings = [], affectedCounts = [], filters = {} }) {
    const productFilter = text(filters.productCode, 120).toLowerCase();
    const packageFilter = upper(filters.packageCode);
    const supplierFilter = upper(filters.supplierCode);
    const availabilityFilter = upper(filters.availability);
    const productNames = new Map(products.map(row => [text(row.productCode, 120).toLowerCase(), text(row.name, 160)]));
    const packageNames = new Map(packages.map(row => [`${text(row.productCode, 120).toLowerCase()}:${upper(row.packageCode)}`, text(row.name, 160)]));
    const snapshotBySupplier = new Map(snapshots.map(row => [upper(row.supplierCode), row]));
    const suppliers = snapshots.filter(participatesInLiveOperations).map(row => ({ supplierCode: upper(row.supplierCode), supplierName: text(row.supplierName, 120), monitored: row.packageAvailability?.supported === true }));
    const affected = new Map(affectedCounts.map(row => [`${text(row._id?.productCode, 120).toLowerCase()}:${upper(row._id?.packageCode)}:${upper(row._id?.supplierCode)}`, Number(row.count || 0)]));
    const mappingByPackage = new Map();
    mappings.forEach(mapping => {
        const key = `${text(mapping.productCode, 120).toLowerCase()}:${upper(mapping.packageCode)}`;
        if (!mappingByPackage.has(key)) mappingByPackage.set(key, []);
        mappingByPackage.get(key).push(mapping);
    });
    const result = [];
    packages.forEach(pkg => {
        const productCode = text(pkg.productCode, 120).toLowerCase();
        const packageCode = upper(pkg.packageCode);
        if (productFilter && productFilter !== "all" && productCode !== productFilter) return;
        if (packageFilter && packageFilter !== "ALL" && packageCode !== packageFilter) return;
        const key = `${productCode}:${packageCode}`;
        const packageMappings = mappingByPackage.get(key) || [];
        const supplierRows = suppliers.map(supplier => {
            const candidates = packageMappings.filter(mapping => upper(mapping.supplierCode) === supplier.supplierCode);
            const mapping = candidates.length === 1 ? candidates[0] : null;
            const snapshot = snapshotBySupplier.get(supplier.supplierCode);
            const evidenceRows = snapshot?.packageAvailability?.packages || [];
            const evidence = mapping ? evidenceRows.find(row => upper(row.packageCode) === packageCode && text(row.productCode, 120).toLowerCase() === productCode) : null;
            let availability = "NOT_MONITORED";
            let reason = supplier.monitored ? "NO_CANONICAL_SUPPLIER_MAPPING" : "CAPABILITY_NOT_SUPPORTED";
            if (candidates.length > 1) { availability = "UNKNOWN"; reason = "AMBIGUOUS_SUPPLIER_MAPPING"; }
            else if (mapping && supplier.monitored) { availability = evidence?.availability || "UNKNOWN"; reason = evidence?.evidence || "SUPPLIER_EVIDENCE_MISSING"; }
            return {
                supplierCode: supplier.supplierCode, supplierName: supplier.supplierName,
                supplierPackageCode: mapping ? text(mapping.supplierPackageCode, 120) : "",
                supplierProductCode: mapping ? text(mapping.supplierProductCode, 120) : "",
                availability, evidence: reason, fetchedAt: evidence?.fetchedAt || snapshot?.packageAvailability?.fetchedAt || null,
                stale: Boolean(snapshot?.packageAvailability?.stale),
                affectedOrderCount: affected.get(`${key}:${supplier.supplierCode}`) || 0
            };
        }).filter(row => (!supplierFilter || supplierFilter === "ALL" || row.supplierCode === supplierFilter) && (!availabilityFilter || availabilityFilter === "ALL" || row.availability === availabilityFilter));
        if (!supplierRows.length) return;
        const confirmed = supplierRows.filter(row => row.availability === "AVAILABLE").length;
        const monitored = supplierRows.filter(row => row.availability !== "NOT_MONITORED").length;
        let product = result.find(row => row.productCode === productCode);
        if (!product) { product = { productCode, productName: productNames.get(productCode) || productCode, packageCount: 0, supplierSummary: [], packages: [] }; result.push(product); }
        product.packages.push({ packageCode, packageName: packageNames.get(key) || packageCode, coverage: { confirmedAvailableSuppliers: confirmed, state: coverageState(confirmed, monitored) }, suppliers: supplierRows });
        product.packageCount += 1;
    });
    result.forEach(product => {
        product.supplierSummary = suppliers.filter(supplier => !supplierFilter || supplierFilter === "ALL" || supplier.supplierCode === supplierFilter).map(supplier => {
            if (!supplier.monitored) return { supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, monitored: false };
            const rows = product.packages.flatMap(pkg => pkg.suppliers).filter(row => row.supplierCode === supplier.supplierCode);
            return { supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, monitored: true, counts: availabilitySummary(rows) };
        });
    });
    return result;
}

async function getSupplierPackageCoverage(options = {}) {
    const ProductModel = options.ProductModel || CatalogProduct;
    const PackageModel = options.PackageModel || CatalogPackage;
    const MappingModel = options.MappingModel || SupplierProductMapping;
    const AttemptModel = options.AttemptModel || FulfillmentAttempt;
    const snapshots = options.snapshots || await getSupplierOperations(options);
    const recentSince = new Date((options.now instanceof Date ? options.now : new Date()).getTime() - 30 * 24 * 60 * 60 * 1000);
    const [products, packages, mappings, affectedCounts] = await Promise.all([
        ProductModel.find({ deletedAt: null }).sort({ sortOrder: 1, productCode: 1 }).lean(),
        PackageModel.find({ deletedAt: null }).sort({ productCode: 1, sortOrder: 1, packageCode: 1 }).lean(),
        MappingModel.find({ archivedAt: null }).sort({ productCode: 1, packageCode: 1, supplierCode: 1 }).lean(),
        AttemptModel.aggregate([{ $match: { normalizedFailureCategory: "SUPPLIER_OUT_OF_STOCK", failedAt: { $gte: recentSince } } }, { $group: { _id: { productCode: "$productCode", packageCode: "$packageCode", supplierCode: "$supplierCodeSnapshot" }, count: { $sum: 1 } } }])
    ]);
    return buildProductPackageCoverage({ snapshots, products, packages, mappings, affectedCounts, filters: options.filters });
}

async function fetchSupplierSnapshot({ supplier, mappings, force, now, SupplierModel, adapterResolver }) {
    const supplierCode = upper(supplier.supplierCode);
    const cached = snapshotCache.get(supplierCode);
    if (!force && cached && cached.expiresAt > now.getTime()) return cached.snapshot;
    if (inFlight.has(supplierCode)) return inFlight.get(supplierCode);

    const operation = (async () => {
        const adapter = adapterResolver(supplier);
        const previous = cached?.snapshot || null;
        const [balance, packageAvailability] = await Promise.all([
            fetchBalance({ supplier, adapter, previous: previous?.balance, now, SupplierModel }),
            fetchAvailability({ adapter, mappings, previous: previous?.packageAvailability, now })
        ]);
        const snapshot = {
            supplierCode,
            supplierName: text(supplier.name || supplierCode, 120),
            enabled: supplier.enabled !== false,
            mode: upper(supplier.mode),
            balance: { ...balance, stale: balance.stale || isStale(balance.fetchedAt, now) },
            packageAvailability: { ...packageAvailability, stale: packageAvailability.stale || (packageAvailability.fetchedAt ? isStale(packageAvailability.fetchedAt, now) : packageAvailability.stale) }
        };
        snapshot.liveOperationsVisible = participatesInLiveOperations(snapshot);
        snapshotCache.set(supplierCode, { snapshot, expiresAt: now.getTime() + SNAPSHOT_TTL_MS });
        return snapshot;
    })().finally(() => inFlight.delete(supplierCode));
    inFlight.set(supplierCode, operation);
    return operation;
}

async function getSupplierOperations(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const SupplierModel = options.SupplierModel || Supplier;
    const MappingModel = options.MappingModel || SupplierProductMapping;
    const adapterResolver = options.adapterResolver || getSupplierAdapter;
    const [suppliers, mappings] = await Promise.all([
        SupplierModel.find({}).sort({ supplierCode: 1 }).lean(),
        MappingModel.find({ archivedAt: null }).sort({ supplierCode: 1, productCode: 1, packageCode: 1 }).lean()
    ]);
    const bySupplier = new Map();
    mappings.forEach(mapping => {
        const code = upper(mapping.supplierCode);
        if (!bySupplier.has(code)) bySupplier.set(code, []);
        bySupplier.get(code).push(mapping);
    });
    const results = await Promise.allSettled(suppliers.map(supplier => fetchSupplierSnapshot({
        supplier,
        mappings: bySupplier.get(upper(supplier.supplierCode)) || [],
        force: options.force === true,
        now,
        SupplierModel,
        adapterResolver
    })));
    return suppliers.map((supplier, index) => {
        if (results[index].status === "fulfilled") return results[index].value;
        const mappingsForSupplier = bySupplier.get(upper(supplier.supplierCode)) || [];
        const snapshot = {
            supplierCode: upper(supplier.supplierCode), supplierName: text(supplier.name, 120), enabled: supplier.enabled !== false, mode: upper(supplier.mode),
            balance: { ...unsupportedBalance("Supplier snapshot unavailable."), supported: upper(supplier.mode) !== "MANUAL", status: "UNAVAILABLE", stale: true, ...errorPayload(results[index].reason) },
            packageAvailability: { ...unsupportedAvailability(mappingsForSupplier, "Supplier snapshot unavailable."), stale: true, ...errorPayload(results[index].reason) }
        };
        return { ...snapshot, liveOperationsVisible: participatesInLiveOperations(snapshot) };
    });
}

function clearSupplierOperationsCache() {
    snapshotCache.clear();
    inFlight.clear();
}

module.exports = {
    SNAPSHOT_TTL_MS,
    SNAPSHOT_STALE_MS,
    SUPPLIER_BALANCE_TIMEOUT_MS,
    SUPPLIER_PACKAGE_AVAILABILITY_TIMEOUT_MS,
    balanceHealth,
    normalizeAvailabilityEvidence,
    participatesInLiveOperations,
    buildProductPackageCoverage,
    getSupplierPackageCoverage,
    getSupplierOperations,
    clearSupplierOperationsCache,
    _withTimeout: withTimeout,
    _fetchBalance: fetchBalance,
    _fetchAvailability: fetchAvailability,
    _fetchSupplierSnapshot: fetchSupplierSnapshot,
    _cache: snapshotCache,
    _inFlight: inFlight
};
