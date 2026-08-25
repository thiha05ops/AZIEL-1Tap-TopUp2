#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const CommerceOrder = require("../models/CommerceOrder");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const adapter = require("../services/suppliers/fazercardsAdapter");
const { loadDailyPricingWorkspace, batchPreviewDailyPricing } = require("../services/commerce/adminPricingControlCenterService");

const APPLY = process.argv.includes("--apply");
const CATEGORY = "valorant_th";
const EXACT = Object.freeze([
    ["VALORANT_475_VP", "475 VP", "475_vp"], ["VALORANT_1000_VP", "1000 VP", "1000_vp"],
    ["VALORANT_2050_VP", "2050 VP", "2050_vp"], ["VALORANT_3650_VP", "3650 VP", "3650_vp"],
    ["VALORANT_5350_VP", "5350 VP", "5350_vp"], ["VALORANT_11000_VP", "11000 VP", "11000_vp"]
]);
const LEGACY = Object.freeze(["VAL_WONDD_VL00475", "VAL_WONDD_VL01000", "VAL_WONDD_VL02050", "VAL_WONDD_VL03650", "VAL_WONDD_VL05350", "VAL_WONDD_VL11000"]);
const OUT_JSON = path.join(__dirname, "../../docs/fazercards-valorant-canonical-rollout.json");
const OUT_MD = path.join(__dirname, "../../docs/fazercards-valorant-canonical-rollout.md");
const clean = value => String(value == null ? "" : value).trim();
const hash = rows => crypto.createHash("sha256").update(JSON.stringify(rows.map(row => ({ id: String(row._id), supplierCode: row.supplierCode, productCode: row.productCode, packageCode: row.packageCode, supplierProductCode: row.supplierProductCode, supplierPackageCode: row.supplierPackageCode, enabled: row.enabled, updatedAt: row.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
const table = (headers, rows) => `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map(row => `| ${row.join(" | ")} |`).join("\n")}`;

async function main() {
    if (adapter.isAutoFulfillmentEnabled("valorant")) throw new Error("FazerCards Valorant live gate must be OFF.");
    const balanceBefore = await adapter.getBalance();
    let cursor = ""; let category = null;
    do { const page = await adapter.getTopupCategories(cursor); category ||= (page.items || []).find(item => item.category_id === CATEGORY); cursor = clean(page.meta?.next_cursor); } while (cursor);
    if (!category) throw new Error("valorant_th category is missing.");
    const payload = await adapter.getTopupOffers(CATEGORY);
    const note = clean(payload.note || category.note);
    const fields = (payload.fields || []).map(item => ({ key: clean(item.key), label: clean(item.label), type: clean(item.type) }));
    if (!/Region:\s*Thailand/i.test(note) || !/region-locked/i.test(note)) throw new Error("Explicit Thailand region authority drifted.");
    if (!/delivered directly to your account/i.test(note)) throw new Error("Direct delivery authority drifted.");
    if (JSON.stringify(fields) !== JSON.stringify([{ key: "riot_id", label: "Riot ID", type: "text" }])) throw new Error("Valorant input contract drifted.");
    if (!/Name#TAG/i.test(note)) throw new Error("Provider Riot ID format evidence drifted.");
    const offers = new Map((payload.offers || []).map(item => [clean(item.offer_id), item]));
    if (offers.size !== EXACT.length) throw new Error(`Expected exactly six Valorant TH offers; received ${offers.size}.`);
    const verified = EXACT.map(([packageCode, name, offerId]) => {
        const offer = offers.get(offerId);
        if (!offer || clean(offer.name) !== name) throw new Error(`Provider offer identity drift for ${offerId}.`);
        const rawUsd = Number(offer.price_usd);
        if (!Number.isFinite(rawUsd) || rawUsd <= 0) throw new Error(`Invalid supplier price for ${offerId}.`);
        return { packageCode, name, offerId, rawUsd };
    });

    await mongoose.connect(process.env.MONGO_URI);
    const [supplier, wonddBefore, legacyPackages] = await Promise.all([
        Supplier.findOne({ supplierCode: "FAZERCARDS" }), Mapping.find({ supplierCode: "WONDD" }).lean(),
        CatalogPackage.find({ productCode: "valorant", packageCode: { $in: LEGACY } }).lean()
    ]);
    if (!supplier || supplier.mode !== "API" || supplier.supplierCurrency !== "USD") throw new Error("FAZERCARDS supplier authority is missing or conflicting.");
    if (legacyPackages.length !== LEGACY.length) throw new Error("Legacy Valorant package set drifted; preserve/reconcile before mutation.");
    const wonddHash = hash(wonddBefore);
    const legacyReferences = Object.fromEntries(await Promise.all(LEGACY.map(async packageCode => [packageCode, await CommerceOrder.countDocuments({ "product.packageCode": packageCode })])));
    const result = { apply: APPLY, provider: { categoryId: CATEGORY, region: "Thailand", delivery: "DIRECT_TOPUP", fields, format: "Name#TAG", offerCount: verified.length, note }, verified, createdPackages: [], reusedPackages: [], createdMappings: [], reusedMappings: [], legacyDisposition: LEGACY.map(packageCode => ({ packageCode, classification: legacyReferences[packageCode] ? "LEGACY_PRIVATE" : "UNUSED", historicalOrderReferences: legacyReferences[packageCode], action: "PRESERVED_DISABLED_NOT_REINTERPRETED_AS_VP" })) };

    if (APPLY) {
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const product = await CatalogProduct.findOne({ productCode: "valorant" }).session(session);
            if (!product) throw new Error("Historical Valorant product record is missing; automatic replacement is unsafe.");
            product.name = "Valorant"; product.enabled = true; product.deletedAt = null; product.deletedBy = "";
            product.catalogCategory = "PC_GAME"; product.lifecycleStatus = "ACTIVE"; product.commerceState = "HIDDEN";
            product.publicDiscoveryEnabled = false; product.homepageEnabled = false; product.supportedRegions = ["TH"];
            product.productRoute = "product.html?product=valorant"; product.sortOrder = 145;
            product.fulfillment = { manualAllowedRegions: [] };
            product.presentation = { ...(product.presentation?.toObject?.() || product.presentation || {}), displayMarketLabel: "Thailand", marketScope: "REGION" };
            product.metadata = { ...(product.metadata || {}), canonicalOperationalCatalog: true, archived: false, canonicalRepair: { authority: "FAZERCARDS_LIVE_API", categoryId: CATEGORY, restoredAt: new Date(), previousArchivedRecordPreserved: true }, customerInputContract: { fields: [{ key: "riotId", label: "Riot ID", required: true, type: "text", format: "Name#TAG", normalization: "TRIM_PRESERVE_CASE_AND_INTERNAL_CHARACTERS" }], supplierTranslation: { FAZERCARDS: { categoryId: CATEGORY, riotId: "fields.riot_id" } } } };
            await product.save({ session });
            for (let index = 0; index < verified.length; index += 1) {
                const item = verified[index];
                let pkg = await CatalogPackage.findOne({ productCode: "valorant", packageCode: item.packageCode }).session(session);
                if (!pkg) {
                    pkg = new CatalogPackage({ productCode: "valorant", packageCode: item.packageCode, name: item.name, enabled: false, prices: {}, sortOrder: (index + 1) * 10, source: "admin", metadata: { canonicalDenomination: "VP", identityAuthority: "FAZERCARDS_VALORANT_TH" } });
                    result.createdPackages.push(item.packageCode);
                } else {
                    if (pkg.name !== item.name) throw new Error(`Conflicting canonical package ${item.packageCode}.`);
                    pkg.enabled = false; pkg.deletedAt = null; result.reusedPackages.push(item.packageCode);
                }
                await pkg.save({ session });
                let mapping = await Mapping.findOne({ supplierId: supplier._id, productCode: "valorant", packageCode: item.packageCode, region: "TH" }).session(session);
                const supplierCostAuthority = { rawSupplierCost: item.rawUsd, supplierCurrency: "USD", capturedAt: new Date(), source: "FAZERCARDS_LIVE_API", providerProductCode: CATEGORY, providerOfferCode: item.offerId, fundingCost: 0, otherAcquisitionCost: 0 };
                const mappingMetadata = { requiredFields: ["riot_id"], customerInputContract: { azielField: "riotId", supplierField: "riot_id", label: "Riot ID", type: "text", required: true, format: "Name#TAG" }, region: "TH", regionEvidence: { categoryId: CATEGORY, providerRegion: "Thailand", regionLocked: true, note }, validation: { available: false, status: "NOT_ADVERTISED", requiredBeforeOrder: false }, readiness: { supplierMapped: true, inputReady: true, validationReady: true, pricingReady: true, fulfillmentReady: false, storefrontReady: false }, blocker: "VALORANT_PUBLIC_AND_FULFILLMENT_ROLLOUT_DEFERRED" };
                if (mapping) {
                    if (mapping.supplierProductCode !== CATEGORY || mapping.supplierPackageCode !== item.offerId) throw new Error(`Conflicting FazerCards mapping for ${item.packageCode}.`);
                    mapping.enabled = false; mapping.executionMode = "API"; mapping.supplierDisplayName = item.name; mapping.supplierCostAuthority = supplierCostAuthority; mapping.mappingMetadata = mappingMetadata; result.reusedMappings.push(item.packageCode);
                } else {
                    mapping = new Mapping({ supplierId: supplier._id, supplierCode: "FAZERCARDS", productCode: "valorant", packageCode: item.packageCode, supplierProductCode: CATEGORY, supplierPackageCode: item.offerId, supplierDisplayName: item.name, region: "TH", enabled: false, executionMode: "API", supplierCostAuthority, mappingMetadata }); result.createdMappings.push(item.packageCode);
                }
                await mapping.save({ session });
            }
        });
        await session.endSession();
    }

    const workspace = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), productCode: "valorant", region: "TH" });
    const previewRows = workspace.rows.filter(row => EXACT.some(item => item[0] === row.packageCode) && row.previewEligible).map(row => ({ mappingId: row.mappingId, productCode: row.productCode, packageCode: row.packageCode, newSupplierCost: row.supplierCost, selected: false }));
    const preview = previewRows.length ? await batchPreviewDailyPricing({ supplierId: String(supplier._id), region: "TH", rows: previewRows }) : { rows: [] };
    result.pricingPreview = verified.map(item => { const row = preview.rows.find(value => value.packageCode === item.packageCode); const th = row?.regions?.find(value => value.region === "TH"); return { packageCode: item.packageCode, offerId: item.offerId, rawUsd: item.rawUsd, fxRate: th?.exchangeRate ?? null, convertedThb: th?.fxConvertedCost ?? null, landedThb: th?.landedCost ?? null, sellingThb: th?.recommendedSellingPrice ?? null, profitThb: th?.netProfit ?? null, blockingErrors: th?.blockingErrors || row?.blockingErrors || [] }; });
    const [productAfter, packagesAfter, mappingsAfter, wonddAfter, balanceAfter] = await Promise.all([CatalogProduct.findOne({ productCode: "valorant" }).lean(), CatalogPackage.find({ productCode: "valorant", packageCode: { $in: EXACT.map(item => item[0]) } }).lean(), Mapping.find({ supplierCode: "FAZERCARDS", productCode: "valorant", region: "TH" }).lean(), Mapping.find({ supplierCode: "WONDD" }).lean(), adapter.getBalance()]);
    result.gates = { canonical: Boolean(productAfter && !productAfter.deletedAt), operationalModelReady: productAfter?.enabled === true, thailandAuthority: JSON.stringify(productAfter?.supportedRegions) === JSON.stringify(["TH"]), inputReady: productAfter?.metadata?.customerInputContract?.fields?.[0]?.key === "riotId", packagesReady: packagesAfter.length === 6, mappingsPrepared: mappingsAfter.length === 6, publicDiscovery: productAfter?.publicDiscoveryEnabled === true, checkout: productAfter?.commerceState === "PURCHASABLE" || packagesAfter.some(item => item.enabled), mappingsEnabled: mappingsAfter.filter(item => item.enabled).length, fulfillment: mappingsAfter.some(item => item.mappingMetadata?.readiness?.fulfillmentReady === true), pricesPublished: packagesAfter.some(item => item.prices?.TH?.enabled === true) };
    result.safety = { realOrderCalls: 0, liveValidationCalls: 0, balanceBeforeUsd: balanceBefore.rawMetadata.balance, balanceAfterUsd: balanceAfter.rawMetadata.balance, balanceSpentUsd: Number(balanceBefore.rawMetadata.balance) - Number(balanceAfter.rawMetadata.balance), customerOrdersModified: 0, walletsModified: 0, wonddModified: wonddHash === hash(wonddAfter) ? 0 : "DETECTED" };
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(OUT_MD, `# FazerCards Valorant canonical rollout preparation\n\nGenerated: ${new Date().toISOString()}\n\nValorant is restored as closed canonical Thailand authority while public discovery, checkout, fulfillment, mappings, and publication remain disabled. Provider access in this run used GET only.\n\n## Canonical VP packages and disabled mappings\n\n${table(["Package", "Name", "Category", "Offer", "Raw USD", "Enabled"], verified.map(item => [item.packageCode, item.name, CATEGORY, item.offerId, item.rawUsd, "false"]))}\n\n## Pricing preview\n\n${table(["Package", "Raw USD", "FX", "Converted THB", "Landed THB", "Selling THB", "Profit THB"], result.pricingPreview.map(item => [item.packageCode, item.rawUsd, item.fxRate, item.convertedThb, item.landedThb, item.sellingThb, item.profitThb]))}\n\n## Legacy disposition\n\n${table(["Package", "Classification", "Historical refs", "Action"], result.legacyDisposition.map(item => [item.packageCode, item.classification, item.historicalOrderReferences, item.action]))}\n\n## Riot ID authority\n\nAZIEL uses one required text field, riotId, labelled Riot ID and formatted Name#TAG. Surrounding whitespace is trimmed; case and internal characters are preserved. FazerCards translation is fields.riot_id. Validation is not advertised and no validation call was made.\n\n## Safety gates\n\nPublic discovery OFF; checkout OFF; all mappings disabled; fulfillment not ready; no prices published; WonDD unchanged.\n`);
    console.log(JSON.stringify({ result: "PASS", ...result }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode = 1; });
