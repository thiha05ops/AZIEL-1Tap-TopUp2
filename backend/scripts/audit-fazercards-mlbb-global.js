#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const fetch = require("node-fetch");
const adapter = require("../services/suppliers/fazercardsAdapter");
const CatalogPackage = require("../models/CatalogPackage");
const SupplierProductMapping = require("../models/SupplierProductMapping");
const PricingPolicy = require("../models/PricingPolicy");

const CATEGORY = "mobile_legends_global";
const OUT_JSON = path.join(__dirname, "../../docs/fazercards-mlbb-global-reconciliation.json");
const OUT_MD = path.join(__dirname, "../../docs/fazercards-mlbb-global-reconciliation.md");
const clean = value => String(value == null ? "" : value).trim();
const compact = value => clean(value).toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, "").replace(/diamonds?/g, "diamond");
const money = value => Math.round(Number(value) * 1e6) / 1e6;
const mdTable = (headers, rows) => `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map(row => `| ${row.map(value => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`).join("\n")}`;

function restrictionsFor(offer, note) {
    const result = [];
    if (/Not available for Indonesia and BR regions/i.test(note)) result.push("CATEGORY_EXCLUDES_ID_AND_BR");
    const restricted = /^(78_8|156_16|234_23|625_81|1860_335|3099_589|4649_883|7740_1548)_diamonds$/.test(offer.offer_id) || offer.offer_id === "weekly_pass";
    if (restricted) result.push("PACK_EXCLUDES_MY_SG_PH_ID_RU");
    return result;
}

function classify(offer, packages, note) {
    const name = clean(offer.name);
    const restrictions = restrictionsFor(offer, note);
    if (/first top-up bonus/i.test(name)) return { classification: "BONUS_VARIANT", canonical: null, restrictions };
    if (/pass|weekly elite|monthly elite/i.test(name)) return { classification: "PASS_OR_SUBSCRIPTION", canonical: null, restrictions };
    const exact = packages.filter(pkg => compact(pkg.name) === compact(name));
    if (restrictions.includes("PACK_EXCLUDES_MY_SG_PH_ID_RU")) return { classification: "REGION_RESTRICTED", canonical: exact.length === 1 ? exact[0] : null, restrictions };
    if (exact.length === 1) return { classification: "EXACT_EXISTING_PACKAGE", canonical: exact[0], restrictions };
    if (exact.length > 1) return { classification: "AMBIGUOUS", canonical: null, restrictions };
    if (/^\d+ diamonds$/i.test(name)) return { classification: "NEW_CANONICAL_PACKAGE_CANDIDATE", canonical: null, restrictions };
    if (/^\d+\s*\+\s*\d+ diamonds$/i.test(name)) return { classification: "BONUS_VARIANT", canonical: null, restrictions };
    return { classification: "AMBIGUOUS", canonical: null, restrictions };
}

async function main() {
    if (clean(process.env.FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED).toLowerCase() === "true") throw new Error("FazerCards live gate must be OFF for reconciliation.");
    const before = await adapter.getBalance();
    let cursor = ""; let category = null;
    do {
        const page = await adapter.getTopupCategories(cursor);
        category ||= (page.items || []).find(item => item.category_id === CATEGORY) || null;
        cursor = clean(page.meta?.next_cursor);
    } while (cursor);
    if (!category) throw new Error(`${CATEGORY} is absent from the current authenticated catalog.`);
    const offerPayload = await adapter.getTopupOffers(CATEGORY);
    const offers = offerPayload.offers || [];
    const capabilityResponse = await fetch("https://api.fzr.cards/api/v2/topups/validate-id", { headers: { Accept: "application/json", "X-API-Key": process.env.FAZERCARDS_API_KEY } });
    if (!capabilityResponse.ok) throw new Error(`Validation capability GET failed with ${capabilityResponse.status}.`);
    const capabilities = (await capabilityResponse.json()).items || [];
    const validation = capabilities.find(item => item.category_id === "mobile_legends") || null;

    await mongoose.connect(process.env.MONGO_URI);
    const [packages, mappings, policy] = await Promise.all([
        CatalogPackage.find({ productCode: { $in: ["mlbb", "mlbb-twilight-weekly-pass"] }, deletedAt: null }).sort({ productCode: 1, sortOrder: 1 }).lean(),
        SupplierProductMapping.find({ productCode: { $in: ["mlbb", "mlbb-twilight-weekly-pass"] } }).lean(),
        PricingPolicy.findOne({ region: "TH", currency: "THB", status: "ACTIVE", "metadata.supplierCurrency": "USD" }).sort({ updatedAt: -1 }).lean()
    ]);
    const fx = Number(policy?.metadata?.exchangeRate);
    if (!Number.isFinite(fx) || fx <= 0) throw new Error("Active USD→THB PricingPolicy authority was not resolved.");
    const wondd = mappings.filter(item => item.supplierCode === "WONDD" && item.region === "TH");
    const rows = offers.map(offer => {
        const result = classify(offer, packages, offerPayload.note || category.note || "");
        return { offerId: offer.offer_id, providerName: offer.name, priceUsd: Number(offer.price_usd), landedThb: money(Number(offer.price_usd) * fx), availability: "LISTED_CURRENTLY", ...result, canonicalProductCode: result.canonical?.productCode || "", canonicalPackageCode: result.canonical?.packageCode || "", canonicalDisplayName: result.canonical?.name || "" };
    });
    const exactMatches = rows.filter(row => row.classification === "EXACT_EXISTING_PACKAGE");
    const newCandidates = rows.filter(row => row.classification === "NEW_CANONICAL_PACKAGE_CANDIDATE");
    const ambiguousOffers = rows.filter(row => ["AMBIGUOUS", "UNSUPPORTED", "BONUS_VARIANT", "PASS_OR_SUBSCRIPTION", "REGION_RESTRICTED"].includes(row.classification));
    const supplierEconomics = exactMatches.map(row => {
        const wm = wondd.find(item => item.productCode === row.canonicalProductCode && item.packageCode === row.canonicalPackageCode);
        const pkg = packages.find(item => item.productCode === row.canonicalProductCode && item.packageCode === row.canonicalPackageCode);
        if (!wm) return null;
        const wonddCost = Number(wm.supplierCostAuthority?.rawSupplierCost ?? (pkg?.prices?.TH?.supplierCode === "WONDD" ? pkg.prices.TH.supplierCost : null));
        return { canonicalPackageCode: row.canonicalPackageCode, canonicalDisplayName: row.canonicalDisplayName, wonddPackcode: wm?.supplierPackageCode || "", wonddRawThb: Number.isFinite(wonddCost) ? wonddCost : null, fazerOfferId: row.offerId, fazerRawUsd: row.priceUsd, fxRate: fx, fazerLandedThb: row.landedThb, differenceThb: Number.isFinite(wonddCost) ? money(row.landedThb - wonddCost) : null, cheaperSupplier: Number.isFinite(wonddCost) ? row.landedThb < wonddCost ? "FAZERCARDS" : wonddCost < row.landedThb ? "WONDD" : "TIE" : "NO_WONDD_EXACT_MAPPING" };
    }).filter(Boolean);
    const canonical = packages.map(pkg => ({ productCode: pkg.productCode, packageCode: pkg.packageCode, displayName: pkg.name, enabled: pkg.enabled !== false, deleted: Boolean(pkg.deletedAt), thAvailable: pkg.prices?.TH?.enabled === true, thSellingPrice: pkg.prices?.TH?.amount ?? null }));
    const wonddMappings = wondd.map(item => ({ productCode: item.productCode, packageCode: item.packageCode, servicecode: item.supplierProductCode, packcode: item.supplierPackageCode, enabled: item.enabled === true, executionMode: item.executionMode, supplierCostThb: item.supplierCostAuthority?.rawSupplierCost ?? packages.find(pkg => pkg.productCode === item.productCode && pkg.packageCode === item.packageCode)?.prices?.TH?.supplierCost ?? null, fulfillmentReady: item.enabled === true && item.executionMode === "API" }));
    const inputContract = [{ source: "OFFERS_GET", fields: offerPayload.fields || [], normalizedAzielMapping: { userId: "player_id", zoneId: "UNRESOLVED_SERVER_ID_VS_ZONE_ID" }, trimming: "Adapter trims strings", missingFieldBehavior: "Current MLBB order payload support is not implemented; adapter's existing top-up builder only sends player_id", numericRequirement: "NOT_EXPLICITLY_STATED_BY_PROVIDER_METADATA" }, { source: "VALIDATION_CAPABILITY_GET", validationCategory: validation?.category_id || "", fields: validation?.fields || [], playerNameReturned: "UNKNOWN_WITHOUT_LIVE_VALIDATION", mandatoryBeforeOrder: "NOT_PROVEN_BY_READ_ONLY_METADATA" }];
    const regionRestrictions = [{ scope: "CATEGORY", excluded: ["ID", "BR"], evidence: "Provider category note" }, { scope: "SELECTED_PACKS", excluded: ["MY", "SG", "PH", "ID", "RU"], offers: rows.filter(row => row.restrictions.includes("PACK_EXCLUDES_MY_SG_PH_ID_RU")).map(row => row.offerId), evidence: "Provider category note" }];
    const plan = canonical.map(pkg => ({ packageCode: pkg.packageCode, recommendation: pkg.enabled ? "KEEP" : "LEGACY_KEEP_PRIVATE", reason: "Canonical identity is independent of FazerCards coverage." }));
    plan.push(...newCandidates.map(row => ({ offerId: row.offerId, recommendation: "ADD_CANDIDATE", reason: "Plain denomination is unambiguous, but production creation is deferred." })));
    plan.push(...ambiguousOffers.map(row => ({ offerId: row.offerId, recommendation: row.classification === "AMBIGUOUS" ? "AMBIGUOUS_REVIEW" : "DO_NOT_MAP", reason: row.classification })));
    const candidate = rows.find(row => row.offerId === "5_diamonds");
    const after = await adapter.getBalance();
    const report = { generatedAt: new Date().toISOString(), status: "PASS", category: { categoryId: category.category_id, name: category.name, note: category.note, offerCount: offers.length }, currentCanonicalPackages: canonical, wonddMappings, fazercardsOffers: rows, exactMatches, newCandidates, ambiguousOffers, supplierEconomics, regionRestrictions, inputContract, recommendedCanonicalPlan: plan, fxAuthority: { rate: fx, source: policy.metadata.exchangeRateSource, capturedAt: policy.metadata.exchangeRateCapturedAt, maximumAgeSeconds: policy.metadata.exchangeRateMaxAgeSeconds, policyCode: policy.code }, controlledTestCandidate: { ...candidate, assessment: candidate?.classification === "NEW_CANONICAL_PACKAGE_CANDIDATE" ? "LOWEST_COST_PLAIN_DENOMINATION_BUT_NOT_READY_UNTIL_CANONICAL_IDENTITY_AND_SERVER_ID_FIELD_ARE_RESOLVED" : "NOT_SAFE" }, safety: { realFazerCardsOrderCalls: 0, liveValidationCalls: 0, wonddTopupCalls: 0, providerBalanceBeforeUsd: before.rawMetadata.balance, providerBalanceAfterUsd: after.rawMetadata.balance, providerBalanceSpentUsd: Number(before.rawMetadata.balance) - Number(after.rawMetadata.balance), productionDataMutations: 0, fazerCardsMappingsCreated: 0, fazerCardsMappingsEnabled: 0, wonddMappingsModified: 0, pricesPublished: 0, publicStorefrontChanged: false } };
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    const offerTable = rows.map(row => [row.offerId, row.providerName, row.priceUsd, row.landedThb, row.classification, row.canonicalPackageCode || "-", row.restrictions.join(", ") || "-"]);
    const economics = supplierEconomics.map(row => [row.canonicalDisplayName, row.wonddPackcode || "-", row.wonddRawThb ?? "-", row.fazerOfferId, row.fazerRawUsd, row.fxRate, row.fazerLandedThb, row.differenceThb ?? "-", row.cheaperSupplier]);
    const md = `# FazerCards Mobile Legends Global reconciliation\n\nGenerated: ${report.generatedAt}\n\nRead-only authority snapshot. No provider mutation, validation POST, mapping change, price publication, or storefront change occurred.\n\n## Authority summary\n\n- Canonical packages: ${canonical.length}\n- WonDD TH mappings: ${wonddMappings.length}\n- Current Global offers: ${rows.length}\n- Exact existing matches: ${exactMatches.length}\n- New plain-denomination candidates: ${newCandidates.length}\n- Ambiguous/special/restricted offers: ${ambiguousOffers.length}\n- FX: ${fx} THB/USD (${report.fxAuthority.source})\n\n## Offer reconciliation\n\n${mdTable(["Offer", "Provider name", "USD", "Landed THB", "Classification", "Canonical package", "Restrictions"], offerTable)}\n\n## WonDD vs FazerCards economics\n\n${mdTable(["Canonical", "WonDD packcode", "WonDD THB", "Fazer offer", "Fazer USD", "FX", "Fazer landed THB", "Fazer-WonDD", "Cheaper"], economics)}\n\n## Input contract\n\nThe current offers response requires \`player_id\` and \`server_id\`; validation capability metadata uses \`player_id\` and \`zone_id\` under validation category \`mobile_legends\`. AZIEL uses User ID and Zone ID. This server_id/zone_id naming discrepancy must be resolved from provider order authority before exact mapping rollout. No validation POST was made.\n\n## Regional safety\n\nGlobal excludes Indonesia and Brazil. The provider also excludes MY/SG/PH/ID/RU for 78+8, 156+16, 234+23, 625+81, 1860+335, 3099+589, 4649+883, 7740+1548 Diamonds, and Weekly Pass.\n\n## Controlled test candidate\n\n\`mobile_legends_global/5_diamonds\` is the lowest-cost plain-denomination offer (${candidate?.priceUsd} USD; ${candidate?.landedThb} THB preview). It is not rollout-ready until a canonical 5 Diamonds identity is approved and the provider's \`server_id\` versus \`zone_id\` order-field contract is resolved.\n\nThe complete canonical package, WonDD mapping, input, restriction, cleanup-plan, and safety records are in the companion JSON.\n`;
    fs.writeFileSync(OUT_MD, md);
    await mongoose.disconnect();
    console.log(JSON.stringify({ result: "PASS", canonicalPackages: canonical.length, wonddMappings: wonddMappings.length, globalOffers: rows.length, exactMatches: exactMatches.length, newCandidates: newCandidates.length, ambiguousUnsupported: ambiguousOffers.length, fxRate: fx, controlledTestCandidate: candidate?.offerId || null, ...report.safety }, null, 2));
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", message: error.message })); process.exitCode = 1; });
