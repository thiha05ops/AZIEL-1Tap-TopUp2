"use strict";

const crypto = require("crypto");
const { WONDD_FAMILIES, familyForServiceId, resolveWonddCatalogIdentity } = require("../../suppliers/wonddCatalogConfig");
const { sanitizeSupplierCatalogSnapshot, hashSupplierCatalogSnapshot, normalizeSupplierCost, normalizeOfferSemantics, observationTimestamps, canonicalJson } = require("../supplierCatalogNormalization");
const { normalizedFields } = require("../../suppliers/fazercardsFulfillmentContractService");

const NAMESPACE = "WONDD_PACKAGE_CATALOG";
const COMPLETENESS_EVIDENCE = "SINGLE_RESPONSE_COMPLETENESS_UNPROVEN";
const clean = value => String(value == null ? "" : value).trim();
class WonddCatalogIngestionError extends Error { constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; } }

function createCatalogReader(adapter) {
    return Object.freeze({ listPackages: options => adapter.getPackageCatalog(options) });
}

function inputContract(family) {
    if (family?.inputContract === "MLBB_USER_ZONE") return { contractId: family.inputContract, fields: [{ name: "userId", label: "User ID", providerField: "gameid", required: true, type: "numeric-text", transformationId: "JOIN_WITH_SPACE" }, { name: "zoneId", label: "Zone ID", providerField: "gameid", required: true, type: "numeric-text", transformationId: "JOIN_WITH_SPACE" }] };
    if (family?.inputContract === "FREEFIRE_PLAYER_ID") return { contractId: family.inputContract, fields: [{ name: "userId", label: "Player ID", providerField: "gameid", required: true, type: "text", transformationId: "DIRECT" }] };
    return {};
}

function supplierInputContract(row = {}, transactionalServiceCode = "") {
    const source = row.inputSchema;
    const rows = Array.isArray(source) ? source : Array.isArray(source?.fields) ? source.fields : [];
    const fields = normalizedFields({ normalizedInputContract: { fields: rows.map(field => ({
        customerField: field.customerField || field.customer_field || field.azielField,
        providerField: field.providerField || field.provider_field || field.destination || field.parameter || field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        options: field.options,
        constraints: field.constraints,
        transformationId: field.transformationId || field.transformation_id || "DIRECT"
    })) } });
    if (!fields.length && row.noCustomerInput !== true) return null;
    return { version: 1, protocol: "WONDD_GAME_ID_TOPUP", transactionalServiceCode: clean(transactionalServiceCode), fields, noCustomerInput: row.noCustomerInput === true, authority: "WONDD_PACKAGE_CATALOG_INPUT_SCHEMA" };
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
    return new Set(mappings.filter(x => x.supplierCode === "WONDD" && clean(x.supplierProductCode) && clean(x.supplierPackageCode))
        .map(x => { const legacy=resolveWonddCatalogIdentity(x.supplierProductCode); return `${legacy?.serviceId||clean(x.supplierProductCode)}/${clean(x.supplierPackageCode)}`; }));
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
        const family = familyForServiceId(serviceId);
        const observedServiceCodes = [...new Set(familyRows.map(row => clean(row.servicecode)).filter(Boolean))];
        const observedServiceCode = observedServiceCodes.length === 1 ? observedServiceCodes[0] : "";
        const transactionalServiceCode = observedServiceCode || family?.serviceCode || "";
        const discoveredContracts = familyRows.map(row => supplierInputContract(row, observedServiceCode)).filter(Boolean), contractKeys = [...new Set(discoveredContracts.map(canonicalJson))];
        const automaticContract = discoveredContracts.length === familyRows.length && contractKeys.length === 1 ? discoveredContracts[0] : null;
        const normalizedInputContract = automaticContract || {};
        const safe = sanitizeSupplierCatalogSnapshot({ serviceid: serviceId, transactionalServiceCode, inputSchema: automaticContract || null, packageCount: familyRows.length, providerFields: [...new Set(familyRows.flatMap(Object.keys))].sort() });
        return { supplierId, catalogNamespace: NAMESPACE, supplierProductCode: serviceId, supplierMarketCode: "UNSPECIFIED", displayName: family?.game || `WonDD service ${serviceId}`, rawName: family?.game || "", categoryCode: serviceId, supportState: "SUPPORTED", requiredFields: normalizedInputContract.fields || [], normalizedInputContract, restrictions: [], metadata: { transactionalServiceCode, canonicalProductCode: family?.productCode || "", serviceCodeAuthority: observedServiceCode ? "WONDD_SUPPLIER_CATALOG" : family?.serviceCode ? "WONDD_CATALOG_CONFIG_LEGACY" : observedServiceCodes.length > 1 ? "CONFLICTING_SUPPLIER_VALUES" : "UNRESOLVED", inputContractState: automaticContract ? "AUTO_CONTRACT" : contractKeys.length > 1 ? "CONFLICTING_SUPPLIER_SCHEMAS" : "SUPPLIER_METADATA_INSUFFICIENT", snapshotTruncation: safe.truncation }, ...observationTimestamps({}, observedAt, { changed: true }), sourceRevision: "", rawSnapshotHash: hashSupplierCatalogSnapshot(safe.snapshot), rawSnapshot: safe.snapshot };
    });
    const offers = valid.map(row => {
        const family = familyForServiceId(row.serviceid), exact = Boolean(family?.serviceCode && mapped.has(`${row.serviceid}/${row.packcode}`)), safe = sanitizeSupplierCatalogSnapshot(row);
        const automaticContract = supplierInputContract(row, clean(row.servicecode)), productContracts = grouped.get(row.serviceid).map(item => supplierInputContract(item, clean(item.servicecode))).filter(Boolean), productContractKeys = [...new Set(productContracts.map(canonicalJson))];
        const offerOverride = automaticContract && (productContracts.length !== grouped.get(row.serviceid).length || productContractKeys.length !== 1) ? automaticContract : null;
        return { supplierId, catalogNamespace: NAMESPACE, supplierProductCode: row.serviceid, supplierOfferCode: row.packcode, supplierOfferName: row.name, rawName: row.name, supplierCost: normalizeSupplierCost({ amount: row.netpricedealer, currency: "THB", observedAt }), rawSemantics: { providerName: row.name, point: row.point ?? null, amount: row.amount ?? null, discount: row.discount ?? null }, normalizedSemantics: semantics(row), catalogLifecycleState: "ACTIVE", reconciliationState: classify(row, family, exact), reconciliationEvidence: exact ? { code: "EXACT_CONFIRMED_SERVICECODE_PACKCODE" } : { code: "NO_IDENTITY_INFERENCE" }, ...observationTimestamps({}, observedAt, { changed: true }), sourceRevision: "", rawSnapshotHash: hashSupplierCatalogSnapshot(safe.snapshot), rawSnapshot: safe.snapshot, metadata: { ...(offerOverride ? { normalizedInputContract: offerOverride } : {}), snapshotTruncation: safe.truncation }, availability: { state: "AVAILABLE", evidenceCode: "WONDD_PACKAGE_LISTED", observedAt, coverageComplete: false } };
    });
    const contentRevision = meaningfulRevision(products, offers);
    return { supplierId, catalogNamespace: NAMESPACE, observedAt, rowsObserved: rows.length, validRows: valid.length, coverageState: "PARTIAL", completenessEvidence: payload?.completenessEvidence || COMPLETENESS_EVIDENCE, products, offers, errors, contentRevision };
}

