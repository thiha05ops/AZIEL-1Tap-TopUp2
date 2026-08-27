#!/usr/bin/env node
"use strict";

const path = require("path");
const mongoose = require("mongoose");
const { PILOT_IDENTITY } = require("../config/mmWonddMlbbPilot");
const { normalizeFulfillmentEligibility, validateFulfillmentEligibility } = require("../services/supplierFulfillmentEligibilityService");

const EVIDENCE_SOURCE = "AZIEL controlled cross-market pilot for WonDD MLBB MLFT055; eligibility limited to TH and MM pending broader provider evidence.";
const LEGACY_SOURCE = "Historically routed through TH by AZIEL; not provider-confirmed customer-market eligibility; not safe for automatic cross-market routing.";
const text = value => String(value == null ? "" : value).trim();

function parseArgs(argv = process.argv.slice(2)) {
    const options = { apply: false, rollback: false, verifiedAt: null };
    for (const argument of argv) {
        if (argument === "--apply") options.apply = true;
        else if (argument === "--rollback") options.rollback = true;
        else if (argument.startsWith("--verified-at=")) options.verifiedAt = new Date(argument.slice(14));
        else throw Object.assign(new Error(`Unknown argument: ${argument}`), { code: "UNKNOWN_ARGUMENT" });
    }
    if (options.verifiedAt && !Number.isFinite(options.verifiedAt.getTime())) throw Object.assign(new Error("--verified-at must be valid."), { code: "VERIFIED_AT_INVALID" });
    return options;
}

function legacyEligibility(verifiedAt) {
    return { mode: "UNKNOWN", allowedCustomerMarkets: [], evidenceCode: "LEGACY_EFFECTIVE_SCOPE", evidenceSource: LEGACY_SOURCE, verifiedAt: new Date(verifiedAt), version: 1 };
}

function pilotEligibility(verifiedAt) {
    return { mode: "CUSTOMER_MARKET_ALLOWLIST", allowedCustomerMarkets: ["MM", "TH"], evidenceCode: "CONTROLLED_TEST", evidenceSource: EVIDENCE_SOURCE, verifiedAt: new Date(verifiedAt), version: 1 };
}

function stateMatches(value, expected) {
    const actual = normalizeFulfillmentEligibility(value);
    return actual.mode === expected.mode && actual.evidenceCode === expected.evidenceCode && JSON.stringify(actual.allowedCustomerMarkets) === JSON.stringify(expected.allowedCustomerMarkets);
}

function buildPlan(mappings, options = {}) {
    if (mappings.length !== 1) throw Object.assign(new Error(`Pilot identity must resolve exactly one mapping; found ${mappings.length}.`), { code: "PILOT_MAPPING_CARDINALITY_INVALID" });
    const mapping = mappings[0];
    if (String(mapping.supplierProductCode || "").toLowerCase() !== PILOT_IDENTITY.supplierProductCode || String(mapping.supplierPackageCode || "").toUpperCase() !== PILOT_IDENTITY.supplierPackageCode) throw Object.assign(new Error("Pilot provider identity differs from the approved identity."), { code: "PILOT_PROVIDER_IDENTITY_MISMATCH" });
    if (mapping.archivedAt || mapping.enabled !== true || String(mapping.executionMode).toUpperCase() !== "API") throw Object.assign(new Error("Pilot mapping is not active API execution."), { code: "PILOT_MAPPING_NOT_ACTIVE" });
    const assessment = validateFulfillmentEligibility(mapping.fulfillmentEligibility);
    if (!assessment.valid) throw Object.assign(new Error(`Pilot eligibility is malformed: ${assessment.errors.join(",")}`), { code: "PILOT_ELIGIBILITY_MALFORMED" });
    const verifiedAt = options.verifiedAt || new Date();
    const from = options.rollback ? pilotEligibility(verifiedAt) : legacyEligibility(verifiedAt);
    const to = options.rollback ? legacyEligibility(verifiedAt) : pilotEligibility(verifiedAt);
    const alreadyTarget = stateMatches(mapping.fulfillmentEligibility, to);
    if (!alreadyTarget && !stateMatches(mapping.fulfillmentEligibility, from)) throw Object.assign(new Error("Pilot eligibility is not in the expected source state."), { code: "PILOT_ELIGIBILITY_STATE_MISMATCH" });
    return {
        result: "PASS",
        mode: options.apply ? "APPLY" : "DRY_RUN",
        operation: options.rollback ? "ROLLBACK" : "ENABLE_PILOT_ELIGIBILITY",
        selectedCount: 1,
        proposedChangeCount: alreadyTarget ? 0 : 1,
        idempotentNoop: alreadyTarget,
        identity: { ...PILOT_IDENTITY },
        mappingId: String(mapping._id),
        before: normalizeFulfillmentEligibility(mapping.fulfillmentEligibility),
        after: normalizeFulfillmentEligibility(to),
        writes: 0,
        beforeRaw: mapping.fulfillmentEligibility,
        afterRaw: to
    };
}

function defensivePredicate(plan) {
    return {
        _id: plan.mappingId,
        supplierCode: PILOT_IDENTITY.supplierCode,
        productCode: PILOT_IDENTITY.productCode,
        packageCode: PILOT_IDENTITY.packageCode,
        supplierProductCode: PILOT_IDENTITY.supplierProductCode,
        supplierPackageCode: PILOT_IDENTITY.supplierPackageCode,
        enabled: true,
        archivedAt: null,
        executionMode: "API",
        fulfillmentEligibility: plan.beforeRaw
    };
}

async function applyPlan(plan, Mapping) {
    if (plan.mode !== "APPLY" || plan.idempotentNoop) return { matched: 0, modified: 0, writes: 0 };
    const result = await Mapping.updateOne(defensivePredicate(plan), { $set: { fulfillmentEligibility: plan.afterRaw } }, { runValidators: true });
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) throw Object.assign(new Error("Defensive pilot update did not modify exactly one mapping."), { code: "PILOT_DEFENSIVE_WRITE_FAILED" });
    return { matched: 1, modified: 1, writes: 1 };
}

function publicReport(plan, writes) {
    const { beforeRaw, afterRaw, ...report } = plan;
    return { ...report, writes };
}

async function main() {
    const options = parseArgs();
    require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
    const uri = text(process.env.MONGO_URI || process.env.MONGODB_URI);
    if (!uri) throw Object.assign(new Error("MONGO_URI is required."), { code: "MONGO_URI_REQUIRED" });
    await mongoose.connect(uri, { autoIndex: false });
    const Mapping = require("../models/SupplierProductMapping");
    const mappings = await Mapping.find({ supplierCode: PILOT_IDENTITY.supplierCode, productCode: PILOT_IDENTITY.productCode, packageCode: PILOT_IDENTITY.packageCode, supplierPackageCode: PILOT_IDENTITY.supplierPackageCode }).lean();
    const plan = buildPlan(mappings, options);
    const writes = await applyPlan(plan, Mapping);
    console.log(JSON.stringify(publicReport(plan, writes), null, 2));
    await mongoose.disconnect();
}

if (require.main === module) main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; });

module.exports = Object.freeze({ EVIDENCE_SOURCE, LEGACY_SOURCE, parseArgs, legacyEligibility, pilotEligibility, stateMatches, buildPlan, defensivePredicate, applyPlan, publicReport });
