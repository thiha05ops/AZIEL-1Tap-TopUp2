#!/usr/bin/env node
"use strict";

const path = require("path");
const mongoose = require("mongoose");
const { validateFulfillmentEligibility, normalizeFulfillmentEligibility, isCustomerMarketEligible } = require("../services/supplierFulfillmentEligibilityService");
const { PILOT_IDENTITY } = require("../config/mmWonddMlbbPilot");
const { findPublishedVersionForPackage } = require("../services/commerce/productionPricingContextService");

const SUPPLIERS = new Set(["WONDD", "FAZERCARDS"]);
const OPERATOR_WONDD_PRODUCTS = new Set(["mlbb", "freefire", "freefire-pass-membership", "mlbb-twilight-weekly-pass"]);
const OPERATOR_EVIDENCE_SOURCE = "AZIEL operator routing decision: this exact active WonDD supplier mapping is approved for customer markets MM and TH based on operational supplier capability knowledge; supplier request semantics remain unchanged.";
const text = value => String(value == null ? "" : value).trim();
const upper = value => text(value).toUpperCase();
const lower = value => text(value).toLowerCase();
const id = value => text(value?._id || value);
const key = mapping => `${upper(mapping.supplierCode)}|${lower(mapping.productCode)}|${upper(mapping.packageCode)}`;
const stable = value => JSON.stringify(value, Object.keys(value || {}).sort());

function parseArgs(argv = process.argv.slice(2)) {
    const options = { apply: false, supplier: "", product: "", verifiedAt: null };
    for (const argument of argv) {
        if (argument === "--apply") options.apply = true;
        else if (argument.startsWith("--supplier=")) options.supplier = upper(argument.slice(11));
        else if (argument.startsWith("--product=")) options.product = lower(argument.slice(10));
        else if (argument.startsWith("--verified-at=")) options.verifiedAt = new Date(argument.slice(14));
        else throw Object.assign(new Error(`Unknown argument: ${argument}`), { code: "UNKNOWN_ARGUMENT" });
    }
    if (options.supplier && !SUPPLIERS.has(options.supplier)) throw Object.assign(new Error("Supplier scope is unsupported."), { code: "SCOPE_SUPPLIER_UNSUPPORTED" });
    if (options.verifiedAt && !Number.isFinite(options.verifiedAt.getTime())) throw Object.assign(new Error("--verified-at must be a valid date."), { code: "VERIFIED_AT_INVALID" });
    return options;
}

function evidenceCandidates(mapping) {
    const metadata = mapping.mappingMetadata || {};
    return [metadata.customerMarketEligibilityEvidence, metadata.fulfillmentEligibilityEvidence, metadata.regionEvidence]
        .filter(item => item && typeof item === "object" && !Array.isArray(item));
}

function explicitEvidence(mapping) {
    const candidates = evidenceCandidates(mapping).map(evidence => {
        const source = text(evidence.evidenceSource || evidence.source || evidence.authority || evidence.note);
        const confirmed = evidence.providerConfirmed === true || evidence.regionLocked === true;
        const global = evidence.globalCustomerMarketEligibility === true || upper(evidence.marketScope) === "GLOBAL";
        const markets = [...new Set([...(evidence.allowedCustomerMarkets || []), ...(evidence.supportedCustomerMarkets || []), evidence.customerMarket, evidence.providerRegion]
            .map(upper).filter(market => ["MM", "TH"].includes(market)))].sort();
        if (evidence.regionLocked === true && markets.length === 0 && ["MM", "TH"].includes(upper(mapping.region))) markets.push(upper(mapping.region));
        if (!confirmed || !source || (!global && markets.length === 0)) return null;
        return { global, markets, source };
    }).filter(Boolean);
    const signatures = [...new Set(candidates.map(item => `${item.global}|${item.markets.join(",")}`))];
    if (signatures.length > 1) return { ambiguous: true };
    return candidates[0] || null;
}

