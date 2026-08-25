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
const CATEGORY = "free_fire_th";
const EXACT = Object.freeze([
    ["FF_WONDD_F00033", "33 Diamonds", "33_diamonds"], ["FF_WONDD_F00068", "68 Diamonds", "68_diamonds"],
    ["FF_WONDD_F00172", "172 Diamonds", "172_diamonds"], ["FF_310_DIA", "310 Diamonds", "310_diamonds"],
    ["FF_WONDD_F00517", "517 Diamonds", "517_diamonds"], ["FF_WONDD_F00690", "690 Diamonds", "690_diamonds"],
    ["FF_WONDD_F01052", "1,052 Diamonds", "1052_diamonds"], ["FF_WONDD_F01801", "1,801 Diamonds", "1801_diamonds"],
    ["FF_WONDD_F03698", "3,698 Diamonds", "3698_diamonds"]
]);
const OUT_JSON = path.join(__dirname, "../../docs/fazercards-freefire-th-reconciliation.json");
const OUT_MD = path.join(__dirname, "../../docs/fazercards-freefire-th-reconciliation.md");
const clean = value => String(value == null ? "" : value).trim();
const normalized = value => clean(value).toLowerCase().replace(/,/g, "").replace(/\s+/g, " ");
const money = value => Math.round(Number(value) * 1e6) / 1e6;
const hashMappings = rows => crypto.createHash("sha256").update(JSON.stringify(rows.map(row => ({ id: String(row._id), packageCode: row.packageCode, supplierProductCode: row.supplierProductCode, supplierPackageCode: row.supplierPackageCode, enabled: row.enabled, updatedAt: row.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
const mdTable = (headers, rows) => `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map(row => `| ${row.join(" | ")} |`).join("\n")}`;

async function main() {
    if (adapter.isAutoFulfillmentEnabled("freefire")) throw new Error("FazerCards Free Fire live gate must be OFF.");
    const before = await adapter.getBalance();
    let cursor = ""; let category = null;
    do { const page = await adapter.getTopupCategories(cursor); category ||= (page.items || []).find(item => item.category_id === CATEGORY); cursor = clean(page.meta?.next_cursor); } while (cursor);
    if (!category || !/Region:\s*Thailand/i.test(category.note || "") || !/region-locked/i.test(category.note || "")) throw new Error("Explicit Thailand region authority is missing.");
    const payload = await adapter.getTopupOffers(CATEGORY);
    const fields = (payload.fields || []).map(item => ({ key: clean(item.key), label: clean(item.label), type: clean(item.type) }));
    if (JSON.stringify(fields.map(item => item.key)) !== JSON.stringify(["player_id"])) throw new Error("Free Fire TH input contract drifted.");
    const validationGet = await fetch("https://api.fzr.cards/api/v2/topups/validate-id", { headers: { Accept: "application/json", "X-API-Key": process.env.FAZERCARDS_API_KEY } });
    if (!validationGet.ok) throw new Error(`Validation capability GET failed: ${validationGet.status}`);
    const validation = ((await validationGet.json()).items || []).find(item => item.category_id === "free_fire");
    if (JSON.stringify((validation?.fields || []).map(item => item.key)) !== JSON.stringify(["player_id"])) throw new Error("Free Fire validation contract drifted.");
    const offerMap = new Map((payload.offers || []).map(item => [clean(item.offer_id), item]));

    await mongoose.connect(process.env.MONGO_URI);
    const [supplier, canonicalPackages, exactPackages, wonddBefore] = await Promise.all([
        Supplier.findOne({ supplierCode: "FAZERCARDS" }), CatalogPackage.find({ productCode: "freefire", deletedAt: null }).lean(),
        CatalogPackage.find({ productCode: "freefire", packageCode: { $in: EXACT.map(item => item[0]) }, deletedAt: null }).lean(), Mapping.find({ supplierCode: "WONDD", productCode: "freefire" }).lean()
    ]);
    if (!supplier || supplier.mode !== "API" || supplier.supplierCurrency !== "USD") throw new Error("FAZERCARDS supplier authority is missing or conflicting.");
    const verified = EXACT.map(([packageCode, displayName, offerId]) => {
        const pkg = exactPackages.find(item => item.packageCode === packageCode); const offer = offerMap.get(offerId);
        if (!pkg || normalized(pkg.name) !== normalized(displayName)) throw new Error(`Canonical identity mismatch for ${packageCode}.`);
        if (!offer || normalized(offer.name) !== normalized(displayName)) throw new Error(`Provider identity mismatch for ${offerId}.`);
        const rawUsd = Number(offer.price_usd); if (!Number.isFinite(rawUsd) || rawUsd <= 0) throw new Error(`Invalid cost for ${offerId}.`);
        return { packageCode, canonicalDisplayName: pkg.name, offerId, providerDisplayName: offer.name, rawUsd };
    });
    const wonddHash = hashMappings(wonddBefore); const result = { apply: APPLY, created: [], reused: [], verified };
    if (APPLY) {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            for (const item of verified) {
                let mapping = await Mapping.findOne({ supplierId: supplier._id, productCode: "freefire", packageCode: item.packageCode, region: "TH" }).session(session);
                const cost = { rawSupplierCost: item.rawUsd, supplierCurrency: "USD", capturedAt: new Date(), source: "FAZERCARDS_LIVE_API", providerProductCode: CATEGORY, providerOfferCode: item.offerId, fundingCost: 0, otherAcquisitionCost: 0 };
                const metadata = { requiredFields: ["player_id"], region: "TH", regionEvidence: { categoryId: CATEGORY, note: payload.note, regionLocked: true }, validation: { available: true, categoryId: "free_fire", requiredFields: ["player_id"], mandatoryBeforeOrder: false }, supplierCost: { amount: item.rawUsd, currency: "USD" }, readiness: { supplierMapped: true, inputReady: true, validationReady: true, pricingReady: true, fulfillmentReady: false, storefrontReady: false }, blocker: "FREEFIRE_FULFILLMENT_DISABLED_CONTROLLED_TEST_REQUIRED" };
                if (mapping) {
                    if (mapping.supplierProductCode !== CATEGORY || mapping.supplierPackageCode !== item.offerId) throw new Error(`Conflicting mapping for ${item.packageCode}.`);
                    mapping.enabled = false; mapping.executionMode = "API"; mapping.supplierDisplayName = item.providerDisplayName; mapping.supplierCostAuthority = cost; mapping.mappingMetadata = metadata; await mapping.save({ session }); result.reused.push(item.packageCode);
                } else {
                    await new Mapping({ supplierId: supplier._id, supplierCode: "FAZERCARDS", productCode: "freefire", packageCode: item.packageCode, supplierProductCode: CATEGORY, supplierPackageCode: item.offerId, supplierDisplayName: item.providerDisplayName, region: "TH", enabled: false, executionMode: "API", supplierCostAuthority: cost, mappingMetadata: metadata }).save({ session }); result.created.push(item.packageCode);
                }
            }
        });
        await session.endSession();
    }
    const workspace = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), region: "TH" });
    const selected = workspace.rows.filter(row => row.productCode === "freefire" && EXACT.some(exact => exact[0] === row.packageCode) && row.previewEligible).map(row => ({ mappingId: row.mappingId, productCode: row.productCode, packageCode: row.packageCode, newSupplierCost: row.supplierCost, selected: false }));
    const previews = selected.length ? await batchPreviewDailyPricing({ supplierId: String(supplier._id), region: "TH", rows: selected }) : { rows: [] };
    result.pricingPreview = verified.map(item => { const row = previews.rows.find(value => value.packageCode === item.packageCode); const th = row?.regions?.find(value => value.region === "TH"); return { canonicalPackage: item.packageCode, offerId: item.offerId, rawUsd: item.rawUsd, fxRate: th?.exchangeRate ?? null, convertedThb: th?.fxConvertedCost ?? null, landedThb: th?.landedCost ?? null, sellingThb: th?.recommendedSellingPrice ?? null, profitThb: th?.netProfit ?? null, blockingErrors: th?.blockingErrors || row?.blockingErrors || [] }; });
    result.supplierComparisons = result.pricingPreview.map(item => { const wm = wonddBefore.find(value => value.packageCode === item.canonicalPackage); const pkg = exactPackages.find(value => value.packageCode === item.canonicalPackage); const wc = Number(wm?.supplierCostAuthority?.rawSupplierCost ?? (pkg?.prices?.TH?.supplierCode === "WONDD" ? pkg.prices.TH.supplierCost : null)); return { canonicalPackage: item.canonicalPackage, wonddPackcode: wm?.supplierPackageCode || "", wonddThb: Number.isFinite(wc) ? wc : null, fazerLandedThb: item.landedThb, differenceThb: Number.isFinite(wc) && Number.isFinite(item.landedThb) ? money(item.landedThb - wc) : null, cheaperSupplier: !Number.isFinite(wc) || !Number.isFinite(item.landedThb) ? "INSUFFICIENT_AUTHORITY" : item.landedThb < wc ? "FAZERCARDS" : wc < item.landedThb ? "WONDD" : "EQUAL" }; });
    const exactOfferIds = new Set(EXACT.map(item => item[2]));
    result.newCandidates = (payload.offers || []).filter(item => /^\d+ Diamonds$/i.test(item.name) && !exactOfferIds.has(item.offer_id)).map(item => ({ offerId: item.offer_id, name: item.name, rawUsd: Number(item.price_usd), classification: "ADD_CANDIDATE" }));
    result.ambiguousSpecial = (payload.offers || []).filter(item => !exactOfferIds.has(item.offer_id) && !result.newCandidates.some(value => value.offerId === item.offer_id)).map(item => ({ offerId: item.offer_id, name: item.name, rawUsd: Number(item.price_usd), classification: /weekly|monthly|pass|subscription/i.test(item.name) ? "SPECIAL" : "AMBIGUOUS" }));
    const afterMappings = await Mapping.find({ supplierCode: "FAZERCARDS", productCode: "freefire", region: "TH" }).lean(); const wonddAfter = await Mapping.find({ supplierCode: "WONDD", productCode: "freefire" }).lean(); const after = await adapter.getBalance();
    result.currentAuthority = { canonicalPackageCount: canonicalPackages.length, wonddMappingCount: wonddBefore.length, fazerCardsOfferCount: (payload.offers || []).length, inputContract: fields, validationCategory: validation.category_id, regionRestriction: "THAILAND_REGION_LOCKED", categoryNote: payload.note };
    result.safety = { realFazerCardsOrderCalls: 0, liveValidationPostCalls: 0, providerBalanceBeforeUsd: before.rawMetadata.balance, providerBalanceAfterUsd: after.rawMetadata.balance, providerBalanceSpentUsd: Number(before.rawMetadata.balance) - Number(after.rawMetadata.balance), fazerCardsFreeFireMappings: afterMappings.length, fazerCardsFreeFireEnabledMappings: afterMappings.filter(item => item.enabled).length, globalFazerCardsGate: adapter.isAutoFulfillmentEnabled("freefire") ? "ON" : "OFF", wonddFreeFireMappingsModified: wonddHash === hashMappings(wonddAfter) ? 0 : "DETECTED", pricesPublished: 0, publicStorefrontChanged: false };
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(result, null, 2)}\n`);
    const maps = verified.map(item => [item.packageCode, CATEGORY, item.offerId, item.providerDisplayName, item.rawUsd, "false"]); const prices = result.pricingPreview.map(item => [item.canonicalPackage, item.offerId, item.rawUsd, item.fxRate, item.convertedThb, item.landedThb, item.sellingThb, item.profitThb]); const comparisons = result.supplierComparisons.map(item => [item.canonicalPackage, item.wonddPackcode, item.wonddThb, item.fazerLandedThb, item.differenceThb, item.cheaperSupplier]);
    fs.writeFileSync(OUT_MD, `# FazerCards Free Fire Thailand reconciliation\n\nGenerated: ${new Date().toISOString()}\n\nRead-only provider refresh plus exact disabled mapping preparation. No provider POST, price publication, gate, WonDD, or storefront mutation occurred.\n\n## Exact disabled mappings\n\n${mdTable(["Canonical", "Category", "Offer", "Identity", "Raw USD", "Enabled"], maps)}\n\n## Pricing preview\n\n${mdTable(["Canonical", "Offer", "Raw USD", "FX", "Converted THB", "Landed THB", "Selling THB", "Profit THB"], prices)}\n\n## WonDD comparison\n\n${mdTable(["Canonical", "WonDD packcode", "WonDD THB", "Fazer landed THB", "Difference", "Cheaper"], comparisons)}\n\n## Input and region\n\nOrder and validation each use only \`player_id\` (text). Validation category is \`free_fire\`. Category \`free_fire_th\` is explicitly Thailand-region-locked and direct delivery. Live validation was not called and mandatory validation is not proven.\n\n## Candidates and exclusions\n\nNew candidates: ${result.newCandidates.length}. Special/ambiguous: ${result.ambiguousSpecial.map(item => `${item.offerId} (${item.classification})`).join(", ") || "none"}.\n`);
    console.log(JSON.stringify({ result: "PASS", mappingsCreated: result.created.length, mappingsReused: result.reused.length, ...result.currentAuthority, exactMatches: verified.length, newCandidates: result.newCandidates.length, ambiguousSpecial: result.ambiguousSpecial.length, pricingPreview: result.pricingPreview, comparisons: result.supplierComparisons, safety: result.safety }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode = 1; });
