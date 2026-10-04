"use strict";

const mongoose = require("mongoose");
const { auditSupplierLifecycle } = require("../services/supplierLifecycleAuditService");

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is required; this command is read-only.");
    mongoose.set("autoIndex", false);
    await mongoose.connect(uri);
    try { process.stdout.write(`${JSON.stringify(await auditSupplierLifecycle(), null, 2)}\n`); }
    finally { await mongoose.disconnect(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
