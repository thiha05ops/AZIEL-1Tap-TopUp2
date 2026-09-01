#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const Supplier = require("../models/Supplier");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Mapping = require("../models/SupplierProductMapping");
const Publication = require("../models/PackageMarketPublication");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const PricingPolicy = require("../models/PricingPolicy");
const { canonicalJson } = require("../services/supplierCatalog/supplierCatalogNormalization");

const fazerSource = require("../../docs/fazercards-current-master-catalog-source-2026-08-31.json");
const wonddSource = require("../../docs/wondd-current-master-catalog-source-2026-08-31.json");
const outputArg = process.argv.find(value => value.startsWith("--output="));
const outputPath = outputArg ? path.resolve(process.cwd(), outputArg.slice(9)) : "";
const sha = value => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
const id = value => String(value?._id || value || "");

async function fingerprint(Model, projection = {}) {
    const rows = await Model.find({}).select(projection).sort({ _id: 1 }).lean();
    return { count: rows.length, sha256: sha(rows) };
}

function operationRows(sourceRows, existingRows, keys) {
    const key = row => keys.map(name => String(row[name] || "")).join("/");
    const existing = new Map(existingRows.map(row => [key(row), row]));
    return sourceRows.map(row => ({ identity: Object.fromEntries(keys.map(name => [name, row[name]])), operation: existing.has(key(row)) ? "UPDATE" : "CREATE", sourceHash: row.rawSnapshotHash }));
}

async function main() {
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred", serverSelectionTimeoutMS: 10000 });
    const suppliers = await Supplier.find({ supplierCode: { $in: ["FAZERCARDS", "WONDD"] } }).lean();
    const byCode = new Map(suppliers.map(row => [row.supplierCode, row]));
    if (!byCode.has("FAZERCARDS") || !byCode.has("WONDD")) throw new Error("Required supplier records are missing.");
    const namespaces = { FAZERCARDS: "FAZERCARDS_RESELLER_CATALOG", WONDD: "WONDD_PACKAGE_CATALOG" };
    const current = {};
    for (const supplierCode of ["FAZERCARDS", "WONDD"]) {
        const scope = { supplierId: byCode.get(supplierCode)._id, catalogNamespace: namespaces[supplierCode] };
        current[supplierCode] = { products: await Product.find(scope).lean(), offers: await Offer.find(scope).lean() };
    }
    const sources = { FAZERCARDS: fazerSource, WONDD: wonddSource };
    const supplierPlans = {};
    for (const supplierCode of Object.keys(sources)) {
        const source = sources[supplierCode];
        supplierPlans[supplierCode] = {
            supplierId: id(byCode.get(supplierCode)),
            namespace: namespaces[supplierCode],
            sourceSetHash: source.sourceSetHash,
            completeness: source.completeness,
            products: operationRows(source.products, current[supplierCode].products, ["supplierProductCode"]),
            offers: operationRows(source.offers, current[supplierCode].offers, ["supplierProductCode", "supplierOfferCode"])
        };
    }
    const protectedState = {
        SupplierProductMapping: await fingerprint(Mapping),
        CatalogProduct: await fingerprint(CatalogProduct),
        CatalogPackage: await fingerprint(CatalogPackage),
        PackageMarketPublication: await fingerprint(Publication),
        PricingPolicy: await fingerprint(PricingPolicy)
    };
    const availabilityCount = await Availability.countDocuments();
    const plan = {
        artifactType: "SUPPLIER_MASTER_CATALOG_INGESTION_PLAN",
        mode: "REVIEWED_CATALOG_EVIDENCE_ONLY",
        generatedAt: new Date().toISOString(),
        suppliers: supplierPlans,
        before: { supplierProducts: await Product.countDocuments(), supplierOffers: await Offer.countDocuments(), availability: availabilityCount, protectedState },
        authorityEffects: { canonicalProducts: 0, canonicalPackages: 0, mappings: 0, publications: 0, pricing: 0, routingRoles: 0, orders: 0, fulfillmentCalls: 0 },
        sourcePlanHash: ""
    };
    plan.sourcePlanHash = sha({ suppliers: plan.suppliers, before: plan.before, authorityEffects: plan.authorityEffects });
    const json = `${JSON.stringify(plan, null, 2)}\n`;
    if (outputPath) fs.writeFileSync(outputPath, json, { flag: "wx" });
    else process.stdout.write(JSON.stringify({ artifactType: plan.artifactType, generatedAt: plan.generatedAt, suppliers: Object.fromEntries(Object.entries(plan.suppliers).map(([code, value]) => [code, { namespace: value.namespace, sourceSetHash: value.sourceSetHash, completeness: value.completeness, products: value.products.reduce((out, row) => (out[row.operation] = (out[row.operation] || 0) + 1, out), {}), offers: value.offers.reduce((out, row) => (out[row.operation] = (out[row.operation] || 0) + 1, out), {}) }])), before: plan.before, authorityEffects: plan.authorityEffects, sourcePlanHash: plan.sourcePlanHash }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ result: "ABORTED", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
