#!/usr/bin/env node
"use strict";
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Mapping = require("../models/SupplierProductMapping");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const SupplierCatalogOffer = require("../models/SupplierCatalogOffer");
const SupplierOfferAvailability = require("../models/SupplierOfferAvailability");
const PackageSupplierSelection = require("../models/PackageSupplierSelection");
const PackageMarketPublication = require("../models/PackageMarketPublication");
const StoreCatalogSelection = require("../models/StoreCatalogSelection");
const { projectCatalogProduct } = require("../services/catalogService");
const { auditProductionActivation, groupEnabledPackages } = require("../services/productionActivationAuditService");
const timeoutMs = Math.max(10_000, Number(process.env.PRODUCTION_ACTIVATION_AUDIT_TIMEOUT_MS) || 120_000);
const queryTimeoutMs = Math.max(5_000, Math.min(timeoutMs, Number(process.env.PRODUCTION_ACTIVATION_QUERY_TIMEOUT_MS) || 45_000));
const startedAt = Date.now();
const progress = (stage, details = {}) => console.error(JSON.stringify({ audit: "production-activation", stage, elapsedMs: Date.now() - startedAt, ...details }));
function withDeadline(promise, label, ms = timeoutMs) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { code: "AUDIT_TIMEOUT" })), ms); })
    ]).finally(() => clearTimeout(timer));
}
const read = query => query.maxTimeMS(queryTimeoutMs).lean();

async function main() {
    if (!process.env.MONGO_URI) throw Object.assign(new Error("MONGO_URI is required."), { code: "MONGO_URI_REQUIRED" });
    progress("connecting", { timeoutMs, queryTimeoutMs });
    await withDeadline(mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: Math.min(queryTimeoutMs, 15_000) }), "MongoDB connection", queryTimeoutMs);
    progress("connected", { database: mongoose.connection.name || "unknown" });
    progress("loading-catalog-scope");
    const [mappings, products] = await withDeadline(Promise.all([
        read(Mapping.find({})),
        read(CatalogProduct.find({ enabled: true, deletedAt: null, publicDiscoveryEnabled: true }))
    ]), "catalog scope reads");
    progress("catalog-scope-loaded", { mappings: mappings.length, products: products.length });
    const mappingIds = mappings.map(row => row._id);
    const supplierIds = [...new Set(mappings.map(row => String(row.supplierId)).filter(Boolean))];
    const offerIds = [...new Set(mappings.map(row => row.supplierCatalogOfferId).filter(Boolean).map(String))];
    const productCodes = [...new Set([...mappings.map(row => row.productCode), ...products.map(row => row.productCode)].filter(Boolean))];
    progress("loading-bounded-authorities", { supplierIds: supplierIds.length, offerIds: offerIds.length, productCodes: productCodes.length });
    const [packages, suppliers, offers, availabilityRows, selections, successfulAttempts, publications, storeSelections] = await withDeadline(Promise.all([
        read(CatalogPackage.find({ productCode: { $in: productCodes }, deletedAt: null })),
        read(Supplier.find({ _id: { $in: supplierIds } })),
        read(SupplierCatalogOffer.find({ _id: { $in: offerIds } })),
        read(SupplierOfferAvailability.find({ supplierCatalogOfferId: { $in: offerIds } })),
        read(PackageSupplierSelection.find({ productCode: { $in: products.map(row => row.productCode) } })),
        read(FulfillmentAttempt.find({ supplierMappingId: { $in: mappingIds }, status: "SUCCEEDED", supplierReference: { $nin: [null, ""] } }).select("supplierMappingId")),
        read(PackageMarketPublication.find({ customerMarket: { $in: ["TH", "MM"] }, published: true })),
        read(StoreCatalogSelection.find({ status: "ACTIVE", sellingRegions: { $in: ["TH", "MM"] } }))
    ]), "bounded authority reads");
    progress("core-authorities-loaded", { mappings: mappings.length, products: products.length, packages: packages.length, suppliers: suppliers.length, offers: offers.length, availability: availabilityRows.length, selections: selections.length, successfulAttempts: successfulAttempts.length });
    const packagesByProduct = groupEnabledPackages(packages);
    const catalog = products.map(product => projectCatalogProduct(product, packagesByProduct.get(product.productCode) || [], { includeDisabled: false, includeAdminPricing: false })).filter(Boolean);
    progress("evaluating", { publicProducts: catalog.length });
    const purchasableProducts = new Set(products.filter(row => String(row.commerceState || "").toUpperCase() === "PURCHASABLE").map(row => String(row.productCode).toLowerCase()));
    const published = new Set(publications.map(row => `${String(row.productCode).toLowerCase()}:${String(row.packageCode).toUpperCase()}:${String(row.customerMarket).toUpperCase()}`));
    const customerFacingRoutes = [];
    for (const selection of storeSelections) for (const market of selection.sellingRegions || []) for (const item of selection.packages || []) {
        const productCode = String(selection.productCode || "").toLowerCase();
        const packageCode = String(item.packageCode || "").toUpperCase();
        const region = String(market || "").toUpperCase();
        const pkg = packages.find(row => String(row.productCode || "").toLowerCase() === productCode && String(row.packageCode || "").toUpperCase() === packageCode);
        const price = pkg?.prices?.[region];
        if (purchasableProducts.has(productCode) && pkg?.enabled === true && price?.enabled !== false && Number(price?.amount) > 0 && published.has(`${productCode}:${packageCode}:${region}`)) customerFacingRoutes.push({ productCode, packageCode, region });
    }
    const uniqueCustomerFacingRoutes = [...new Map(customerFacingRoutes.map(row => [`${row.productCode}:${row.packageCode}:${row.region}`, row])).values()];
    const result = auditProductionActivation({ mappings, suppliers, offers, availabilityRows, packages, selections, successfulAttempts, catalog, customerFacingRoutes: uniqueCustomerFacingRoutes });
    progress("complete", { result: result.result, violations: result.violations.length, nonCustomerFacingFindings: result.nonCustomerFacingFindings.length });
    console.log(JSON.stringify(result, null, 2));
    if (result.violations.length) process.exitCode = 1;
}

const redact = value => String(value || "")
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, "[REDACTED_MONGODB_URI]")
    .replace(/(password|passwd|token|secret)=([^\s&]+)/gi, "$1=[REDACTED]");
withDeadline(main(), "production activation audit").catch(error => {
    const safeStack = redact(error?.stack || "").split("\n").slice(0, 12).join("\n");
    console.error(JSON.stringify({ result: "FAIL", code: error.code || "AUDIT_FAILED", message: redact(error.message), stack: safeStack || undefined }));
    process.exitCode = 1;
}).finally(async () => { await mongoose.disconnect().catch(() => null); });
