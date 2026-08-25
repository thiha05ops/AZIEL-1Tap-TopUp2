#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const audit = require("../../docs/wondd-catalog-audit.json");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const { batchPreviewDailyPricing, publishDailyPricing } = require("../services/commerce/adminPricingControlCenterService");
const { updatePackage } = require("../services/catalogAdminService");
const { hasWonddGameIdFormatter } = require("../services/suppliers/wonddGameIdFormatters");

const APPLY = process.argv.includes("--apply");
const REPORT_ONLY = process.argv.includes("--report-only");
const MAX_EXISTING_PRICE_CHANGE_PERCENT = 20;
const ARTIFACT = path.resolve(__dirname, "../../docs/wondd-mlbb-production-rollout.md");

function assertGateOff() {
    if (String(process.env.WONDD_MLBB_AUTO_FULFILLMENT_ENABLED || "").trim().toLowerCase() === "true") throw new Error("WONDD_MLBB_AUTO_FULFILLMENT_ENABLED must remain false.");
    if (String(process.env.WONDD_AUTO_FULFILLMENT_ENABLED_PRODUCTS || "").split(",").map(value => value.trim().toLowerCase()).includes("mlbb")) throw new Error("MLBB must not appear in WONDD_AUTO_FULFILLMENT_ENABLED_PRODUCTS during rollout.");
}

function adapterGateState() {
    return String(process.env.WONDD_MLBB_AUTO_FULFILLMENT_ENABLED || "").trim().toLowerCase() === "true";
}

function money(value) { return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : null; }
function percentChange(previous, next) {
    if (!Number.isFinite(Number(previous)) || Number(previous) <= 0) return null;
    return Number((((Number(next) - Number(previous)) / Number(previous)) * 100).toFixed(2));
}
function md(value) { return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " "); }

