#!/usr/bin/env node
"use strict";

const path = require("path");
const mongoose = require("mongoose");
const { createRoutingAuthority, resolveLegacyCheckoutRouteSnapshot } = require("../services/supplierProductionSelectionService");
const { resolveEligibilityPrimaryRoute } = require("../services/supplierEligibilityRouteResolver");
const { FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");
const { PILOT_IDENTITY } = require("../config/mmWonddMlbbPilot");
const Mapping = require("../models/SupplierProductMapping");
const CatalogPackage = require("../models/CatalogPackage");
const Supplier = require("../models/Supplier");

function parseMarket(argv = process.argv.slice(2)) {
    const argument = argv.find(value => value.startsWith("--market="));
    if (!argument || argv.length !== 1) throw Object.assign(new Error("Exactly one --market=TH|MM argument is required."), { code: "PILOT_MARKET_REQUIRED" });
    const market = String(argument.slice(9)).trim().toUpperCase();
    if (!["TH", "MM"].includes(market)) throw Object.assign(new Error("Pilot comparison market must be TH or MM."), { code: "PILOT_MARKET_INVALID" });
    return market;
}

async function main() {
    const market = parseMarket();
    require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
    const uri = String(process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
    if (!uri) throw Object.assign(new Error("MONGO_URI is required."), { code: "MONGO_URI_REQUIRED" });
    await mongoose.connect(uri, { autoIndex: false });
    const route = createRoutingAuthority({
        legacyResolver: resolveLegacyCheckoutRouteSnapshot,
        eligibilityResolver: resolveEligibilityPrimaryRoute,
        modeResolver: () => FULFILLMENT_ROUTING_MODES.DUAL_READ,
        pilotEnabledResolver: () => false
    });
    const [result, mapping, catalogPackage] = await Promise.all([
        route({ productCode: PILOT_IDENTITY.productCode, packageCode: PILOT_IDENTITY.packageCode, region: market, includeDiagnostics: true }),
        Mapping.findOne({ supplierCode: PILOT_IDENTITY.supplierCode, productCode: PILOT_IDENTITY.productCode, packageCode: PILOT_IDENTITY.packageCode, supplierPackageCode: PILOT_IDENTITY.supplierPackageCode }).lean(),
        CatalogPackage.findOne({ productCode: PILOT_IDENTITY.productCode, packageCode: PILOT_IDENTITY.packageCode, deletedAt: null }).lean()
    ]);
    const supplier = mapping ? await Supplier.findById(mapping.supplierId).lean() : null;
    const price = catalogPackage?.prices?.[market] || null;
    console.log(JSON.stringify({
        result: "PASS",
        requestedMode: "DUAL_READ_COMPARISON_ONLY",
        productionRoute: result.routeSnapshot || null,
        diagnostics: result.diagnostics,
        pricingBoundary: {
            customerMarket: market,
            sellingPrice: price?.amount ?? null,
            customerCurrency: price?.currency || "",
            rawSupplierCost: mapping?.supplierCostAuthority?.rawSupplierCost ?? null,
            supplierCurrency: mapping?.supplierCostAuthority?.supplierCurrency || supplier?.supplierCurrency || ""
        },
        writes: 0,
        providerCalls: 0
    }, null, 2));
    await mongoose.disconnect();
}

if (require.main === module) main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(JSON.stringify({ result: "FAIL", code: error.code || error.name, message: error.message }, null, 2)); process.exitCode = 1; });

module.exports = Object.freeze({ parseMarket });
