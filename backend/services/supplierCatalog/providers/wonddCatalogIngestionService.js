"use strict";

const crypto = require("crypto");
const { WONDD_FAMILIES, familyForServiceId } = require("../../suppliers/wonddCatalogConfig");
const { sanitizeSupplierCatalogSnapshot, hashSupplierCatalogSnapshot, normalizeSupplierCost, normalizeOfferSemantics, observationTimestamps, canonicalJson } = require("../supplierCatalogNormalization");

const NAMESPACE = "WONDD_PACKAGE_CATALOG";
const COMPLETENESS_EVIDENCE = "SINGLE_RESPONSE_COMPLETENESS_UNPROVEN";
const clean = value => String(value == null ? "" : value).trim();
class WonddCatalogIngestionError extends Error { constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; } }

function createCatalogReader(adapter) {
    return Object.freeze({ listPackages: options => adapter.getPackageCatalog(options) });
}

function inputContract(family) {
    if (family?.inputContract === "MLBB_USER_ZONE") return { contractId: family.inputContract, fields: [{ name: "userId", required: true }, { name: "zoneId", required: true }] };
    if (family?.inputContract === "FREEFIRE_PLAYER_ID") return { contractId: family.inputContract, fields: [{ name: "userId", required: true }] };
    return {};
}

function semantics(row = {}) {
    const name = clean(row.name);
    const numeric = name.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:diamonds?|tokens?|points?|uc|vp)?/i);
    const result = numeric ? { baseAmount: Number(numeric[1]) } : {};
    if (/gift\s*box/i.test(name)) result.membershipType = "GIFT_BOX";
    if (/association/i.test(name)) result.passType = "ASSOCIATION_PACK";
    if (/pass|weekly|monthly|membership/i.test(name)) result.passType ||= "SPECIAL_PASS";
    return normalizeOfferSemantics(result);
}

function mappingIdentitySet(mappings = []) {
    return new Set(mappings.filter(x => x.supplierCode === "WONDD").map(x => `${clean(x.supplierProductCode).toLowerCase()}/${clean(x.supplierPackageCode)}`));
}

function classify(row, family, mapped) {
    if (mapped) return "EXACT_CANONICAL_MATCH";
    if (!family?.serviceCode || family.unsupportedReason) return "NO_CANONICAL_PACKAGE";
    if (String(row.serviceid) === "9624" && typeof family.packageFilter === "function" && !family.packageFilter(row)) return "SPECIAL_VARIANT";
    if (/gift\s*box|association|event|pass|membership|bundle/i.test(clean(row.name))) return "SPECIAL_VARIANT";
    return "SEMANTIC_REVIEW_REQUIRED";
}

function meaningfulRevision(products, offers) {
    const stableProducts = products.map(x => ({ supplierProductCode: x.supplierProductCode, supplierMarketCode: x.supplierMarketCode, displayName: x.displayName, supportState: x.supportState, normalizedInputContract: x.normalizedInputContract, metadata: x.metadata, rawSnapshotHash: x.rawSnapshotHash })).sort((a, b) => a.supplierProductCode.localeCompare(b.supplierProductCode));
    const stableOffers = offers.map(x => ({ supplierProductCode: x.supplierProductCode, supplierOfferCode: x.supplierOfferCode, supplierOfferName: x.supplierOfferName, supplierCost: x.supplierCost ? { amount: x.supplierCost.amount, currency: x.supplierCost.currency } : null, normalizedSemantics: x.normalizedSemantics, reconciliationState: x.reconciliationState, rawSnapshotHash: x.rawSnapshotHash, availability: { state: x.availability.state, evidenceCode: x.availability.evidenceCode, coverageComplete: x.availability.coverageComplete } })).sort((a, b) => `${a.supplierProductCode}/${a.supplierOfferCode}`.localeCompare(`${b.supplierProductCode}/${b.supplierOfferCode}`));
    return crypto.createHash("sha256").update(canonicalJson({ namespace: NAMESPACE, products: stableProducts, offers: stableOffers })).digest("hex");
}

