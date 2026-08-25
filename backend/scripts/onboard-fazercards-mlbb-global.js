#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const fetch = require("node-fetch");
const Supplier = require("../models/Supplier");
const CatalogPackage = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const adapter = require("../services/suppliers/fazercardsAdapter");
const { loadDailyPricingWorkspace, batchPreviewDailyPricing } = require("../services/commerce/adminPricingControlCenterService");

const APPLY = process.argv.includes("--apply");
const CATEGORY = "mobile_legends_global";
const EXACT = Object.freeze([
    ["MLBB_42", "42 Diamonds", "42_diamonds"],
    ["MLBB_56", "70 Diamonds", "70_diamonds"],
    ["MLBB_284", "284 Diamonds", "284_diamonds"],
    ["MLBB_570", "429 Diamonds", "429_diamonds"],
    ["MLBB_716", "716 Diamonds", "716_diamonds"]
]);
const OUT_JSON = path.join(__dirname, "../../docs/fazercards-mlbb-phase-2d.json");
const OUT_MD = path.join(__dirname, "../../docs/fazercards-mlbb-phase-2d.md");
const clean = value => String(value == null ? "" : value).trim();
const money = value => Math.round(Number(value) * 1e6) / 1e6;
const stableWondd = rows => crypto.createHash("sha256").update(JSON.stringify(rows.map(row => ({ id: String(row._id), productCode: row.productCode, packageCode: row.packageCode, supplierProductCode: row.supplierProductCode, supplierPackageCode: row.supplierPackageCode, enabled: row.enabled, executionMode: row.executionMode, updatedAt: row.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
const mdTable = (headers, rows) => `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map(row => `| ${row.join(" | ")} |`).join("\n")}`;

async function main() {
    if (String(process.env.FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED || "").trim().toLowerCase() === "true") throw new Error("FazerCards live gate must be OFF.");
    const balanceBefore = await adapter.getBalance();
    const offersPayload = await adapter.getTopupOffers(CATEGORY);
    if (clean(offersPayload.category_id) !== CATEGORY) throw new Error("MLBB Global category authority mismatch.");
    const orderFields = (offersPayload.fields || []).map(item => clean(item.key));
    if (JSON.stringify(orderFields) !== JSON.stringify(["player_id", "server_id"])) throw new Error(`MLBB order fields drifted: ${orderFields.join(",")}`);
    const validationResponse = await fetch("https://api.fzr.cards/api/v2/topups/validate-id", { headers: { Accept: "application/json", "X-API-Key": process.env.FAZERCARDS_API_KEY } });
    if (!validationResponse.ok) throw new Error(`Validation capability GET failed: ${validationResponse.status}`);
    const validation = ((await validationResponse.json()).items || []).find(item => item.category_id === "mobile_legends");
    const validationFields = (validation?.fields || []).map(item => clean(item.key));
    if (JSON.stringify(validationFields) !== JSON.stringify(["player_id", "zone_id"])) throw new Error(`MLBB validation fields drifted: ${validationFields.join(",")}`);
    const liveOffers = new Map((offersPayload.offers || []).map(item => [clean(item.offer_id), item]));

    await mongoose.connect(process.env.MONGO_URI);
    const [supplier, packages, wonddBefore, previousReport] = await Promise.all([
        Supplier.findOne({ supplierCode: "FAZERCARDS" }),
        CatalogPackage.find({ productCode: "mlbb", packageCode: { $in: EXACT.map(item => item[0]) }, deletedAt: null }).lean(),
        Mapping.find({ supplierCode: "WONDD", productCode: "mlbb" }).lean(),
        Promise.resolve(fs.existsSync(path.join(__dirname, "../../docs/fazercards-mlbb-global-reconciliation.json")) ? JSON.parse(fs.readFileSync(path.join(__dirname, "../../docs/fazercards-mlbb-global-reconciliation.json"), "utf8")) : null)
    ]);
    if (!supplier || supplier.mode !== "API" || supplier.supplierCurrency !== "USD") throw new Error("FAZERCARDS supplier authority is missing or conflicting.");
    const verified = EXACT.map(([packageCode, identity, offerId]) => {
        const pkg = packages.find(item => item.packageCode === packageCode);
        const offer = liveOffers.get(offerId);
        if (!pkg || clean(pkg.name) !== identity) throw new Error(`Canonical identity mismatch for ${packageCode}.`);
        if (!offer || clean(offer.name) !== identity) throw new Error(`Provider identity mismatch for ${offerId}.`);
        const rawUsd = Number(offer.price_usd);
        if (!Number.isFinite(rawUsd) || rawUsd <= 0) throw new Error(`Invalid supplier cost for ${offerId}.`);
        const previous = previousReport?.fazercardsOffers?.find(item => item.offerId === offerId)?.priceUsd;
        return { packageCode, identity, offerId, rawUsd, previousUsd: Number.isFinite(Number(previous)) ? Number(previous) : null, priceDriftUsd: Number.isFinite(Number(previous)) ? money(rawUsd - Number(previous)) : null };
    });
    const beforeHash = stableWondd(wonddBefore);
    const result = { apply: APPLY, created: [], reused: [], verified, orderFields, validationFields };

    if (APPLY) {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            for (const item of verified) {
                let mapping = await Mapping.findOne({ supplierId: supplier._id, productCode: "mlbb", packageCode: item.packageCode, region: "TH" }).session(session);
                const authority = { rawSupplierCost: item.rawUsd, supplierCurrency: "USD", capturedAt: new Date(), source: "FAZERCARDS_LIVE_API", providerProductCode: CATEGORY, providerOfferCode: item.offerId, fundingCost: 0, otherAcquisitionCost: 0 };
                const metadata = { providerConfirmedFieldContract: { order: { categoryId: CATEGORY, fields: { userId: "player_id", zoneId: "server_id" } }, validation: { categoryId: "mobile_legends", fields: { userId: "player_id", zoneId: "zone_id" } }, authority: "FAZERCARDS_SUPPORT_CONFIRMATION" }, requiredFields: ["player_id", "server_id"], region: "Global", regionRestrictions: { excludedRegions: ["ID", "BR"], evidence: offersPayload.note }, validation: { available: true, categoryId: "mobile_legends", requiredFields: ["player_id", "zone_id"], mandatoryBeforeOrder: false }, supplierCost: { amount: item.rawUsd, currency: "USD" }, readiness: { supplierMapped: true, inputReady: true, validationReady: true, pricingReady: true, fulfillmentReady: false, storefrontReady: false }, blocker: "MLBB_FULFILLMENT_DISABLED_CONTROLLED_TEST_REQUIRED" };
                if (mapping) {
                    if (mapping.supplierProductCode !== CATEGORY || mapping.supplierPackageCode !== item.offerId) throw new Error(`Conflicting FazerCards mapping for ${item.packageCode}.`);
                    mapping.enabled = false; mapping.executionMode = "API"; mapping.supplierDisplayName = item.identity; mapping.supplierCostAuthority = authority; mapping.mappingMetadata = metadata;
                    await mapping.save({ session }); result.reused.push(item.packageCode);
                } else {
                    mapping = new Mapping({ supplierId: supplier._id, supplierCode: "FAZERCARDS", productCode: "mlbb", packageCode: item.packageCode, supplierProductCode: CATEGORY, supplierPackageCode: item.offerId, supplierDisplayName: item.identity, region: "TH", enabled: false, executionMode: "API", supplierCostAuthority: authority, mappingMetadata: metadata });
                    await mapping.save({ session }); result.created.push(item.packageCode);
                }
            }
        });
        await session.endSession();
    }

    const workspace = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), region: "TH" });
    const selectedRows = workspace.rows.filter(row => row.productCode === "mlbb" && EXACT.some(item => item[0] === row.packageCode) && row.previewEligible).map(row => ({ mappingId: row.mappingId, productCode: row.productCode, packageCode: row.packageCode, newSupplierCost: row.supplierCost, selected: false }));
    const preview = selectedRows.length ? await batchPreviewDailyPricing({ supplierId: String(supplier._id), region: "TH", rows: selectedRows }) : { rows: [] };
    result.economics = verified.map(item => {
        const row = preview.rows.find(candidate => candidate.packageCode === item.packageCode);
        const th = row?.regions?.find(region => region.region === "TH");
        return { canonicalPackage: item.packageCode, providerOffer: item.offerId, rawUsd: item.rawUsd, fxRate: th?.exchangeRate ?? null, convertedThb: th?.fxConvertedCost ?? null, landedThb: th?.landedCost ?? null, sellingThb: th?.recommendedSellingPrice ?? null, profitThb: th?.netProfit ?? null, blockingErrors: th?.blockingErrors || row?.blockingErrors || [] };
    });
    result.supplierComparisons = result.economics.map(item => {
        const wm = wonddBefore.find(mapping => mapping.packageCode === item.canonicalPackage);
        const pkg = packages.find(candidate => candidate.packageCode === item.canonicalPackage);
        const raw = Number(wm?.supplierCostAuthority?.rawSupplierCost ?? (pkg?.prices?.TH?.supplierCode === "WONDD" ? pkg.prices.TH.supplierCost : null));
        return { canonicalPackage: item.canonicalPackage, wonddPackcode: wm?.supplierPackageCode || "", wonddThb: Number.isFinite(raw) ? raw : null, fazerLandedThb: item.landedThb, classification: !wm || !Number.isFinite(raw) || !Number.isFinite(item.landedThb) ? "INSUFFICIENT_AUTHORITY" : item.landedThb < raw ? "FAZERCARDS_CHEAPER" : raw < item.landedThb ? "WONDD_CHEAPER" : "EQUAL" };
    }).filter(item => item.wonddPackcode);
    const mappingsAfter = await Mapping.find({ supplierCode: "FAZERCARDS", productCode: "mlbb", region: "TH" }).lean();
    const wonddAfter = await Mapping.find({ supplierCode: "WONDD", productCode: "mlbb" }).lean();
    const balanceAfter = await adapter.getBalance();
    result.safety = { realFazerCardsOrderCalls: 0, liveValidationPostCalls: 0, providerBalanceBeforeUsd: balanceBefore.rawMetadata.balance, providerBalanceAfterUsd: balanceAfter.rawMetadata.balance, providerBalanceSpentUsd: Number(balanceBefore.rawMetadata.balance) - Number(balanceAfter.rawMetadata.balance), fazerCardsMlbbMappings: mappingsAfter.length, fazerCardsMlbbEnabledMappings: mappingsAfter.filter(item => item.enabled).length, globalFazerCardsGate: adapter.isAutoFulfillmentEnabled("mlbb") ? "ON" : "OFF", wonddMappingsModified: beforeHash === stableWondd(wonddAfter) ? 0 : "DETECTED", pricesPublished: 0, customerOrdersModified: 0, publicStorefrontChanged: false };
    const allPlainCandidates = (offersPayload.offers || []).filter(item => /^\d+ Diamonds$/i.test(clean(item.name)) && !EXACT.some(exact => exact[2] === item.offer_id)).map(item => ({ offerId: item.offer_id, identity: item.name, rawUsd: Number(item.price_usd), classification: "ADD_CANDIDATE" }));
    result.newCandidates = allPlainCandidates;
    result.specialRestricted = (offersPayload.offers || []).filter(item => !EXACT.some(exact => exact[2] === item.offer_id) && !allPlainCandidates.some(candidate => candidate.offerId === item.offer_id)).map(item => ({ offerId: item.offer_id, identity: item.name, classification: /pass|elite/i.test(item.name) ? "SPECIAL" : /78 \+ 8|156 \+ 16|234 \+ 23|625 \+ 81|1860 \+ 335|3099 \+ 589|4649 \+ 883|7740 \+ 1548/i.test(item.name) ? "REGION_RESTRICTED" : "AMBIGUOUS" }));
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(result, null, 2)}\n`);
    const mapTable = verified.map(item => [item.packageCode, CATEGORY, item.offerId, item.identity, item.rawUsd, "false"]);
    const econTable = result.economics.map(item => [item.canonicalPackage, item.providerOffer, item.rawUsd, item.fxRate, item.convertedThb, item.landedThb, item.sellingThb, item.profitThb]);
    const compareTable = result.supplierComparisons.map(item => [item.canonicalPackage, item.wonddPackcode, item.wonddThb, item.fazerLandedThb, item.classification]);
    fs.writeFileSync(OUT_MD, `# FazerCards MLBB Phase 2D\n\nGenerated: ${new Date().toISOString()}\n\nProvider-confirmed translation: order \`userId→player_id\`, \`zoneId→server_id\`; validation \`userId→player_id\`, \`zoneId→zone_id\`. No provider POST occurred.\n\n## Exact disabled mappings\n\n${mdTable(["Canonical", "Category", "Offer", "Identity", "Raw USD", "Enabled"], mapTable)}\n\n## Pricing preview\n\n${mdTable(["Canonical", "Offer", "Raw USD", "FX", "Converted THB", "Landed THB", "Selling THB", "Profit THB"], econTable)}\n\n## Exact WonDD comparison\n\n${mdTable(["Canonical", "WonDD packcode", "WonDD THB", "Fazer landed THB", "Result"], compareTable)}\n\n## Safety\n\n${Object.entries(result.safety).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n`);
    console.log(JSON.stringify({ result: "PASS", mappingsCreated: result.created.length, mappingsReused: result.reused.length, currentGlobalOffers: offersPayload.offers.length, exactMatches: verified.length, newCandidates: result.newCandidates.length, specialRestricted: result.specialRestricted.length, priceDrift: verified.filter(item => item.priceDriftUsd !== 0).map(item => ({ offerId: item.offerId, previousUsd: item.previousUsd, currentUsd: item.rawUsd })), economics: result.economics, comparisons: result.supplierComparisons, safety: result.safety }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode = 1; });