function isPilot(mapping) {
    return upper(mapping.supplierCode) === PILOT_IDENTITY.supplierCode && lower(mapping.productCode) === PILOT_IDENTITY.productCode &&
        upper(mapping.packageCode) === PILOT_IDENTITY.packageCode && lower(mapping.supplierProductCode) === PILOT_IDENTITY.supplierProductCode &&
        upper(mapping.supplierPackageCode) === PILOT_IDENTITY.supplierPackageCode;
}

function classify(mapping, context = {}) {
    const problems = [];
    if (!SUPPLIERS.has(upper(mapping.supplierCode))) problems.push("UNSUPPORTED_SUPPLIER");
    if (!text(mapping.supplierProductCode)) problems.push("PROVIDER_PRODUCT_ID_MISSING");
    if (!text(mapping.supplierPackageCode)) problems.push("PROVIDER_PACKAGE_ID_MISSING");
    if (!context.canonical) problems.push("CANONICAL_PACKAGE_MISMATCH");
    if (context.duplicatePrimary) problems.push("DUPLICATE_ACTIVE_PRIMARY");
    const eligibility = validateFulfillmentEligibility(mapping.fulfillmentEligibility);
    if (!eligibility.valid) problems.push(...eligibility.errors);
    const explicit = explicitEvidence(mapping);
    if (explicit?.ambiguous) problems.push("AMBIGUOUS_PROVIDER_EVIDENCE");
    if (problems.length) return { bucket: "INVALID_MAPPING", problems: [...new Set(problems)].sort(), proposed: null, evidence: null };

    const current = eligibility.value;
    if (explicit?.global || (current.mode === "GLOBAL" && current.evidenceCode === "PROVIDER_CONFIRMED")) {
        const source = explicit?.source || current.evidenceSource;
        if (!source) return { bucket: "UNKNOWN", problems: ["PROVIDER_EVIDENCE_SOURCE_MISSING"], proposed: null, evidence: null };
        return { bucket: "GLOBAL", problems: [], evidence: source, proposed: { mode: "GLOBAL", allowedCustomerMarkets: [], evidenceCode: "PROVIDER_CONFIRMED", evidenceSource: source, verifiedAt: context.verifiedAt, version: 1 } };
    }
    const markets = explicit?.markets || current.allowedCustomerMarkets;
    const code = explicit ? "PROVIDER_CONFIRMED" : current.evidenceCode;
    const source = explicit?.source || current.evidenceSource;
    if (markets.includes("MM") && (["PROVIDER_CONFIRMED", "OPERATOR_CONFIRMED_CAPABILITY"].includes(code) || (code === "CONTROLLED_TEST" && isPilot(mapping)))) {
        const allowed = [...new Set(markets)].sort();
        return { bucket: "VERIFIED_MM", problems: [], evidence: source, proposed: { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: allowed, evidenceCode: code, evidenceSource: source, verifiedAt: context.verifiedAt, version: 1 } };
    }
    if (markets.includes("TH") && code === "PROVIDER_CONFIRMED") return { bucket: "TH_ONLY", problems: [], evidence: source, proposed: null };
    return { bucket: "UNKNOWN", problems: [], evidence: source, proposed: null };
}

function operatorManagedEligibility(mapping, classified, verifiedAt) {
    if (upper(mapping.supplierCode) !== "WONDD" || !OPERATOR_WONDD_PRODUCTS.has(lower(mapping.productCode)) || isPilot(mapping)) return classified;
    if (classified.bucket !== "UNKNOWN") return classified;
    return {
        bucket: "VERIFIED_MM",
        problems: [],
        evidence: OPERATOR_EVIDENCE_SOURCE,
        proposed: {
            mode: "CUSTOMER_MARKET_ALLOWLIST",
            allowedCustomerMarkets: ["MM", "TH"],
            evidenceCode: "OPERATOR_CONFIRMED_CAPABILITY",
            evidenceSource: OPERATOR_EVIDENCE_SOURCE,
            verifiedAt: new Date(verifiedAt),
            version: 1
        }
    };
}