async function stageCatalog({ reader, supplierId, mappings = [], observedAt = new Date(), signal }) {
    let payload;
    try { payload = await reader.listPackages({ signal }); }
    catch (error) { return { supplierId, catalogNamespace: NAMESPACE, observedAt, coverageState: "PARTIAL", completenessEvidence: COMPLETENESS_EVIDENCE, rowsObserved: 0, products: [], offers: [], errors: [{ code: error.code || "PROVIDER_HTTP_ERROR", message: error.message }], contentRevision: meaningfulRevision([], []) }; }
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const errors = [], valid = [], identities = new Set();
    rows.forEach((row, index) => {
        const serviceId = clean(row?.serviceid), packCode = clean(row?.packcode), name = clean(row?.name), cost = Number(row?.netpricedealer);
        if (!serviceId || !packCode || !name || !Number.isFinite(cost) || cost < 0) { errors.push({ code: "MALFORMED_OFFER", index, serviceid: serviceId, packcode: packCode }); return; }
        const key = `${serviceId}/${packCode}`;
        if (identities.has(key)) { errors.push({ code: "DUPLICATE_PROVIDER_IDENTITY", identity: key }); return; }
        identities.add(key); valid.push({ ...row, serviceid: serviceId, packcode: packCode, name, netpricedealer: cost });
    });
    const mapped = mappingIdentitySet(mappings), grouped = new Map();
    valid.forEach(row => { if (!grouped.has(row.serviceid)) grouped.set(row.serviceid, []); grouped.get(row.serviceid).push(row); });
    const products = [...grouped].map(([serviceId, familyRows]) => {
        const family = familyForServiceId(serviceId), safe = sanitizeSupplierCatalogSnapshot({ serviceid: serviceId, packageCount: familyRows.length, providerFields: [...new Set(familyRows.flatMap(Object.keys))].sort() });
        return { supplierId, catalogNamespace: NAMESPACE, supplierProductCode: serviceId, supplierMarketCode: "UNSPECIFIED", displayName: family?.game || `WonDD service ${serviceId}`, rawName: family?.game || "", categoryCode: serviceId, supportState: family ? "SUPPORTED" : "REVIEW_REQUIRED", requiredFields: inputContract(family).fields || [], normalizedInputContract: inputContract(family), restrictions: [], metadata: { transactionalServiceCode: family?.serviceCode || "", canonicalProductCode: family?.productCode || "", serviceCodeAuthority: family?.serviceCode ? "WONDD_CATALOG_CONFIG" : "UNRESOLVED", snapshotTruncation: safe.truncation }, ...observationTimestamps({}, observedAt, { changed: true }), sourceRevision: "", rawSnapshotHash: hashSupplierCatalogSnapshot(safe.snapshot), rawSnapshot: safe.snapshot };
    });
    const offers = valid.map(row => {
        const family = familyForServiceId(row.serviceid), exact = Boolean(family?.serviceCode && mapped.has(`${family.serviceCode.toLowerCase()}/${row.packcode}`)), safe = sanitizeSupplierCatalogSnapshot(row);
        return { supplierId, catalogNamespace: NAMESPACE, supplierProductCode: row.serviceid, supplierOfferCode: row.packcode, supplierOfferName: row.name, rawName: row.name, supplierCost: normalizeSupplierCost({ amount: row.netpricedealer, currency: "THB", observedAt }), rawSemantics: { providerName: row.name, point: row.point ?? null, amount: row.amount ?? null, discount: row.discount ?? null }, normalizedSemantics: semantics(row), catalogLifecycleState: "ACTIVE", reconciliationState: classify(row, family, exact), reconciliationEvidence: exact ? { code: "EXACT_CONFIRMED_SERVICECODE_PACKCODE" } : { code: "NO_NUMERIC_INFERENCE" }, ...observationTimestamps({}, observedAt, { changed: true }), sourceRevision: "", rawSnapshotHash: hashSupplierCatalogSnapshot(safe.snapshot), rawSnapshot: safe.snapshot, metadata: { snapshotTruncation: safe.truncation }, availability: { state: "AVAILABLE", evidenceCode: "WONDD_PACKAGE_LISTED", observedAt, coverageComplete: false } };
    });
    const contentRevision = meaningfulRevision(products, offers);
    return { supplierId, catalogNamespace: NAMESPACE, observedAt, rowsObserved: rows.length, validRows: valid.length, coverageState: "PARTIAL", completenessEvidence: payload?.completenessEvidence || COMPLETENESS_EVIDENCE, products, offers, errors, contentRevision };
}

