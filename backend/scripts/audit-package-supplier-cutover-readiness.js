#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogPackage = require("../models/CatalogPackage");
const CatalogProduct = require("../models/CatalogProduct");
const CommerceOrder = require("../models/CommerceOrder");
const MediaAsset = require("../models/MediaAsset");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const Supplier = require("../models/Supplier");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const { evaluatePackageSupplierCandidates } = require("../services/packageSupplierCandidateService");
const { marginAssessment } = require("../services/packageSupplierSelectionService");
const { toPublicCatalog } = require("../services/catalogService");
const { assessProductionMapping, resolveCheckoutRouteSnapshot } = require("../services/supplierProductionSelectionService");
const { inspect: inspectSelectionIndex } = require("./verify-package-supplier-selection-production-index");

const READ_ONLY = true;
const MARKETS = Object.freeze(["TH", "MM"]);
const DEFAULT_STAGE_TIMEOUT_MS = 30_000;
const DEFAULT_AUDIT_CONCURRENCY = 4;
const MAX_AUDIT_CONCURRENCY = 8;
const UNAVAILABLE_BLOCKERS = new Set(["SUPPLIER_DISABLED", "SUPPLIER_NOT_API_READY", "SUPPLIER_OFFER_NOT_ACTIVE", "SUPPLIER_AVAILABILITY_NOT_CONFIRMED"]);
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const id = value => clean(value?._id || value);

function assertReadOnlyStartup() {
    assert.strictEqual(READ_ONLY, true, "Read-only safety flag is required.");
    assert(!process.argv.includes("--apply"), "This audit does not support --apply.");
    const source = fs.readFileSync(__filename, "utf8");
    const forbidden = ["insert" + "One(", "insert" + "Many(", "update" + "One(", "update" + "Many(", "delete" + "One(", "delete" + "Many(", "findOneAnd" + "Update(", "bulk" + "Write(", "create" + "Index(", "sync" + "Indexes(", "drop" + "Index("];
    const found = forbidden.filter(token => source.includes(`.${token}`));
    assert.deepStrictEqual(found, [], `Write-capable code detected: ${found.join(", ")}`);
}

function installReadOnlyMongooseGuard() {
    const refuse = operation => function refuseWrite() {
        throw Object.assign(new Error(`Read-only cutover audit blocked ${operation}.`), { code: "READ_ONLY_AUDIT_WRITE_BLOCKED" });
    };
    for (const operation of ["create", "insertMany", "bulkWrite", "updateOne", "updateMany", "deleteOne", "deleteMany", "findOneAndUpdate", "findByIdAndUpdate", "replaceOne"]) {
        mongoose.Model[operation] = refuse(`Model.${operation}`);
    }
    for (const operation of ["save", "deleteOne", "updateOne", "replaceOne"]) {
        mongoose.Model.prototype[operation] = refuse(`Document.${operation}`);
    }
    for (const operation of ["insertOne", "insertMany", "bulkWrite", "updateOne", "updateMany", "deleteOne", "deleteMany", "findOneAndUpdate", "createIndex", "dropIndex", "dropIndexes"]) {
        mongoose.Collection.prototype[operation] = refuse(`Collection.${operation}`);
    }
    mongoose.Connection.prototype.createCollection = refuse("Connection.createCollection");
}

function installExternalNetworkGuard({ globalObject = globalThis, httpModule = http, httpsModule = https } = {}) {
    const refuse = operation => function refuseExternalNetwork() {
        throw Object.assign(new Error(`Read-only cutover audit blocked external network operation ${operation}.`), { code: "READ_ONLY_AUDIT_EXTERNAL_NETWORK_BLOCKED" });
    };
    if (typeof globalObject.fetch === "function") globalObject.fetch = refuse("fetch");
    for (const [module, name] of [[httpModule, "http"], [httpsModule, "https"]]) {
        module.request = refuse(`${name}.request`);
        module.get = refuse(`${name}.get`);
    }
}

