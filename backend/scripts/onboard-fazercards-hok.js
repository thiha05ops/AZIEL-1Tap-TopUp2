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
const CATEGORY = "honor_of_kings";
const EXACT = Object.freeze([
    ["HOK_16_TOKENS", "16 Tokens", "16_tokens"], ["HOK_80_TOKENS", "80 Tokens", "80_tokens"],
    ["HOK_240_TOKENS", "240 Tokens", "240_tokens"], ["HOK_400_TOKENS", "400 Tokens", "400_tokens"],
    ["HOK_560_TOKENS", "560 Tokens", "560_tokens"], ["HOK_830_TOKENS", "830 Tokens", "830_tokens"],
    ["HOK_1245_TOKENS", "1245 Tokens", "1245_tokens"], ["HOK_2508_TOKENS", "2508 Tokens", "2508_tokens"],
    ["HOK_4180_TOKENS", "4180 Tokens", "4180_tokens"], ["HOK_8360_TOKENS", "8360 Tokens", "8360_tokens"]
]);
const OUT_JSON = path.join(__dirname, "../../docs/fazercards-hok-reconciliation.json");
const OUT_MD = path.join(__dirname, "../../docs/fazercards-hok-reconciliation.md");
const clean = value => String(value == null ? "" : value).trim();
const hash = rows => crypto.createHash("sha256").update(JSON.stringify(rows.map(row => ({ id: String(row._id), supplierCode: row.supplierCode, productCode: row.productCode, packageCode: row.packageCode, supplierProductCode: row.supplierProductCode, supplierPackageCode: row.supplierPackageCode, enabled: row.enabled, updatedAt: row.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
const mdTable = (headers, rows) => `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map(row => `| ${row.join(" | ")} |`).join("\n")}`;

async function main() {
    if (adapter.isAutoFulfillmentEnabled("hok")) throw new Error("FazerCards HOK fulfillment gate must be OFF.");
    const balanceBefore = await adapter.getBalance();
    let cursor = ""; let category = null;
    do { const page = await adapter.getTopupCategories(cursor); category ||= (page.items || []).find(item => item.category_id === CATEGORY); cursor = clean(page.meta?.next_cursor); } while (cursor);
    if (!category) throw new Error("HOK category is missing.");
    const payload = await adapter.getTopupOffers(CATEGORY);
    const fields = (payload.fields || []).map(item => ({ key: clean(item.key), label: clean(item.label), type: clean(item.type) }));
    if (JSON.stringify(fields.map(item => item.key)) !== JSON.stringify(["player_id"])) throw new Error(`HOK field contract drifted: ${fields.map(item => item.key).join(",")}`);
    if (/\b(region|country|global|thailand|region-locked|server_id|zone_id)\b/i.test(payload.note || category.note || "")) throw new Error("HOK region/field note drift detected; stop before mutation.");
    if (!/delivered directly to your account/i.test(payload.note || category.note || "")) throw new Error("HOK direct-delivery evidence is missing.");
    const validationGet = await fetch("https://api.fzr.cards/api/v2/topups/validate-id", { headers: { Accept: "application/json", "X-API-Key": process.env.FAZERCARDS_API_KEY } });
    if (!validationGet.ok) throw new Error(`Validation capability GET failed: ${validationGet.status}`);
    const validationItems = (await validationGet.json()).items || [];
    if (validationItems.some(item => item.category_id === CATEGORY || /honor of kings/i.test(item.name || ""))) throw new Error("HOK validation capability appeared; contract must be reconciled before mutation.");
    const offers = new Map((payload.offers || []).map(item => [clean(item.offer_id), item]));

    await mongoose.connect(process.env.MONGO_URI);
    const [supplier, packages, allWonddBefore] = await Promise.all([
        Supplier.findOne({ supplierCode: "FAZERCARDS" }), CatalogPackage.find({ productCode: "hok", packageCode: { $in: EXACT.map(item => item[0]) }, deletedAt: null }).lean(), Mapping.find({ supplierCode: "WONDD" }).lean()
    ]);
    if (!supplier || supplier.mode !== "API" || supplier.supplierCurrency !== "USD") throw new Error("FAZERCARDS supplier authority is missing or conflicting.");
    const verified = EXACT.map(([packageCode, identity, offerId]) => {
        const pkg = packages.find(item => item.packageCode === packageCode); const offer = offers.get(offerId);
        if (!pkg || clean(pkg.name) !== identity) throw new Error(`Canonical identity drift for ${packageCode}.`);
        if (!offer || clean(offer.name) !== identity) throw new Error(`Provider identity drift for ${offerId}.`);
        const rawUsd = Number(offer.price_usd); if (!Number.isFinite(rawUsd) || rawUsd <= 0) throw new Error(`Invalid cost for ${offerId}.`);
        return { packageCode, identity, offerId, rawUsd };
    });
    const wonddHash = hash(allWonddBefore); const result = { apply: APPLY, created: [], reused: [], verified };
    if (APPLY) {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            for (const item of verified) {
                let mapping = await Mapping.findOne({ supplierId: supplier._id, productCode: "hok", packageCode: item.packageCode, region: "TH" }).session(session);
                const cost = { rawSupplierCost: item.rawUsd, supplierCurrency: "USD", capturedAt: new Date(), source: "FAZERCARDS_LIVE_API", providerProductCode: CATEGORY, providerOfferCode: item.offerId, fundingCost: 0, otherAcquisitionCost: 0 };
                const metadata = { providerConfirmedOrderContract: { categoryId: CATEGORY, requiredFields: ["player_id"], absentFields: ["server_id", "zone_id", "region"], authority: "FAZERCARDS_SUPPORT_CONFIRMATION" }, requiredFields: ["player_id"], region: "TH", regionEvidence: { explicitRestriction: false, thailandAcceptedBySupportConfirmation: true, catalogNote: payload.note }, validation: { available: false, status: "NOT_ADVERTISED", requiredBeforeOrder: false }, supplierCost: { amount: item.rawUsd, currency: "USD" }, readiness: { supplierMapped: true, inputReady: true, validationReady: true, pricingReady: true, fulfillmentReady: false, storefrontReady: false }, blocker: "HOK_FULFILLMENT_DISABLED_REAL_CUSTOMER_TEST_REQUIRED" };
                if (mapping) {
                    if (mapping.supplierProductCode !== CATEGORY || mapping.supplierPackageCode !== item.offerId) throw new Error(`Conflicting HOK mapping for ${item.packageCode}.`);
                    mapping.enabled = false; mapping.executionMode = "API"; mapping.supplierDisplayName = item.identity; mapping.supplierCostAuthority = cost; mapping.mappingMetadata = metadata; await mapping.save({ session }); result.reused.push(item.packageCode);
                } else {
                    await new Mapping({ supplierId: supplier._id, supplierCode: "FAZERCARDS", productCode: "hok", packageCode: item.packageCode, supplierProductCode: CATEGORY, supplierPackageCode: item.offerId, supplierDisplayName: item.identity, region: "TH", enabled: false, executionMode: "API", supplierCostAuthority: cost, mappingMetadata: metadata }).save({ session }); result.created.push(item.packageCode);
                }
            }
        });
        await session.endSession();
    }
    const workspace = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), region: "TH" });
    const rows = workspace.rows.filter(row => row.productCode === "hok" && EXACT.some(item => item[0] === row.packageCode) && row.previewEligible).map(row => ({ mappingId: row.mappingId, productCode: row.productCode, packageCode: row.packageCode, newSupplierCost: row.supplierCost, selected: false }));
    const preview = rows.length ? await batchPreviewDailyPricing({ supplierId: String(supplier._id), region: "TH", rows }) : { rows: [] };
    result.pricingPreview = verified.map(item => { const row = preview.rows.find(value => value.packageCode === item.packageCode); const th = row?.regions?.find(value => value.region === "TH"); return { canonicalPackage: item.packageCode, offerId: item.offerId, rawUsd: item.rawUsd, fxRate: th?.exchangeRate ?? null, convertedThb: th?.fxConvertedCost ?? null, landedThb: th?.landedCost ?? null, sellingThb: th?.recommendedSellingPrice ?? null, profitThb: th?.netProfit ?? null, blockingErrors: th?.blockingErrors || row?.blockingErrors || [] }; });
    const exactIds = new Set(EXACT.map(item => item[2]));
    result.newCandidates = (payload.offers || []).filter(item => /^\d+ Tokens$/i.test(item.name) && !exactIds.has(item.offer_id)).map(item => ({ offerId: item.offer_id, name: item.name, rawUsd: Number(item.price_usd) }));
    result.excludedSpecial = (payload.offers || []).filter(item => !exactIds.has(item.offer_id) && !result.newCandidates.some(value => value.offerId === item.offer_id)).map(item => ({ offerId: item.offer_id, name: item.name, rawUsd: Number(item.price_usd), classification: /weekly|card/i.test(item.name) ? "PASS/SUBSCRIPTION" : "SPECIAL" }));
    const mappings = await Mapping.find({ supplierCode: "FAZERCARDS", productCode: "hok", region: "TH" }).lean(); const allWonddAfter = await Mapping.find({ supplierCode: "WONDD" }).lean(); const balanceAfter = await adapter.getBalance();
    result.liveCatalogContract = { categoryId: CATEGORY, fields, absentFields: ["server_id", "zone_id", "region"], explicitRegionRestriction: false, directDelivery: true, offerCount: (payload.offers || []).length, note: payload.note };
    result.thailandRegionAuthority = "FAZERCARDS_SUPPORT_CONFIRMED_ACCEPTANCE_WHEN_CATALOG_HAS_NO_RESTRICTION";
    result.validation = "NOT_AVAILABLE_NOT_ADVERTISED";
    result.safety = { realFazerCardsOrderCalls: 0, liveValidationCalls: 0, providerBalanceBeforeUsd: balanceBefore.rawMetadata.balance, providerBalanceAfterUsd: balanceAfter.rawMetadata.balance, providerBalanceSpentUsd: Number(balanceBefore.rawMetadata.balance) - Number(balanceAfter.rawMetadata.balance), hokMappings: mappings.length, hokMappingsEnabled: mappings.filter(item => item.enabled).length, globalFazerCardsGate: adapter.isAutoFulfillmentEnabled("hok") ? "ON" : "OFF", pricesPublished: 0, publicStorefrontChanged: false, wonddModified: wonddHash === hash(allWonddAfter) ? 0 : "DETECTED", customerOrdersModified: 0, walletsModified: 0 };
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(result, null, 2)}\n`);
    const mappingRows = verified.map(item => [item.packageCode, CATEGORY, item.offerId, item.identity, item.rawUsd, "false"]); const priceRows = result.pricingPreview.map(item => [item.canonicalPackage, item.offerId, item.rawUsd, item.fxRate, item.convertedThb, item.landedThb, item.sellingThb, item.profitThb]);
    fs.writeFileSync(OUT_MD, `# FazerCards Honor of Kings rollout preparation\n\nGenerated: ${new Date().toISOString()}\n\nFazerCards support confirmed that \`honor_of_kings\` accepts Thailand accounts when the catalog has no restriction and requires only \`player_id\`. No provider POST occurred.\n\n## Exact disabled mappings\n\n${mdTable(["Canonical", "Category", "Offer", "Identity", "Raw USD", "Enabled"], mappingRows)}\n\n## Thailand pricing preview\n\n${mdTable(["Canonical", "Offer", "Raw USD", "FX", "Converted THB", "Landed THB", "Selling THB", "Profit THB"], priceRows)}\n\n## Input and validation\n\nAZIEL \`userId\` maps to order \`fields.player_id\`. The formatter trims whitespace, rejects missing/empty values, and never adds server, zone, or region fields. HOK validation remains **NOT AVAILABLE / NOT ADVERTISED** and no validation POST was made.\n\n## Deliberately excluded\n\nNew candidates: ${result.newCandidates.map(item => item.offerId).join(", ")}. Special/pass: ${result.excludedSpecial.map(item => item.offerId).join(", ")}.\n\n## Gate state\n\nAll HOK mappings are disabled, fulfillment is not ready, prices are unpublished, and the storefront is unchanged.\n`);
    console.log(JSON.stringify({ result: "PASS", mappingsCreated: result.created.length, mappingsReused: result.reused.length, liveCatalogContract: result.liveCatalogContract, thailandRegionAuthority: result.thailandRegionAuthority, validation: result.validation, exactMappings: verified.length, pricingPreview: result.pricingPreview, newCandidates: result.newCandidates.length, excludedSpecial: result.excludedSpecial.length, safety: result.safety }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode = 1; });
