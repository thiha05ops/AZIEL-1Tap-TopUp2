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
const ARTIFACT = path.resolve(__dirname, "../../docs/wondd-freefire-production-rollout.md");
const CANONICAL_NAMES = Object.freeze({
    F00033: "33 Diamonds", F00068: "68 Diamonds", F00172: "172 Diamonds", F00310: "310 Diamonds",
    F00517: "517 Diamonds", F00690: "690 Diamonds", F01052: "1,052 Diamonds", F01801: "1,801 Diamonds",
    F03698: "3,698 Diamonds", FBIG06: "Level 6 Up Pass", FBIG10: "Level 10 Up Pass",
    FBIG15: "Level 15 Up Pass", FBIG20: "Level 20 Up Pass", FBIG25: "Level 25 Up Pass",
    FBIG30: "Level 30 Up Pass", FBPC84: "BP Card", FDIM32: "Weekly Membership Lite",
    FDIM63: "Weekly Membership", FMON280: "Monthly Membership"
});

function assertGateOff() {
    if (String(process.env.WONDD_FREEFIRE_AUTO_FULFILLMENT_ENABLED || "").trim().toLowerCase() === "true") throw new Error("WONDD_FREEFIRE_AUTO_FULFILLMENT_ENABLED must remain false.");
    const products = String(process.env.WONDD_AUTO_FULFILLMENT_ENABLED_PRODUCTS || "").toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
    if (products.includes("freefire")) throw new Error("Free Fire must not appear in WONDD_AUTO_FULFILLMENT_ENABLED_PRODUCTS during rollout.");
}
function money(value) { return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : null; }
function md(value) { return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " "); }

