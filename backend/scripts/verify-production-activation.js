#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Mapping = require("../models/SupplierProductMapping");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { assessProductionMapping, resolveCheckoutRouteSnapshot } = require("../services/supplierProductionSelectionService");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const { projectCatalogProduct } = require("../services/catalogService");

const sensitiveKeys = /supplierCost|landedCost|rawSupplier|providerOffer|supplierPackage|costAuthority|supplierProduct/i;
async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const mappings = await Mapping.find({}).lean();
    const attempts = await FulfillmentAttempt.find({ supplierMappingId: { $ne: null } }).select("supplierMappingId status supplierReference").lean();
    const evidence = new Map();
    for (const item of attempts) { const key = String(item.supplierMappingId); const value = evidence.get(key) || { succeeded: 0, total: 0 }; value.total += 1; if (item.status === "SUCCEEDED" && item.supplierReference) value.succeeded += 1; evidence.set(key, value); }
    const groups = new Map();
    for (const mapping of mappings) { const key = `${mapping.productCode}:${mapping.packageCode}:${mapping.region}`; groups.set(key, [...(groups.get(key) || []), mapping]); }
    const violations = [];
    for (const [key, rows] of groups) {
        const primary = rows.filter(item => item.productionRole === "PRIMARY");
        if (primary.length > 1) violations.push({ key, code: "MULTIPLE_PRIMARY" });
        for (const mapping of primary) {
            const assessment = await assessProductionMapping(mapping);
            const test = evidence.get(String(mapping._id));
            const blockers = [...assessment.blockers];
            const controlledTestWarning = !test?.succeeded;
            if (mapping.archivedAt) blockers.push("ORPHAN_OR_ARCHIVED_PRIMARY");
            if (blockers.length) violations.push({ key, mappingId: String(mapping._id), supplier: mapping.supplierCode, blockers: [...new Set(blockers)] });
            else if (controlledTestWarning) mapping.controlledTestWarning = "CONTROLLED_TEST_EVIDENCE_MISSING";
        }
    }
    const archivedRoutable = mappings.filter(item => item.archivedAt && (item.enabled || item.productionRole !== "DISABLED"));
    archivedRoutable.forEach(item => violations.push({ mappingId: String(item._id), code: "ARCHIVED_MAPPING_ROUTABLE" }));
    const products = await CatalogProduct.find({ enabled: true, deletedAt: null, publicDiscoveryEnabled: true }).lean();
    const packages = await CatalogPackage.find({ enabled: true, deletedAt: null, productCode: { $in: products.map(item => item.productCode) } }).lean();
    const catalog = products.map(product => projectCatalogProduct(product, packages.filter(pkg => pkg.productCode === product.productCode), { includeDisabled: false, includeAdminPricing: false })).filter(Boolean);
    const leaked = [];
    function scan(value, trail = "catalog") { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { if (sensitiveKeys.test(key)) leaked.push(`${trail}.${key}`); else scan(child, `${trail}.${key}`); } }
    scan(catalog);
    if (leaked.length) violations.push({ code: "SUPPLIER_COST_PUBLIC_LEAKAGE", fields: leaked.slice(0, 20) });
    const publicPackages = (catalog || []).flatMap(product => (product.packages || []).map(pkg => ({ productCode: product.productCode, packageCode: pkg.packageCode, regions: Object.keys(pkg.prices || {}) })));
    const routeChecks = publicPackages.flatMap(pkg => pkg.regions.map(region => ({ pkg, region })));
    await Promise.all(routeChecks.map(async ({ pkg, region }) => {
        const route = await resolveCheckoutRouteSnapshot({ ...pkg, region });
        if (!route.ready || !route.routeSnapshot) violations.push({ key: `${pkg.productCode}:${pkg.packageCode}:${region}`, code: "PUBLIC_CHECKOUT_ROUTE_MISSING", blockers: route.blockers });
    }));
    console.log(JSON.stringify({ result: violations.length ? "FAIL" : "PASS", mappings: mappings.length, primaryMappings: mappings.filter(item => item.productionRole === "PRIMARY").length, archivedMappings: mappings.filter(item => item.archivedAt).length, publicProducts: catalog.length, publicPackages: publicPackages.length, violations }, null, 2));
    await mongoose.disconnect();
    if (violations.length) process.exitCode = 1;
}
main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode = 1; });
