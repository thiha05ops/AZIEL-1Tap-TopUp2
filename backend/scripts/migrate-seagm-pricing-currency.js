"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const CatalogPackage = require("../models/CatalogPackage");

async function inspectEvidence() {
    const packages = await CatalogPackage.find({ deletedAt: null })
        .select("prices.TH.supplierCost prices.TH.supplierCurrency prices.MM.supplierCost prices.MM.supplierCurrency")
        .lean();
    const currencies = new Set();
    packages.forEach(pkg => ["TH", "MM"].forEach(region => {
        const price = pkg.prices?.[region];
        if (price?.supplierCost != null && price.supplierCurrency) currencies.add(String(price.supplierCurrency).toUpperCase());
    }));
    return [...currencies].sort();
}

async function run({ apply = false } = {}) {
    await mongoose.connect(process.env.MONGO_URI);
    const supplier = await Supplier.findOne({ supplierCode: "SEAGM", enabled: true });
    if (!supplier) throw new Error("Enabled SEAGM supplier not found.");
    if (supplier.supplierCurrency) {
        return { changed: false, supplierId: String(supplier._id), supplierCode: supplier.supplierCode, supplierCurrency: supplier.supplierCurrency, reason: "already_configured" };
    }
    const evidence = await inspectEvidence();
    if (!evidence.length || evidence.some(currency => currency !== "THB")) {
        throw new Error(`SEAGM currency normalization refused; catalog evidence is ${evidence.join(",") || "missing"}.`);
    }
    if (!apply) return { changed: false, dryRun: true, supplierId: String(supplier._id), supplierCode: supplier.supplierCode, proposedCurrency: "THB", evidence };
    const result = await Supplier.updateOne(
        { _id: supplier._id, $or: [{ supplierCurrency: "" }, { supplierCurrency: null }, { supplierCurrency: { $exists: false } }] },
        { $set: { supplierCurrency: "THB", "metadata.pricingCurrencyMigration": "SEAGM_CATALOG_THB_EVIDENCE_V1" } }
    );
    return { changed: result.modifiedCount === 1, supplierId: String(supplier._id), supplierCode: supplier.supplierCode, supplierCurrency: "THB", evidence };
}

if (require.main === module) {
    run({ apply: process.argv.includes("--apply") })
        .then(result => console.log(JSON.stringify(result, null, 2)))
        .catch(error => { console.error(error.message); process.exitCode = 1; })
        .finally(() => mongoose.disconnect());
}

module.exports = { inspectEvidence, run };