function stageTimeoutMs(value = process.env.AZIEL_CUTOVER_AUDIT_STAGE_TIMEOUT_MS) {
    const parsed = Number(value || DEFAULT_STAGE_TIMEOUT_MS);
    assert(Number.isInteger(parsed) && parsed >= 100, "AZIEL_CUTOVER_AUDIT_STAGE_TIMEOUT_MS must be an integer of at least 100ms.");
    return parsed;
}

function auditConcurrency(value = process.env.AZIEL_CUTOVER_AUDIT_CONCURRENCY) {
    const parsed = Number(value || DEFAULT_AUDIT_CONCURRENCY);
    assert(Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_AUDIT_CONCURRENCY, `AZIEL_CUTOVER_AUDIT_CONCURRENCY must be an integer from 1 to ${MAX_AUDIT_CONCURRENCY}.`);
    return parsed;
}

async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    async function runWorker() {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
    return results;
}

async function withStageTimeout(stage, task, timeoutMs) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`Audit stage timed out after ${timeoutMs}ms: ${stage}`), {
            code: "CUTOVER_AUDIT_STAGE_TIMEOUT",
            stage,
            timeoutMs
        })), timeoutMs);
    });
    try {
        return await Promise.race([Promise.resolve().then(task), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

function createStageRunner({ logger = console.log, timeoutMs = stageTimeoutMs(), total = 9, start = 1 } = {}) {
    let position = start;
    return async function stage(label, task) {
        const step = position++;
        const startedAt = Date.now();
        logger(`[${step}/${total}] ${label}...`);
        try {
            const result = await withStageTimeout(label, task, timeoutMs);
            logger(`[${step}/${total}] ${label} complete (${Date.now() - startedAt}ms)`);
            return result;
        } catch (error) {
            logger(`[${step}/${total}] ${label} failed (${Date.now() - startedAt}ms): ${error.code || error.name}`);
            throw error;
        }
    };
}

function countBy(rows, field) {
    return rows.reduce((counts, row) => {
        const key = row[field] || "UNKNOWN";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

function topologyProjection(hello = {}) {
    const topology = hello.msg === "isdbgrid" ? "sharded" : hello.setName ? "replicaSet" : Object.keys(hello).length ? "standalone" : "unknown";
    const logicalSessionSupport = Number.isFinite(Number(hello.logicalSessionTimeoutMinutes));
    return { topology, logicalSessionSupport, transactionCapable: logicalSessionSupport && (topology === "replicaSet" || topology === "sharded") };
}

function coverageClassification(data = {}) {
    const selected = (data.candidates || []).find(candidate => candidate.selected);
    if (data.selection) {
        if (!selected) return "SELECTED_UNREADY";
        if (selected.readiness?.selectable === true) return "SELECTED_READY";
        return (selected.readiness?.blockerCodes || []).some(code => UNAVAILABLE_BLOCKERS.has(code)) ? "SELECTED_UNAVAILABLE" : "SELECTED_UNREADY";
    }
    const selectable = (data.candidates || []).filter(candidate => candidate.readiness?.selectable === true);
    if (!selectable.length) return "NO_ELIGIBLE_SUPPLIER";
    const plausibleLegacy = selectable.filter(candidate => candidate.readiness?.legacyProductionRole === "PRIMARY");
    return plausibleLegacy.length > 1 ? "AMBIGUOUS_LEGACY_ROUTE" : "NO_SELECTION";
}

function routeComparison(legacy = {}, data = {}) {
    const explicit = (data.candidates || []).find(candidate => candidate.selected);
    if (!data.selection) return "NO_EXPLICIT_SELECTION";
    if (!explicit || explicit.readiness?.selectable !== true) return "EXPLICIT_NOT_READY";
    if (!legacy.ready || legacy.routeSnapshot?.routeType !== "SUPPLIER_API") return "LEGACY_NOT_READY";
    return id(legacy.routeSnapshot.supplierMappingId) === id(explicit.supplierMappingId) ? "MATCH" : "MISMATCH";
}

function priceComparison(customerPrice = null, selected = null) {
    if (!selected || !customerPrice || (!customerPrice.supplierId && !customerPrice.supplierCode)) return "PRICE_PROVENANCE_UNKNOWN";
    const supplierMatch = customerPrice.supplierId
        ? id(customerPrice.supplierId) === id(selected.supplier?.supplierId)
        : upper(customerPrice.supplierCode) === upper(selected.supplier?.supplierCode);
    return supplierMatch ? "PRICE_SUPPLIER_MATCH" : "PRICE_SUPPLIER_DIFFERENT";
}

async function auditRawCounts() {
    const [publicationTotal, publicationPublished, publicationByMarket, storeSelections, activeStoreSelections, productTotal, productEnabled, packageTotal, packageEnabled, selectionsByMarket] = await Promise.all([
        PackageMarketPublication.countDocuments({}),
        PackageMarketPublication.countDocuments({ published: true }),
        PackageMarketPublication.aggregate([{ $match: { published: true } }, { $group: { _id: "$customerMarket", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
        StoreCatalogSelection.countDocuments({}),
        StoreCatalogSelection.countDocuments({ status: "ACTIVE" }),
        CatalogProduct.countDocuments({}),
        CatalogProduct.countDocuments({ enabled: true, deletedAt: null }),
        CatalogPackage.countDocuments({}),
        CatalogPackage.countDocuments({ enabled: true, deletedAt: null }),
        PackageSupplierSelection.aggregate([{ $group: { _id: "$customerMarket", count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    ]);
    return {
        packageMarketPublication: { total: publicationTotal, published: publicationPublished, publishedByCustomerMarket: Object.fromEntries(publicationByMarket.map(row => [row._id || "UNKNOWN", row.count])) },
        storeCatalogSelection: { total: storeSelections, active: activeStoreSelections },
        catalogProduct: { total: productTotal, enabled: productEnabled },
        catalogPackage: { total: packageTotal, enabled: packageEnabled },
        packageSupplierSelectionByCustomerMarket: Object.fromEntries(selectionsByMarket.map(row => [row._id || "UNKNOWN", row.count]))
    };
}

async function loadPublicMarketCatalog(customerMarket) {
    // This is the same authority used by GET /api/catalog. Its database path is
    // read-only: model reads, pure projections, and a process-local cache only.
    return toPublicCatalog({ includeDisabled: false, customerMarket });
}

const identityKey = (productCode, packageCode) => `${clean(productCode).toLowerCase()}::${upper(packageCode)}`;

async function preloadMarketAuthorities(customerMarket, catalog) {
    const identities = catalog.flatMap(product => (product.packages || []).map(pkg => ({ productCode: clean(product.productCode).toLowerCase(), packageCode: upper(pkg.packageCode) })));
    const identityFilter = identities.map(item => ({ productCode: item.productCode, packageCode: item.packageCode }));
    if (!identityFilter.length) return { identities, packages: [], publications: [], selections: [], mappings: [], suppliers: [], offers: [], availabilityRows: [], mediaAssets: [], bulkQueryCount: 0 };
    const [packages, publications, selections, mappings] = await Promise.all([
        CatalogPackage.find({ $or: identityFilter, deletedAt: null }).lean(),
        PackageMarketPublication.find({ $or: identityFilter.map(item => ({ ...item, customerMarket })) }).lean(),
        PackageSupplierSelection.find({ $or: identityFilter.map(item => ({ ...item, customerMarket })) }).lean(),
        SupplierProductMapping.find({ $or: identityFilter }).sort({ supplierCode: 1, region: 1, _id: 1 }).lean()
    ]);
    const supplierIds = [...new Set(mappings.map(item => id(item.supplierId)).filter(Boolean))];
    const offerIds = [...new Set(mappings.map(item => id(item.supplierCatalogOfferId)).filter(Boolean))];
    const assetIds = [...new Set(packages.map(item => clean(item.iconAssetId)).filter(Boolean))];
    const [suppliers, offers, availabilityRows, mediaAssets] = await Promise.all([
        supplierIds.length ? Supplier.find({ _id: { $in: supplierIds } }).lean() : [],
        offerIds.length ? SupplierCatalogOffer.find({ _id: { $in: offerIds } }).lean() : [],
        offerIds.length ? SupplierOfferAvailability.find({ supplierCatalogOfferId: { $in: offerIds } }).lean() : [],
        assetIds.length ? MediaAsset.find({ assetId: { $in: assetIds }, status: "active" }).lean() : []
    ]);
    return { identities, packages, publications, selections, mappings, suppliers, offers, availabilityRows, mediaAssets, bulkQueryCount: 8 };
}

async function auditPublicMarket(customerMarket, publicCatalog = null, options = {}) {
    const catalog = publicCatalog || await loadPublicMarketCatalog(customerMarket);
    const logger = options.logger || console.log;
    const concurrency = options.concurrency || auditConcurrency();
    const startedAt = Date.now();
    const authorities = options.authorities || await preloadMarketAuthorities(customerMarket, catalog);
    const packageByKey = new Map(authorities.packages.map(item => [identityKey(item.productCode, item.packageCode), item]));
    const publicationByKey = new Map(authorities.publications.map(item => [identityKey(item.productCode, item.packageCode), item]));
    const selectionByKey = new Map(authorities.selections.map(item => [identityKey(item.productCode, item.packageCode), item]));
    const mappingsByKey = new Map();
    for (const mapping of authorities.mappings) {
        const key = identityKey(mapping.productCode, mapping.packageCode);
        if (!mappingsByKey.has(key)) mappingsByKey.set(key, []);
        mappingsByKey.get(key).push(mapping);
    }
    const mediaById = new Map(authorities.mediaAssets.map(item => [clean(item.assetId), item]));
    const tasks = catalog.flatMap(product => (product.packages || []).map(publicPackage => ({ product, publicPackage })));
    logger(`${customerMarket} coverage: 0/${tasks.length} public packages (concurrency ${concurrency}, ${authorities.bulkQueryCount} bulk authority queries)`);
    let completed = 0;
    const checkpoint = Math.max(1, Math.min(10, Math.ceil(tasks.length / 5)));
    const rows = await mapWithConcurrency(tasks, concurrency, async ({ product, publicPackage }) => {
        const key = identityKey(product.productCode, publicPackage.packageCode);
        const pkg = packageByKey.get(key);
        if (!pkg) return null;
        const publication = publicationByKey.get(key) || null;
        const data = evaluatePackageSupplierCandidates({ productCode: product.productCode, packageCode: publicPackage.packageCode, customerMarket, pkg, publication, selection: selectionByKey.get(key) || null, mappings: mappingsByKey.get(key) || [], suppliers: authorities.suppliers, offers: authorities.offers, availabilityRows: authorities.availabilityRows, iconAsset: mediaById.get(clean(pkg.iconAssetId)) || null });
        const selected = (data.candidates || []).find(candidate => candidate.selected) || null;
        const legacy = await resolveCheckoutRouteSnapshot({ productCode: product.productCode, packageCode: publicPackage.packageCode, region: customerMarket, includeDiagnostics: true });
        const margin = selected
            ? selected.cost?.stale === true
                ? { state: "UNKNOWN", evidence: "STALE_SUPPLIER_COST" }
                : marginAssessment(pkg, customerMarket, selected.cost)
            : { state: "UNAVAILABLE" };
        const row = {
            productCode: product.productCode,
            packageCode: publicPackage.packageCode,
            customerMarket,
            publicationState: publication?.published === true ? "EFFECTIVE_PUBLIC" : "EFFECTIVE_STOREFRONT_WITHOUT_EXPLICIT_PUBLICATION",
            customerPrice: data.customerPrice,
            selectionMappingId: data.selection?.supplierMappingId || "",
            selectedSupplierCode: selected?.supplier?.supplierCode || "",
            supplierMarket: selected?.supplierMarket || "",
            selectionStatus: coverageClassification(data),
            blockers: selected?.readiness?.blockerCodes || [],
            legacyMappingId: legacy.routeSnapshot?.supplierMappingId || "",
            legacySupplierCode: legacy.routeSnapshot?.supplierCode || "",
            routeComparison: routeComparison(legacy, data),
            priceComparison: priceComparison(data.customerPrice, selected),
            marginAssessment: margin
        };
        completed += 1;
        if (completed === tasks.length || completed % checkpoint === 0) logger(`${customerMarket} coverage: ${completed}/${tasks.length}`);
        return row;
    });
    const elapsedMs = Date.now() - startedAt;
    logger(`${customerMarket} coverage complete: ${rows.filter(Boolean).length} packages, ${elapsedMs}ms, average ${tasks.length ? Math.round(elapsedMs / tasks.length) : 0}ms/package`);
    return rows.filter(Boolean);
}

async function auditPublicPackages() {
    return (await Promise.all(MARKETS.map(auditPublicMarket))).flat();
}

const COMMERCIAL_ONLY_BLOCKERS = new Set(["CURRENT_SUPPLIER_COST_MISSING", "SUPPLIER_COST_AUTHORITY_STALE", "PRODUCTION_PRICE_NOT_PUBLISHED", "PRICING_NOT_READY"]);
function frozenExecutionBlockers(assessment = {}) {
    return (assessment.blockers || []).filter(code => !COMMERCIAL_ONLY_BLOCKERS.has(code));
}

async function auditOrders() {
    const orders = await CommerceOrder.find({}).select("orderId status paymentStatus product commercial fulfilment.routeSnapshot fulfilment.status createdAt").sort({ _id: 1 }).lean();
    const mappingIds = [...new Set(orders.map(order => id(order.fulfilment?.routeSnapshot?.supplierMappingId)).filter(value => mongoose.Types.ObjectId.isValid(value)))];
    const mappings = mappingIds.length ? await SupplierProductMapping.find({ _id: { $in: mappingIds } }).lean() : [];
    const mappingById = new Map(mappings.map(mapping => [id(mapping), mapping]));
    const assessmentById = new Map();
    for (const mapping of mappings) assessmentById.set(id(mapping), await assessProductionMapping(mapping));
    const counts = {
        WITH_ROUTE_SNAPSHOT: 0, WITHOUT_ROUTE_SNAPSHOT: 0, SNAPSHOT_MAPPING_PRIMARY: 0, SNAPSHOT_MAPPING_BACKUP: 0,
        SNAPSHOT_MAPPING_DISABLED: 0, SNAPSHOT_MAPPING_ARCHIVED: 0, SNAPSHOT_MAPPING_MISSING: 0,
        SNAPSHOT_MAPPING_ID_ABSENT_LEGACY: 0, SNAPSHOT_MAPPING_ID_INVALID: 0, SNAPSHOT_MAPPING_REFERENCE_MISSING: 0,
        SNAPSHOT_NON_SUPPLIER_ROUTE: 0, SNAPSHOT_MALFORMED_IDENTITY: 0, SUPPLIER_DISABLED: 0,
        ADAPTER_OR_PROVIDER_NOT_EXECUTABLE: 0, CURRENT_FULFILLMENT_WOULD_FAIL_ROLE_ONLY: 0
    };
    const details = [];
    const noSnapshotByStatus = {};
    const noSnapshotOrders = [];
    for (const order of orders) {
        const snapshot = order.fulfilment?.routeSnapshot || null;
        if (!snapshot) {
            counts.WITHOUT_ROUTE_SNAPSHOT += 1;
            const key = `${order.status || "UNKNOWN"}/${order.paymentStatus || "UNKNOWN"}/${order.fulfilment?.status || "UNKNOWN"}`;
            noSnapshotByStatus[key] = (noSnapshotByStatus[key] || 0) + 1;
            const identity = { orderId: order.orderId, productCode: clean(order.product?.gameCode).toLowerCase(), packageCode: upper(order.product?.packageCode), customerMarket: upper(order.commercial?.region || order.product?.region), createdAt: order.createdAt || null, orderStatus: order.status, paymentStatus: order.paymentStatus, fulfillmentStatus: order.fulfilment?.status || "" };
            if (String(order.paymentStatus || "").toLowerCase() === "paid" && String(order.fulfilment?.status || "").toLowerCase() === "not_started") {
                const routing = await resolveCheckoutRouteSnapshot({ productCode: identity.productCode, packageCode: identity.packageCode, region: identity.customerMarket, includeDiagnostics: true });
                identity.currentHandling = routing.ready && routing.routeSnapshot?.routeType === "SUPPLIER_API" ? "WOULD_RESOLVE_CURRENT_ROUTE_AND_START_SUPPLIER" : routing.ready && routing.routeSnapshot?.routeType === "MANUAL_ADMIN" ? "WOULD_QUEUE_MANUAL_ADMIN" : "WOULD_FAIL_NO_AUTHORIZED_ROUTE";
                identity.currentRoutePreview = { ready: routing.ready === true, routeType: routing.routeSnapshot?.routeType || "", mappingId: routing.routeSnapshot?.supplierMappingId || "", supplierCode: routing.routeSnapshot?.supplierCode || "", blockers: routing.blockers || [] };
            }
            noSnapshotOrders.push(identity);
            continue;
        }
        counts.WITH_ROUTE_SNAPSHOT += 1;
        const routeType = upper(snapshot.routeType);
        if (routeType && routeType !== "SUPPLIER_API") {
            counts.SNAPSHOT_NON_SUPPLIER_ROUTE += 1;
            details.push({ orderId: order.orderId, routeType, classification: "SNAPSHOT_NON_SUPPLIER_ROUTE" });
            continue;
        }
        const snapshotMappingId = id(snapshot.supplierMappingId);
        if (!snapshotMappingId) {
            counts.SNAPSHOT_MAPPING_MISSING += 1;
            counts.SNAPSHOT_MAPPING_ID_ABSENT_LEGACY += 1;
            details.push({ orderId: order.orderId, snapshotVersion: snapshot.snapshotVersion || 1, routeType: routeType || "LEGACY_UNKNOWN", classification: "SNAPSHOT_MAPPING_ID_ABSENT_LEGACY" });
            continue;
        }
        if (!mongoose.Types.ObjectId.isValid(snapshotMappingId)) {
            counts.SNAPSHOT_MAPPING_MISSING += 1;
            counts.SNAPSHOT_MAPPING_ID_INVALID += 1;
            details.push({ orderId: order.orderId, mappingId: snapshotMappingId, classification: "SNAPSHOT_MAPPING_ID_INVALID" });
            continue;
        }
        const mapping = mappingById.get(snapshotMappingId);
        if (!mapping) {
            counts.SNAPSHOT_MAPPING_MISSING += 1;
            counts.SNAPSHOT_MAPPING_REFERENCE_MISSING += 1;
            details.push({ orderId: order.orderId, mappingId: snapshotMappingId, classification: "SNAPSHOT_MAPPING_REFERENCE_MISSING" });
            continue;
        }
        const malformedIdentity = clean(snapshot.productCode).toLowerCase() !== clean(mapping.productCode).toLowerCase() || upper(snapshot.packageCode) !== upper(mapping.packageCode) || (snapshot.supplierId && id(snapshot.supplierId) !== id(mapping.supplierId));
        if (malformedIdentity) counts.SNAPSHOT_MALFORMED_IDENTITY += 1;
        const role = upper(mapping.productionRole || "DISABLED");
        if (role === "PRIMARY") counts.SNAPSHOT_MAPPING_PRIMARY += 1;
        if (role === "BACKUP") counts.SNAPSHOT_MAPPING_BACKUP += 1;
        if (role === "DISABLED") counts.SNAPSHOT_MAPPING_DISABLED += 1;
        if (mapping.archivedAt) counts.SNAPSHOT_MAPPING_ARCHIVED += 1;
        const assessment = assessmentById.get(id(mapping)) || { ready: false, blockers: ["ASSESSMENT_MISSING"] };
        if (assessment.blockers.includes("SUPPLIER_DISABLED")) counts.SUPPLIER_DISABLED += 1;
        const executionBlockers = frozenExecutionBlockers(assessment);
        if (executionBlockers.some(code => ["SUPPLIER_ADAPTER_NOT_READY", "PROVIDER_FEATURE_GATE_OFF", "SUPPLIER_AUTO_FULFILLMENT_DISABLED", "FULFILLMENT_PROCESSOR_NOT_READY", "SUPPLIER_DISABLED"].includes(code))) counts.ADAPTER_OR_PROVIDER_NOT_EXECUTABLE += 1;
        const roleOnly = role === "BACKUP" && !mapping.archivedAt && mapping.enabled === true && !malformedIdentity && executionBlockers.length === 0;
        if (roleOnly) counts.CURRENT_FULFILLMENT_WOULD_FAIL_ROLE_ONLY += 1;
        if (role !== "PRIMARY" || mapping.archivedAt || assessment.blockers.length || malformedIdentity) details.push({ orderId: order.orderId, status: order.status, paymentStatus: order.paymentStatus, mappingId: id(mapping), supplierCode: mapping.supplierCode, productionRole: role, archived: Boolean(mapping.archivedAt), malformedIdentity, roleOnlyFailure: roleOnly, commercialReadinessBlockers: assessment.blockers || [], frozenExecutionBlockers: executionBlockers });
    }
    return { total: orders.length, counts, noSnapshotByStatus, noSnapshotOrders, details, validationBoundary: { commercialOnlyBlockersExcludedFromFrozenExecution: [...COMMERCIAL_ONLY_BLOCKERS].sort(), frozenExecutionStillRequires: ["exact frozen identity", "mapping exists and is not archived", "mapping and supplier enabled", "API execution mode", "input and fulfillment readiness", "configured adapter/provider feature gate", "provider processor compatibility"], currentPrimaryRoleCheckReportedSeparately: true } };
}

function printHuman(report) {
    console.log("PHASE 3 CUTOVER READINESS");
    console.log("\nMongo");
    console.log(`Topology: ${report.mongo.topology}`);
    console.log(`Transaction capable: ${report.mongo.transactionCapable ? "YES" : "NO"}`);
    console.log("\nSelection index");
    console.log(`Expected index: ${report.selectionIndex.status}`);
    console.log(`Duplicates: ${report.selectionIndex.duplicateCount}`);
    console.log("\nRaw authority counts");
    console.log(JSON.stringify(report.rawCounts));
    console.log("\nPublic package coverage");
    for (const market of MARKETS) console.log(`${market}: ${JSON.stringify(report.coverage.summary[market] || {})}`);
    console.log("\nLegacy vs explicit");
    console.log(JSON.stringify(report.routeComparison.summary));
    console.log("\nPricing provenance");
    console.log(JSON.stringify(report.pricing.summary));
    console.log("\nExisting orders");
    console.log(JSON.stringify(report.orders.counts));
}

function buildReport({ hello, selectionIndex, rawCounts, coverageRows, orders }) {
    return {
        result: "AUDIT_COMPLETED",
        mode: "READ_ONLY",
        generatedAt: new Date().toISOString(),
        mongo: topologyProjection(hello),
        selectionIndex,
        rawCounts,
        coverage: { summary: Object.fromEntries(MARKETS.map(market => [market, countBy(coverageRows.filter(row => row.customerMarket === market), "selectionStatus")])), rows: coverageRows },
        routeComparison: { summary: countBy(coverageRows, "routeComparison"), rows: coverageRows.map(row => ({ productCode: row.productCode, packageCode: row.packageCode, customerMarket: row.customerMarket, legacyMappingId: row.legacyMappingId, legacySupplierCode: row.legacySupplierCode, explicitMappingId: row.selectionMappingId, explicitSupplierCode: row.selectedSupplierCode, classification: row.routeComparison })) },
        pricing: { summary: countBy(coverageRows, "priceComparison"), rows: coverageRows.map(row => ({ productCode: row.productCode, packageCode: row.packageCode, customerMarket: row.customerMarket, selectedSupplierCode: row.selectedSupplierCode, classification: row.priceComparison, customerPrice: row.customerPrice, marginAssessment: row.marginAssessment })) },
        orders,
        safety: { writes: 0, selectionsCreated: 0, indexesChanged: 0, pricesChanged: 0, publicationsChanged: 0, ordersChanged: 0, mappingsChanged: 0, fulfillmentAttemptsCreated: 0, supplierRequests: 0, paymentRequests: 0 }
    };
}

async function executeAuditStages({ connect, disconnect, hello, selectionIndex, rawCounts, loadPublicCatalog, publicMarket, orders, logger = console.log, timeoutMs = stageTimeoutMs(), printReport = printHuman }) {
    logger("[1/11] Starting read-only cutover audit");
    const stage = createStageRunner({ logger, timeoutMs, total: 11, start: 2 });
    let primaryError = null;
    try {
        await stage("Connecting to MongoDB", connect);
        const helloResult = await stage("Reading MongoDB topology", hello);
        const indexResult = await stage("Inspecting selection index", selectionIndex);
        const rawResult = await stage("Reading raw authority counts", rawCounts);
        const thCatalog = await stage("Building TH storefront projection", () => loadPublicCatalog("TH"));
        const thRows = await stage("Auditing TH supplier and routing coverage", () => publicMarket("TH", thCatalog, { logger }));
        const mmCatalog = await stage("Building MM storefront projection", () => loadPublicCatalog("MM"));
        const mmRows = await stage("Auditing MM supplier and routing coverage", () => publicMarket("MM", mmCatalog, { logger }));
        const orderResult = await stage("Auditing frozen orders", orders);
        const report = buildReport({ hello: helloResult, selectionIndex: indexResult, rawCounts: rawResult, coverageRows: [...thRows, ...mmRows], orders: orderResult });
        await stage("Rendering audit report", async () => printReport(report));
        return report;
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        logger("[cleanup] Disconnecting from MongoDB...");
        try {
            await withStageTimeout("Disconnecting from MongoDB", disconnect, timeoutMs);
            logger("[cleanup] MongoDB disconnected");
        } catch (disconnectError) {
            logger(`[cleanup] MongoDB disconnect failed: ${disconnectError.code || disconnectError.name}`);
            if (!primaryError) throw disconnectError;
        }
    }
}

async function run(options = {}) {
    assertReadOnlyStartup();
    installReadOnlyMongooseGuard();
    installExternalNetworkGuard();
    mongoose.set("autoIndex", false);
    mongoose.set("autoCreate", false);
    assert(process.env.MONGO_URI, "MONGO_URI is required.");
    return executeAuditStages({
        connect: () => mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, readPreference: "secondaryPreferred", serverSelectionTimeoutMS: Math.min(Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000), stageTimeoutMs()) }),
        disconnect: () => mongoose.disconnect(),
        hello: () => mongoose.connection.db.admin().command({ hello: 1 }),
        selectionIndex: inspectSelectionIndex,
        rawCounts: auditRawCounts,
        loadPublicCatalog: loadPublicMarketCatalog,
        publicMarket: auditPublicMarket,
        orders: auditOrders,
        logger: options.logger || console.log,
        timeoutMs: options.timeoutMs || stageTimeoutMs(),
        printReport: report => {
            printHuman(report);
            console.log("\nDETAILS_JSON");
            console.log(JSON.stringify(report, null, 2));
        }
    });
}

if (require.main === module) run().catch(error => {
    console.error(JSON.stringify({ result: "AUDIT_FAILED", mode: "READ_ONLY", code: error.code || error.name, stage: error.stage || "", timeoutMs: error.timeoutMs || null, message: error.message }, null, 2));
    process.exitCode = 1;
});

module.exports = { assertReadOnlyStartup, auditConcurrency, auditOrders, auditPublicMarket, auditPublicPackages, auditRawCounts, buildReport, coverageClassification, createStageRunner, executeAuditStages, frozenExecutionBlockers, installExternalNetworkGuard, installReadOnlyMongooseGuard, loadPublicMarketCatalog, mapWithConcurrency, preloadMarketAuthorities, priceComparison, routeComparison, run, stageTimeoutMs, topologyProjection, withStageTimeout };
