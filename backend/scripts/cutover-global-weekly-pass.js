#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const { CUTOVER, createGlobalWeeklyPassCutoverService } = require("../services/supplierCatalog/globalWeeklyPassCutoverService");

function args(argv) {
    const values = {};
    for (const item of argv.slice(2)) {
        if (item === "--apply") values.apply = true;
        else if (item === "--confirmed") values.confirmed = true;
        else if (item === "--refresh-approval") values.refreshApproval = true;
        else if (item.startsWith("--") && item.includes("=")) {
            const [key, ...rest] = item.slice(2).split("=");
            values[key] = rest.join("=");
        }
    }
    return values;
}

function required(value, name) {
    if (!String(value || "").trim()) throw new Error(`${name} is required.`);
    return String(value).trim();
}

async function main() {
    const input = args(process.argv);
    const uri = required(process.env.AZIEL_GLOBAL_WEEKLY_PASS_CUTOVER_MONGO_URI, "AZIEL_GLOBAL_WEEKLY_PASS_CUTOVER_MONGO_URI");
    const expected = {
        mappingUpdatedAt: required(input["expected-mapping-updated-at"], "--expected-mapping-updated-at"),
        mappingVersion: Number(required(input["expected-mapping-version"], "--expected-mapping-version")),
        decisionId: required(input["expected-decision-id"], "--expected-decision-id"),
        decisionVersion: Number(required(input["expected-decision-version"], "--expected-decision-version")),
        sourceOfferHash: required(input["expected-source-offer-hash"], "--expected-source-offer-hash"),
        sourceOfferRevision: required(input["expected-source-offer-revision"], "--expected-source-offer-revision"),
        sourceLastChangedAt: required(input["expected-source-last-changed-at"], "--expected-source-last-changed-at"),
        sourceSemanticHash: required(input["expected-source-semantic-hash"], "--expected-source-semantic-hash"),
        sourceProductEvidenceHash: required(input["expected-source-product-evidence-hash"], "--expected-source-product-evidence-hash"),
        sourceCostHash: required(input["expected-source-cost-hash"], "--expected-source-cost-hash")
    };
    const previousSource = input.refreshApproval ? {
        sourceOfferHash: required(input["previous-source-offer-hash"], "--previous-source-offer-hash"),
        sourceOfferRevision: required(input["previous-source-offer-revision"], "--previous-source-offer-revision"),
        sourceLastChangedAt: required(input["previous-source-last-changed-at"], "--previous-source-last-changed-at"),
        sourceSemanticHash: required(input["previous-source-semantic-hash"], "--previous-source-semantic-hash"),
        sourceProductEvidenceHash: required(input["previous-source-product-evidence-hash"], "--previous-source-product-evidence-hash"),
        sourceCostHash: required(input["previous-source-cost-hash"], "--previous-source-cost-hash")
    } : null;
    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
    try {
        const service = createGlobalWeeklyPassCutoverService();
        if (input.refreshApproval) {
            if (!input.apply) {
                const plan = await service.inspectRefresh({ expected, previousSource });
                console.log(JSON.stringify({ result: "PASS", mode: "refresh-approval-dry-run", state: plan.state, planHash: plan.planHash, mappingId: CUTOVER.mappingId, preservedTarget: `${CUTOVER.oldProductCode}/${CUTOVER.oldPackageCode}`, reviewedCost: CUTOVER.reviewedCost, destinationRestrictions: CUTOVER.reviewedExcludedMarkets, writes: 0 }, null, 2));
                return;
            }
            const result = await service.refreshApproval({ expected, previousSource, planHash: required(input["plan-hash"], "--plan-hash"), confirmed: input.confirmed === true, confirmation: input.confirmation }, { actor: { id: required(process.env.AZIEL_CUTOVER_OWNER_ADMIN_ID, "AZIEL_CUTOVER_OWNER_ADMIN_ID"), sessionId: required(process.env.AZIEL_CUTOVER_OWNER_SESSION_ID, "AZIEL_CUTOVER_OWNER_SESSION_ID") }, requestId: required(input["request-id"], "--request-id") });
            console.log(JSON.stringify({ result: "PASS", mode: "refresh-approval-apply", ...result }, null, 2));
            return;
        }
        if (!input.apply) {
            const plan = await service.inspect({ expected });
            console.log(JSON.stringify({ result: "PASS", mode: "dry-run", state: plan.state, planHash: plan.planHash, mappingId: CUTOVER.mappingId, source: `${CUTOVER.supplierCode}/${CUTOVER.supplierProductCode}/${CUTOVER.supplierPackageCode}`, target: `${CUTOVER.newProductCode}/${CUTOVER.newPackageCode}`, historicalOrderCount: plan.historicalOrders.length, writes: 0 }, null, 2));
            return;
        }
        const result = await service.apply({ expected, planHash: required(input["plan-hash"], "--plan-hash"), confirmed: input.confirmed === true, confirmation: input.confirmation }, { actor: { id: required(process.env.AZIEL_CUTOVER_OWNER_ADMIN_ID, "AZIEL_CUTOVER_OWNER_ADMIN_ID"), sessionId: required(process.env.AZIEL_CUTOVER_OWNER_SESSION_ID, "AZIEL_CUTOVER_OWNER_SESSION_ID") }, requestId: required(input["request-id"], "--request-id") });
        console.log(JSON.stringify({ result: "PASS", mode: "apply", ...result }, null, 2));
    } finally {
        await mongoose.disconnect();
    }
}

main().catch(error => {
    console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name || "CUTOVER_FAILED", message: error.message, details: error.details || undefined }, null, 2));
    process.exitCode = 1;
});