function costFresh(mapping, now) {
    const cost = Number(mapping.supplierCostAuthority?.rawSupplierCost);
    const captured = new Date(mapping.supplierCostAuthority?.capturedAt || 0);
    const maxAge = Number(mapping.mappingMetadata?.costAuthorityMaximumAgeSeconds || 86400);
    return Number.isFinite(cost) && cost >= 0 && Number.isFinite(captured.getTime()) && now.getTime() - captured.getTime() <= maxAge * 1000;
}

function pricingReadiness(mapping, pkg, policies, versions, now) {
    const price = pkg?.prices?.MM;
    const policy = policies.find(item => upper(item.region) === "MM" && upper(item.currency) === "MMK" && item.status === "ACTIVE" && (!item.effectiveFrom || new Date(item.effectiveFrom) <= now) && (!item.effectiveUntil || new Date(item.effectiveUntil) > now));
    const version = policy && findPublishedVersionForPackage({ versions, policy, pkg });
    const validMmk = price?.enabled === true && upper(price.currency) === "MMK" && Number.isFinite(Number(price.amount)) && Number(price.amount) > 0;
    const fxRequired = upper(mapping.supplierCostAuthority?.supplierCurrency) !== "MMK";
    const fxReady = !fxRequired || Boolean(Number(price?.fxRate) > 0 && text(price?.fxRateSource));
    return { mmPricingPolicy: Boolean(policy), publishedPriceVersion: Boolean(version), validMmkSellingPrice: validMmk, freshSupplierCost: costFresh(mapping, now), fxContext: fxReady };
}

function sameEligibility(current, proposed) {
    const a = normalizeFulfillmentEligibility(current); const b = normalizeFulfillmentEligibility(proposed);
    return a.mode === b.mode && a.evidenceCode === b.evidenceCode && a.evidenceSource === b.evidenceSource && a.version === b.version && a.allowedCustomerMarkets.join("|") === b.allowedCustomerMarkets.join("|");
}

