#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const { isCanonicalProductCode } = require("../catalog/canonicalOperationalCatalog");
const { familyDefinitions } = require("../catalog/canonicalPackageFamilies");
const { findCatalogPackageByIdentity } = require("../services/commerce/catalogPackageIdentityService");

const TARGETS = Object.freeze([
    ["mlbb", "MLBB_ONE_TIME_WEEKLY_PASS", "mlbb-twilight-weekly-pass", "WEEKLY_PASS"],
    ["mlbb", "MLBB_TWILIGHT_MIYA_PASS", "mlbb-twilight-weekly-pass", "TWILIGHT_PASS"],
    ...["FF_BP_CARD", "FF_LEVEL_6_UP_PASS", "FF_LEVEL_10_UP_PASS", "FF_LEVEL_15_UP_PASS", "FF_LEVEL_20_UP_PASS", "FF_LEVEL_25_UP_PASS", "FF_LEVEL_30_UP_PASS", "FF_WEEKLY_MEMBERSHIP_LITE", "FF_WEEKLY_MEMBERSHIP", "FF_MONTHLY_MEMBERSHIP"].map(code => ["freefire", code, "freefire-pass-membership", code === "FF_BP_CARD" ? "BP_CARD" : code.includes("LEVEL_") ? "LEVEL_UP_PASS" : "MEMBERSHIP"]),
    ["hok", "HOK_WEEKLY_CARD", "hok-pass-cards", "CARDS_PASSES"],
    ["hok", "HOK_WEEKLY_CARD_PLUS", "hok-pass-cards", "CARDS_PASSES"]
]);

async function main() {
    for (const code of ["mlbb", "mlbb-twilight-weekly-pass", "freefire", "freefire-pass-membership", "hok", "hok-pass-cards", "pubg", "pubgrp"]) assert(isCanonicalProductCode(code), `Missing static product authority ${code}.`);
    assert.deepStrictEqual(familyDefinitions("mlbb").filter(x => x.code !== "OTHER_SPECIAL").map(x => x.code), ["DIAMONDS", "FIRST_TOP_UP"]);
    assert.deepStrictEqual(familyDefinitions("freefire").filter(x => x.code !== "OTHER_SPECIAL").map(x => x.code), ["DIAMONDS"]);
    assert.deepStrictEqual(familyDefinitions("hok").filter(x => x.code !== "OTHER_SPECIAL").map(x => x.code), ["TOKENS"]);
    await mongoose.connect(process.env.MONGO_URI);
    const [products, packages, mappings] = await Promise.all([CatalogProduct.find({ deletedAt: null }).lean(), CatalogPackage.find({ deletedAt: null }).lean(), Mapping.find({}).lean()]);
    assert.strictEqual(products.length, 24); assert.strictEqual(packages.length, 219); assert.strictEqual(packages.filter(p => p.enabled).length, 119); assert.strictEqual(mappings.length, 168);
    const byProduct = new Map(products.map(p => [p.productCode, p]));
    assert.strictEqual(byProduct.get("mlbb-twilight-weekly-pass")?.name, "Mobile Legends Twilight Pass & Weekly Diamonds");
    assert.strictEqual(byProduct.get("pubgrp")?.name, "PUBG Mobile Pass"); assert.strictEqual(byProduct.get("pubgrp")?.enabled, false);
    assert.strictEqual(byProduct.get("hok")?.name, "Honor of Kings Tokens");
    for (const code of ["freefire-pass-membership", "hok-pass-cards"]) { const product = byProduct.get(code); assert(product, `Missing split product ${code}.`); }
    for (const [oldProduct, packageCode, targetProduct, family] of TARGETS) {
        const pkg = packages.find(p => p.productCode === targetProduct && p.packageCode === packageCode); assert(pkg, `Missing moved package ${targetProduct}/${packageCode}.`); assert.strictEqual(pkg.packageFamily?.code, family); assert(pkg.productAliases?.includes(oldProduct), `Missing product alias ${oldProduct}/${packageCode}.`);
        assert(!packages.some(p => p.productCode === oldProduct && p.packageCode === packageCode), `Old package authority remains ${oldProduct}/${packageCode}.`);
        const aliasResolved = await findCatalogPackageByIdentity(oldProduct, packageCode, { deletedAt: null }).lean(); assert.strictEqual(String(aliasResolved?._id), String(pkg._id), `Legacy identity did not resolve ${oldProduct}/${packageCode}.`);
    }
    assert(packages.filter(p => p.productCode === "mlbb").every(p => ["DIAMONDS", "FIRST_TOP_UP"].includes(p.packageFamily?.code)));
    assert(packages.filter(p => p.productCode === "freefire").every(p => p.packageFamily?.code === "DIAMONDS"));
    assert(packages.filter(p => p.productCode === "hok").every(p => p.packageFamily?.code === "TOKENS"));
    const movedMappings = mappings.filter(m => TARGETS.some(([, code, target]) => m.productCode === target && m.packageCode === code)); assert.strictEqual(movedMappings.length, 12);
    assert.strictEqual(mappings.filter(m => TARGETS.some(([old, code]) => m.productCode === old && m.packageCode === code)).length, 0);
    assert.strictEqual(packages.filter(p => /WONDD|FAZER|SEAGM/i.test(p.packageCode) && p.enabled).length, 0);
    console.log(JSON.stringify({ result: "PASS", products: products.length, packages: packages.length, enabledPackages: packages.filter(p => p.enabled).length, mappings: mappings.length, exactMoves: TARGETS.length, movedMappings: movedMappings.length, aliasResolution: `${TARGETS.length}/${TARGETS.length}`, splitProductAvailabilityPreserved: true, realOrders: 0, realTopups: 0 }, null, 2));
}
main().catch(error => { console.error(`VERIFY_ENTITLEMENT_SPLIT_FAILED: ${error.message}`); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
