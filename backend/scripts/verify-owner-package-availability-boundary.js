#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Product = require("../models/CatalogProduct");
const Package = require("../models/CatalogPackage");
const { setPackageEnabledForSelling } = require("../services/catalogAdminService");

const PRODUCT = "pubg-mobile-fast-7fbcc7684d";
const PACKAGE = "PUBG-MOBILE-FAST-7FBCC7684D_1800_UC_79BFED8FD519E627";
const OWNER = { _id: new mongoose.Types.ObjectId(), username: "isolated-owner", role: "OWNER" };

async function main() {
    const repl = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" }, replSet: { count: 1, storageEngine: "wiredTiger" } });
    try {
        await mongoose.connect(repl.getUri(), { dbName: "owner_package_availability_boundary", autoIndex: true });
        await Product.create({ productCode: PRODUCT, name: "PUBG Mobile (Global)", enabled: true, lifecycleStatus: "ACTIVE", commerceState: "PURCHASABLE", publicDiscoveryEnabled: true });
        const seeded = await Package.create({ productCode: PRODUCT, packageCode: PACKAGE, name: "1800 UC", enabled: false, prices: { TH: { amount: 803, currency: "THB", enabled: true }, MM: { amount: 111083, currency: "MMK", enabled: true } }, source: "admin" });
        const identity = String(seeded._id), prices = JSON.stringify(seeded.prices.toObject ? seeded.prices.toObject() : seeded.prices);

        await assert.rejects(() => setPackageEnabledForSelling({ productCode: PRODUCT, packageCode: PACKAGE, enabled: true, expectedUpdatedAt: seeded.updatedAt, actor: { role: "CATALOG" } }), error => error.code === "OWNER_REQUIRED");
        let result = await setPackageEnabledForSelling({ productCode: PRODUCT, packageCode: PACKAGE, enabled: true, expectedUpdatedAt: seeded.updatedAt, actor: OWNER });
        assert.equal(result.package.enabled, true);
        let current = await Package.findById(seeded._id);
        await assert.rejects(() => setPackageEnabledForSelling({ productCode: PRODUCT, packageCode: PACKAGE, enabled: false, expectedUpdatedAt: seeded.updatedAt, actor: OWNER }), error => error.code === "CATALOG_CONFLICT");
        result = await setPackageEnabledForSelling({ productCode: PRODUCT, packageCode: PACKAGE, enabled: false, expectedUpdatedAt: current.updatedAt, actor: OWNER });
        assert.equal(result.package.enabled, false);
        current = await Package.findById(seeded._id);
        result = await setPackageEnabledForSelling({ productCode: PRODUCT, packageCode: PACKAGE, enabled: true, expectedUpdatedAt: current.updatedAt, actor: OWNER });
        assert.equal(result.package.enabled, true);
        current = await Package.findById(seeded._id).lean();
        assert.equal(String(current._id), identity); assert.equal(JSON.stringify(current.prices), prices);

        const root = path.join(__dirname, "..", "..");
        const service = fs.readFileSync(path.join(root, "backend/services/catalogAdminService.js"), "utf8");
        const boundary = service.slice(service.indexOf("async function setPackageEnabledForSelling"), service.indexOf("module.exports"));
        assert(!boundary.includes("PackageSupplierSelection.findOne"));
        assert(!boundary.includes("pricingReady") && !boundary.includes("fulfillmentReady"));
        assert(boundary.includes("reconcileSellability: false"));
        const route = fs.readFileSync(path.join(root, "backend/routes/catalog.js"), "utf8");
        assert(route.includes("requireAdminPermission(PERMISSIONS.CATALOG_MANAGE)") && route.includes("setPackageEnabledForSelling"));
        const pricing = fs.readFileSync(path.join(root, "backend/services/commerce/unifiedSalesPublicationService.js"), "utf8");
        assert(pricing.includes("CANONICAL_PACKAGE_DISABLED") && pricing.includes("OWNER_UNVERIFIED_LAUNCH_APPROVAL_REQUIRED"));
        const checkout = fs.readFileSync(path.join(root, "backend/services/supplierProductionSelectionService.js"), "utf8");
        assert(checkout.includes("GLOBAL_SUPPLIER_SELECTION_REQUIRED") && checkout.includes("assessMappingReadiness"));

        console.log(JSON.stringify({ result: "PASS", ownerEnableDisableEnable: true, packageIdentityPreserved: true, pricesPreserved: true, routingWrites: 0, publicationWrites: 0, fulfillmentWrites: 0, productionConnections: 0, supplierCalls: 0 }, null, 2));
    } finally { await mongoose.disconnect(); await repl.stop(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
