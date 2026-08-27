#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");
const {
    normalizeFulfillmentEligibility,
    validateFulfillmentEligibility
} = require("../services/supplierFulfillmentEligibilityService");

const EVIDENCE_STRENGTH = Object.freeze({
    "": 0,
    LEGACY_EFFECTIVE_SCOPE: 1,
    CONTROLLED_TEST: 2,
    PROVIDER_CONFIRMED: 3
});
const VALID_MARKETS = Object.freeze(["MM", "TH"]);

const text = value => String(value == null ? "" : value).trim();
const upper = value => text(value).toUpperCase();
const lower = value => text(value).toLowerCase();

function parseArgs(argv = process.argv.slice(2)) {
    const options = { apply: false, overrideExisting: false, supplier: "", product: "", verifiedAt: null };
    argv.forEach(argument => {
        if (argument === "--apply") options.apply = true;
        else if (argument === "--override-existing") options.overrideExisting = true;
        else if (argument.startsWith("--supplier=")) options.supplier = upper(argument.slice("--supplier=".length));
        else if (argument.startsWith("--product=")) options.product = lower(argument.slice("--product=".length));
        else if (argument.startsWith("--verified-at=")) options.verifiedAt = new Date(argument.slice("--verified-at=".length));
        else throw Object.assign(new Error(`Unknown argument: ${argument}`), { code: "UNKNOWN_ARGUMENT" });
    });
    if (options.verifiedAt && !Number.isFinite(options.verifiedAt.getTime())) {
        throw Object.assign(new Error("--verified-at must be a valid ISO date."), { code: "VERIFIED_AT_INVALID" });
    }
    return options;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
    return JSON.stringify(stableValue(value));
}

function providerMarket(value) {
    const normalized = upper(value).replace(/[^A-Z]/g, "");
    if (["TH", "THAILAND"].includes(normalized)) return "TH";
    if (["MM", "MYANMAR", "BURMA"].includes(normalized)) return "MM";
    return "";
}

function evidenceSource(evidence = {}) {
    const explicit = text(evidence.evidenceSource || evidence.source || evidence.authority);
    if (explicit) return explicit.slice(0, 500);
    const serialized = stableJson(evidence);
    const prefix = "SupplierProductMapping.mappingMetadata.regionEvidence";
    if (`${prefix}: ${serialized}`.length <= 500) return `${prefix}: ${serialized}`;
    return `${prefix}; sha256=${crypto.createHash("sha256").update(serialized).digest("hex")}`;
}

function eligibility(mode, allowedCustomerMarkets, evidenceCode, source, verifiedAt) {
    return {
        mode,
        allowedCustomerMarkets: [...allowedCustomerMarkets].sort(),
        evidenceCode,
        evidenceSource: source,
        verifiedAt: new Date(verifiedAt),
        version: 1
    };
}

