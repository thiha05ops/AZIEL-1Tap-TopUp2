#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Product = require("../models/CatalogProduct");
const Package = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const Supplier = require("../models/Supplier");
const FulfillmentAttempt = require("../models/FulfillmentAttempt");
const { CANONICAL_PRODUCT_CODES } = require("../catalog/canonicalOperationalCatalog");
const { toPublicCatalog } = require("../services/catalogService");
const { assessProductionMapping } = require("../services/supplierProductionSelectionService");
const { loadDailyPricingWorkspace, batchPreviewDailyPricing } = require("../services/commerce/adminPricingControlCenterService");
const { CONFIRMED_SERVICE_CODES } = require("../services/suppliers/wonddCatalogConfig");
const { hasWonddGameIdFormatter } = require("../services/suppliers/wonddGameIdFormatters");
const { SUPPORTED_PRODUCT_CATEGORIES } = require("../services/suppliers/fazercardsFulfillmentProcessor");

const OUT_JSON = path.join(__dirname, "../../docs/all-products-production-readiness.json");
const OUT_MD = path.join(__dirname, "../../docs/all-products-production-readiness.md");
const clean = value => String(value == null ? "" : value).trim();
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const table = (headers, rows) => `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map(row => `| ${row.map(value => String(value ?? "").replace(/\|/g, "\\|")).join(" | ")} |`).join("\n")}`;

function identity(mapping) {
    const product = clean(mapping.productCode).toLowerCase();
    const category = clean(mapping.supplierProductCode);
    const offer = clean(mapping.supplierPackageCode);
    if (!category || !offer) return "MISSING";
    if (mapping.mappingMetadata?.readiness?.supplierMapped !== true) return "AMBIGUOUS";
    if (mapping.supplierCode === "WONDD") return CONFIRMED_SERVICE_CODES[product]?.toLowerCase() === category.toLowerCase() ? "EXACT" : "MISMATCH";
    if (mapping.supplierCode === "FAZERCARDS") return SUPPORTED_PRODUCT_CATEGORIES[product] === category ? "EXACT" : "MISMATCH";
    return "AMBIGUOUS";
}

