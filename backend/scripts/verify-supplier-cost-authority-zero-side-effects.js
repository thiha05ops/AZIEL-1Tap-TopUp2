#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { assertIsolatedMongoUri } = require("./lib/assertIsolatedMongoUri");

const URI_ENV = "AZIEL_SUPPLIER_COST_TEST_MONGO_URI";
const MODE_ENV = "AZIEL_SUPPLIER_COST_TEST_MODE";
const DATABASE_PREFIX = "aziel_supplier_cost_";

function resolveIsolatedSupplierCostUri(env = process.env) {
    if (String(env[MODE_ENV] || "").trim() !== "isolated") throw new Error("SUPPLIER_COST_TEST_ISOLATED_MODE_REQUIRED");
    if (String(env.MONGO_URI || "").trim() || String(env.MONGODB_URI || "").trim()) {
        throw new Error("SUPPLIER_COST_TEST_AMBIGUOUS_RUNTIME_URI_REJECTED");
    }
    const uri = String(env[URI_ENV] || "").trim();
    assertIsolatedMongoUri(uri, DATABASE_PREFIX);
    return uri;
}

async function main(env = process.env) {
    // Resolve and reject unsafe configuration before Mongoose can attempt a connection.
    const uri = resolveIsolatedSupplierCostUri(env);
    const mongoose = require("mongoose");
    const Product = require("../models/SupplierCatalogProduct");
    const Offer = require("../models/SupplierCatalogOffer");
    const Observation = require("../models/SupplierCatalogCostObservation");
    const Availability = require("../models/SupplierOfferAvailability");
    const Run = require("../models/SupplierCatalogIngestionRun");
    const Mapping = require("../models/SupplierProductMapping");
    const Change = require("../models/SupplierCostAuthorityChange");
    const Decision = require("../models/SupplierCatalogReconciliationDecision");
    const CatalogProduct = require("../models/CatalogProduct");
    const CatalogPackage = require("../models/CatalogPackage");
    const Publication = require("../models/PackageMarketPublication");
    const PricingQuote = require("../models/PricingQuote");
    const CommerceOrder = require("../models/CommerceOrder");
    const FulfillmentAttempt = require("../models/FulfillmentAttempt");
    const Inventory = require("../models/PackageInventoryState");
    const Supplier = require("../models/Supplier");
    const { compareSupplierCost } = require("../services/supplierCatalog/supplierCostComparisonService");
    const { mutationsEnabled } = require("../services/supplierCatalog/supplierCostAuthorityService");
    const { toPublicCatalog } = require("../services/catalogService");
    const { mappingBusinessHash } = require("../services/supplierCatalog/supplierCatalogMappingReferenceService");

    const models = {
        SupplierCatalogProduct: Product, SupplierCatalogOffer: Offer, SupplierCatalogCostObservation: Observation,
        SupplierOfferAvailability: Availability, SupplierCatalogIngestionRun: Run, SupplierProductMapping: Mapping,
        SupplierCostAuthorityChange: Change, SupplierCatalogReconciliationDecision: Decision, CatalogProduct,
        CatalogPackage, PackageMarketPublication: Publication, PricingQuote, CommerceOrder, FulfillmentAttempt,
        PackageInventoryState: Inventory
    };
    const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const fingerprint = async Model => {
        const rows = await Model.find().sort({ _id: 1 }).lean();
        return { count: rows.length, sha256: sha(rows) };
    };
    const all = async () => Object.fromEntries(await Promise.all(Object.entries(models).map(async ([name, Model]) => [name, await fingerprint(Model)])));

    mongoose.set("autoIndex", false);
    try {
        await mongoose.connect(uri, { readPreference: "primary", serverSelectionTimeoutMS: 10000 });
        const before = await all(), mappings = await Mapping.find().lean(), business = mappingBusinessHash(mappings);
        const [offers, suppliers] = await Promise.all([Offer.find().lean(), Supplier.find().lean()]);
        const bySupplier = new Map(suppliers.map(row => [String(row._id), row.supplierCode]));
        const byOffer = new Map(offers.map(row => [String(row._id), row]));
        const states = {};
        for (const mapping of mappings.filter(row => row.supplierCatalogOfferId)) {
            const state = compareSupplierCost(byOffer.get(String(mapping.supplierCatalogOfferId))?.supplierCost, mapping.supplierCostAuthority).state;
            states[state] = (states[state] || 0) + 1;
        }
        const availability = await Availability.find().lean(), availabilityBySupplier = {};
        for (const row of availability) {
            const code = bySupplier.get(String(byOffer.get(String(row.supplierCatalogOfferId))?.supplierId)) || "UNKNOWN";
            availabilityBySupplier[code] ??= { AVAILABLE: 0, UNAVAILABLE: 0, UNKNOWN: 0, complete: 0, partial: 0 };
            availabilityBySupplier[code][row.state] += 1;
            availabilityBySupplier[code][row.coverageComplete ? "complete" : "partial"] += 1;
        }
        const storefront = (await toPublicCatalog({ source: "database", customerMarket: "TH", includeDisabled: true, publicationProjectionMode: "EXPLICIT" }))
            .reduce((count, product) => count + (product.packages || []).length, 0);
        const after = await all(), afterBusiness = mappingBusinessHash(await Mapping.find().lean());
        assert.deepStrictEqual(after, before);
        assert.strictEqual(afterBusiness, business);
        assert(!mutationsEnabled());
        assert.strictEqual(after.SupplierCatalogCostObservation.count, 0);
        assert.strictEqual(after.SupplierCostAuthorityChange.count, 0);
        console.log(JSON.stringify({
            result: "PASS", isolated: true, databasePrefix: DATABASE_PREFIX,
            data: { offers: offers.length, mappings: mappings.length, linked: mappings.filter(row => row.supplierCatalogOfferId).length, legacyUnlinked: mappings.filter(row => !row.supplierCatalogOfferId).length, comparisonStates: states, availabilityBySupplier, decisions: after.SupplierCatalogReconciliationDecision.count, publications: after.PackageMarketPublication.count, storefront, costObservations: after.SupplierCatalogCostObservation.count, costAuthorityChanges: after.SupplierCostAuthorityChange.count },
            mutationGate: { resolved: false, default: false }, fingerprints: after, mappingBusinessStateHash: afterBusiness,
            exactEquality: true, databaseWrites: 0, productionConnections: 0, indexEffects: "NONE (autoIndex disabled)",
            supplierNetworkCalls: { catalog: 0, balance: 0, validation: 0, order: 0, status: 0, fulfillment: 0 }
        }, null, 2));
    } finally {
        await mongoose.disconnect().catch(() => null);
    }
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch(error => {
        console.error(error.code || error.message || error);
        process.exit(1);
    });
}

module.exports = Object.freeze({ DATABASE_PREFIX, MODE_ENV, URI_ENV, resolveIsolatedSupplierCostUri, main });