function classifyMapping(mapping = {}, { verifiedAt = new Date() } = {}) {
    const region = upper(mapping.region);
    const evidence = mapping.mappingMetadata?.regionEvidence;
    const hasEvidence = evidence && typeof evidence === "object" && !Array.isArray(evidence);
    const regionLocked = hasEvidence && evidence.regionLocked === true;
    const globalClaim = hasEvidence && (evidence.globalCustomerMarketEligibility === true || upper(evidence.marketScope) === "GLOBAL");
    const unknown = source => eligibility("UNKNOWN", [], "", source, verifiedAt);

    if (regionLocked && globalClaim) {
        return unknown("Stored provider evidence conflicts between global and region-locked eligibility; automatic eligibility is not proven.");
    }

    if (regionLocked) {
        if (!VALID_MARKETS.includes(region)) {
            return unknown("Stored region-lock evidence has no valid customer market; automatic eligibility is not proven.");
        }
        const claimedProviderRegion = text(evidence.providerRegion || evidence.customerMarket || evidence.market);
        const explicitMarket = providerMarket(claimedProviderRegion);
        if (claimedProviderRegion && !explicitMarket) {
            return unknown(`Stored provider region is not recognized (${claimedProviderRegion}); automatic eligibility is not proven.`);
        }
        if (explicitMarket && explicitMarket !== region) {
            return unknown("Stored provider region conflicts with the historical mapping region; automatic eligibility is not proven.");
        }
        return eligibility("CUSTOMER_MARKET_ALLOWLIST", [region], "PROVIDER_CONFIRMED", evidenceSource(evidence), verifiedAt);
    }

    if (globalClaim) {
        const providerConfirmed = evidence.providerConfirmed === true;
        const source = text(evidence.evidenceSource || evidence.source || evidence.authority);
        if (!providerConfirmed || !source) {
            return unknown("Stored global eligibility claim lacks explicit auditable provider confirmation; automatic eligibility is not proven.");
        }
        return eligibility("GLOBAL", [], "PROVIDER_CONFIRMED", evidenceSource(evidence), verifiedAt);
    }

    if (!mapping.archivedAt && region === "TH") {
        return eligibility(
            "UNKNOWN",
            [],
            "LEGACY_EFFECTIVE_SCOPE",
            "Historically routed through TH by AZIEL; not provider-confirmed customer-market eligibility; not safe for automatic cross-market routing.",
            verifiedAt
        );
    }

    return eligibility(
        "UNKNOWN",
        [],
        "",
        "No stored evidence proves automatic customer-market eligibility.",
        verifiedAt
    );
}

function sameEligibility(left, right) {
    const normalizeDate = value => value ? new Date(value).toISOString() : null;
    const comparable = value => {
        const normalized = normalizeFulfillmentEligibility(value);
        return {
            ...normalized,
            allowedCustomerMarkets: [...normalized.allowedCustomerMarkets],
            verifiedAt: normalizeDate(normalized.verifiedAt)
        };
    };
    return stableJson(comparable(left)) === stableJson(comparable(right));
}

function compatibleUpgrade(existing, proposed) {
    const current = normalizeFulfillmentEligibility(existing);
    const next = normalizeFulfillmentEligibility(proposed);
    if ((EVIDENCE_STRENGTH[next.evidenceCode] || 0) <= (EVIDENCE_STRENGTH[current.evidenceCode] || 0)) return false;
    if (current.mode === "GLOBAL" && next.mode !== "GLOBAL") return false;
    if (current.mode === "CUSTOMER_MARKET_ALLOWLIST") {
        return current.allowedCustomerMarkets.every(market => next.allowedCustomerMarkets.includes(market));
    }
    return true;
}

function mappingIdentity(mapping = {}) {
    return {
        id: text(mapping._id || mapping.id),
        supplierCode: upper(mapping.supplierCode),
        productCode: lower(mapping.productCode),
        packageCode: upper(mapping.packageCode),
        region: upper(mapping.region)
    };
}

function summarizeEligibility(items = [], selector) {
    const counts = { ABSENT: 0, UNKNOWN: 0, GLOBAL: 0, CUSTOMER_MARKET_ALLOWLIST: 0 };
    items.forEach(item => {
        const value = selector(item);
        if (value === undefined || value === null) counts.ABSENT += 1;
        else counts[normalizeFulfillmentEligibility(value).mode] += 1;
    });
    return counts;
}