function planMutations(stage, existing = {}) {
    const productByKey = new Map((existing.products || []).map(x => [x.supplierProductCode, x])), offerByKey = new Map((existing.offers || []).map(x => [`${x.supplierProductCode}/${x.supplierOfferCode}`, x]));
    const products = stage.products.map(x => { const old = productByKey.get(x.supplierProductCode), changed = !old || old.rawSnapshotHash !== x.rawSnapshotHash; return { ...x, ...observationTimestamps(old || {}, stage.observedAt, { changed }), operation: old ? "UPDATE" : "CREATE" }; });
    const offers = stage.offers.map(x => { const old = offerByKey.get(`${x.supplierProductCode}/${x.supplierOfferCode}`), changed = !old || old.rawSnapshotHash !== x.rawSnapshotHash; return { ...x, reconciliationState: old?.reconciliationState || x.reconciliationState, ...observationTimestamps(old || {}, stage.observedAt, { changed }), operation: old ? "UPDATE" : "CREATE" }; });
    const exact = offers.filter(x => x.reconciliationState === "EXACT_CANONICAL_MATCH").length;
    return { supplierId: stage.supplierId, catalogNamespace: NAMESPACE, observedAt: stage.observedAt, contentRevision: stage.contentRevision, products, offers, missing: [], mappingCoverage: { exactCanonicalMatch: exact, unmapped: offers.length - exact }, runStatus: stage.products.length || stage.offers.length ? "SUCCEEDED_PARTIAL" : "FAILED", coverageState: "PARTIAL", completenessEvidence: stage.completenessEvidence, errors: stage.errors, categoryResults: [{ category: "WONDD_PACKAGE_LIST", complete: false, pages: 1, offersObserved: stage.offers.length, evidence: stage.completenessEvidence }] };
}

async function applyCatalogOnlyPlan(plan, repositories, { runKey } = {}) {
    const run = await repositories.runs.start({ supplierId: plan.supplierId, catalogNamespace: NAMESPACE, runKey, status: "RUNNING", coverageState: "UNKNOWN", startedAt: plan.observedAt, sourceRevision: plan.contentRevision });
    const ids = new Map();
    for (const product of plan.products) { const saved = await repositories.products.upsert(product); ids.set(product.supplierProductCode, saved._id); }
    for (const offer of plan.offers) { const saved = await repositories.offers.upsert({ ...offer, supplierCatalogProductId: ids.get(offer.supplierProductCode) }); await repositories.availability.upsert({ ...offer.availability, supplierCatalogOfferId: saved._id, observationRunId: run._id }); if (repositories.observations?.append) await repositories.observations.append({ offer: saved, ingestionRunId: run._id }); }
    return repositories.runs.finalize(run._id, plan);
}

module.exports = Object.freeze({ NAMESPACE, COMPLETENESS_EVIDENCE, WonddCatalogIngestionError, createCatalogReader, inputContract, semantics, classify, meaningfulRevision, stageCatalog, planMutations, applyCatalogOnlyPlan, WONDD_FAMILIES });
