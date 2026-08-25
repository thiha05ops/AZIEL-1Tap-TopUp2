#!/usr/bin/env node
"use strict";
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Mapping = require("../models/SupplierProductMapping");
const CatalogPackage = require("../models/CatalogPackage");
async function main() {
    const apply = process.argv.includes("--apply");
    await mongoose.connect(process.env.MONGO_URI);
    const mapping = await Mapping.findOne({ supplierCode: "SEAGM", productCode: "mlbb", packageCode: "MLBB_WEEKLY_1X", supplierProductCode: "MLBB", supplierPackageCode: "WEEKLY_PASS", region: "MM" });
    if (!mapping) throw new Error("Exact orphan mapping was not found; refusing broad archival.");
    const canonical = await CatalogPackage.findOne({ productCode: mapping.productCode, packageCode: mapping.packageCode, deletedAt: null }).lean();
    if (canonical) throw new Error("Canonical package now exists; archival requires a new authority review.");
    if (mapping.productionRole === "PRIMARY") throw new Error("Orphan unexpectedly became PRIMARY; refusing mutation.");
    if (apply && !mapping.archivedAt) {
        mapping.enabled = false;
        mapping.productionRole = "DISABLED";
        mapping.archivedAt = new Date();
        mapping.archivedReason = "CANONICAL_PACKAGE_MISSING_PRESERVE_AUDIT_HISTORY";
        mapping.mappingMetadata = { ...(mapping.mappingMetadata || {}), archival: { authority: "EXISTING_PRODUCTS_PRODUCTION_READY_COMPLETION", reason: mapping.archivedReason, archivedAt: mapping.archivedAt } };
        await mapping.save();
    }
    console.log(JSON.stringify({ result: "PASS", apply, mappingId: String(mapping._id), enabled: mapping.enabled, productionRole: mapping.productionRole, archivedAt: mapping.archivedAt, reason: mapping.archivedReason || "" }, null, 2));
    await mongoose.disconnect();
}
main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode = 1; });