function buildPlan({ mappings = [], packages = [], suppliers = [], policies = [], versions = [], options = {}, now = new Date() }) {
    const verifiedAt = options.verifiedAt || now;
    const canonicalByKey = new Map(packages.map(pkg => [`${lower(pkg.productCode)}|${upper(pkg.packageCode)}`, pkg]));
    const primaryCounts = new Map();
    mappings.filter(item => item.productionRole === "PRIMARY" && item.enabled === true && !item.archivedAt).forEach(item => primaryCounts.set(key(item), (primaryCounts.get(key(item)) || 0) + 1));
    const selected = mappings.filter(item => !item.archivedAt && item.enabled === true && upper(item.supplierCode) !== "SEAGM" && SUPPLIERS.has(upper(item.supplierCode)) && (!options.supplier || upper(item.supplierCode) === options.supplier) && (!options.product || lower(item.productCode) === options.product));
    if ((options.supplier || options.product) && selected.length === 0) throw Object.assign(new Error("Requested scope selected zero active mappings."), { code: "SCOPE_NOT_FOUND" });
    const supplierById = new Map(suppliers.map(item => [id(item), item]));
    const inventory = selected.map(mapping => {
        const pkg = canonicalByKey.get(`${lower(mapping.productCode)}|${upper(mapping.packageCode)}`);
        const result = operatorManagedEligibility(mapping, classify(mapping, { canonical: pkg, duplicatePrimary: primaryCounts.get(key(mapping)) > 1, verifiedAt: new Date(verifiedAt) }), verifiedAt);
        const readiness = pricingReadiness(mapping, pkg, policies, versions, now);
        const supplier = supplierById.get(id(mapping.supplierId));
        const apiReady = mapping.enabled === true && upper(mapping.executionMode) === "API" && mapping.mappingMetadata?.readiness?.supplierMapped === true && mapping.mappingMetadata?.readiness?.inputReady === true && mapping.mappingMetadata?.readiness?.fulfillmentReady === true && supplier?.enabled === true && upper(supplier?.mode) === "API";
        const proposal = result.proposed && !sameEligibility(mapping.fulfillmentEligibility, result.proposed) ? result.proposed : null;
        return {
            mappingId: id(mapping), productCode: lower(mapping.productCode), packageCode: upper(mapping.packageCode), supplier: upper(mapping.supplierCode),
            providerProductId: text(mapping.supplierProductCode), providerPackageId: text(mapping.supplierPackageCode), productionRole: mapping.productionRole,
            legacyRegion: mapping.region, eligibility: normalizeFulfillmentEligibility(mapping.fulfillmentEligibility), apiMappingReady: apiReady,
            supplierCostFresh: readiness.freshSupplierCost, publishedMmPricing: readiness.validMmkSellingPrice, exactCanonicalMatch: Boolean(pkg),
            mmSupplierSupportEvidenced: ["VERIFIED_MM", "GLOBAL"].includes(result.bucket), classification: result.bucket, blockers: result.problems,
            evidenceSource: result.evidence || normalizeFulfillmentEligibility(mapping.fulfillmentEligibility).evidenceSource, pricingReadiness: readiness,
            pricingClassification: ["VERIFIED_MM", "GLOBAL"].includes(result.bucket) ? (Object.values(readiness).every(Boolean) ? "ROUTE_AND_PRICE_READY" : "ELIGIBLE_BUT_PRICE_NOT_READY") : "NOT_ELIGIBLE",
            proposedEligibility: proposal,
            shadowVerification: proposal ? {
                MM: isCustomerMarketEligible(proposal, "MM") ? "ELIGIBLE" : "NO_ELIGIBLE_ROUTE",
                TH: isCustomerMarketEligible(proposal, "TH") ? "ELIGIBLE" : "NO_ELIGIBLE_ROUTE",
                mappingId: id(mapping), providerProductId: text(mapping.supplierProductCode), providerPackageId: text(mapping.supplierPackageCode)
            } : null
        };
    }).sort((a, b) => [a.supplier, a.productCode, a.packageCode, a.mappingId].join("|").localeCompare([b.supplier, b.productCode, b.packageCode, b.mappingId].join("|")));
    const proposed = inventory.filter(item => item.proposedEligibility);
    const invalidProposed = proposed.filter(item => item.blockers.length || !item.apiMappingReady);
    if (invalidProposed.length) throw Object.assign(new Error(`Proposed MM writes failed preflight: ${invalidProposed.map(item => item.mappingId).join(",")}`), { code: "PROPOSED_MM_PREFLIGHT_FAILED" });
    const count = bucket => inventory.filter(item => item.classification === bucket).length;
    const supplierTotals = Object.fromEntries([...SUPPLIERS].map(code => [code, inventory.filter(item => item.supplier === code).length]));
    const bySupplierProduct = Object.fromEntries([...new Set(inventory.map(item => `${item.supplier}/${item.productCode}`))].sort().map(group => {
        const rows = inventory.filter(item => `${item.supplier}/${item.productCode}` === group);
        return [group, { total: rows.length, VERIFIED_MM: rows.filter(item => item.classification === "VERIFIED_MM").length, GLOBAL: rows.filter(item => item.classification === "GLOBAL").length, TH_ONLY: rows.filter(item => item.classification === "TH_ONLY").length, UNKNOWN: rows.filter(item => item.classification === "UNKNOWN").length, INVALID_MAPPING: rows.filter(item => item.classification === "INVALID_MAPPING").length }];
    }));
    return { mode: options.apply ? "APPLY" : "DRY_RUN", authority: "OPERATOR_MANAGED_CUSTOMER_MARKET_ELIGIBILITY", regionalProductRule: "Create separate regional canonical product identities only when the supplier/product has an actual market restriction.", scope: { supplier: options.supplier || "ALL", product: options.product || "ALL" }, generatedAt: now.toISOString(), verifiedAt: new Date(verifiedAt).toISOString(), totals: { activeMappings: inventory.length, auditedWonddMappings: inventory.filter(item => item.supplier === "WONDD").length, existingPilotCount: inventory.filter(item => item.supplier === "WONDD" && item.providerPackageId === PILOT_IDENTITY.supplierPackageCode && !item.proposedEligibility).length, operatorConfirmedProposed: proposed.filter(item => item.proposedEligibility?.evidenceCode === "OPERATOR_CONFIRMED_CAPABILITY").length, skippedCount: inventory.filter(item => !item.proposedEligibility).length, suppliers: supplierTotals, bySupplierProduct, VERIFIED_MM: count("VERIFIED_MM"), GLOBAL: count("GLOBAL"), TH_ONLY: count("TH_ONLY"), UNKNOWN: count("UNKNOWN"), INVALID_MAPPING: count("INVALID_MAPPING"), proposedChanges: proposed.length, mmPricingReady: inventory.filter(item => item.pricingClassification === "ROUTE_AND_PRICE_READY").length, eligibleButPriceNotReady: inventory.filter(item => item.pricingClassification === "ELIGIBLE_BUT_PRICE_NOT_READY").length }, inventory, proposedChanges: proposed, intentionallyUnchanged: inventory.filter(item => !item.proposedEligibility), writes: 0, safety: { supplierCalls: 0, providerCalls: 0, paymentCalls: 0, orderCreations: 0, fulfillmentAttempts: 0, supplierPayloadChanges: 0 } };
}

