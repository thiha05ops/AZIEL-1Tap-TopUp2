#!/usr/bin/env node
const mongoose = require("mongoose");
const audit = require("../../docs/wondd-catalog-audit.json");
const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");
const Mapping = require("../models/SupplierProductMapping");
const { WONDD_FAMILIES } = require("../services/suppliers/wonddCatalogConfig");
const { hasWonddGameIdFormatter } = require("../services/suppliers/wonddGameIdFormatters");

const APPLY = process.argv.includes("--apply");
const CAPTURED_AT = new Date(audit.capturedAt);
const PRODUCT_NAMES = Object.freeze({
    aovid: "Arena of Valor (RoV)", freefire: "Free Fire Diamonds", undawn: "Undawn RC & Packages",
    callofduty: "Call of Duty Mobile CP", deltaforce: "Delta Force Coins & Packages",
    haikyuflyhigh: "Haikyu!! Fly High", pubg: "PUBG Mobile UC", mlbb: "Mobile Legends Diamonds",
    valorant: "Valorant Points", heartopia: "Heartopia Diamonds"
});

function cleanName(value) {
    return String(value || "").toLowerCase()
        .replace(/mobile legends|pubg mobile|pubg|free fire|call of duty mobile|delta force|haikyu(?:!!)? fly high|valorant|heartopia|undawn|rov/g, " ")
        .replace(/diamonds?/g, "diamond").replace(/points?/g, "point").replace(/coupons?/g, "coupon")
        .replace(/,/g, "").replace(/[^a-z0-9+]+/g, " ").trim().replace(/\s+/g, " ");
}

