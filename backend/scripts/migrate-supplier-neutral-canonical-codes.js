#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const CatalogProduct = require("../models/CatalogProduct");

const APPLY = process.argv.includes("--apply");
const PAIRS = Object.freeze([
    ["freefire","FF_WONDD_F00033","FF_33_DIA"],["freefire","FF_WONDD_F00068","FF_68_DIA"],["freefire","FF_WONDD_F00172","FF_172_DIA"],["freefire","FF_WONDD_F00517","FF_517_DIA"],["freefire","FF_WONDD_F00690","FF_690_DIA"],["freefire","FF_WONDD_F01052","FF_1052_DIA"],["freefire","FF_WONDD_F01801","FF_1801_DIA"],["freefire","FF_WONDD_F03698","FF_3698_DIA"],
    ["freefire","FF_WONDD_FBIG06","FF_LEVEL_6_UP_PASS"],["freefire","FF_WONDD_FBIG10","FF_LEVEL_10_UP_PASS"],["freefire","FF_WONDD_FBIG15","FF_LEVEL_15_UP_PASS"],["freefire","FF_WONDD_FBIG20","FF_LEVEL_20_UP_PASS"],["freefire","FF_WONDD_FBIG25","FF_LEVEL_25_UP_PASS"],["freefire","FF_WONDD_FBIG30","FF_LEVEL_30_UP_PASS"],["freefire","FF_WONDD_FBPC84","FF_BP_CARD"],["freefire","FF_WONDD_FDIM32","FF_WEEKLY_MEMBERSHIP_LITE"],["freefire","FF_WONDD_FDIM63","FF_WEEKLY_MEMBERSHIP"],["freefire","FF_WONDD_FMON280","FF_MONTHLY_MEMBERSHIP"],
    ["mlbb","MLBB_WONDD_ML00257","MLBB_257_DIA"],["mlbb","MLBB_WONDD_ML00275","MLBB_275_DIA"],["mlbb","MLBB_WONDD_ML00343","MLBB_343_DIA"],["mlbb","MLBB_WONDD_ML00600","MLBB_600_DIA"],["mlbb","MLBB_WONDD_ML00706","MLBB_706_DIA"],["mlbb","MLBB_WONDD_ML00792","MLBB_792_DIA"],["mlbb","MLBB_WONDD_ML01049","MLBB_1049_DIA"],["mlbb","MLBB_WONDD_ML02195","MLBB_2195_DIA"],["mlbb","MLBB_WONDD_ML03688","MLBB_3688_DIA"],["mlbb","MLBB_WONDD_ML05532","MLBB_5532_DIA"],["mlbb","MLBB_WONDD_ML09288","MLBB_9288_DIA"],
    ["mlbb","MLBB_WONDD_MLFT055","MLBB_55_DIA_FIRST_TOPUP"],["mlbb","MLBB_WONDD_MLFT165","MLBB_165_DIA_FIRST_TOPUP"],["mlbb","MLBB_WONDD_MLFT275","MLBB_275_DIA_FIRST_TOPUP"],["mlbb","MLBB_WONDD_MLFT565","MLBB_565_DIA_FIRST_TOPUP"],["mlbb","MLBB_WONDD_MLOTW01","MLBB_ONE_TIME_WEEKLY_PASS"],["mlbb","MLBB_WONDD_MLTMP01","MLBB_TWILIGHT_MIYA_PASS"]
].map(([productCode, oldCode, newCode]) => ({ productCode, oldCode, newCode })));

const HISTORICAL = Object.freeze({
    commerceorders: ["product.packageCode", "fulfilment.routeSnapshot.packageCode"],
    orders: ["packageCode"], pricingquotes: ["packageSnapshot.packageCode"],
    fulfillmentattempts: ["packageCode"], manualpaymentattempts: ["packageCode"]
});
const CURRENT = Object.freeze({ packageinventorystates: "packageCode", promocodes: "packageCode" });
const stable = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const packageEvidence = pkg => ({ name: pkg.name, family: pkg.packageFamily, prices: pkg.prices, enabled: pkg.enabled, sortOrder: pkg.sortOrder, metadata: pkg.metadata });

async function references(oldCode) {
    const historical = {};
    for (const [collection, paths] of Object.entries(HISTORICAL)) {
        historical[collection] = 0;
        for (const field of paths) historical[collection] += await mongoose.connection.collection(collection).countDocuments({ [field]: oldCode });
    }
    const current = {};
    for (const [collection, field] of Object.entries(CURRENT)) current[collection] = await mongoose.connection.collection(collection).countDocuments({ [field]: oldCode });
    current.pricingworkspacedrafts = await mongoose.connection.collection("pricingworkspacedrafts").countDocuments({ "packageRows.packageCode": oldCode });
    return { historical, current };
}