async function main() {
    assertGateOff();
    const capturedAt = new Date(audit.capturedAt);
    if (!Number.isFinite(capturedAt.getTime()) || Date.now() - capturedAt.getTime() > 24 * 60 * 60 * 1000) throw new Error("WonDD catalog audit is stale; refresh it first.");
    const game = audit.games.find(item => String(item.serviceid) === "9602");
    if (!game || game.packages.length !== 19) throw new Error("Current WonDD audit must contain exactly 19 Free Fire packages for serviceid 9602.");
    if (game.servicecode) throw new Error("Catalog serviceid must remain distinct from confirmed API servicecode.");
    if (new Set(game.packages.map(row => row.packcode)).size !== 19) throw new Error("Live Free Fire packcodes are not unique.");

    await mongoose.connect(process.env.MONGO_URI);
    const [supplier, product] = await Promise.all([
        Supplier.findOne({ supplierCode: "WONDD", enabled: true, mode: "API" }),
        CatalogProduct.findOne({ productCode: "freefire" })
    ]);
    if (!supplier) throw new Error("Enabled WONDD API supplier is required.");
    if (!product || product.enabled !== true || product.commerceState !== "PURCHASABLE" || !product.supportedRegions?.includes("TH")) throw new Error("Canonical Free Fire product is not TH-purchasable.");
    if (!hasWonddGameIdFormatter("freefire")) throw new Error("Confirmed Free Fire Player ID formatter is missing.");

    const mappings = await Mapping.find({ supplierId: supplier._id, supplierCode: "WONDD", productCode: "freefire", region: "TH" });
    if (mappings.length !== 19) throw new Error(`Expected 19 WonDD Free Fire mappings; found ${mappings.length}.`);
    const byPackcode = new Map(mappings.map(item => [item.supplierPackageCode, item]));
    if (byPackcode.size !== 19) throw new Error("Stored Free Fire packcodes are not unique.");
    const packages = await CatalogPackage.find({ productCode: "freefire", packageCode: { $in: mappings.map(item => item.packageCode) }, deletedAt: null });
    const byPackage = new Map(packages.map(item => [item.packageCode, item]));
    if (byPackage.size !== 19) throw new Error("Every WonDD Free Fire mapping must resolve to one canonical package.");

    const stagedRows = game.packages.map(row => {
        const mapping = byPackcode.get(row.packcode);
        if (!mapping) throw new Error(`Missing mapping for live packcode ${row.packcode}.`);
        if (mapping.supplierProductCode !== "freefire" || mapping.executionMode !== "API") throw new Error(`Invalid servicecode/execution mode for ${row.packcode}.`);
        return {
            rowId: row.packcode, productCode: "freefire", packageCode: mapping.packageCode,
            newSupplierCost: Number(row.netpricedealer), supplierCurrency: "THB",
            supplierVersion: `WONDD_CATALOG_${audit.capturedAt}`, supplierCostTimestamp: audit.capturedAt,
            pricingNote: `WonDD netpricedealer authority; packcode ${row.packcode}`, selected: true
        };
    });
    const preview = await batchPreviewDailyPricing({ rows: stagedRows, region: "TH", supplierId: String(supplier._id), actor: { username: "wondd-freefire-production-rollout" } });
    const rows = preview.rows.map(row => {
        const live = game.packages.find(item => item.packcode === row.rowId);
        const regional = row.regions.find(item => item.region === "TH") || {};
        const price = money(regional.recommendedSellingPrice);
        const blockers = [...(row.blockingErrors || []), ...(regional.blockingErrors || [])].map(item => item.code);
        const suspicious = blockers.length > 0 || price == null || price <= Number(live.netpricedealer);
        return {
            packageCode: row.packageCode, packcode: live.packcode, displayName: CANONICAL_NAMES[live.packcode],
            supplierName: live.name, cost: money(live.netpricedealer), price,
            profit: price == null ? null : money(price - Number(live.netpricedealer)),
            marginPercent: price == null ? null : Number((((price - Number(live.netpricedealer)) / price) * 100).toFixed(2)),
            blockers, suspicious
        };
    });
    if (rows.length !== 19) throw new Error("Pricing preview did not return exactly 19 Free Fire rows.");
    const suspicious = rows.filter(row => row.suspicious);

    let publish = null;
    if (APPLY && !REPORT_ONLY) {
        if (suspicious.length) throw new Error(`Refusing to publish ${suspicious.length} suspicious pricing rows.`);
        publish = await publishDailyPricing({ rows: stagedRows, region: "TH", supplierId: String(supplier._id), actor: "wondd-freefire-production-rollout", admin: { username: "wondd-freefire-production-rollout" }, skipDraftCleanup: true });
        if (publish.summary.failed || publish.summary.skipped || publish.summary.published !== 19) throw new Error(`Pricing publication incomplete: ${JSON.stringify(publish.summary)}`);
        for (const row of rows) {
            const mapping = byPackcode.get(row.packcode);
            let pkg = await CatalogPackage.findOne({ productCode: "freefire", packageCode: row.packageCode });
            await updatePackage({ productCode: "freefire", packageCode: row.packageCode, patch: { name: row.displayName, enabled: true, prices: { TH: { enabled: true } }, expectedUpdatedAt: pkg.updatedAt }, actor: "wondd-freefire-production-rollout" });
            pkg = await CatalogPackage.findOne({ productCode: "freefire", packageCode: row.packageCode });
            pkg.metadata = {
                ...(pkg.metadata || {}),
                wondd: { ...(pkg.metadata?.wondd || {}), serviceId: "9602", serviceCode: "freefire", packcode: row.packcode, supplierName: row.supplierName, netDealerPrice: row.cost, capturedAt: audit.capturedAt },
                wonddReadiness: { supplierMapped: true, inputReady: true, pricingReady: true, storefrontReady: true, fulfillmentReady: true, enabled: true }
            };
            await pkg.save();
            mapping.enabled = true;
            mapping.mappingMetadata = {
                ...(mapping.mappingMetadata || {}), serviceId: "9602", serviceCode: "freefire",
                supplierCost: { ...(mapping.mappingMetadata?.supplierCost || {}), netDealerPrice: row.cost, currency: "THB", capturedAt: audit.capturedAt },
                readiness: { supplierMapped: true, inputReady: true, pricingReady: true, storefrontReady: true, fulfillmentReady: true, enabled: true }, blocker: ""
            };
            await mapping.save();
        }
        product.metadata = { ...(product.metadata || {}), wondd: { ...(product.metadata?.wondd || {}), serviceId: "9602", serviceCode: "freefire", inputContract: "FREEFIRE_PLAYER_ID", inputReady: true, capturedAt: audit.capturedAt } };
        await product.save();
    }

    const lines = [
        "# WonDD Free Fire production rollout", "", `Generated: ${new Date().toISOString()}`, "",
        `Mode: **${REPORT_ONLY ? "VERIFIED PRODUCTION REPORT" : APPLY ? "APPLY" : "PREVIEW"}**. Live gate: **OFF**. Top-up calls: **0**.`, "",
        "Authority: current WonDD read-only catalog `netpricedealer`, confirmed `servicecode=freefire`, confirmed Player-ID-only `gameid`, and the active TH/THB Pricing Engine policy.", "",
        "| AZIEL package | Canonical name | WonDD packcode | Supplier name | Cost THB | Price THB | Profit THB | Margin | Blocker |",
        "|---|---|---|---|---:|---:|---:|---:|---|",
        ...rows.map(row => `| ${md(row.packageCode)} | ${md(row.displayName)} | ${md(row.packcode)} | ${md(row.supplierName)} | ${row.cost} | ${row.price ?? "—"} | ${row.profit ?? "—"} | ${row.marginPercent == null ? "—" : `${row.marginPercent}%`} | ${md(row.blockers.join(", ") || "none")} |`), "",
        `Summary: ${rows.length - suspicious.length}/19 pricing-ready; ${APPLY && !REPORT_ONLY ? publish?.summary?.published || 0 : 0} published; ${suspicious.length} blocked.`, "",
        "Safety: this script imports no WonDD transport adapter and cannot call `method=topup`. It creates no orders and touches no wallets, customers, or fulfillment attempts.", ""
    ];
    fs.writeFileSync(ARTIFACT, `${lines.join("\n")}\n`);
    console.log(JSON.stringify({ mode: REPORT_ONLY ? "REPORT" : APPLY ? "APPLY" : "PREVIEW", rows, suspiciousCount: suspicious.length, publishSummary: publish?.summary || null, liveGate: "OFF", topupCalls: 0, artifact: path.relative(process.cwd(), ARTIFACT) }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(`WONDD_FREEFIRE_ROLLOUT_ERROR: ${error.message}`); process.exitCode = 1; });
