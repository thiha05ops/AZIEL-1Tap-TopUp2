#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const { createPubgMobileAutoMigrationService, CONFIRMATION } = require("../services/supplierCatalog/pubgMobileAutoMigrationService");

const argument = name => (process.argv.find(value => value.startsWith(`--${name}=`)) || "").slice(name.length + 3);
const apply = process.argv.includes("--apply");

(async () => {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { readPreference: apply ? "primary" : "secondaryPreferred", serverSelectionTimeoutMS: 10000 });
    const service = createPubgMobileAutoMigrationService();
    const plan = await service.inspect();
    const comparison = plan.rows.map(row => ({ packageCode: row.expected.packageCode, packageName: row.expected.name, oldSupplierProductCode: row.source.supplierProductCode, oldSupplierOfferCode: row.source.supplierPackageCode, proposedSupplierProductCode: row.target.supplierProductCode, proposedSupplierOfferCode: row.target.supplierOfferCode, currentCostUsd: row.target.supplierCost.amount, availability: row.observed.state, availabilityObservedAt: row.observed.observedAt, targetOfferId: String(row.target._id) }));
    if (!apply) {
        console.log(JSON.stringify({ mode: "READ_ONLY_PLAN", state: plan.state, planHash: plan.planHash, productCode: plan.product.productCode, productName: plan.product.name, ingestionRunId: String(plan.run._id), comparison, effects: { canonicalProductChanges: 0, canonicalPackageChanges: 0, sellingPriceChanges: 0, storeSelectionChanges: 0, sourceMappingChanges: 0, orderChanges: 0, fulfillmentAttemptChanges: 0, preparedDisabledMappings: plan.state === "READY" ? 6 : 0 }, nextStep: { confirmation: CONFIRMATION, applyGate: "PUBG_MOBILE_AUTO_MIGRATION_PREPARE_ENABLED" } }, null, 2));
        return;
    }
    const result = await service.prepare({ planHash: argument("plan-hash"), confirmed: argument("confirmation") === CONFIRMATION, confirmation: argument("confirmation"), requestId: argument("request-id") }, { adminId: argument("admin-id"), username: argument("username"), role: argument("role") });
    console.log(JSON.stringify({ mode: "PREPARE", ...result, activationPerformed: false, publicationPerformed: false }, null, 2));
})().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
