#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogPackage = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const { getCatalogProductDetail, resolveAdminCatalogProduct } = require("../services/catalogService");
const { loadFulfillmentCapability } = require("../services/fulfillmentCapabilityService");

const THAI = /[\u0E00-\u0E7F]/;

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const [allPackages, allMappings, publicProduct, adminProduct] = await Promise.all([
        CatalogPackage.find({ productCode: "mlbb", deletedAt: null }).lean(),
        Mapping.find({ productCode: "mlbb", region: "TH" }).lean(),
        getCatalogProductDetail("mlbb", { source: "database", includeDisabled: false, includeAdminPricing: false }),
        resolveAdminCatalogProduct("mlbb", { includeAdminPricing: true })
    ]);
    const exactMappings = allMappings.filter(mapping =>
        mapping.supplierCode === "WONDD" && mapping.supplierProductCode === "mlbb" &&
        Boolean(String(mapping.supplierPackageCode || "").trim()) && mapping.executionMode === "API" && mapping.enabled === true
    );
    assert.strictEqual(allPackages.length, 34, "Canonical catalog must retain all 34 MLBB packages.");
    assert(adminProduct.packages.length >= allPackages.length, "Admin must retain every active canonical package, including historical soft-deleted records.");
    allPackages.forEach(pkg => assert(adminProduct.packages.some(item => item.packageCode === pkg.packageCode), `${pkg.packageCode} missing from Admin.`));
    assert.strictEqual(exactMappings.length, 20, "WonDD MLBB whitelist must contain exactly 20 mappings.");
    assert.strictEqual(publicProduct.packages.length, 20, "Public MLBB projection must contain only the production-ready whitelist.");
    assert.strictEqual(new Set(publicProduct.packages.map(pkg => pkg.packageCode)).size, 20);

    for (const pkg of publicProduct.packages) {
        assert(!THAI.test(pkg.name), `${pkg.packageCode} exposes Thai supplier text.`);
        assert.strictEqual(Object.hasOwn(pkg.prices.TH, "supplierCost"), false, `${pkg.packageCode} exposes supplier cost.`);
        const capability = await loadFulfillmentCapability({ productCode: "mlbb", packageCode: pkg.packageCode, region: "TH" });
        assert.strictEqual(capability.fulfillmentAvailable, true);
        assert.strictEqual(capability.manualAdminAllowed, false);
        assert.strictEqual(capability.eligibleRoutes.length, 1, `${pkg.packageCode} must resolve to exactly one supplier route.`);
        assert.strictEqual(capability.eligibleRoutes[0].mapping.supplierCode, "WONDD");
        assert(Number(pkg.prices.TH.amount) > Number(allPackages.find(item => item.packageCode === pkg.packageCode).prices.TH.supplierCost));
    }

    const visibleCodes = new Set(publicProduct.packages.map(pkg => pkg.packageCode));
    const hidden = allPackages.filter(pkg => !visibleCodes.has(pkg.packageCode));
    assert.strictEqual(hidden.length, 14);
    for (const pkg of hidden) {
        const capability = await loadFulfillmentCapability({ productCode: "mlbb", packageCode: pkg.packageCode, region: "TH" });
        assert.strictEqual(capability.fulfillmentAvailable, false, `${pkg.packageCode} must not enter checkout.`);
        assert.strictEqual(capability.manualAdminAllowed, false, `${pkg.packageCode} must not fall back to MANUAL_ADMIN.`);
        const admin = adminProduct.packages.find(item => item.packageCode === pkg.packageCode);
        assert(admin, `${pkg.packageCode} missing from Admin.`);
        assert.strictEqual(admin.supplierSupport?.TH?.status, "UNSUPPORTED_WONDD");
    }

    const ml86 = exactMappings.find(mapping => mapping.packageCode === "MLBB_86");
    assert.strictEqual(ml86?.supplierPackageCode, "ML00086");
    assert.strictEqual(publicProduct.packages.find(pkg => pkg.packageCode === "MLBB_86")?.name, "86 Diamonds");
    assert.strictEqual(adminProduct.packages.filter(pkg => pkg.supplierSupport?.TH?.status === "SUPPORTED_READY").length, 20);
    assert.strictEqual(adminProduct.packages.filter(pkg => pkg.supplierSupport?.TH?.status === "SUPPORTED_NOT_READY").length, 0);
    await mongoose.disconnect();
    console.log(JSON.stringify({ result: "PASS", canonical: 34, mapped: 20, productionReady: 20, storefrontVisible: 20, unsupported: 14, supportedNotReady: 0, topupCalls: 0 }, null, 2));
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error("MLBB storefront authority verifier failed:", error.message); process.exitCode = 1; });
