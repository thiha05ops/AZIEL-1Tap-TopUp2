#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");

const APPLY = process.argv.includes("--apply");
const GROUPS = Object.freeze([
    ...[325, 660, 1800, 3850, 8100].map(value => ({
        productCode: "pubg",
        canonicalCode: `PUBG_${value}_UC`,
        canonicalName: `${value} UC`,
        sourceCodes: [`PUBG_FAZER_${value}_UC`, `PUBG_WONDD_UC${String(value).padStart(5, "0")}`],
        createFrom: `PUBG_FAZER_${value}_UC`
    })),
    ...[475, 1000, 2050, 3650, 5350, 11000].map(value => ({
        productCode: "valorant",
        canonicalCode: `VALORANT_${value}_VP`,
        canonicalName: `${value} VP`,
        sourceCodes: [`VAL_WONDD_VL${String(value).padStart(5, "0")}`]
    }))
]);

function plain(value) {
    const result = value.toObject({ depopulate: true, versionKey: false });
    delete result._id; delete result.createdAt; delete result.updatedAt; delete result.deletedAt; delete result.deletedBy;
    return result;
}

async function consolidate(group, session) {
    const codes = [group.canonicalCode, ...group.sourceCodes];
    const packages = await CatalogPackage.find({ productCode: group.productCode, packageCode: { $in: codes } }).session(session);
    const byCode = new Map(packages.map(item => [item.packageCode, item]));
    const sources = group.sourceCodes.map(code => byCode.get(code)).filter(Boolean);
    assert(sources.length === group.sourceCodes.length, `Missing proven source package for ${group.canonicalCode}.`);

    let canonical = byCode.get(group.canonicalCode);
    if (!canonical) {
        const template = byCode.get(group.createFrom);
        assert(template, `Missing canonical template ${group.createFrom}.`);
        canonical = new CatalogPackage({
            ...plain(template),
            packageCode: group.canonicalCode,
            name: group.canonicalName,
            aliases: [...new Set([...(template.aliases || []), ...group.sourceCodes])],
            source: "admin",
            metadata: {
                ...(template.metadata || {}),
                canonicalConsolidation: { authority: "EXACT_PROVIDER_RECONCILIATION", consolidatedAt: new Date(), sourceCodes: group.sourceCodes }
            }
        });
        await canonical.save({ session });
    } else {
        canonical.name = group.canonicalName;
        canonical.aliases = [...new Set([...(canonical.aliases || []), ...group.sourceCodes])];
        canonical.metadata = {
            ...(canonical.metadata || {}),
            canonicalConsolidation: { authority: "EXACT_PROVIDER_RECONCILIATION", consolidatedAt: new Date(), sourceCodes: group.sourceCodes }
        };
        await canonical.save({ session });
    }

    const mappings = await SupplierProductMapping.find({ productCode: group.productCode, packageCode: { $in: group.sourceCodes } }).session(session);
    for (const mapping of mappings) {
        mapping.packageCode = group.canonicalCode;
        await mapping.save({ session });
    }
    await CatalogPackage.updateMany(
        { productCode: group.productCode, packageCode: { $in: group.sourceCodes } },
        { $set: { enabled: false, deletedAt: new Date(), deletedBy: "canonical-routing-cleanup" } },
        { session }
    );
    return { ...group, mappingsMoved: mappings.length };
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const before = {
        packages: await CatalogPackage.countDocuments({ deletedAt: null }),
        mappings: await SupplierProductMapping.countDocuments({})
    };
    if (!APPLY) {
        console.log(JSON.stringify({ mode: "DRY_RUN", before, groups: GROUPS, orders: 0, topups: 0, publications: 0 }, null, 2));
        return;
    }
    const session = await mongoose.startSession();
    let results;
    try {
        await session.withTransaction(async () => {
            results = [];
            for (const group of GROUPS) results.push(await consolidate(group, session));
        });
    } finally { await session.endSession(); }
    const after = {
        packages: await CatalogPackage.countDocuments({ deletedAt: null }),
        mappings: await SupplierProductMapping.countDocuments({})
    };
    assert.strictEqual(after.mappings, before.mappings, "Supplier mapping count changed.");
    assert.strictEqual(await SupplierProductMapping.countDocuments({ productionRole: "PRIMARY" }), 0, "PRIMARY mapping unexpectedly exists.");
    console.log(JSON.stringify({ mode: "APPLIED", before, after, results, orders: 0, topups: 0, publications: 0 }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