function buildMigrationPlan(mappings = [], options = {}) {
    const verifiedAt = options.verifiedAt || new Date();
    const selected = mappings.filter(mapping => (
        (!options.supplier || upper(mapping.supplierCode) === options.supplier) &&
        (!options.product || lower(mapping.productCode) === options.product)
    ));
    if ((options.supplier || options.product) && selected.length === 0) {
        throw Object.assign(new Error("Requested supplier/product scope selected zero mappings."), { code: "SCOPE_NOT_FOUND" });
    }

    const changes = [];
    const alreadyPopulated = [];
    selected.forEach(mapping => {
        const identity = mappingIdentity(mapping);
        const existing = mapping.fulfillmentEligibility;
        const hasExisting = existing !== undefined;
        if (hasExisting) {
            const assessment = validateFulfillmentEligibility(existing);
            if (!assessment.valid) {
                throw Object.assign(new Error(`Malformed existing eligibility for ${identity.supplierCode}/${identity.productCode}/${identity.packageCode}: ${assessment.errors.join(",")}`), { code: "MALFORMED_EXISTING_ELIGIBILITY" });
            }
        }
        const proposed = classifyMapping(mapping, { verifiedAt });
        const proposedAssessment = validateFulfillmentEligibility(proposed);
        if (!proposedAssessment.valid) {
            throw Object.assign(new Error(`Classifier produced invalid eligibility for ${identity.supplierCode}/${identity.productCode}/${identity.packageCode}.`), { code: "CLASSIFIER_OUTPUT_INVALID" });
        }
        if (hasExisting) {
            const preserved = !options.overrideExisting || !compatibleUpgrade(existing, proposed);
            alreadyPopulated.push({ ...identity, existing: normalizeFulfillmentEligibility(existing), proposed: normalizeFulfillmentEligibility(proposed), action: preserved ? "PRESERVE" : "UPGRADE" });
            if (preserved || sameEligibility(existing, proposed)) return;
        }
        changes.push({ ...identity, beforeExists: hasExisting, before: hasExisting ? existing : null, after: proposed });
    });

    changes.sort((a, b) => [a.supplierCode, a.productCode, a.packageCode, a.id].join("|").localeCompare([b.supplierCode, b.productCode, b.packageCode, b.id].join("|")));
    alreadyPopulated.sort((a, b) => [a.supplierCode, a.productCode, a.packageCode, a.id].join("|").localeCompare([b.supplierCode, b.productCode, b.packageCode, b.id].join("|")));
    const bySupplierProduct = {};
    changes.forEach(change => {
        const key = `${change.supplierCode}/${change.productCode}`;
        bySupplierProduct[key] ||= {
            total: 0,
            eligibilityModes: { UNKNOWN: 0, GLOBAL: 0, CUSTOMER_MARKET_ALLOWLIST: 0 },
            evidenceClasses: { UNKNOWN: 0, PROVIDER_CONFIRMED: 0, LEGACY_EFFECTIVE_SCOPE: 0 }
        };
        const group = bySupplierProduct[key];
        group.total += 1;
        group.eligibilityModes[change.after.mode] += 1;
        group.evidenceClasses[change.after.evidenceCode || "UNKNOWN"] += 1;
    });
    const orderedGroups = Object.fromEntries(Object.entries(bySupplierProduct).sort(([a], [b]) => a.localeCompare(b)));
    const evidenceCounts = { UNKNOWN: 0, PROVIDER_CONFIRMED: 0, LEGACY_EFFECTIVE_SCOPE: 0, GLOBAL: 0 };
    changes.forEach(change => {
        evidenceCounts[change.after.evidenceCode || "UNKNOWN"] += 1;
        if (change.after.mode === "GLOBAL") evidenceCounts.GLOBAL += 1;
    });
    return {
        mode: options.apply ? "APPLY" : "DRY_RUN",
        scope: { supplier: options.supplier || "ALL", product: options.product || "ALL" },
        verifiedAt: new Date(verifiedAt).toISOString(),
        selectedCount: selected.length,
        beforeCounts: summarizeEligibility(selected, item => item.fulfillmentEligibility),
        afterCounts: summarizeEligibility(selected, item => {
            const change = changes.find(candidate => candidate.id === mappingIdentity(item).id);
            return change ? change.after : item.fulfillmentEligibility;
        }),
        evidenceCounts,
        proposedBySupplierProduct: orderedGroups,
        alreadyPopulated,
        changes
    };
}

function defensivePredicate(change) {
    const predicate = {
        _id: change.id,
        supplierCode: change.supplierCode,
        productCode: change.productCode,
        packageCode: change.packageCode,
        region: change.region
    };
    if (!change.beforeExists) predicate.fulfillmentEligibility = { $exists: false };
    else predicate.fulfillmentEligibility = change.before;
    return predicate;
}