async function migrate(pair, refs, session) {
    const pkg = await CatalogPackage.findOne({ productCode: pair.productCode, packageCode: pair.oldCode, deletedAt: null }).session(session).lean();
    assert(pkg && pkg.enabled === true, `Missing enabled source ${pair.oldCode}.`);
    assert(!await CatalogPackage.exists({ productCode: pair.productCode, packageCode: pair.newCode }).session(session), `Target collision ${pair.newCode}.`);
    const beforeHash = stable(packageEvidence(pkg));
    await CatalogPackage.collection.updateOne({ _id: pkg._id }, { $set: { packageCode: pair.newCode, aliases: [...new Set([...(pkg.aliases || []), pair.oldCode])] } }, { session });
    await SupplierProductMapping.updateMany({ productCode: pair.productCode, packageCode: pair.oldCode }, { $set: { packageCode: pair.newCode } }, { session });
    for (const [collection, field] of Object.entries(CURRENT)) await mongoose.connection.collection(collection).updateMany({ [field]: pair.oldCode }, { $set: { [field]: pair.newCode } }, { session });
    await mongoose.connection.collection("pricingworkspacedrafts").updateMany({ "packageRows.packageCode": pair.oldCode }, { $set: { "packageRows.$[row].packageCode": pair.newCode } }, { arrayFilters: [{ "row.packageCode": pair.oldCode }], session });
    const products = await CatalogProduct.find({ "productKnowledge.packageGuide.groups.packageCodes": pair.oldCode }).session(session);
    for (const product of products) {
        for (const group of product.productKnowledge?.packageGuide?.groups || []) group.packageCodes = group.packageCodes.map(code => code === pair.oldCode ? pair.newCode : code);
        await product.save({ session });
    }
    const after = await CatalogPackage.findById(pkg._id).session(session).lean();
    assert.strictEqual(stable(packageEvidence(after)), beforeHash, `Package authority drifted for ${pair.oldCode}.`);
    return { ...pair, displayName: pkg.name, family: pkg.packageFamily?.code || "", prices: { TH: pkg.prices?.TH?.amount ?? null, MM: pkg.prices?.MM?.amount ?? null }, aliases: [pair.oldCode], references: refs };
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const before = { packages: await CatalogPackage.countDocuments({ deletedAt: null }), enabled: await CatalogPackage.countDocuments({ deletedAt: null, enabled: true }), mappings: await SupplierProductMapping.countDocuments({}), primary: await SupplierProductMapping.countDocuments({ productionRole: "PRIMARY" }) };
    if (!APPLY) {
        const rows = [];
        for (const pair of PAIRS) { const pkg = await CatalogPackage.findOne({ productCode: pair.productCode, packageCode: pair.oldCode }).lean(); rows.push({ ...pair, displayName: pkg?.name, family: pkg?.packageFamily?.code, references: await references(pair.oldCode) }); }
        console.log(JSON.stringify({ mode: "DRY_RUN", before, rows }, null, 2)); return;
    }
    const auditedReferences = new Map();
    for (const pair of PAIRS) auditedReferences.set(pair.oldCode, await references(pair.oldCode));
    const session = await mongoose.startSession(); let rows = [];
    try { await session.withTransaction(async () => { for (const pair of PAIRS) rows.push(await migrate(pair, auditedReferences.get(pair.oldCode), session)); }); } finally { await session.endSession(); }
    const after = { packages: await CatalogPackage.countDocuments({ deletedAt: null }), enabled: await CatalogPackage.countDocuments({ deletedAt: null, enabled: true }), mappings: await SupplierProductMapping.countDocuments({}), primary: await SupplierProductMapping.countDocuments({ productionRole: "PRIMARY" }) };
    assert.deepStrictEqual(after, before, "Package/mapping authority counts changed.");
    console.log(JSON.stringify({ mode: "APPLIED", before, after, migrated: rows.length, historicalReferences: rows.reduce((sum, row) => sum + Object.values(row.references.historical).reduce((total, count) => total + count, 0), 0), orders: 0, topups: 0, priceChanges: 0, gatesEnabled: 0 }, null, 2));
})().catch(error => { console.error("MIGRATION_FAILED:", error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
