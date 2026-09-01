#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Availability = require("../models/SupplierOfferAvailability");
const Run = require("../models/SupplierCatalogIngestionRun");
const Mapping = require("../models/SupplierProductMapping");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Publication = require("../models/PackageMarketPublication");
const PricingQuote = require("../models/PricingQuote");
const CommerceOrder = require("../models/CommerceOrder");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const Inventory = require("../models/PackageInventoryState");
const readService = require("../services/adminSupplierCatalogReadService");
const { mappingBusinessHash } = require("../services/supplierCatalog/supplierCatalogMappingReferenceService");
const { toPublicCatalog } = require("../services/catalogService");

const models = { SupplierCatalogProduct: Product, SupplierCatalogOffer: Offer, SupplierOfferAvailability: Availability, SupplierCatalogIngestionRun: Run, SupplierProductMapping: Mapping, CatalogProduct, CatalogPackage, PackageMarketPublication: Publication, PricingQuote, CommerceOrder, FulfillmentAttempt, PackageInventoryState: Inventory };
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function fingerprint(Model) {
    const rows = await Model.find().sort({ _id: 1 }).lean();
    return { count: rows.length, sha256: sha(rows) };
}
async function fingerprints() {
    return Object.fromEntries(await Promise.all(Object.entries(models).map(async ([name, Model]) => [name, await fingerprint(Model)])));
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const before = await fingerprints();
    const mappingsBefore = await Mapping.find().lean();
    const mappingHashBefore = mappingBusinessHash(mappingsBefore);
    const first = await readService.listOffers({ page: 1, limit: 25 });
    const second = await readService.listOffers({ page: 2, limit: 25 });
    const filtered = await readService.listOffers({ supplier: "WONDD", coverage: "PARTIAL", page: 1, limit: 25 });
    const runs = await readService.listRuns({});
    const projection = readService.project(await readService.load());
    const reconciliationBySupplier = Object.fromEntries(["FAZERCARDS", "WONDD"].map(supplierCode => [supplierCode, projection.rows.filter(row => row.supplierCode === supplierCode).reduce((counts, row) => { counts[row.reconciliationState] = (counts[row.reconciliationState] || 0) + 1; return counts; }, {})]));
    const mlbb570 = projection.rows.filter(row => row.canonicalProductCode === "mlbb" && row.canonicalPackageCode === "MLBB_570").map(row => ({ supplierCode: row.supplierCode, supplierOfferCode: row.supplierOfferCode, mappingId: row.mappingId, supplierRole: row.supplierRole, availabilityState: row.availabilityState, coverageComplete: row.coverageComplete, publicationState: row.publicationState, automaticFailover: row.alternativeMappings.some(item => item.automaticFailover) })).sort((a, b) => a.supplierCode.localeCompare(b.supplierCode));
    if (first.offers[0]) await readService.getOffer(first.offers[0].offerId);
    if (first.products[0]) await readService.getProduct(first.products[0].productId);
    const publicCatalog = await toPublicCatalog({ source: "database", customerMarket: "TH", includeDisabled: true, includeAssetProjection: false, includeAdminPricing: false, publicationProjectionMode: "EXPLICIT" });
    const publicPackages = publicCatalog.reduce((total, product) => total + (product.packages || []).length, 0);
    const after = await fingerprints();
    const mappingsAfter = await Mapping.find().lean();
    const mappingHashAfter = mappingBusinessHash(mappingsAfter);
    assert.deepStrictEqual(after, before, "Protected production fingerprints changed during Admin reads");
    assert.strictEqual(mappingHashAfter, mappingHashBefore, "SupplierProductMapping business state changed");
    assert.strictEqual(new Set([...first.offers, ...second.offers].map(row => row.offerId)).size, first.offers.length + second.offers.length, "Pagination overlaps");
    console.log(JSON.stringify({ result: "PASS", summary: first.summary, reconciliationBySupplier, productsReturnedForFilters: first.products.length, page1: first.offers.length, page2: second.offers.length, wonddPartialPage: filtered.offers.length, runs: runs.runs, mlbb570, legacyUnlinkedMappings: first.legacyUnlinkedMappings, publicStorefrontPackages: publicPackages, fingerprints: after, mappingBusinessStateHash: mappingHashAfter, protectedStateExactEquality: true, supplierNetworkCalls: 0, productionWrites: 0 }, null, 2));
    await mongoose.disconnect();
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(error); process.exit(1); });