function costAuthority(mapping) {
    const authority = mapping.supplierCostAuthority || {};
    if (finite(authority.rawSupplierCost) !== null && authority.capturedAt) return { state: "AUTHORITATIVE", capturedAt: authority.capturedAt };
    const legacy = mapping.mappingMetadata?.supplierCost || {};
    if (finite(legacy.amount ?? legacy.netDealerPrice ?? legacy.priceUsd) !== null) return { state: "LEGACY_EVIDENCE_MIGRATABLE_REVIEW", capturedAt: legacy.capturedAt || null };
    return { state: "MISSING_COST_AUTHORITY", capturedAt: null };
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const [products, packages, mappings, suppliers, publicCatalog, attempts] = await Promise.all([
        Product.find({ productCode: { $in: CANONICAL_PRODUCT_CODES } }).sort({ sortOrder: 1, productCode: 1 }).lean(),
        Package.find({ productCode: { $in: CANONICAL_PRODUCT_CODES }, deletedAt: null }).sort({ productCode: 1, sortOrder: 1, packageCode: 1 }).lean(),
        Mapping.find({ productCode: { $in: CANONICAL_PRODUCT_CODES } }).sort({ productCode: 1, packageCode: 1, supplierCode: 1 }).lean(),
        Supplier.find().lean(),
        toPublicCatalog({ source: "database", includeDisabled: false, includeAdminPricing: false }),
        FulfillmentAttempt.find({ supplierMappingId: { $ne: null } }).select("supplierMappingId status supplierCodeSnapshot createdAt").lean()
    ]);
    const supplierMap = new Map(suppliers.map(item => [String(item._id), item]));
    const publicMap = new Map(publicCatalog.map(product => [product.productCode, new Set((product.packages || []).map(pkg => pkg.packageCode))]));
    const previews = new Map();
    const controlledTestByMapping = new Map();
    for (const attempt of attempts) {
        const key = String(attempt.supplierMappingId); const current = controlledTestByMapping.get(key) || { total: 0, succeeded: 0, failed: 0, latestAt: null };
        current.total += 1; if (attempt.status === "SUCCEEDED") current.succeeded += 1; if (attempt.status === "FAILED") current.failed += 1;
        if (!current.latestAt || new Date(attempt.createdAt) > new Date(current.latestAt)) current.latestAt = attempt.createdAt;
        controlledTestByMapping.set(key, current);
    }
    for (const supplier of suppliers.filter(item => mappings.some(mapping => String(mapping.supplierId) === String(item._id)))) {
        const workspace = await loadDailyPricingWorkspace({ supplierId: String(supplier._id), region: "TH" });
        const rows = workspace.rows.filter(row => CANONICAL_PRODUCT_CODES.includes(row.productCode) && row.previewEligible).map(row => ({ mappingId: row.mappingId, productCode: row.productCode, packageCode: row.packageCode, newSupplierCost: row.supplierCost, selected: false }));
        if (!rows.length) continue;
        const preview = await batchPreviewDailyPricing({ supplierId: String(supplier._id), region: "TH", rows });
        for (const row of preview.rows || []) {
            const th = row.regions?.find(item => item.region === "TH") || {};
            previews.set(String(row.mappingId), { fxRate: finite(th.exchangeRate), landedThb: finite(th.landedCost), recommendedPrice: finite(th.recommendedSellingPrice), recommendedProfit: finite(th.netProfit), errors: th.blockingErrors || row.blockingErrors || [] });
        }
    }
    const rows = [];
    for (const pkg of packages) {
        const product = products.find(item => item.productCode === pkg.productCode);
        const related = mappings.filter(item => item.productCode === pkg.productCode && item.packageCode === pkg.packageCode && item.region === "TH");
        const base = { product: pkg.productCode, packageCode: pkg.packageCode, packageName: pkg.name, publicTh: publicMap.get(pkg.productCode)?.has(pkg.packageCode) === true, publishedThPrice: finite(pkg.prices?.TH?.amount), commerceState: product?.commerceState || "HIDDEN", publicDiscovery: product?.publicDiscoveryEnabled === true, currentSafeRoute: product?.fulfillment?.manualAllowedRegions?.includes("TH") && pkg.enabled && pkg.prices?.TH?.enabled ? "MANUAL_ADMIN" : "NONE" };
        if (!related.length) { rows.push({ ...base, supplier: "NONE", exactIdentity: "MISSING", recommendedFutureRole: base.currentSafeRoute === "MANUAL_ADMIN" ? "MANUAL_ONLY" : "DISABLED", activationWave: base.currentSafeRoute === "MANUAL_ADMIN" ? "WAVE_0_MANUAL_SAFE" : "WAVE_4_IDENTITY_AUTHORITY_BLOCKED", activationBlockers: ["NO_SUPPLIER_MAPPING"] }); continue; }
        for (const mapping of related) {
            const supplier = supplierMap.get(String(mapping.supplierId)); const assessment = await assessProductionMapping(mapping); const preview = previews.get(String(mapping._id)) || {};
            const rawCost = finite(mapping.supplierCostAuthority?.rawSupplierCost ?? mapping.mappingMetadata?.supplierCost?.amount ?? mapping.mappingMetadata?.supplierCost?.netDealerPrice ?? mapping.mappingMetadata?.supplierCost?.priceUsd);
            const expectedProfit = base.publishedThPrice !== null && preview.landedThb !== null ? base.publishedThPrice - preview.landedThb - Math.max(0, (preview.recommendedPrice ?? preview.landedThb) - preview.landedThb - (preview.recommendedProfit ?? 0)) : null;
            const expectedMargin = expectedProfit !== null && base.publishedThPrice > 0 ? expectedProfit / base.publishedThPrice * 100 : null;
            const authority = costAuthority(mapping); const exact = identity(mapping);
            const economicFlags = [];
            if (base.publishedThPrice === null) economicFlags.push("PRICE_NOT_PUBLISHED");
            if (preview.landedThb !== null && base.publishedThPrice !== null && base.publishedThPrice < preview.landedThb) economicFlags.push("SELL_BELOW_COST");
            if (expectedProfit !== null && expectedProfit < 2) economicFlags.push("BELOW_MINIMUM_PROFIT");
            if (preview.recommendedPrice !== null && base.publishedThPrice !== null && base.publishedThPrice < preview.recommendedPrice) economicFlags.push("BELOW_POLICY_PRICE");
            if (authority.state === "MISSING_COST_AUTHORITY") economicFlags.push("MISSING_COST_AUTHORITY");
            if (authority.state === "LEGACY_EVIDENCE_MIGRATABLE_REVIEW") economicFlags.push("COST_AUTHORITY_MIGRATION_REVIEW");
            const attemptsEvidence = controlledTestByMapping.get(String(mapping._id));
            const implementation = { adapterReady: !assessment.blockers.includes("SUPPLIER_ADAPTER_NOT_READY"), processorReady: mapping.supplierCode === "WONDD" ? hasWonddGameIdFormatter(mapping.productCode) : !assessment.blockers.includes("FULFILLMENT_PROCESSOR_NOT_READY"), gate: assessment.featureGateEnabled ? "ON" : "OFF", controlledTest: attemptsEvidence?.succeeded ? "SUCCEEDED_EVIDENCE" : attemptsEvidence?.failed ? "FAILED_EVIDENCE" : mapping.mappingMetadata?.controlledTest?.status || mapping.mappingMetadata?.controlledTestStatus || "NOT_RECORDED" };
            const capturedAt = authority.capturedAt ? new Date(authority.capturedAt) : null;
            const maximumAgeSeconds = Number(mapping.mappingMetadata?.supplierCost?.maximumAgeSeconds || 86400);
            if (capturedAt && Number.isFinite(capturedAt.getTime()) && Date.now() - capturedAt.getTime() > maximumAgeSeconds * 1000) economicFlags.push("STALE_COST_AUTHORITY");
            if ((preview.errors || []).some(error => /exchange|fx.*stale|stale.*fx/i.test(String(error?.code || error)))) economicFlags.push("FX_STALE");
            const blockers = [...new Set([...assessment.blockers, ...(exact === "EXACT" ? [] : [`IDENTITY_${exact}`]), ...economicFlags])];
            let role = "BLOCKED"; let wave = "WAVE_4_IDENTITY_AUTHORITY_BLOCKED";
            if (exact === "EXACT" && implementation.adapterReady && implementation.processorReady && mapping.mappingMetadata?.readiness?.inputReady === true) {
                if (economicFlags.some(flag => ["SELL_BELOW_COST", "BELOW_MINIMUM_PROFIT", "BELOW_POLICY_PRICE", "PRICE_NOT_PUBLISHED"].includes(flag))) { role = "BLOCKED"; wave = "WAVE_3_PRICING_REQUIRED"; }
                else if (mapping.mappingMetadata?.readiness?.fulfillmentReady === true && blockers.every(flag => ["PROVIDER_FEATURE_GATE_OFF", "CURRENT_SUPPLIER_COST_MISSING", "MAPPING_DISABLED"].includes(flag))) { role = "PRIMARY_CANDIDATE"; wave = "WAVE_1_CONTROLLED_TEST_READY"; }
                else { role = "PRIMARY_CANDIDATE"; wave = "WAVE_1_CONTROLLED_TEST_READY"; }
            } else if (exact === "EXACT") { role = "BLOCKED"; wave = "WAVE_2_IMPLEMENTATION_REQUIRED"; }
            rows.push({ ...base, supplier: mapping.supplierCode, supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode, exactIdentity: exact, rawCost, supplierCurrency: mapping.supplierCostAuthority?.supplierCurrency || supplier?.supplierCurrency || "", fxRate: preview.fxRate ?? null, landedThb: preview.landedThb ?? null, recommendedPriceThb: preview.recommendedPrice ?? null, expectedProfitThb: expectedProfit, expectedMarginPercent: expectedMargin, costAuthority: authority.state, costCapturedAt: authority.capturedAt, pricingReady: mapping.mappingMetadata?.readiness?.pricingReady === true, inputReady: mapping.mappingMetadata?.readiness?.inputReady === true, adapterReady: implementation.adapterReady, processorReady: implementation.processorReady, gate: implementation.gate, controlledTest: implementation.controlledTest, controlledTestEvidence: attemptsEvidence || null, mappingEnabled: mapping.enabled === true, currentRole: mapping.productionRole || "DISABLED", fulfillmentReady: mapping.mappingMetadata?.readiness?.fulfillmentReady === true, recommendedFutureRole: role, activationWave: wave, activationBlockers: blockers });
        }
    }
    const activePackageKeys = new Set(packages.map(pkg => `${pkg.productCode}:${pkg.packageCode}`));
    for (const mapping of mappings.filter(item => !activePackageKeys.has(`${item.productCode}:${item.packageCode}`))) {
        const supplier = supplierMap.get(String(mapping.supplierId)); const authority = costAuthority(mapping);
        rows.push({ product: mapping.productCode, packageCode: mapping.packageCode, packageName: "MISSING CANONICAL PACKAGE", publicTh: false, publishedThPrice: null, commerceState: products.find(item => item.productCode === mapping.productCode)?.commerceState || "HIDDEN", publicDiscovery: false, currentSafeRoute: "NONE", supplier: mapping.supplierCode, supplierProductCode: mapping.supplierProductCode, supplierPackageCode: mapping.supplierPackageCode, exactIdentity: "MISSING", rawCost: finite(mapping.supplierCostAuthority?.rawSupplierCost ?? mapping.mappingMetadata?.supplierCost?.amount), supplierCurrency: mapping.supplierCostAuthority?.supplierCurrency || supplier?.supplierCurrency || "", landedThb: null, expectedProfitThb: null, expectedMarginPercent: null, costAuthority: authority.state, costCapturedAt: authority.capturedAt, pricingReady: false, inputReady: false, adapterReady: false, processorReady: false, gate: "OFF", controlledTest: "NOT_RECORDED", mappingEnabled: mapping.enabled === true, currentRole: mapping.productionRole || "DISABLED", fulfillmentReady: false, recommendedFutureRole: "BLOCKED", activationWave: "WAVE_4_IDENTITY_AUTHORITY_BLOCKED", activationBlockers: ["CANONICAL_PACKAGE_MISSING"] });
    }
    const summary = { canonicalProducts: CANONICAL_PRODUCT_CODES.length, databaseCanonicalProducts: products.length, canonicalPackages: packages.length, publicProducts: publicCatalog.length, publicThPackages: rows.filter((row, index) => row.publicTh && rows.findIndex(value => value.product === row.product && value.packageCode === row.packageCode) === index).length, supplierMappings: mappings.length, exactMappings: rows.filter(row => row.exactIdentity === "EXACT").length, ambiguousMappings: rows.filter(row => row.exactIdentity === "AMBIGUOUS").length, mismatches: rows.filter(row => row.exactIdentity === "MISMATCH").length, primaryMappings: mappings.filter(item => item.productionRole === "PRIMARY").length };
    const waves = Object.fromEntries([...new Set(rows.map(row => row.activationWave))].sort().map(wave => [wave, rows.filter(row => row.activationWave === wave).length]));
    const report = { generatedAt: new Date().toISOString(), summary, products: products.map(item => ({ productCode: item.productCode, name: item.name, packages: packages.filter(pkg => pkg.productCode === item.productCode).length, publicThPackages: new Set(rows.filter(row => row.product === item.productCode && row.publicTh).map(row => row.packageCode)).size, commerceState: item.commerceState, publicDiscovery: item.publicDiscoveryEnabled === true, manualAdminTh: item.fulfillment?.manualAllowedRegions?.includes("TH") === true })), waves, matrix: rows, safety: { realSupplierOrders: 0, realTopups: 0, providerBalanceSpent: 0, mappingsPromotedPrimary: 0, providerGatesEnabled: 0, publicProductsPackagesNewlyEnabled: 0, publishedPricesChanged: 0, databaseMutations: 0, commitsPushes: 0 } };
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(OUT_MD, `# AZIEL all-products production readiness\n\nGenerated: ${report.generatedAt}\n\n${table(["Product", "Package", "Public TH", "Price", "Supplier", "Identity", "Raw", "Currency", "Landed THB", "Profit", "Margin %", "Cost authority", "Pricing", "Input", "Adapter", "Processor", "Gate", "Test", "Enabled", "Role", "Future role", "Wave", "Safe route", "Blockers"], rows.map(row => [row.product, row.packageCode, row.publicTh ? "YES" : "NO", row.publishedThPrice ?? "-", row.supplier, row.exactIdentity, row.rawCost ?? "-", row.supplierCurrency || "-", row.landedThb ?? "-", row.expectedProfitThb ?? "-", row.expectedMarginPercent ?? "-", row.costAuthority || "-", row.pricingReady ? "YES" : "NO", row.inputReady ? "YES" : "NO", row.adapterReady ? "YES" : "NO", row.processorReady ? "YES" : "NO", row.gate || "-", row.controlledTest || "-", row.mappingEnabled ? "YES" : "NO", row.currentRole || "DISABLED", row.recommendedFutureRole, row.activationWave, row.currentSafeRoute, row.activationBlockers.join(", ")]))}\n`);
    console.log(JSON.stringify({ result: "PASS", summary, waves, safety: report.safety }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(error.stack || error.message); process.exitCode = 1; });
