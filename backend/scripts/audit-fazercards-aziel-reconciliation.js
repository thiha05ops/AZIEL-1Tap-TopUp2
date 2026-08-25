#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const adapter = require("../services/suppliers/fazercardsAdapter");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const { CANONICAL_OPERATIONAL_PRODUCTS } = require("../catalog/canonicalOperationalCatalog");
const { loadDailyPricingWorkspace, batchPreviewDailyPricing } = require("../services/commerce/adminPricingControlCenterService");
const previous = require("../../docs/fazercards-sellable-catalog-audit.json");

const OUT_JSON = path.join(__dirname, "../../docs/fazercards-aziel-catalog-reconciliation.json");
const OUT_MD = path.join(__dirname, "../../docs/fazercards-aziel-catalog-reconciliation.md");
const OVERLAPS = ["Mobile Legends", "PUBG Mobile", "Free Fire", "Honor of Kings", "Valorant", "Genshin Impact", "Blood Strike", "Marvel Rivals", "LifeAfter", "Magic Chess Go Go", "CapCut"];
const FAMILY_CODES = Object.freeze({
    "Mobile Legends": ["mlbb", "mlbb-twilight-weekly-pass"], "PUBG Mobile": ["pubg", "pubgrp"], "Free Fire": ["freefire"],
    "Honor of Kings": ["hok"], Valorant: [], "Genshin Impact": [], "Blood Strike": ["blood-strike", "blood-strike-pass"],
    "Marvel Rivals": ["marvel-rivals"], LifeAfter: ["lifeafter"], "Magic Chess Go Go": ["magic-chess-go-go"], CapCut: ["capcut"]
});
const AZIEL_INPUTS = Object.freeze({ mlbb: ["userId", "zoneId"], "mlbb-twilight-weekly-pass": ["userId", "zoneId"], pubg: ["userId"], pubgrp: ["userId"], freefire: ["userId"], hok: ["userId"] });
const priorCategory = new Map(previous.categories.map(item => [item.category_id, item]));
const priorFamilyCategoryIds = new Map(OVERLAPS.map(family => [family, previous.categories.filter(item => item.family === family).map(item => item.category_id)]));
const clean = value => String(value == null ? "" : value).trim();
const upper = value => clean(value).toUpperCase();
const normalized = value => clean(value).toLowerCase().replace(/,/g, "").replace(/\bmobile legends\b|\bpubg mobile\b|\bfree fire\b|\bhonor of kings\b|\bvalorant\b|\bgenshin impact\b|\bblood strike\b|\bmarvel rivals\b|\blifeafter\b|\bmagic chess(?::)? go go\b|\bcapcut\b/g, " ").replace(/[^a-z0-9+]+/g, " ").trim().replace(/\s+/g, " ");
const passwordFields = fields => fields.some(field => /password|passcode|otp|email/i.test(field.key || field));

