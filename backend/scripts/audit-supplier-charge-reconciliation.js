#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");
const { auditHistoricalCharges } = require("../services/supplierChargeReconciliationService");

async function main() {
    if (!process.argv.includes("--read-only")) throw new Error("Pass --read-only to confirm this audit must not mutate business data.");
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
    const supplierArg = process.argv.find(value => value.startsWith("--supplier="));
    const supplierCode = supplierArg ? supplierArg.split("=")[1] : "";
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
    try {
        const result = await auditHistoricalCharges({ supplierCode });
        console.log(JSON.stringify(result, null, 2));
    } finally { await mongoose.disconnect(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
