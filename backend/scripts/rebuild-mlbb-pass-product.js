#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");

const APPLY = process.argv.includes("--apply");
const PRODUCT_CODE = "mlbb-twilight-weekly-pass";
const PRODUCT_NAME = "Mobile Legends Twilight Pass & Weekly Diamonds";
const LEGACY_ALIASES = ["Mobile Legends Pass", "Mobile Legends Twilight Pass & Weekly Pass"];
const PACKAGE_CODES = ["MLBB_ONE_TIME_WEEKLY_PASS", "MLBB_TWILIGHT_MIYA_PASS"];
const HISTORICAL_COLLECTIONS = ["commerceorders", "orders", "pricingquotes", "paymentattempts", "fulfillmentattempts", "manualpaymentattempts"];
const stable = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function snapshot() {
    const [product, packages, mappings, historical] = await Promise.all([
        CatalogProduct.findOne({ productCode: PRODUCT_CODE }).lean(),
        CatalogPackage.find({ productCode: PRODUCT_CODE, packageCode: { $in: PACKAGE_CODES } }).sort({ packageCode: 1 }).lean(),
        SupplierProductMapping.find({ productCode: PRODUCT_CODE, packageCode: { $in: PACKAGE_CODES } }).sort({ _id: 1 }).lean(),
        Promise.all(HISTORICAL_COLLECTIONS.map(async collection => ({
            collection,
            count: await mongoose.connection.collection(collection).countDocuments({
                $or: [
                    { productCode: PRODUCT_CODE },
                    { "product.productCode": PRODUCT_CODE },
                    { "packageSnapshot.gameCode": PRODUCT_CODE },
                    { "fulfillment.routeSnapshot.productCode": PRODUCT_CODE }
                ]
            })
        })))
    ]);
    return { product, packages, mappings, historical };
}

function protectedPackage(row) {
    return { _id: String(row._id), productCode: row.productCode, packageCode: row.packageCode, name: row.name, prices: row.prices, enabled: row.enabled, aliases: row.aliases, productAliases: row.productAliases, canonicalSupplierCost: row.canonicalSupplierCost };
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const before = await snapshot();
    assert(before.product, "Canonical MLBB pass product is missing.");
    assert.strictEqual(before.packages.length, 2, "Expected the two active canonical pass entitlements.");
    const protectedPackagesBefore = stable(before.packages.map(protectedPackage));
    const mappingsBefore = stable(before.mappings);
    const historicalBefore = stable(before.historical);

    if (APPLY) {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                await CatalogProduct.updateOne(
                    { _id: before.product._id },
                    { $set: { name: PRODUCT_NAME }, $addToSet: { aliases: { $each: LEGACY_ALIASES } } },
                    { session }
                );
                await CatalogPackage.updateMany(
                    { productCode: PRODUCT_CODE, "packageFamily.code": "WEEKLY_PASS", deletedAt: null },
                    { $set: { "packageFamily.name": "Weekly Diamonds" } },
                    { session }
                );
            });
        } finally {
            await session.endSession();
        }
    }

    const after = await snapshot();
    if (APPLY) {
        assert.strictEqual(after.product.name, PRODUCT_NAME);
        for (const alias of LEGACY_ALIASES) assert(after.product.aliases.includes(alias), `Missing legacy alias: ${alias}`);
        assert(after.packages.find(row => row.packageCode === "MLBB_ONE_TIME_WEEKLY_PASS")?.packageFamily?.name === "Weekly Diamonds");
        assert(after.packages.find(row => row.packageCode === "MLBB_TWILIGHT_MIYA_PASS")?.packageFamily?.name === "Twilight Pass");
    }
    assert.strictEqual(stable(after.packages.map(protectedPackage)), protectedPackagesBefore, "Protected package identity, price, or state changed.");
    assert.strictEqual(stable(after.mappings), mappingsBefore, "Supplier mappings changed.");
    assert.strictEqual(stable(after.historical), historicalBefore, "Historical reference counts changed.");
    console.log(JSON.stringify({
        result: "PASS",
        mode: APPLY ? "APPLY" : "DRY_RUN",
        productId: String(after.product._id),
        productCode: PRODUCT_CODE,
        beforeName: before.product.name,
        afterName: APPLY ? after.product.name : PRODUCT_NAME,
        aliases: APPLY ? after.product.aliases : [...new Set([...(before.product.aliases || []), ...LEGACY_ALIASES])],
        packageIdsPreserved: after.packages.map(row => String(row._id)),
        packageCodesPreserved: after.packages.map(row => row.packageCode),
        mappingIdsPreserved: after.mappings.map(row => String(row._id)),
        historicalReferences: after.historical,
        realOrders: 0,
        realTopups: 0,
        priceChanges: 0
    }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
