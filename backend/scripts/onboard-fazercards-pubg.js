#!/usr/bin/env node
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const CatalogPackage = require("../models/CatalogPackage");
const adapter = require("../services/suppliers/fazercardsAdapter");

const APPLY = process.argv.includes("--apply");
const OFFERS = Object.freeze([
    ["PUBG_60_UC", "60 UC", "60_uc", 0.8874, true],
    ["PUBG_325_UC", "325 UC", "325_uc", 4.4421, false],
    ["PUBG_660_UC", "660 UC", "660_uc", 8.8697, false],
    ["PUBG_1800_UC", "1800 UC", "1800_uc", 22.1743, false],
    ["PUBG_3850_UC", "3850 UC", "3850_uc", 44.3487, false],
    ["PUBG_8100_UC", "8100 UC", "8100_uc", 88.0051, false]
]);

function rows(payload) { return payload.offers || payload.data?.offers || payload.data || []; }

async function main() {
    if (String(process.env.FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED || "").toLowerCase() === "true") throw new Error("FazerCards live gate must remain OFF during onboarding.");
    if (!adapter.isConfigured()) throw new Error("FAZERCARDS_API_KEY is not configured.");
    const before = await adapter.getBalance();
    const liveOffers = rows(await adapter.getTopupOffers("pubg_mobile_auto"));
    const liveAuthority = new Map();
    const priceDrift = [];
    for (const [, , offerId, expected] of OFFERS) {
        const offer = liveOffers.find(item => String(item.offer_id || item.id) === offerId);
        if (!offer) throw new Error(`Required live offer ${offerId} is missing; no production records were changed.`);
        const observed = Number(offer.price_usd ?? offer.price);
        if (!Number.isFinite(observed) || observed <= 0) throw new Error(`Required live offer ${offerId} has invalid price authority; no production records were changed.`);
        liveAuthority.set(offerId, observed);
        if (observed !== expected) priceDrift.push({ offerId, expectedUsd: expected, observedUsd: observed });
    }
    await mongoose.connect(process.env.MONGO_URI);
    let supplier = await Supplier.findOne({ supplierCode: "FAZERCARDS" });
    const summary = { apply: APPLY, supplier: supplier ? "reused" : "created", packagesCreated: [], packagesReused: [], mappingsCreated: [], mappingsReused: [], mappingsEnabled: 0, priceDrift };
    if (!supplier) supplier = new Supplier({ supplierCode: "FAZERCARDS", name: "FazerCards", mode: "API", enabled: true, supportedRegions: ["TH"], supplierCurrency: "USD", capabilities: ["TOPUP", "ORDER_STATUS", "PLAYER_VALIDATION", "WEBHOOK"], balanceAmount: null, balanceCurrency: "USD", balanceSource: "UNKNOWN", configurationStatus: "CONFIGURED", metadata: { apiBaseUrl: "https://api.fzr.cards/api/v2", credentialsSource: "environment", webhookConfigured: false } });
    else {
        if (supplier.mode !== "API" || (supplier.supplierCurrency && supplier.supplierCurrency !== "USD")) throw new Error("Existing FAZERCARDS supplier conflicts with approved authority.");
        supplier.mode = "API"; supplier.enabled = true; supplier.supplierCurrency = "USD"; supplier.balanceCurrency = "USD"; supplier.supportedRegions = [...new Set([...(supplier.supportedRegions || []), "TH"])];
    }
    if (APPLY) await supplier.save();

    for (const [packageCode, name, offerId, , mayReuse] of OFFERS) {
        const cost = liveAuthority.get(offerId);
        let pkg = await CatalogPackage.findOne({ productCode: "pubg", packageCode, deletedAt: null });
        if (pkg && !mayReuse && pkg.metadata?.supplierScopedAuthority !== "FAZERCARDS") throw new Error(`Refusing ambiguous package identity ${packageCode}.`);
        if (!pkg) {
            pkg = new CatalogPackage({ productCode: "pubg", packageCode, name, enabled: false, source: "admin", metadata: { supplierScopedAuthority: mayReuse ? "" : "FAZERCARDS", providerIdentity: { categoryId: "pubg_mobile_auto", offerId } } });
            summary.packagesCreated.push(packageCode); if (APPLY) await pkg.save();
        } else summary.packagesReused.push(packageCode);
        let mapping = await Mapping.findOne({ supplierId: supplier._id, productCode: "pubg", packageCode, region: "TH" });
        const authority = { rawSupplierCost: cost, supplierCurrency: "USD", capturedAt: new Date(), source: "FAZERCARDS_LIVE_API", providerProductCode: "pubg_mobile_auto", providerOfferCode: offerId, fundingCost: 0, otherAcquisitionCost: 0 };
        const metadata = { requiredFields: ["player_id"], region: "Global", validation: { available: true, categoryId: "pubg_mobile", requiredFields: ["player_id"], mandatoryBeforeOrder: false }, supplierCost: { amount: cost, currency: "USD" }, readiness: { supplierMapped: true, inputReady: true, validationReady: true, pricingReady: false, fulfillmentReady: false, storefrontReady: false }, blocker: "CONTROLLED_TEST_AND_PROVIDER_BALANCE_REQUIRED" };
        if (!mapping) {
            mapping = new Mapping({ supplierId: supplier._id, supplierCode: "FAZERCARDS", productCode: "pubg", packageCode, supplierProductCode: "pubg_mobile_auto", supplierPackageCode: offerId, supplierDisplayName: name, region: "TH", enabled: false, executionMode: "API", supplierCostAuthority: authority, mappingMetadata: metadata });
            summary.mappingsCreated.push(`${packageCode}->${offerId}`);
        } else {
            if (mapping.supplierProductCode !== "pubg_mobile_auto" || mapping.supplierPackageCode !== offerId) throw new Error(`Conflicting mapping for ${packageCode}.`);
            mapping.enabled = false; mapping.executionMode = "API"; mapping.supplierCostAuthority = authority; mapping.mappingMetadata = metadata;
            summary.mappingsReused.push(`${packageCode}->${offerId}`);
        }
        if (APPLY) await mapping.save();
    }
    const after = await adapter.getBalance();
    summary.balanceBefore = before.rawMetadata?.balance; summary.balanceAfter = after.rawMetadata?.balance;
    summary.balanceSpent = Number(summary.balanceBefore) - Number(summary.balanceAfter); summary.realOrderCalls = 0; summary.liveGate = false;
    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { console.error(JSON.stringify({ success: false, code: error.code || error.name, message: error.message })); await mongoose.disconnect().catch(() => null); process.exitCode = 1; });
