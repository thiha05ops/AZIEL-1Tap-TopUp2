#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");

const APPLY = process.argv.includes("--apply");
const REFRESH_REPORT = process.argv.includes("--refresh-report");
const OUT_JSON = path.resolve(__dirname, "../../docs/canonical-product-entitlement-split.json");
const OUT_MD = path.resolve(__dirname, "../../docs/canonical-product-entitlement-split.md");
const TARGET_PRODUCTS = Object.freeze({
    "mlbb-twilight-weekly-pass": { name: "Mobile Legends Twilight Pass & Weekly Diamonds", source: "mlbb", create: false },
    "freefire-pass-membership": { name: "Free Fire Pass & Membership", source: "freefire", create: true },
    "hok-pass-cards": { name: "Honor of Kings Pass & Cards", source: "hok", create: true },
    pubgrp: { name: "PUBG Mobile Pass", source: "pubgrp", create: false },
    hok: { name: "Honor of Kings Tokens", source: "hok", create: false }
});
const MOVES = Object.freeze([
    ["mlbb", "MLBB_ONE_TIME_WEEKLY_PASS", "mlbb-twilight-weekly-pass", "MOVE_TO_EXISTING_PRODUCT"],
    ["mlbb", "MLBB_TWILIGHT_MIYA_PASS", "mlbb-twilight-weekly-pass", "MOVE_TO_EXISTING_PRODUCT"],
    ...["FF_BP_CARD", "FF_LEVEL_6_UP_PASS", "FF_LEVEL_10_UP_PASS", "FF_LEVEL_15_UP_PASS", "FF_LEVEL_20_UP_PASS", "FF_LEVEL_25_UP_PASS", "FF_LEVEL_30_UP_PASS", "FF_WEEKLY_MEMBERSHIP_LITE", "FF_WEEKLY_MEMBERSHIP", "FF_MONTHLY_MEMBERSHIP"].map(code => ["freefire", code, "freefire-pass-membership", "MOVE_TO_NEW_PRODUCT"]),
    ["hok", "HOK_WEEKLY_CARD", "hok-pass-cards", "MOVE_TO_NEW_PRODUCT"],
    ["hok", "HOK_WEEKLY_CARD_PLUS", "hok-pass-cards", "MOVE_TO_NEW_PRODUCT"]
].map(([from, packageCode, to, action]) => ({ from, packageCode, to, action })));
const HISTORICAL = Object.freeze({
    commerceorders: ["product.productCode", "product.packageCode", "fulfillment.routeSnapshot.productCode", "fulfillment.routeSnapshot.packageCode"],
    orders: ["productCode", "packageCode"], pricingquotes: ["packageSnapshot.gameCode", "packageSnapshot.packageCode"],
    paymentattempts: ["productCode", "packageCode", "orderSnapshot.productCode", "orderSnapshot.packageCode"],
    fulfillmentattempts: ["productCode", "packageCode"], manualpaymentattempts: ["productCode", "packageCode"]
});
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cleanDoc = value => JSON.parse(JSON.stringify(value));
const protectedPackage = row => ({ _id: String(row._id), packageCode: row.packageCode, name: row.name, family: row.packageFamily, prices: row.prices, canonicalSupplierCost: row.canonicalSupplierCost, aliases: row.aliases, enabled: row.enabled, sortOrder: row.sortOrder, metadata: row.metadata, deletedAt: row.deletedAt });
const protectedMapping = row => { const copy = cleanDoc(row); delete copy.productCode; delete copy.updatedAt; delete copy.__v; return copy; };
const isPublicProduct = p => p.enabled === true && p.deletedAt == null && p.publicDiscoveryEnabled === true && p.commerceState === "PURCHASABLE";
const publicPackageCount = (products, packages) => { const visible = new Set(products.filter(isPublicProduct).map(p => p.productCode)); return packages.filter(p => p.enabled === true && p.deletedAt == null && visible.has(p.productCode) && ["MM", "TH"].some(region => p.prices?.[region]?.enabled === true && Number(p.prices[region].amount) > 0)).length; };