function categoryRows(payload) { return Array.isArray(payload?.items) ? payload.items : []; }
function offerRows(payload) { return payload?.offers || payload?.data?.offers || payload?.data || []; }
function inferRegion(item = {}, prior = {}) {
    if (prior.region_context && prior.region_context !== "UNKNOWN") return prior.region_context;
    const note = clean(item.note || item.notes);
    return note.match(/Region:\s*([^\n]+)/i)?.[1]?.trim() || "UNKNOWN";
}
function classifyCategory(family, item, prior) {
    const id = clean(item.category_id);
    const name = clean(item.name);
    if (/login/i.test(id) || /via login/i.test(name) || passwordFields(prior.required_player_fields || [])) return "RELATED_BUT_DIFFERENT";
    if (family === "PUBG Mobile") return id === "pubg_mobile_auto" ? "EXACT_MATCH" : "RELATED_BUT_DIFFERENT";
    const region = inferRegion(item, prior);
    if (/manual|reserve|voucher/i.test(id)) return "RELATED_BUT_DIFFERENT";
    if (/Global/i.test(region) || region === "UNKNOWN") return "EXACT_MATCH";
    return "REGIONAL_VARIANT";
}
function providerFields(prior = {}, validationByFamily = new Map(), family = "") {
    const exact = Array.isArray(prior.required_player_fields) ? prior.required_player_fields : [];
    const fallback = validationByFamily.get(family)?.fields || [];
    return (exact.length ? exact : fallback).map(field => ({ key: clean(field.key || field), label: clean(field.label || field.key || field), type: clean(field.type || "text") }));
}
function canonicalFields(code) { return AZIEL_INPUTS[code] || ["userId"]; }
function inputsCompatible(provider = [], aziel = []) {
    if (!provider.length) return false;
    if (passwordFields(provider)) return false;
    const providerKeys = provider.map(item => item.key);
    const hasId = providerKeys.every(key => /^(player_id|user_id|uid|role_id|zone_id|server_id|server|region|username)$/.test(key));
    const azielCapacity = aziel.length >= providerKeys.length;
    return hasId && azielCapacity;
}
function packageClass(offer, canonicalPackages, preparedMapping) {
    if (preparedMapping) return "EXACT_PACKAGE_MATCH";
    const name = clean(offer.name);
    if (/pass|subscription|membership|prime|bundle|pack|weekly|monthly|first purchase|voucher|login/i.test(name)) return "SUPPLIER_ONLY_VARIANT";
    const matches = canonicalPackages.filter(pkg => normalized(pkg.name) === normalized(name));
    if (matches.length === 1) return "EXACT_PACKAGE_MATCH";
    if (matches.length > 1) return "AMBIGUOUS";
    if (/\d/.test(name) && /diamond|uc|token|point|credit|gold|crystal|coin/i.test(name)) return "NEW_CANONICAL_PACKAGE_CANDIDATE";
    return "AMBIGUOUS";
}
function recommendation(fazerCost, wonddCost) {
    if (Number.isFinite(fazerCost) && Number.isFinite(wonddCost)) return fazerCost < wonddCost ? "FAZERCARDS_PREFERRED" : wonddCost < fazerCost ? "WONDD_PREFERRED" : "NEEDS_REVIEW";
    if (Number.isFinite(fazerCost)) return "ONLY_FAZERCARDS";
    if (Number.isFinite(wonddCost)) return "ONLY_WONDD";
    return "NEEDS_REVIEW";
}
async function mapLimit(values, limit, fn) {
    const output = new Array(values.length); let cursor = 0;
    async function worker() { while (cursor < values.length) { const index = cursor++; output[index] = await fn(values[index], index); } }
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker)); return output;
}
function mdTable(headers, rows) {
    const cell = value => String(value == null ? "" : value).replace(/\|/g, "\\|").replace(/\n/g, " ");
    return `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map(row => `| ${row.map(cell).join(" | ")} |`).join("\n")}`;
}

