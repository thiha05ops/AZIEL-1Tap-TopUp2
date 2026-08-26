#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Product = require("../models/CatalogProduct");
const Package = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const adapter = require("../services/suppliers/fazercardsAdapter");

const APPLY = process.argv.includes("--apply");
const CATEGORY = "honor_of_kings";
const EXACT = Object.freeze([
    ["HOK_16_TOKENS", "16 Tokens", "16_tokens"], ["HOK_80_TOKENS", "80 Tokens", "80_tokens"],
    ["HOK_240_TOKENS", "240 Tokens", "240_tokens"], ["HOK_400_TOKENS", "400 Tokens", "400_tokens"],
    ["HOK_560_TOKENS", "560 Tokens", "560_tokens"], ["HOK_830_TOKENS", "830 Tokens", "830_tokens"],
    ["HOK_1245_TOKENS", "1245 Tokens", "1245_tokens"], ["HOK_2508_TOKENS", "2508 Tokens", "2508_tokens"],
    ["HOK_4180_TOKENS", "4180 Tokens", "4180_tokens"], ["HOK_8360_TOKENS", "8360 Tokens", "8360_tokens"]
]);
const clean = value => String(value == null ? "" : value).trim();
const NEW_CODES = new Set(EXACT.slice(5).map(item => item[0]));

