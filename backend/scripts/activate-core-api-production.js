#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Mapping = require("../models/SupplierProductMapping");
const Package = require("../models/CatalogPackage");
const Product = require("../models/CatalogProduct");
const Supplier = require("../models/Supplier");
const { publishDailyPricing, loadDailyPricingWorkspace } = require("../services/commerce/adminPricingControlCenterService");
const { supportsFazerCardsMapping } = require("../services/suppliers/fazercardsFulfillmentProcessor");
const { CONFIRMED_SERVICE_CODES } = require("../services/suppliers/wonddCatalogConfig");

const APPLY = process.argv.includes("--apply");
const CORE = new Set(["mlbb", "pubg", "freefire", "hok"]);
const clean = value => String(value == null ? "" : value).trim();
const processorReady = mapping => mapping.supplierCode === "FAZERCARDS" ? supportsFazerCardsMapping(mapping) : mapping.supplierCode === "WONDD" && ["mlbb", "freefire"].includes(mapping.productCode) && clean(mapping.supplierProductCode).toLowerCase() === CONFIRMED_SERVICE_CODES[mapping.productCode];
const priority = mapping => ({ mlbb: { WONDD: 1, FAZERCARDS: 2 }, freefire: { WONDD: 1, FAZERCARDS: 2 }, pubg: { FAZERCARDS: 1 }, hok: { FAZERCARDS: 1 } }[mapping.productCode]?.[mapping.supplierCode] || 99);

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const [products, packages, mappings, suppliers] = await Promise.all([Product.find({ productCode: { $in: [...CORE] }, deletedAt: null }).lean(), Package.find({ productCode: { $in: [...CORE] }, deletedAt: null }).lean(), Mapping.find({ productCode: { $in: [...CORE] }, region: "TH", archivedAt: null }).lean(), Supplier.find({ enabled: true }).lean()]);
    const supplierMap = new Map(suppliers.map(item => [String(item._id), item])); const packageMap = new Map(packages.map(item => [`${item.productCode}:${item.packageCode}`, item]));
    const eligible = mappings.filter(mapping => {
        const supplier = supplierMap.get(String(mapping.supplierId)); const pkg = packageMap.get(`${mapping.productCode}:${mapping.packageCode}`); const cost = Number(mapping.supplierCostAuthority?.rawSupplierCost);
        return pkg && supplier?.supportedRegions?.includes("TH") && mapping.executionMode === "API" && clean(mapping.supplierProductCode) && clean(mapping.supplierPackageCode) && processorReady(mapping) && Number.isFinite(cost) && cost > 0 && Date.now() - new Date(mapping.supplierCostAuthority?.capturedAt || 0).getTime() <= Number(mapping.mappingMetadata?.costAuthorityMaximumAgeSeconds || 86400) * 1000;
    });
    const groups = new Map(); for (const mapping of eligible) { const key = `${mapping.productCode}:${mapping.packageCode}`; groups.set(key, [...(groups.get(key) || []), mapping]); }
    const routes = [...groups.entries()].map(([key, rows]) => ({ key, primary: [...rows].sort((a, b) => priority(a) - priority(b))[0], backups: [...rows].sort((a, b) => priority(a) - priority(b)).slice(1) })).filter(route => priority(route.primary) < 99);
    assert(routes.length > 0, "No exact production routes resolved.");
    const publishResults = [];
    if (APPLY) {
        await Product.updateMany({ productCode: { $in: ["mlbb-twilight-weekly-pass", "freefire-pass-membership", "hok-pass-cards", "pubgrp"] } }, { $set: { enabled: false, commerceState: "HIDDEN", publicDiscoveryEnabled: false, homepageEnabled: false } });
        await Product.updateOne({ productCode: "valorant" }, { $set: { commerceState: "HIDDEN", publicDiscoveryEnabled: false, homepageEnabled: false } });
        await Package.updateMany({ $or: routes.map(route => ({ productCode: route.primary.productCode, packageCode: route.primary.packageCode })) }, { $set: { enabled: true } });
        const bySupplier = new Map(); for (const route of routes) { const id = String(route.primary.supplierId); bySupplier.set(id, [...(bySupplier.get(id) || []), route.primary]); }
        for (const [supplierId, selected] of bySupplier) {
            const workspace = await loadDailyPricingWorkspace({ supplierId, region: "TH" }); const byId = new Map(workspace.rows.map(row => [String(row.mappingId), row]));
            const rows = selected.map(mapping => { const row = byId.get(String(mapping._id)); assert(row?.previewEligible, `Pricing preview unavailable ${mapping.productCode}/${mapping.packageCode}.`); return { mappingId: String(mapping._id), productCode: mapping.productCode, packageCode: mapping.packageCode, newSupplierCost: row.supplierCost, selected: true }; });
            const published = await publishDailyPricing({ rows, region: "TH", supplierId, actor: "api-production-activation", skipDraftCleanup: true }); assert.strictEqual(published.summary.failed, 0, `Price publication failed for supplier ${supplierId}.`); publishResults.push(...published.results);
        }
        const session = await mongoose.startSession(); try { await session.withTransaction(async () => {
            for (const route of routes) {
                for (const [index, source] of [route.primary, ...route.backups].entries()) {
                    const mapping = await Mapping.findById(source._id).session(session); const readiness = { ...(mapping.mappingMetadata?.readiness || {}), supplierMapped: true, inputReady: true, validationReady: mapping.mappingMetadata?.readiness?.validationReady !== false, pricingReady: true, fulfillmentReady: true, storefrontReady: true, enabled: true };
                    mapping.enabled = true; mapping.productionRole = index === 0 ? "PRIMARY" : "BACKUP"; mapping.mappingMetadata = { ...(mapping.mappingMetadata || {}), readiness, blocker: "", productionActivation: { activatedAt: new Date(), authority: "AZIEL_FULL_API_PRODUCTION_ACTIVATION", automaticBackupFailover: false } }; await mapping.save({ session });
                }
            }
        }); } finally { await session.endSession(); }
    }
    const finalMappings = await Mapping.find({ _id: { $in: routes.flatMap(route => [route.primary._id, ...route.backups.map(item => item._id)]) } }).lean();
    const report = { result: "PASS", mode: APPLY ? "APPLIED" : "DRY_RUN", routes: routes.map(route => ({ product: route.primary.productCode, packageCode: route.primary.packageCode, primary: route.primary.supplierCode, backups: route.backups.map(item => item.supplierCode) })), packagesRouted: routes.length, primaryMappings: finalMappings.filter(item => item.productionRole === "PRIMARY").length, backupMappings: finalMappings.filter(item => item.productionRole === "BACKUP").length, enabledMappings: finalMappings.filter(item => item.enabled).length, fulfillmentReadyMappings: finalMappings.filter(item => item.mappingMetadata?.readiness?.fulfillmentReady).length, pricesPublished: publishResults.filter(item => item.published).length, pricesSkippedUnchanged: publishResults.filter(item => item.skipped).length, safety: { realOrders: 0, realTopups: 0, liveValidationPosts: 0, providerSpend: 0, automaticBackupFailover: false } };
    console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(`CORE_API_ACTIVATION_FAILED: ${error.message}`); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