const atPath = (row, field) => field.split(".").reduce((value, key) => value?.[key], row);
async function historicalCounts(packages) {
    const result = new Map(packages.map(pkg => [`${pkg.productCode}:${pkg.packageCode}`, { total: 0, details: {} }]));
    const productCodes = [...new Set(packages.map(pkg => pkg.productCode))]; const packageCodes = packages.map(pkg => pkg.packageCode);
    for (const [collection, fields] of Object.entries(HISTORICAL)) {
        const packageFields = fields.filter(field => field.toLowerCase().includes("package"));
        if (!packageFields.length) continue;
        const projection = Object.fromEntries(packageFields.map(field => [field, 1]));
        const clauses = packageFields.map(field => ({ [field]: { $in: packageCodes } }));
        const docs = await mongoose.connection.collection(collection).find({ $or: clauses }, { projection }).toArray();
        for (const pkg of packages) {
            const count = docs.reduce((sum, doc) => sum + packageFields.filter(field => atPath(doc, field) === pkg.packageCode).length, 0);
            const entry = result.get(`${pkg.productCode}:${pkg.packageCode}`); entry.details[collection] = count; entry.total += count;
        }
    }
    return result;
}

function summarize(products, packages, mappings) {
    return { products: products.filter(p => p.deletedAt == null).length, nonDeletedPackages: packages.filter(p => p.deletedAt == null).length, enabledPackages: packages.filter(p => p.deletedAt == null && p.enabled).length, publicPackages: publicPackageCount(products, packages), supplierMappings: mappings.length };
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    if (REFRESH_REPORT) {
        const report = JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
        const refs = await historicalCounts(report.matrix.map(row => ({ productCode: row.currentProductCode, packageCode: row.packageCode })));
        for (const row of report.matrix) row.historicalReferenceCount = refs.get(`${row.currentProductCode}:${row.packageCode}`)?.total || 0;
        fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
        const moved = report.matrix.filter(row => row.migrationAction.startsWith("MOVE_"));
        const rows = moved.map(row => `| ${row.currentProductCode} | ${row.packageCode} | ${row.currentFamily} | ${row.targetProductCode} | ${row.supplierMappings.join("<br>") || "—"} | ${row.THPrice ?? "—"} | ${row.MMPrice ?? "—"} | ${row.historicalReferenceCount} |`).join("\n");
        fs.writeFileSync(OUT_MD, `# Canonical product entitlement split — Phase 1\n\nGenerated: ${report.generatedAt}\n\n## Authority counts\n\n| Metric | Before | After |\n|---|---:|---:|\n${Object.keys(report.before).map(key => `| ${key} | ${report.before[key]} | ${report.after[key]} |`).join("\n")}\n\n## Exact package moves\n\n| From | Package | Family | To | Supplier mappings | TH | MM | Historical refs |\n|---|---|---|---|---|---:|---:|---:|\n${rows}\n\nThe complete ${report.matrix.length}-row migration matrix and per-row authority evidence are in \`canonical-product-entitlement-split.json\`. Historical snapshots were audited and not rewritten. New split products are disabled, hidden, and excluded from discovery. Prices, package IDs, package codes, mappings, roles, gates, and supplier cost evidence were preserved.\n`);
        console.log(JSON.stringify({ result: "PASS", mode: "REFRESH_REPORT", rows: report.matrix.length })); return;
    }
    const [productsBefore, packagesBefore, mappingsBefore] = await Promise.all([CatalogProduct.find({}).sort({ productCode: 1 }).lean(), CatalogPackage.find({}).sort({ productCode: 1, packageCode: 1 }).lean(), Mapping.find({}).sort({ _id: 1 }).lean()]);
    const before = summarize(productsBefore, packagesBefore, mappingsBefore);
    const packageHashBefore = hash(packagesBefore.map(protectedPackage).sort((a, b) => a._id.localeCompare(b._id)));
    const mappingHashBefore = hash(mappingsBefore.map(protectedMapping));
    const referenceCounts = await historicalCounts(packagesBefore.filter(p => p.deletedAt == null));
    const matrix = [];
    for (const pkg of packagesBefore.filter(p => p.deletedAt == null)) {
        const move = MOVES.find(item => item.from === pkg.productCode && item.packageCode === pkg.packageCode);
        const refs = referenceCounts.get(`${pkg.productCode}:${pkg.packageCode}`);
        matrix.push({ currentProduct: productsBefore.find(p => p.productCode === pkg.productCode)?.name || pkg.productCode, currentProductCode: pkg.productCode, packageCode: pkg.packageCode, packageName: pkg.name, currentFamily: pkg.packageFamily?.code || "", targetProduct: move ? TARGET_PRODUCTS[move.to].name : productsBefore.find(p => p.productCode === pkg.productCode)?.name || pkg.productCode, targetProductCode: move?.to || pkg.productCode, targetFamily: pkg.packageFamily?.code || "", supplierMappings: mappingsBefore.filter(m => m.productCode === pkg.productCode && m.packageCode === pkg.packageCode).map(m => `${m.supplierCode}:${m.region}:${m.supplierPackageCode}`), THPrice: pkg.prices?.TH?.amount ?? null, MMPrice: pkg.prices?.MM?.amount ?? null, enabled: pkg.enabled === true, historicalReferenceCount: refs.total, migrationAction: move?.action || (TARGET_PRODUCTS[pkg.productCode] && TARGET_PRODUCTS[pkg.productCode].name !== productsBefore.find(p => p.productCode === pkg.productCode)?.name ? "RENAME_EXISTING_PRODUCT_AUTHORITY" : "KEEP"), reason: move ? `Explicit ${pkg.packageFamily?.code || "special"} entitlement belongs to ${TARGET_PRODUCTS[move.to].name}.` : "Existing semantic product authority retained." });
    }
    assert.strictEqual(MOVES.length, 14);
    assert(MOVES.every(move => packagesBefore.some(pkg => pkg.productCode === move.from && pkg.packageCode === move.packageCode && pkg.deletedAt == null)), "Exact migration source set drifted.");
    const movedMappingIds = mappingsBefore.filter(m => MOVES.some(move => move.from === m.productCode && move.packageCode === m.packageCode)).map(m => String(m._id));
    assert.strictEqual(movedMappingIds.length, 12, "Expected exactly 12 moved mapping references.");
    let after = before;
    if (APPLY) {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                for (const [code, target] of Object.entries(TARGET_PRODUCTS)) {
                    const existing = await CatalogProduct.findOne({ productCode: code }).session(session).lean();
                    if (existing) { await CatalogProduct.updateOne({ _id: existing._id }, { $set: { name: target.name } }, { session }); continue; }
                    assert(target.create, `Missing existing product authority ${code}.`);
                    const source = await CatalogProduct.findOne({ productCode: target.source, deletedAt: null }).session(session).lean(); assert(source, `Missing source product ${target.source}.`);
                    await CatalogProduct.create([{ productCode: code, name: target.name, description: "", enabled: false, featured: false, catalogCategory: source.catalogCategory, lifecycleStatus: "ACTIVE", commerceState: "HIDDEN", publicDiscoveryEnabled: false, homepageEnabled: false, homepageCategory: source.homepageCategory, homepageOrder: source.homepageOrder, homepageFlags: [], homepageSections: [], productRoute: `product.html?product=${code}`, artworkPath: source.artworkPath || "", supportedRegions: source.supportedRegions || [], aliases: [], sortOrder: Number(source.sortOrder || 0) + 1, source: "admin", fulfillment: { manualAllowedRegions: [] }, metadata: { canonicalAuthority: "CANONICAL_PRODUCT_ENTITLEMENT_SPLIT_V1", sourceProductCode: target.source } }], { session });
                }
                for (const move of MOVES) {
                    const pkg = await CatalogPackage.findOne({ productCode: move.from, packageCode: move.packageCode, deletedAt: null }).session(session).lean(); assert(pkg, `Missing ${move.from}/${move.packageCode}.`);
                    assert(!await CatalogPackage.exists({ productCode: move.to, packageCode: move.packageCode }).session(session), `Collision ${move.to}/${move.packageCode}.`);
                    await CatalogPackage.collection.updateOne({ _id: pkg._id, productCode: move.from }, { $set: { productCode: move.to, productAliases: [...new Set([...(pkg.productAliases || []), move.from])] } }, { session });
                    await Mapping.collection.updateMany({ productCode: move.from, packageCode: move.packageCode }, { $set: { productCode: move.to } }, { session });
                }
            });
        } finally { await session.endSession(); }
        const [productsAfter, packagesAfter, mappingsAfter] = await Promise.all([CatalogProduct.find({}).sort({ productCode: 1 }).lean(), CatalogPackage.find({}).sort({ productCode: 1, packageCode: 1 }).lean(), Mapping.find({}).sort({ _id: 1 }).lean()]);
        after = summarize(productsAfter, packagesAfter, mappingsAfter);
        assert.strictEqual(after.products, before.products + 2, "Only two product authorities may be added.");
        assert.strictEqual(after.nonDeletedPackages, before.nonDeletedPackages); assert.strictEqual(after.enabledPackages, before.enabledPackages); assert.strictEqual(after.supplierMappings, before.supplierMappings);
        assert(after.publicPackages <= before.publicPackages, "Public package exposure increased.");
        assert.strictEqual(hash(packagesAfter.map(protectedPackage).sort((a, b) => a._id.localeCompare(b._id))), packageHashBefore, "Protected package authority changed.");
        assert.strictEqual(hash(mappingsAfter.map(protectedMapping)), mappingHashBefore, "Protected supplier mapping authority changed.");
        assert(movedMappingIds.every(id => mappingsAfter.some(m => String(m._id) === id)), "A supplier mapping ID was lost.");
    }
    const report = { result: "PASS", generatedAt: new Date().toISOString(), mode: APPLY ? "APPLIED" : "DRY_RUN", before, after, exactMoves: MOVES.length, movedMappingReferences: movedMappingIds.length, matrix, safety: { realOrders: 0, realTopups: 0, providerBalanceSpent: 0, priceChanges: 0, primaryPromotions: 0, mappingsEnabled: 0, gatesEnabled: 0, publishedPrices: 0 } };
    if (APPLY) {
        fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
        const moved = matrix.filter(row => row.migrationAction.startsWith("MOVE_"));
        const rows = moved.map(row => `| ${row.currentProductCode} | ${row.packageCode} | ${row.currentFamily} | ${row.targetProductCode} | ${row.supplierMappings.join("<br>") || "—"} | ${row.THPrice ?? "—"} | ${row.MMPrice ?? "—"} | ${row.historicalReferenceCount} |`).join("\n");
        fs.writeFileSync(OUT_MD, `# Canonical product entitlement split — Phase 1\n\nGenerated: ${report.generatedAt}\n\n## Authority counts\n\n| Metric | Before | After |\n|---|---:|---:|\n${Object.keys(before).map(key => `| ${key} | ${before[key]} | ${after[key]} |`).join("\n")}\n\n## Exact package moves\n\n| From | Package | Family | To | Supplier mappings | TH | MM | Historical refs |\n|---|---|---|---|---|---:|---:|---:|\n${rows}\n\nThe complete ${matrix.length}-row migration matrix and per-row authority evidence are in \`canonical-product-entitlement-split.json\`. Historical snapshots were audited and not rewritten. New split products are disabled, hidden, and excluded from discovery. Prices, package IDs, package codes, mappings, roles, gates, and supplier cost evidence were preserved.\n`);
    }
    console.log(JSON.stringify({ result: report.result, mode: report.mode, before, after, exactMoves: report.exactMoves, movedMappingReferences: report.movedMappingReferences, safety: report.safety }, null, 2));
}
main().catch(error => { console.error(`ENTITLEMENT_SPLIT_FAILED: ${error.message}`); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
