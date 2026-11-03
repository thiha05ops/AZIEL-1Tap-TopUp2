#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const {
    CUTOVER_CONFIRMATION,
    ROLLBACK_CONFIRMATION,
    createPubgMobileAutoCutoverService
} = require("../services/supplierCatalog/pubgMobileAutoCutoverService");
const {
    CONFIRMATION: COST_RECOVERY_CONFIRMATION,
    createPubgMobileAutoCostRecoveryService
} = require("../services/supplierCatalog/pubgMobileAutoCostRecoveryService");

const args = Object.fromEntries(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.replace(/^--/, "").split("=");
    return [key, rest.join("=") || true];
}));
const mode = String(args.mode || "preflight").trim().toLowerCase();
const mutations = new Set(["cutover", "rollback", "recover-cost-authorities"]);

function required(name) {
    const value = String(args[name] || "").trim();
    if (!value) throw new Error(`--${name}=... is required for ${mode}.`);
    return value;
}

function publicResult(value) {
    if (!value) return value;
    return {
        state: value.state,
        applied: value.applied,
        idempotentReplay: value.idempotentReplay,
        verified: value.verified,
        planHash: value.planHash,
        cutoverPlanHash: value.cutoverPlanHash,
        auditId: value.auditId,
        primaryCounts: value.primaryCounts,
        packages: value.manifest?.rows?.map(row => row.packageCode),
        targetMappingIds: value.targetMappingIds,
        sourceMappingIds: value.sourceMappingIds
    };
}

async function run() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGO_URI is required.");
    await mongoose.connect(mongoUri, { autoIndex: false, readPreference: mutations.has(mode) ? "primary" : "secondaryPreferred" });
    const service = createPubgMobileAutoCutoverService();
    const recovery = createPubgMobileAutoCostRecoveryService();
    let result;
    if (mode === "diagnose") result = await service.diagnose();
    else if (mode === "preflight") result = await service.preflight();
    else if (mode === "cost-recovery-preflight") result = await recovery.inspect();
    else if (mode === "recover-cost-authorities") result = await recovery.recover({ planHash: required("plan-hash"), confirmed: args.confirm === COST_RECOVERY_CONFIRMATION, confirmation: args.confirm }, { adminId: required("owner-id"), username: required("owner-username"), role: "OWNER" });
    else if (mode === "verify") result = await service.verifyPostCutover({ planHash: required("plan-hash") });
    else if (mode === "rollback-preflight") result = await service.rollbackPreflight({ cutoverPlanHash: required("cutover-plan-hash") });
    else if (mode === "cutover") result = await service.cutover({ planHash: required("plan-hash"), confirmed: args.confirm === CUTOVER_CONFIRMATION, confirmation: args.confirm, requestId: required("request-id") }, { adminId: required("owner-id"), username: required("owner-username"), role: "OWNER" });
    else if (mode === "rollback") result = await service.rollback({ planHash: required("plan-hash"), cutoverPlanHash: required("cutover-plan-hash"), confirmed: args.confirm === ROLLBACK_CONFIRMATION, confirmation: args.confirm, requestId: required("request-id") }, { adminId: required("owner-id"), username: required("owner-username"), role: "OWNER" });
    else throw new Error(`Unsupported --mode=${mode}.`);
    const output = ["diagnose", "cost-recovery-preflight", "recover-cost-authorities"].includes(mode) ? result : publicResult(result);
    console.log(JSON.stringify({ result: "PASS", mode, readOnly: !mutations.has(mode), ...output }, null, 2));
}

run().catch(error => {
    console.error(JSON.stringify({ result: "FAIL", mode, code: error.code || "UNEXPECTED_ERROR", message: error.message, details: error.details || {} }, null, 2));
    process.exitCode = 1;
}).finally(() => mongoose.disconnect().catch(() => null));