async function main() {
    assert.strictEqual(adapter.isAutoFulfillmentEnabled("hok"), false, "HOK provider gate must remain OFF.");
    const balanceBefore = await adapter.getBalance();
    const catalog = await adapter.getTopupOffers(CATEGORY);
    assert.deepStrictEqual((catalog.fields || []).map(field => clean(field.key)), ["player_id"], "Provider input contract drifted.");
    const offers = new Map((catalog.offers || []).map(offer => [clean(offer.offer_id), offer]));
    const verified = EXACT.map(([packageCode, name, offerId]) => {
        const offer = offers.get(offerId); assert(offer, `Missing provider offer ${offerId}.`); assert.strictEqual(clean(offer.name), name, `Identity drift for ${offerId}.`);
        const rawUsd = Number(offer.price_usd); assert(Number.isFinite(rawUsd) && rawUsd > 0, `Invalid provider cost ${offerId}.`); return { packageCode, name, offerId, rawUsd };
    });
    await mongoose.connect(process.env.MONGO_URI);
    const [supplier, hok, passProduct, existingPackages, existingMappings] = await Promise.all([
        Supplier.findOne({ supplierCode: "FAZERCARDS" }).lean(), Product.findOne({ productCode: "hok", deletedAt: null }).lean(), Product.findOne({ productCode: "hok-pass-cards", deletedAt: null }).lean(), Package.find({ productCode: "hok", deletedAt: null }).lean(), Mapping.find({ supplierCode: "FAZERCARDS", productCode: "hok", region: "TH" }).lean()
    ]);
    assert(supplier && supplier.mode === "API" && supplier.supplierCurrency === "USD", "FazerCards supplier authority is invalid.");
    assert(hok && hok.name === "Honor of Kings Tokens" && hok.supportedRegions.length === 1 && hok.supportedRegions[0] === "TH", "HOK token regional authority drifted.");
    assert(passProduct && passProduct.enabled === false && passProduct.commerceState === "HIDDEN" && passProduct.publicDiscoveryEnabled === false, "HOK Pass & Cards exposure drifted.");
    const before = { packages: await Package.countDocuments({ productCode: "hok", deletedAt: null }), mappings: existingMappings.length, enabledMappings: existingMappings.filter(m => m.enabled).length, primaryMappings: existingMappings.filter(m => m.productionRole === "PRIMARY").length };
    const plan = verified.map((item, index) => ({ ...item, packageAction: existingPackages.some(pkg => pkg.packageCode === item.packageCode) ? (NEW_CODES.has(item.packageCode) ? "ENABLE_UNPRICED" : "REUSE") : "CREATE_ENABLED_UNPRICED", mappingAction: existingMappings.some(mapping => mapping.packageCode === item.packageCode) ? "REFRESH_DISABLED" : "CREATE_DISABLED", sortOrder: 80 + index * 10 }));
    if (APPLY) {
        const session = await mongoose.startSession();
        try { await session.withTransaction(async () => {
            for (const item of plan) {
                let pkg = await Package.findOne({ productCode: "hok", packageCode: item.packageCode, deletedAt: null }).session(session);
                if (!pkg) pkg = await new Package({ productCode: "hok", packageCode: item.packageCode, name: item.name, packageFamily: { code: "TOKENS", name: "Tokens", sortOrder: 10, parentCode: "", authority: "CANONICAL_PACKAGE_FAMILY_V1" }, enabled: true, prices: {}, sortOrder: item.sortOrder, source: "admin", metadata: { canonicalAuthority: "FAZERCARDS_HOK_STABILIZATION_V1", entitlementIdentity: item.name } }).save({ session });
                else if (NEW_CODES.has(item.packageCode) && pkg.metadata?.canonicalAuthority === "FAZERCARDS_HOK_STABILIZATION_V1") { pkg.enabled = true; await pkg.save({ session }); }
                assert.strictEqual(pkg.name, item.name); assert.strictEqual(pkg.packageFamily?.code, "TOKENS");
                let mapping = await Mapping.findOne({ supplierId: supplier._id, productCode: "hok", packageCode: item.packageCode, region: "TH" }).session(session);
                const authority = { rawSupplierCost: item.rawUsd, supplierCurrency: "USD", capturedAt: new Date(), source: "FAZERCARDS_LIVE_API", providerProductCode: CATEGORY, providerOfferCode: item.offerId, fundingCost: 0, otherAcquisitionCost: 0 };
                const metadata = { providerConfirmedOrderContract: { categoryId: CATEGORY, requiredFields: ["player_id"], absentFields: ["server_id", "zone_id", "region"], authority: "FAZERCARDS_LIVE_CATALOG_AND_SUPPORT" }, requiredFields: ["player_id"], region: "TH", regionEvidence: { explicitRestriction: false, thailandAcceptedBySupportConfirmation: true, catalogNote: catalog.note }, validation: { available: false, status: "NOT_ADVERTISED", requiredBeforeOrder: false }, supplierCost: { amount: item.rawUsd, currency: "USD" }, readiness: { supplierMapped: true, inputReady: true, validationReady: true, pricingReady: true, fulfillmentReady: false, storefrontReady: false }, blocker: "HOK_FULFILLMENT_DISABLED_REAL_CUSTOMER_TEST_REQUIRED" };
                if (!mapping) mapping = new Mapping({ supplierId: supplier._id, supplierCode: "FAZERCARDS", productCode: "hok", packageCode: item.packageCode, supplierProductCode: CATEGORY, supplierPackageCode: item.offerId, supplierDisplayName: item.name, region: "TH", executionMode: "API" });
                assert.strictEqual(mapping.supplierProductCode, CATEGORY); assert.strictEqual(mapping.supplierPackageCode, item.offerId);
                mapping.enabled = false; mapping.productionRole = "DISABLED"; mapping.supplierCostAuthority = authority; mapping.mappingMetadata = metadata; await mapping.save({ session });
            }
        }); } finally { await session.endSession(); }
    }
    const [afterPackages, afterMappings] = await Promise.all([Package.find({ productCode: "hok", deletedAt: null }).lean(), Mapping.find({ supplierCode: "FAZERCARDS", productCode: "hok", region: "TH" }).lean()]);
    const after = { packages: afterPackages.length, mappings: afterMappings.length, enabledMappings: afterMappings.filter(m => m.enabled).length, primaryMappings: afterMappings.filter(m => m.productionRole === "PRIMARY").length };
    if (APPLY) { assert.strictEqual(after.packages, before.packages + plan.filter(x => x.packageAction === "CREATE_ENABLED_UNPRICED").length); assert.strictEqual(after.mappings, 10); assert.strictEqual(after.enabledMappings, 0); assert.strictEqual(after.primaryMappings, before.primaryMappings); }
    const balanceAfter = await adapter.getBalance();
    console.log(JSON.stringify({ result: "PASS", mode: APPLY ? "APPLIED" : "DRY_RUN", before, after, plan, inputContract: ["player_id"], region: "TH_ONLY", balanceBeforeUsd: balanceBefore.rawMetadata.balance, balanceAfterUsd: balanceAfter.rawMetadata.balance, safety: { realOrders: 0, realTopups: 0, providerSpend: Number(balanceBefore.rawMetadata.balance) - Number(balanceAfter.rawMetadata.balance), pricePublications: 0, mappingsEnabled: 0, primaryPromotions: 0, gatesEnabled: 0 } }, null, 2));
}
main().catch(error => { console.error(`HOK_STABILIZATION_FAILED: ${error.message}`); process.exitCode = 1; }).finally(() => mongoose.disconnect().catch(() => null));