function planMutations(stage, existing = {}) {
    const productByKey = new Map((existing.products || []).map(x => [x.supplierProductCode, x])), offerByKey = new Map((existing.offers || []).map(x => [`${x.supplierProductCode}/${x.supplierOfferCode}`, x]));
    const products = stage.products.map(x => { const old = productByKey.get(x.supplierProductCode), changed = !old || old.rawSnapshotHash !== x.rawSnapshotHash, reviewed = old?.normalizedInputContract?.review?.status === "OWNER_REVIEWED" && !changed; return { ...x, ...(reviewed ? { requiredFields: old.requiredFields || [], normalizedInputContract: old.normalizedInputContract } : {}), ...observationTimestamps(old || {}, stage.observedAt, { changed }), operation: old ? "UPDATE" : "CREATE" }; });
    const offers = stage.offers.map(x => { const old = offerByKey.get(`${x.supplierProductCode}/${x.supplierOfferCode}`), changed = !old || old.rawSnapshotHash !== x.rawSnapshotHash, reviewed = old?.metadata?.normalizedInputContract?.review?.status === "OWNER_REVIEWED" && !changed; return { ...x, ...(reviewed ? { metadata: { ...(x.metadata || {}), normalizedInputContract: old.metadata.normalizedInputContract } } : {}), reconciliationState: old?.reconciliationState || x.reconciliationState, ...observationTimestamps(old || {}, stage.observedAt, { changed }), operation: old ? "UPDATE" : "CREATE" }; });
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

module.exports = Object.freeze({ NAMESPACE, COMPLETENESS_EVIDENCE, WonddCatalogIngestionError, createCatalogReader, inputContract, supplierInputContract, semantics, classify, meaningfulRevision, stageCatalog, planMutations, applyCatalogOnlyPlan, WONDD_FAMILIES });
