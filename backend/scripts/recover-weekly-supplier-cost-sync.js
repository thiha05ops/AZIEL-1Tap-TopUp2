#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { readWeeklySupplierCostSyncPolicy } = require("../config/supplierCatalogIngestionPolicy");
const { loadAutomationActor } = require("./run-weekly-supplier-cost-sync");
const { createWeeklySupplierCostJobService } = require("../services/supplierCatalog/weeklySupplierCostJobService");

async function main() {
    const policy = readWeeklySupplierCostSyncPolicy(process.env);
    if (!policy.enabled) throw Object.assign(new Error("Weekly supplier cost sync is disabled."), { code: "SUPPLIER_WEEKLY_COST_SYNC_DISABLED" });
    await connectDB();
    const actor = await loadAutomationActor(policy.automationActorId);
    const result = await createWeeklySupplierCostJobService().recoverDue({ actor });
    console.log(JSON.stringify({ result: "PASS", ...result }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message })); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
module.exports = Object.freeze({ main });