function deterministicPackageCode(config, row) {
    return `${config.packagePrefix}_WONDD_${String(row.packcode).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function supportedRows(game, config) {
    if (!config?.serviceCode) return [];
    return game.packages.filter(row => !config.packageFilter || config.packageFilter(row));
}

function priceReadiness(pkg, cost) {
    const price = pkg?.prices?.TH;
    if (!price || !price.enabled || !Number.isFinite(Number(price.amount)) || Number(price.amount) <= Number(cost)) return { ready: false, blocker: "PRICING_NOT_READY" };
    if (price.supplierCode && price.supplierCode !== "WONDD" && pkg.packageCode !== "MLBB_86") return { ready: false, blocker: "PRICING_SUPPLIER_CONFLICT" };
    if (price.supplierCode !== "WONDD" || Number(price.supplierCost) !== Number(cost)) return { ready: false, blocker: "PRICING_COST_REFRESH_REQUIRED" };
    return { ready: true, blocker: "" };
}

async function main() {
    if (String(process.env.WONDD_MLBB_AUTO_FULFILLMENT_ENABLED || "").trim().toLowerCase() === "true" || String(process.env.WONDD_AUTO_FULFILLMENT_ENABLED_PRODUCTS || "").trim()) {
        throw new Error("WonDD live fulfillment gates must be disabled during catalog onboarding.");
    }
    if (!Number.isFinite(CAPTURED_AT.getTime()) || Date.now() - CAPTURED_AT.getTime() > 24 * 60 * 60 * 1000) throw new Error("WonDD catalog audit is stale; refresh it first.");
    await mongoose.connect(process.env.MONGO_URI);
    const supplier = await Supplier.findOne({ supplierCode: "WONDD", mode: "API", enabled: true });
    if (!supplier) throw new Error("Configured WONDD supplier is required.");

    const summary = { apply: APPLY, productsCreated: [], productsReused: [], packagesCreated: [], packagesReused: [], mappingsCreated: [], mappingsReused: [], families: [], blockers: [] };
    for (const game of audit.games) {
        const config = WONDD_FAMILIES[String(game.serviceid)];
        if (!config?.serviceCode) {
            summary.families.push({ game: game.game, serviceid: game.serviceid, serviceCode: "", packages: game.packageCount, supportedPackages: 0, status: config?.unsupportedReason || "NEEDS_CONFIGURATION" });
            continue;
        }
        let product = await CatalogProduct.findOne({ productCode: config.productCode });
        if (!product) {
            product = new CatalogProduct({
                productCode: config.productCode, name: PRODUCT_NAMES[config.productCode] || config.game,
                description: `${config.game} supplier catalog onboarding. Player input contract requires confirmation before fulfillment.`,
                enabled: false, commerceState: "HIDDEN", publicDiscoveryEnabled: false, homepageEnabled: false,
                supportedRegions: ["TH"], source: "admin", metadata: {}
            });
            summary.productsCreated.push(config.productCode);
            if (APPLY) await product.save();
        } else summary.productsReused.push(config.productCode);
        product.metadata = {
            ...(product.metadata || {}),
            wondd: { serviceId: String(game.serviceid), serviceCode: config.serviceCode, catalogOnboarded: true, inputContract: config.inputContract || "UNCONFIRMED", inputReady: hasWonddGameIdFormatter(config.productCode), capturedAt: audit.capturedAt }
        };
        if (APPLY && !product.isNew) await product.save();

        const existingPackages = await CatalogPackage.find({ productCode: config.productCode, deletedAt: null });
        const usedPackageIds = new Set();
        const rows = supportedRows(game, config);
        let mapped = 0;
        for (const row of rows) {
            let mapping = await Mapping.findOne({ supplierId: supplier._id, supplierPackageCode: row.packcode, region: "TH" });
            let pkg = mapping ? await CatalogPackage.findOne({ productCode: mapping.productCode, packageCode: mapping.packageCode }) : null;
            if (!pkg) {
                const normalized = cleanName(row.name);
                const matches = existingPackages.filter(item => !usedPackageIds.has(String(item._id)) && cleanName(item.name) === normalized);
                if (matches.length === 1) pkg = matches[0];
            }
            if (!pkg) {
                const packageCode = deterministicPackageCode(config, row);
                pkg = await CatalogPackage.findOne({ productCode: config.productCode, packageCode });
                if (!pkg) {
                    pkg = new CatalogPackage({ productCode: config.productCode, packageCode, name: row.name, enabled: false, source: "admin", metadata: {} });
                    summary.packagesCreated.push(`${config.productCode}:${packageCode}`);
                    if (APPLY) await pkg.save();
                    existingPackages.push(pkg);
                }
            } else summary.packagesReused.push(`${config.productCode}:${pkg.packageCode}`);
            usedPackageIds.add(String(pkg._id || pkg.packageCode));
            const cost = Number(row.netpricedealer);
            const pricing = priceReadiness(pkg, cost);
            pkg.metadata = {
                ...(pkg.metadata || {}),
                wondd: { serviceId: String(game.serviceid), serviceCode: config.serviceCode, packcode: row.packcode, supplierName: row.name, point: row.point ?? null, amount: Number(row.amount), discount: Number(row.discount), netDealerPrice: cost, capturedAt: audit.capturedAt },
                wonddReadiness: { supplierMapped: true, inputReady: hasWonddGameIdFormatter(config.productCode), pricingReady: pricing.ready, fulfillmentReady: config.productCode === "mlbb" && pricing.ready, enabled: config.productCode === "mlbb" && pricing.ready }
            };
            if (pricing.ready && (!pkg.prices.TH.supplierCode || pkg.packageCode === "MLBB_86")) {
                pkg.prices.TH.supplierCost = cost;
                pkg.prices.TH.supplierCurrency = "THB";
                pkg.prices.TH.supplierCode = "WONDD";
                pkg.prices.TH.supplierName = "WonDD";
                pkg.prices.TH.supplierId = supplier._id;
                pkg.prices.TH.supplierCostTimestamp = CAPTURED_AT;
                pkg.canonicalSupplierCost = { supplierId: supplier._id, supplierCode: "WONDD", supplierName: "WonDD", amount: cost, currency: "THB", capturedAt: CAPTURED_AT };
            }
            if (APPLY) await pkg.save();

            const isProven = config.productCode === "mlbb" && pricing.ready && hasWonddGameIdFormatter(config.productCode);
            const readiness = { supplierMapped: true, inputReady: hasWonddGameIdFormatter(config.productCode), pricingReady: pricing.ready, fulfillmentReady: isProven, enabled: isProven };
            const metadata = { serviceId: String(game.serviceid), serviceCode: config.serviceCode, supplierCost: { amount: Number(row.amount), discount: Number(row.discount), netDealerPrice: cost, currency: "THB", capturedAt: audit.capturedAt }, readiness, blocker: isProven ? "" : (!readiness.inputReady ? "INPUT_NEEDS_CONFIRMATION" : pricing.blocker || "CONTROLLED_ENABLEMENT_REQUIRED") };
            if (!mapping) {
                mapping = new Mapping({ supplierId: supplier._id, supplierCode: "WONDD", productCode: config.productCode, packageCode: pkg.packageCode, supplierProductCode: config.serviceCode, supplierPackageCode: row.packcode, supplierDisplayName: row.name, region: "TH", enabled: isProven, executionMode: "API", mappingMetadata: metadata });
                summary.mappingsCreated.push(`${config.productCode}:${pkg.packageCode}->${row.packcode}`);
                if (APPLY) await mapping.save();
            } else {
                if (mapping.productCode !== config.productCode || mapping.packageCode !== pkg.packageCode || mapping.supplierProductCode.toLowerCase() !== config.serviceCode.toLowerCase()) throw new Error(`Conflicting WonDD mapping for ${row.packcode}`);
                mapping.mappingMetadata = metadata;
                mapping.enabled = isProven;
                mapping.executionMode = "API";
                summary.mappingsReused.push(`${mapping.productCode}:${mapping.packageCode}->${row.packcode}`);
                if (APPLY) await mapping.save();
            }
            mapped += 1;
        }
        summary.families.push({ game: config.game, serviceid: game.serviceid, serviceCode: config.serviceCode, packages: game.packageCount, supportedPackages: rows.length, mapped, productCode: config.productCode, inputReady: hasWonddGameIdFormatter(config.productCode), status: hasWonddGameIdFormatter(config.productCode) ? "MAPPED_INPUT_READY" : "MAPPED_INPUT_NEEDS_CONFIRMATION" });
    }
    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { console.error(`WONDD_ONBOARDING_ERROR: ${error.message}`); await mongoose.disconnect().catch(() => null); process.exitCode = 1; });