async function main() {
    if (clean(process.env.FAZERCARDS_PUBG_AUTO_FULFILLMENT_ENABLED).toLowerCase() === "true") throw new Error("FazerCards gate must be OFF.");
    const balanceBefore = await adapter.getBalance();
    const categories = []; let cursor = "";
    do {
        const page = await adapter.getTopupCategories(cursor); categories.push(...categoryRows(page)); cursor = clean(page.meta?.next_cursor);
    } while (cursor);
    const currentCategoryMap = new Map(categories.map(item => [clean(item.category_id), item]));
    const relevantIds = [...new Set(OVERLAPS.flatMap(family => priorFamilyCategoryIds.get(family) || []))].filter(id => currentCategoryMap.has(id));
    const validationCapability = await (async () => {
        const fetch = require("node-fetch");
        const response = await fetch("https://api.fzr.cards/api/v2/topups/validate-id", { headers: { Accept: "application/json", "X-API-Key": process.env.FAZERCARDS_API_KEY } });
        if (!response.ok) return [];
        return (await response.json()).items || [];
    })();
    const validationByFamily = new Map();
    validationCapability.forEach(item => {
        const name = clean(item.name);
        const family = OVERLAPS.find(candidate => name === candidate || name.startsWith(candidate));
        if (family && !validationByFamily.has(family)) validationByFamily.set(family, item);
    });
    const offerSets = await mapLimit(relevantIds, 5, async id => [id, offerRows(await adapter.getTopupOffers(id))]);
    const offersByCategory = new Map(offerSets);

    await mongoose.connect(process.env.MONGO_URI);
    const [dbProducts, dbPackages, suppliers, mappings] = await Promise.all([
        CatalogProduct.find({ deletedAt: null }).lean(), CatalogPackage.find({ deletedAt: null }).lean(), Supplier.find({}).lean(), Mapping.find({}).lean()
    ]);
    const supplierById = new Map(suppliers.map(item => [String(item._id), item]));
    const packageByKey = new Map(dbPackages.map(item => [`${item.productCode}:${item.packageCode}`, item]));
    const mappingsByPackage = new Map();
    mappings.forEach(item => { const key = `${item.productCode}:${item.packageCode}`; if (!mappingsByPackage.has(key)) mappingsByPackage.set(key, []); mappingsByPackage.get(key).push(item); });
    const productDbMap = new Map(dbProducts.map(item => [item.productCode, item]));
    const canonicalMap = new Map(CANONICAL_OPERATIONAL_PRODUCTS.map(item => [item.productCode, item]));
    const productRows = CANONICAL_OPERATIONAL_PRODUCTS.map(canonical => {
        const db = productDbMap.get(canonical.productCode) || {};
        const packages = dbPackages.filter(pkg => pkg.productCode === canonical.productCode);
        return {
            productCode: canonical.productCode, displayName: db.name || canonical.name, family: canonical.family, category: canonical.adminCategory,
            packages: packages.map(pkg => ({ packageCode: pkg.packageCode, displayName: pkg.name, enabled: pkg.enabled !== false, regions: Object.keys(pkg.prices || {}), legacy: pkg.metadata?.legacy === true, supplierMappings: (mappingsByPackage.get(`${pkg.productCode}:${pkg.packageCode}`) || []).map(mapping => ({ supplierCode: mapping.supplierCode, region: mapping.region, enabled: mapping.enabled, supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode })) })),
            supportedRegions: db.supportedRegions || canonical.supportedRegions, customerInputFields: canonicalFields(canonical.productCode), enabled: db.enabled !== false,
            public: db.publicDiscoveryEnabled === true && db.commerceState === "PURCHASABLE", commerceState: db.commerceState || "MISSING_DB_ROW"
        };
    });

    const categoryOutput = [];
    const packageMappings = [];
    const inputContracts = [];
    const restrictions = [];
    for (const family of OVERLAPS) {
        const codes = FAMILY_CODES[family];
        const canonicalPackages = dbPackages.filter(pkg => codes.includes(pkg.productCode));
        for (const id of priorFamilyCategoryIds.get(family) || []) {
            const current = currentCategoryMap.get(id); if (!current) continue;
            const prior = priorCategory.get(id) || {};
            const classification = codes.length ? classifyCategory(family, current, prior) : "AMBIGUOUS";
            const fields = providerFields(prior, validationByFamily, family);
            const azielFields = [...new Set(codes.flatMap(canonicalFields))];
            const compatible = codes.length > 0 && inputsCompatible(fields, azielFields);
            const region = inferRegion(current, prior);
            const category = { family, canonicalProductCodes: codes, categoryId: id, providerName: current.name, classification, region, note: clean(current.note), requiredFields: fields, validationCapability: validationByFamily.get(family) ? { categoryId: validationByFamily.get(family).category_id, fields: validationByFamily.get(family).fields } : null, offerCount: (offersByCategory.get(id) || []).length };
            categoryOutput.push(category);
            inputContracts.push({ product: family, canonicalProductCodes: codes, region, fazerCardsCategory: id, requiredFields: fields.map(item => item.key), azielCurrentFields: azielFields, compatible, requiredAzielChange: compatible ? "NONE" : !codes.length ? "CANONICAL_PRODUCT_AUTHORITY_REQUIRED" : !fields.length ? "PROVIDER_INPUT_CONTRACT_REQUIRED" : "PRODUCT_SPECIFIC_INPUT_SCHEMA_REQUIRED", unsuitablePassword: passwordFields(fields) });
            (prior.explicit_region_restrictions || []).forEach(text => restrictions.push({ product: family, categoryId: id, region, restriction: typeof text === "string" ? text : text.text }));
            for (const offer of offersByCategory.get(id) || []) {
                if (!["EXACT_MATCH", "REGIONAL_VARIANT"].includes(classification)) continue;
                const prepared = mappings.find(mapping => mapping.supplierCode === "FAZERCARDS" && mapping.supplierProductCode === id && mapping.supplierPackageCode === clean(offer.offer_id));
                const packageClassification = packageClass(offer, canonicalPackages, prepared);
                const exactPkg = prepared ? packageByKey.get(`${prepared.productCode}:${prepared.packageCode}`) : canonicalPackages.find(pkg => normalized(pkg.name) === normalized(offer.name));
                packageMappings.push({ family, categoryId: id, region, offerId: clean(offer.offer_id), providerOfferName: clean(offer.name), currentPriceUsd: Number(offer.price_usd), classification: packageClassification, canonicalProductCode: prepared?.productCode || exactPkg?.productCode || "", canonicalPackageCode: prepared?.packageCode || exactPkg?.packageCode || "", evidence: prepared ? "EXISTING_EXACT_SUPPLIER_MAPPING" : exactPkg ? "EXACT_NORMALIZED_CANONICAL_LABEL" : "NO_EXACT_CANONICAL_IDENTITY", restrictions: offer.restrictions || offer.metadata || {} });
            }
        }
    }

    const fazer = suppliers.find(item => item.supplierCode === "FAZERCARDS");
    const wondd = suppliers.find(item => item.supplierCode === "WONDD");
    const supplierComparisons = [];
    if (fazer) {
        const workspace = await loadDailyPricingWorkspace({ supplierId: String(fazer._id), region: "TH" });
        const previewRows = workspace.rows.filter(row => row.previewEligible).map(row => ({ mappingId: row.mappingId, productCode: row.productCode, packageCode: row.packageCode, newSupplierCost: row.supplierCost, selected: false }));
        const previews = previewRows.length ? await batchPreviewDailyPricing({ supplierId: String(fazer._id), region: "TH", rows: previewRows }) : { rows: [] };
        for (const mapping of mappings.filter(item => item.supplierCode === "FAZERCARDS")) {
            const key = `${mapping.productCode}:${mapping.packageCode}`; const pkg = packageByKey.get(key); if (!pkg) continue;
            const preview = previews.rows.find(row => row.productCode === mapping.productCode && row.packageCode === mapping.packageCode)?.regions?.find(item => item.region === "TH");
            const wonddMapping = (mappingsByPackage.get(key) || []).find(item => item.supplierCode === "WONDD");
            const wonddCostEvidence = wonddMapping?.supplierCostAuthority || wonddMapping?.mappingMetadata?.supplierCost || {};
            const wonddCost = Number(wonddCostEvidence.rawSupplierCost ?? wonddCostEvidence.netDealerPrice);
            const fazerRaw = Number(mapping.supplierCostAuthority?.rawSupplierCost);
            const landed = Number(preview?.landedCost);
            supplierComparisons.push({ canonicalProductCode: mapping.productCode, canonicalPackageCode: mapping.packageCode, packageName: pkg.name, wonddAvailable: Boolean(wonddMapping), wonddCostThb: Number.isFinite(wonddCost) ? wonddCost : null, fazerCardsAvailable: true, fazerCardsRawUsd: fazerRaw, fazerCardsLandedThb: Number.isFinite(landed) ? landed : null, existingSellingPriceThb: pkg.prices?.TH?.amount ?? null, recommendation: recommendation(landed, wonddCost) });
        }
    }
    const counts = packageMappings.reduce((acc, item) => { acc[item.classification] = (acc[item.classification] || 0) + 1; return acc; }, {});
    const exactCategories = categoryOutput.filter(item => item.classification === "EXACT_MATCH");
    const regionalCategories = categoryOutput.filter(item => item.classification === "REGIONAL_VARIANT");
    const exactProductFamilies = new Set(exactCategories.filter(item => item.canonicalProductCodes.length).map(item => item.family));
    const mlbbCandidates = packageMappings.filter(item => item.family === "Mobile Legends" && item.categoryId === "mobile_legends_global" && ["EXACT_PACKAGE_MATCH", "NEW_CANONICAL_PACKAGE_CANDIDATE"].includes(item.classification) && /diamond/i.test(item.providerOfferName)).sort((a, b) => a.currentPriceUsd - b.currentPriceUsd);
    const implementationQueue = [
        { priority: "A", products: ["PUBG Mobile"], reason: "Six exact disabled mappings, compatible Player ID input, pricing preview and adapter ready." },
        { priority: "A", products: ["Free Fire", "Mobile Legends"], reason: "Existing canonical products and automatic provider variants; reconcile exact packages and regional restrictions product-by-product." },
        { priority: "B", products: ["Honor of Kings", "Blood Strike", "Marvel Rivals", "LifeAfter", "Magic Chess Go Go", "CapCut"], reason: "Canonical products exist, but package semantics and/or generic input surfaces require cleanup." },
        { priority: "B", products: ["Valorant", "Genshin Impact"], reason: "Provider family overlap exists but neither is in the current closed canonical operational registry." },
        { priority: "C", products: previous.priorityCandidates.filter(item => !OVERLAPS.includes(item.family)).map(item => item.family).slice(0, 20), reason: "Strong provider evidence; deliberately not onboarded in this phase." },
        { priority: "D", products: categoryOutput.filter(item => passwordFields(item.requiredFields)).map(item => item.providerName), reason: "Password/login-based categories are unsuitable." }
    ];
    const ambiguities = [
        ...categoryOutput.filter(item => ["AMBIGUOUS", "RELATED_BUT_DIFFERENT"].includes(item.classification)).map(item => ({ type: "CATEGORY", identity: item.categoryId, reason: item.classification })),
        ...packageMappings.filter(item => item.classification === "AMBIGUOUS").map(item => ({ type: "PACKAGE", identity: `${item.categoryId}/${item.offerId}`, reason: "No exact canonical denomination/semantic identity." })),
        { type: "CANONICAL_REGISTRY", identity: "Valorant/Genshin Impact", reason: "Provider overlaps exist, but current AZIEL closed canonical registry has no corresponding product code." }
    ];
    const balanceAfter = await adapter.getBalance();
    const report = {
        generatedAt: new Date().toISOString(), authority: { providerCategoriesTotal: categories.length, relevantFamilies: OVERLAPS.length, relevantCategories: categoryOutput.length, balanceBeforeUsd: balanceBefore.rawMetadata.balance, balanceAfterUsd: balanceAfter.rawMetadata.balance, providerBalanceSpentUsd: Number(balanceBefore.rawMetadata.balance) - Number(balanceAfter.rawMetadata.balance), realOrderCalls: 0, liveValidationCalls: 0, wonddTopupCalls: 0, pricesPublished: 0, fulfillmentGatesChanged: 0, storefrontChanged: false },
        summary: { azielProductsReviewed: productRows.length, fazerCardsCategoriesReviewed: categoryOutput.length, exactProductMatches: exactProductFamilies.size, exactCategoryMatches: exactCategories.length, regionalVariants: regionalCategories.length, exactPackageMatches: counts.EXACT_PACKAGE_MATCH || 0, newPackageCandidates: counts.NEW_CANONICAL_PACKAGE_CANDIDATE || 0, ambiguousPackages: counts.AMBIGUOUS || 0, inputCompatibleProducts: new Set(inputContracts.filter(item => item.compatible).map(item => item.product)).size, productsRequiringInputChanges: new Set(inputContracts.filter(item => !item.compatible).map(item => item.product)).size, fazerCardsPreferred: supplierComparisons.filter(item => item.recommendation === "FAZERCARDS_PREFERRED").length, wonddPreferred: supplierComparisons.filter(item => item.recommendation === "WONDD_PREFERRED").length, needsReview: supplierComparisons.filter(item => item.recommendation === "NEEDS_REVIEW").length },
        products: productRows, categories: categoryOutput, packageMappings, inputContracts, regionRestrictions: restrictions, supplierComparisons, implementationQueue, ambiguities,
        specialReviews: { mlbbControlledTestCandidate: mlbbCandidates[0] || null, mlbbStatus: mlbbCandidates.length ? "CATALOG_CANDIDATE_ONLY_NO_VALIDATION_OR_ORDER" : "NEEDS_EXACT_PACKAGE_RECONCILIATION", pubgControlledTest: "DEFERRED_UNTIL_REAL_CUSTOMER", pubgPreparedMappings: 6 }
    };
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    const s = report.summary;
    const md = `# FazerCards ↔ AZIEL catalog reconciliation\n\nGenerated: ${report.generatedAt}\n\n> Documentation-only reconciliation. No order, validation POST, WonDD top-up, price publication, fulfillment gate, or storefront mutation occurred.\n\n## Summary\n\n${mdTable(["Metric", "Value"], Object.entries(s).map(([key, value]) => [key, value]))}\n\n## Priority queue\n\n${mdTable(["Priority", "Products", "Reason"], implementationQueue.map(item => [item.priority, item.products.join(", "), item.reason]))}\n\n## Product / region / input matrix\n\n${mdTable(["Product", "Region", "Category", "Identity", "Provider fields", "AZIEL fields", "Compatible", "Required change"], inputContracts.map((item, index) => [item.product, item.region, item.fazerCardsCategory, categoryOutput[index]?.classification || "", item.requiredFields.join(", ") || "UNKNOWN", item.azielCurrentFields.join(", ") || "NONE", item.compatible ? "YES" : "NO", item.requiredAzielChange]))}\n\n## Supplier comparison\n\n${mdTable(["AZIEL package", "WonDD THB", "Fazer USD", "Fazer landed THB", "Selling THB", "Recommendation"], supplierComparisons.map(item => [`${item.canonicalProductCode}/${item.canonicalPackageCode}`, item.wonddCostThb ?? "-", item.fazerCardsRawUsd ?? "-", item.fazerCardsLandedThb ?? "-", item.existingSellingPriceThb ?? "-", item.recommendation]))}\n\n## MLBB special review\n\nSafest catalog candidate for a later controlled validation/test: ${report.specialReviews.mlbbControlledTestCandidate ? `\`${report.specialReviews.mlbbControlledTestCandidate.categoryId}/${report.specialReviews.mlbbControlledTestCandidate.offerId}\` (${report.specialReviews.mlbbControlledTestCandidate.providerOfferName}, ${report.specialReviews.mlbbControlledTestCandidate.currentPriceUsd} USD)` : "not yet proven"}. This is catalog evidence only; no live validation or top-up was performed. Existing WonDD MLBB authority remains unchanged.\n\n## PUBG state\n\nSix existing FazerCards mappings remain disabled. Controlled test: **DEFERRED_UNTIL_REAL_CUSTOMER**.\n\n## Catalog inconsistencies before rollout\n\n${ambiguities.slice(0, 100).map(item => `- **${item.type} — ${item.identity}:** ${item.reason}`).join("\n")}\n\nThe complete category, offer, restriction, package classification, product, and ambiguity records are in the companion JSON file.\n`;
    fs.writeFileSync(OUT_MD, md);
    await mongoose.disconnect();
    console.log(JSON.stringify({ result: "PASS", ...report.summary, relevantCategories: categoryOutput.length, balanceBefore: balanceBefore.rawMetadata.balance, balanceAfter: balanceAfter.rawMetadata.balance, spent: report.authority.providerBalanceSpentUsd, orderCalls: 0, validationCalls: 0, wonddTopupCalls: 0 }, null, 2));
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message })); process.exitCode = 1; });
