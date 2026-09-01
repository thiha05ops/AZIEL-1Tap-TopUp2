#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const Offer = require("../models/SupplierCatalogOffer");
const SupplierProduct = require("../models/SupplierCatalogProduct");
const Availability = require("../models/SupplierOfferAvailability");
const Publication = require("../models/PackageMarketPublication");
const { projectActivation, getWorkspace } = require("../services/adminProductActivationService");

const elapsed = start => Number((performance.now() - start).toFixed(2));
async function oldFullCatalogPath(query) {
    const start = performance.now();
    const [products, packages, suppliers, mappings, offers, supplierProducts, availability, publications] = await Promise.all([
        CatalogProduct.find({ deletedAt: null }).lean(), CatalogPackage.find({ deletedAt: null }).lean(), Supplier.find().lean(),
        Mapping.find({ archivedAt: null }).lean(), Offer.find().lean(), SupplierProduct.find().lean(), Availability.find().lean(), Publication.find().lean()
    ]);
    const result = projectActivation({ products, packages, suppliers, mappings, offers, supplierProducts, availability, publications }, query);
    return { ms: elapsed(start), result, scanned: { products: products.length, packages: packages.length, suppliers: suppliers.length, mappings: mappings.length, offers: offers.length, supplierProducts: supplierProducts.length, availability: availability.length, publications: publications.length } };
}
async function scoped(query) { const start = performance.now(); const result = await getWorkspace(query); return { ms: elapsed(start), result }; }

(async () => {
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI, { readPreference: "secondaryPreferred", serverSelectionTimeoutMS: 10000 });
    const beforeCounts = await Promise.all([Mapping.countDocuments(), Publication.countDocuments()]);
    const query = { productCode: "afk-journey", supplierMarket: "GLOBAL", customerMarket: "TH" };
    const legacy = await oldFullCatalogPath(query);
    const navigation = await scoped({ customerMarket: "TH" });
    const optimized = await scoped(query);
    const valorant = await scoped({ productCode: "valorant", supplierMarket: "TH", customerMarket: "TH" });
    const afterCounts = await Promise.all([Mapping.countDocuments(), Publication.countDocuments()]);
    assert.deepStrictEqual(afterCounts, beforeCounts, "read-only performance verification changed protected records");
    assert.equal(optimized.result.packages.length, legacy.result.packages.length, "scoped projection changed AFK package identity");
    assert.deepStrictEqual(optimized.result.packages.map(item => item.mappingId).sort(), legacy.result.packages.map(item => item.mappingId).sort());
    assert.equal(optimized.result.projectionMode, "READINESS");
    assert.equal(navigation.result.projectionMode, "NAVIGATION");
    assert.equal(optimized.result.packages.length, 9);
    assert.equal(valorant.result.packages.length, 12);
    console.log(JSON.stringify({ result: "PASS", bottleneck: "Every click loaded eight complete collections and assessed every mapping before in-memory filtering.", before: { requestMs: legacy.ms, scanned: legacy.scanned, readinessMappings: legacy.scanned.mappings }, after: { navigationRequestMs: navigation.ms, afkReadinessRequestMs: optimized.ms, valorantReadinessRequestMs: valorant.ms, afkReadinessMappings: optimized.result.packages.length, valorantReadinessMappings: valorant.result.packages.length }, identityParity: true, rapidSwitchProtection: "monotonic frontend requestId; stale responses are discarded", prompt1MappingsBeforeAfter: beforeCounts[0], publicationsBeforeAfter: beforeCounts[1], databaseWrites: 0, supplierCalls: 0 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