function defensivePredicate(item) {
    return { _id: item.mappingId, supplierCode: item.supplier, productCode: item.productCode, packageCode: item.packageCode, supplierProductCode: item.providerProductId, supplierPackageCode: item.providerPackageId, enabled: true, archivedAt: null, productionRole: item.productionRole, fulfillmentEligibility: item.eligibility };
}

async function applyPlan(plan, { Mapping, connection }) {
    if (plan.mode !== "APPLY" || !plan.proposedChanges.length) return { writes: 0, matched: 0, modified: 0 };
    const session = await connection.startSession(); let result;
    try {
        await session.withTransaction(async () => {
            const operations = plan.proposedChanges.map(item => ({ updateOne: { filter: defensivePredicate(item), update: { $set: { fulfillmentEligibility: item.proposedEligibility } } } }));
            result = await Mapping.bulkWrite(operations, { session, ordered: true });
            if (result.matchedCount !== operations.length) throw Object.assign(new Error("Defensive apply predicates did not match every planned mapping."), { code: "DEFENSIVE_APPLY_MISMATCH" });
        });
    } finally { await session.endSession(); }
    return { writes: plan.proposedChanges.length, matched: result.matchedCount, modified: result.modifiedCount };
}

async function main() {
    const options = parseArgs();
    require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
    const uri = text(process.env.MONGO_URI || process.env.MONGODB_URI);
    if (!uri) throw Object.assign(new Error("MONGO_URI is required."), { code: "MONGO_URI_REQUIRED" });
    await mongoose.connect(uri, { autoIndex: false });
    const Mapping = require("../models/SupplierProductMapping"); const CatalogPackage = require("../models/CatalogPackage"); const Supplier = require("../models/Supplier"); const PricingPolicy = require("../models/PricingPolicy"); const PriceVersion = require("../models/PriceVersion");
    const [mappings, packages, suppliers, policies, versions] = await Promise.all([Mapping.find({}).lean(), CatalogPackage.find({ deletedAt: null }).lean(), Supplier.find({}).lean(), PricingPolicy.find({}).lean(), PriceVersion.find({}).lean()]);
    const plan = buildPlan({ mappings, packages, suppliers, policies, versions, options });
    const writeResult = await applyPlan(plan, { Mapping, connection: mongoose.connection }); plan.writes = writeResult;
    console.log(JSON.stringify(plan, null, 2)); await mongoose.disconnect();
}

if (require.main === module) main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; });
module.exports = Object.freeze({ SUPPLIERS, OPERATOR_WONDD_PRODUCTS, OPERATOR_EVIDENCE_SOURCE, parseArgs, explicitEvidence, classify, operatorManagedEligibility, pricingReadiness, buildPlan, defensivePredicate, applyPlan, isPilot });
