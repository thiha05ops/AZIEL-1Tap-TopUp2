#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Product = require("../models/CatalogProduct");
const Package = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const { getCanonicalProduct, resolveCanonicalProductRoute } = require("../catalog/canonicalOperationalCatalog");
const { inputContractForProduct } = require("../services/commerce/canonicalGameInputContract");
const { buildWonddGameId } = require("../services/suppliers/wonddGameIdFormatters");
const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const CODE = "mlbb-twilight-weekly-pass";
const NAME = "Mobile Legends Twilight Pass & Weekly Diamonds";

async function main() {
    assert.strictEqual(getCanonicalProduct("mlbb").name, "Mobile Legends Diamonds");
    assert.strictEqual(getCanonicalProduct(CODE).name, NAME);
    assert.strictEqual(resolveCanonicalProductRoute(CODE), "mlbb.html?product=mlbb-twilight-weekly-pass");
    assert.deepStrictEqual(inputContractForProduct(CODE).required, ["userId", "zoneId"]);
    assert.strictEqual(buildWonddGameId(CODE, { userId: "439488505", zoneId: "2409" }), "439488505 2409");
    const html = read("frontend/mlbb.html"); const js = read("frontend/js/mlbb.js"); const generic = read("frontend/js/product-detail.js");
    for (const text of ["Enter User ID", "Enter Zone ID", "Check your User ID and Zone ID carefully before checkout."]) assert(html.includes(text), `Missing MLBB-family copy: ${text}`);
    assert(js.includes(NAME) && js.includes('gameKey: productCode') && js.includes('productCode,'));
    assert(generic.includes('window.location.replace("mlbb.html?product=mlbb-twilight-weekly-pass")'));
    assert(!js.includes("Account ID / Username")); assert(!js.includes("Enter account ID or username"));
    await mongoose.connect(process.env.MONGO_URI);
    const [product, packages, mappings] = await Promise.all([
        Product.findOne({ productCode: CODE }).lean(),
        Package.find({ productCode: CODE, packageCode: { $in: ["MLBB_ONE_TIME_WEEKLY_PASS", "MLBB_TWILIGHT_MIYA_PASS"] }, deletedAt: null }).sort({ packageCode: 1 }).lean(),
        Mapping.find({ productCode: CODE, packageCode: { $in: ["MLBB_ONE_TIME_WEEKLY_PASS", "MLBB_TWILIGHT_MIYA_PASS"] } }).sort({ _id: 1 }).lean()
    ]);
    assert.strictEqual(product.name, NAME); assert(product.aliases.includes("Mobile Legends Pass"));
    assert.strictEqual(packages.length, 2); assert.strictEqual(new Set(packages.map(row => row.packageCode)).size, 2);
    assert.strictEqual(packages.find(row => row.packageCode === "MLBB_ONE_TIME_WEEKLY_PASS").packageFamily.name, "Weekly Diamonds");
    assert.strictEqual(packages.find(row => row.packageCode === "MLBB_TWILIGHT_MIYA_PASS").packageFamily.name, "Twilight Pass");
    assert.strictEqual(mappings.length, 2); assert(mappings.every(row => row.supplierCode === "WONDD" && row.supplierProductCode === "mlbb"));
    console.log(JSON.stringify({ result: "PASS", productId: String(product._id), productCode: CODE, packages: packages.map(row => ({ id: String(row._id), code: row.packageCode, name: row.name, family: row.packageFamily.name, thPrice: row.prices?.TH?.amount })), mappings: mappings.map(row => ({ id: String(row._id), packageCode: row.packageCode, packcode: row.supplierPackageCode })), realOrders: 0, realTopups: 0, providerCalls: 0 }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