async function main() {
    assertGateOff();
    const capturedAt = new Date(audit.capturedAt);
    if (!Number.isFinite(capturedAt.getTime()) || Date.now() - capturedAt.getTime() > 24 * 60 * 60 * 1000) throw new Error("WonDD catalog audit is stale; refresh it first.");
    const game = audit.games.find(item => String(item.serviceid) === "9622");
    if (!game || game.packages.length !== 20) throw new Error("Current WonDD audit must contain exactly 20 MLBB packages for serviceid 9622.");
    if (game.servicecode) throw new Error("Catalog serviceid must not be silently treated as API servicecode.");

    await mongoose.connect(process.env.MONGO_URI);
    const [supplier, product] = await Promise.all([
        Supplier.findOne({ supplierCode: "WONDD", enabled: true, mode: "API" }),
        CatalogProduct.findOne({ productCode: "mlbb" })
    ]);
    if (!supplier) throw new Error("Enabled WONDD API supplier is required.");
    if (!product || product.enabled !== true || product.commerceState !== "PURCHASABLE" || !product.supportedRegions?.includes("TH")) throw new Error("Canonical MLBB storefront product is not TH-purchasable.");
    if (!hasWonddGameIdFormatter("mlbb")) throw new Error("Proven MLBB player-input formatter is missing.");

    const mappings = await Mapping.find({ supplierId: supplier._id, supplierCode: "WONDD", productCode: "mlbb", region: "TH" });
    if (mappings.length !== 20) throw new Error(`Expected 20 WonDD MLBB mappings; found ${mappings.length}.`);
    const byPackcode = new Map(mappings.map(item => [item.supplierPackageCode, item]));
    if (byPackcode.size !== 20) throw new Error("WonDD MLBB packcodes are not unique.");
    const packages = await CatalogPackage.find({ productCode: "mlbb", packageCode: { $in: mappings.map(item => item.packageCode) }, deletedAt: null });
    const byPackage = new Map(packages.map(item => [item.packageCode, item]));
    if (byPackage.size !== 20) throw new Error("Every WonDD MLBB mapping must resolve to one canonical package.");

    const stagedRows = game.packages.map(row => {
        const mapping = byPackcode.get(row.packcode);
        if (!mapping) throw new Error(`Missing mapping for ${row.packcode}.`);
        if (mapping.supplierProductCode !== "mlbb" || mapping.executionMode !== "API") throw new Error(`Invalid servicecode/execution mode for ${row.packcode}.`);
        return {
            rowId: row.packcode,
            productCode: "mlbb",
            packageCode: mapping.packageCode,
            newSupplierCost: Number(row.netpricedealer),
            supplierCurrency: "THB",
            supplierVersion: `WONDD_CATALOG_${audit.capturedAt}`,
            supplierCostTimestamp: audit.capturedAt,
            pricingNote: `WonDD netpricedealer authority; packcode ${row.packcode}`,
            selected: true
        };
    });
    const preview = await batchPreviewDailyPricing({ rows: stagedRows, region: "TH", supplierId: String(supplier._id), actor: { username: "wondd-mlbb-production-rollout" } });
    const reportRows = preview.rows.map(row => {
        const catalogRow = game.packages.find(item => item.packcode === row.rowId);
        const mapping = byPackcode.get(catalogRow.packcode);
        const pkg = byPackage.get(row.packageCode);
        const regional = row.regions.find(item => item.region === "TH") || {};
        const recommended = money(regional.recommendedSellingPrice);
        const current = money(pkg?.prices?.TH?.amount);
        const changePercent = percentChange(current, recommended);
        const blockers = [...(row.blockingErrors || []), ...(regional.blockingErrors || [])];
        const warningCodes = [...new Set([...(row.warnings || []), ...(regional.warnings || [])].map(item => item.code))];
        const suspicious = blockers.length > 0 || recommended == null || recommended <= Number(catalogRow.netpricedealer) || (changePercent != null && Math.abs(changePercent) > MAX_EXISTING_PRICE_CHANGE_PERCENT);
        return {
            packageCode: row.packageCode,
            packcode: catalogRow.packcode,
            displayName: pkg.name,
            supplierName: catalogRow.name,
            supplierAmount: money(catalogRow.amount),
            discount: money(catalogRow.discount),
            supplierCost: money(catalogRow.netpricedealer),
            currentPrice: current,
            recommendedPrice: recommended,
            changePercent,
            profitabilityStatus: regional.profitabilityStatus || "UNKNOWN",
            warnings: warningCodes,
            blockers: blockers.map(item => item.code),
            suspicious,
            grossMargin: recommended == null ? null : money(recommended - Number(catalogRow.netpricedealer)),
            grossMarginPercent: recommended == null ? null : Number((((recommended - Number(catalogRow.netpricedealer)) / recommended) * 100).toFixed(2)),
            supplierMapped: true,
            inputReady: true,
            pricingReady: !suspicious,
            storefrontReady: !suspicious && product.enabled === true && pkg.enabled === true && pkg.prices?.TH?.enabled !== false,
            fulfillmentReady: !suspicious && mapping.mappingMetadata?.readiness?.fulfillmentReady === true,
            autoFulfillmentEnabled: adapterGateState(),
            readiness: suspicious ? "BLOCKED" : "READY"
        };
    });
    if (reportRows.length !== 20) throw new Error("Pricing preview did not return exactly 20 MLBB rows.");
    const suspiciousRows = reportRows.filter(row => row.suspicious);

    let publish = null;
    if (APPLY && !REPORT_ONLY && !suspiciousRows.length) {
        publish = await publishDailyPricing({ rows: stagedRows, region: "TH", supplierId: String(supplier._id), actor: "wondd-mlbb-production-rollout", admin: { username: "wondd-mlbb-production-rollout" }, skipDraftCleanup: true });
        if (publish.summary.failed || publish.summary.skipped || publish.summary.published !== 20) throw new Error(`Pricing publication incomplete: ${JSON.stringify(publish.summary)}`);
        for (const row of reportRows) {
            const mapping = byPackcode.get(row.packcode);
            const pkg = await CatalogPackage.findOne({ productCode: "mlbb", packageCode: row.packageCode });
            await updatePackage({ productCode: "mlbb", packageCode: row.packageCode, patch: { enabled: true, prices: { TH: { enabled: true } }, expectedUpdatedAt: pkg.updatedAt }, actor: "wondd-mlbb-production-rollout" });
            pkg.metadata = {
                ...(pkg.metadata || {}),
                wondd: { ...(pkg.metadata?.wondd || {}), netDealerPrice: row.supplierCost, capturedAt: audit.capturedAt },
                wonddReadiness: { supplierMapped: true, inputReady: true, pricingReady: true, fulfillmentReady: true, enabled: true }
            };
            await pkg.save();
            mapping.enabled = true;
            mapping.mappingMetadata = {
                ...(mapping.mappingMetadata || {}),
                serviceId: "9622",
                serviceCode: "mlbb",
                supplierCost: { ...(mapping.mappingMetadata?.supplierCost || {}), netDealerPrice: row.supplierCost, currency: "THB", capturedAt: audit.capturedAt },
                readiness: { supplierMapped: true, inputReady: true, pricingReady: true, fulfillmentReady: true, enabled: true },
                blocker: ""
            };
            await mapping.save();
        }
    }

    const lines = [
        "# WonDD MLBB production rollout",
        "",
        `Generated: ${new Date().toISOString()}`,
        "",
        `Mode: **${REPORT_ONLY ? "VERIFIED PRODUCTION REPORT" : APPLY ? "APPLY" : "PREVIEW"}**. Live fulfillment gate: **OFF**. Top-up calls: **0**.`,
        "",
        `Authority: WonDD read-only package catalog captured ${audit.capturedAt}; supplier cost field \`netpricedealer\`; active AZIEL TH/THB production pricing policy.`,
        "",
        `Review rule: block pricing-engine errors, price at/below supplier cost, missing results, or an existing-price movement over ${MAX_EXISTING_PRICE_CHANGE_PERCENT}%. Low-margin advisories are retained but are not blockers when the active policy's configured minimum margin is zero.`,
        "",
        "| AZIEL packageCode | AZIEL display name | WonDD packcode | WonDD package | Amount | Discount | Cost THB | AZIEL price | Margin THB | Margin % | Mapped | Input | Pricing | Storefront | Fulfillment | Auto live | Blocker |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---|---|",
        ...reportRows.map(row => `| ${md(row.packageCode)} | ${md(row.displayName)} | ${md(row.packcode)} | ${md(row.supplierName)} | ${row.supplierAmount} | ${row.discount} | ${row.supplierCost} | ${row.recommendedPrice ?? "—"} | ${row.grossMargin ?? "—"} | ${row.grossMarginPercent == null ? "—" : `${row.grossMarginPercent}%`} | ${row.supplierMapped ? "YES" : "NO"} | ${row.inputReady ? "YES" : "NO"} | ${row.pricingReady ? "YES" : "NO"} | ${row.storefrontReady ? "YES" : "NO"} | ${row.fulfillmentReady ? "YES" : "NO"} | ${row.autoFulfillmentEnabled ? "YES" : "NO"} | ${md(row.blockers.join(", ") || "none")} |`),
        "",
        `Summary: ${reportRows.filter(row => !row.suspicious).length} pricing-ready; ${reportRows.filter(row => row.storefrontReady).length} storefront-ready; ${reportRows.filter(row => row.fulfillmentReady).length} fulfillment-ready; ${reportRows.filter(row => row.autoFulfillmentEnabled).length} live-auto-enabled; ${suspiciousRows.length} blocked; ${APPLY && !REPORT_ONLY ? publish?.summary?.published || 0 : 0} published in this run.`,
        "",
        "Safety: this rollout script imports no WonDD transport adapter and cannot call `method=topup`. It does not create or modify orders, wallets, customers, or fulfillment attempts.",
        ""
    ];
    fs.writeFileSync(ARTIFACT, `${lines.join("\n")}\n`);
    console.log(JSON.stringify({ mode: REPORT_ONLY ? "VERIFIED_PRODUCTION_REPORT" : APPLY ? "APPLY" : "PREVIEW", catalogCapturedAt: audit.capturedAt, rows: reportRows, suspiciousCount: suspiciousRows.length, publishSummary: publish?.summary || null, topupCalls: 0, liveGate: "OFF", artifact: path.relative(process.cwd(), ARTIFACT) }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => {
    await mongoose.disconnect().catch(() => null);
    console.error(`WONDD_MLBB_ROLLOUT_ERROR: ${error.message}`);
    process.exitCode = 1;
});
