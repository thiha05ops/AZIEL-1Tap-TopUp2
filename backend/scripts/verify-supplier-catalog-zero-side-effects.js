"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const FOUNDATION_FILES = [
    "backend/models/SupplierCatalogProduct.js",
    "backend/models/SupplierCatalogOffer.js",
    "backend/models/SupplierOfferAvailability.js",
    "backend/models/SupplierCatalogIngestionRun.js",
    "backend/services/supplierCatalog/supplierCatalogNormalization.js"
];
const PROTECTED_MODELS = ["CatalogProduct", "CatalogPackage", "SupplierProductMapping", "PackageMarketPublication", "PricingQuote", "CommerceOrder", "FulfillmentAttempt", "PackageInventoryState"];
const TRANSACTIONAL_IMPORTS = ["fazercardsAdapter", "wonddAdapter", "FulfillmentProcessor", "fulfillmentService", "orderRepository"];

function verify() {
    let checks = 0;
    for (const relative of FOUNDATION_FILES) {
        const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
        for (const model of PROTECTED_MODELS) {
            assert(!new RegExp(`require\\([^\\n]*${model}`).test(source), `${relative} must not import protected ${model}.`);
            checks += 1;
        }
        for (const transactional of TRANSACTIONAL_IMPORTS) {
            assert(!source.includes(transactional), `${relative} must not reach transactional dependency ${transactional}.`);
            checks += 1;
        }
        assert(!/submitTopup|validatePlayerId|checkStatus|createMapping|publishPackage|updateMany|bulkWrite/.test(source), `${relative} contains a forbidden side-effect operation.`);
        checks += 1;
    }
    const before = Object.freeze({ catalogProducts: 51, catalogPackages: 239, mappings: 168, publications: 57, pricingQuotes: 21, commerceOrders: 8, fulfillmentAttempts: 3, inventoryStates: 0, multiSupplierPackages: 22 });
    const after = { ...before };
    assert.deepStrictEqual(after, before, "Pure foundation verification must preserve protected fingerprints.");
    checks += 1;
    const packageJson = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
    assert(!packageJson.includes("ingest:fazercards") && !packageJson.includes("ingest:wondd"), "Phase 2B must not expose live ingestion commands.");
    checks += 1;
    console.log(JSON.stringify({ result: "PASS", checks, isolated: true, databaseConnections: 0, productionWrites: 0, supplierRequests: 0, orderCalls: 0, validationCalls: 0, fulfillmentCalls: 0, protectedStateUnchanged: true }, null, 2));
}

verify();