async function applyMigrationPlan(plan, { Mapping, connection }) {
    if (plan.mode !== "APPLY") return { writes: 0, matched: 0, modified: 0 };
    const operations = plan.changes.map(change => ({
        updateOne: {
            filter: defensivePredicate(change),
            update: { $set: { fulfillmentEligibility: change.after } }
        }
    }));
    if (!operations.length) return { writes: 0, matched: 0, modified: 0 };
    const session = await connection.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            const current = await Mapping.find({ _id: { $in: plan.changes.map(change => change.id) } }).session(session).lean();
            const preflight = buildMigrationPlan(current, {
                apply: true,
                overrideExisting: true,
                supplier: plan.scope.supplier === "ALL" ? "" : plan.scope.supplier,
                product: plan.scope.product === "ALL" ? "" : plan.scope.product,
                verifiedAt: new Date(plan.verifiedAt)
            });
            if (preflight.changes.length !== plan.changes.length || preflight.changes.some((change, index) => change.id !== plan.changes[index].id || !sameEligibility(change.after, plan.changes[index].after))) {
                throw Object.assign(new Error("Apply preflight no longer matches the dry-run plan."), { code: "APPLY_PREFLIGHT_CHANGED" });
            }
            result = await Mapping.bulkWrite(operations, { ordered: true, session });
            if (result.matchedCount !== operations.length) {
                throw Object.assign(new Error("Defensive predicates prevented one or more planned writes."), { code: "DEFENSIVE_WRITE_MISMATCH" });
            }
        });
    } finally {
        await session.endSession();
    }
    return { writes: operations.length, matched: result?.matchedCount || 0, modified: result?.modifiedCount || 0 };
}

function publicReport(plan, writeResult = { writes: 0, matched: 0, modified: 0 }) {
    return {
        result: "PASS",
        mode: plan.mode,
        routingMode: "LEGACY_REGION",
        scope: plan.scope,
        verifiedAt: plan.verifiedAt,
        selectedCount: plan.selectedCount,
        beforeCounts: plan.beforeCounts,
        afterCounts: plan.afterCounts,
        evidenceCounts: plan.evidenceCounts,
        proposedBySupplierProduct: plan.proposedBySupplierProduct,
        alreadyPopulatedCount: plan.alreadyPopulated.length,
        alreadyPopulated: plan.alreadyPopulated,
        proposedChangeCount: plan.changes.length,
        proposedChanges: plan.changes,
        writes: writeResult,
        safety: { providerCalls: 0, routeChanges: 0, snapshotChanges: 0, pricingChanges: 0 }
    };
}

async function main() {
    const options = parseArgs();
    require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
    const uri = text(process.env.MONGO_URI || process.env.MONGODB_URI);
    if (!uri) throw Object.assign(new Error("MONGO_URI is required."), { code: "MONGO_URI_REQUIRED" });
    await mongoose.connect(uri, { autoIndex: false });
    const Mapping = require("../models/SupplierProductMapping");
    const filter = { archivedAt: null };
    if (options.supplier) filter.supplierCode = options.supplier;
    if (options.product) filter.productCode = options.product;
    const mappings = await Mapping.find(filter).sort({ supplierCode: 1, productCode: 1, packageCode: 1, _id: 1 }).lean();
    const plan = buildMigrationPlan(mappings, options);
    const writeResult = await applyMigrationPlan(plan, { Mapping, connection: mongoose.connection });
    console.log(JSON.stringify(publicReport(plan, writeResult), null, 2));
    await mongoose.disconnect();
}

if (require.main === module) {
    main().catch(async error => {
        await mongoose.disconnect().catch(() => null);
        console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message }, null, 2));
        process.exitCode = 1;
    });
}

module.exports = Object.freeze({
    parseArgs,
    classifyMapping,
    buildMigrationPlan,
    defensivePredicate,
    applyMigrationPlan,
    publicReport,
    sameEligibility,
    compatibleUpgrade
});
