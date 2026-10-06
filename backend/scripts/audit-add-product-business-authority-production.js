#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Product = require("../models/SupplierCatalogProduct");
const Offer = require("../models/SupplierCatalogOffer");
const Mapping = require("../models/SupplierProductMapping");
const CatalogProduct = require("../models/CatalogProduct");
const { generateAddProductPlan } = require("../services/supplierCatalog/addProductFinalizationService");
const { resolvedAuthorities } = require("../services/supplierCatalog/supplierBusinessAuthorityService");

const clean = value => String(value == null ? "" : value).trim();
const id = value => clean(value?._id || value);
const targets = [
    ["FAZERCARDS", "Heartopia"], ["FAZERCARDS", "Omega Legends"], ["FAZERCARDS", "Honor of Kings"],
    ["FAZERCARDS", "Mobile Legends"], ["FAZERCARDS", "PUBG Mobile"], ["WONDD", "Heartopia"]
];

(async () => {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error("Production Mongo URI is not configured; read-only audit skipped.");
    mongoose.set("autoIndex", false);
    await mongoose.connect(uri);
    const suppliers = await Supplier.find({ supplierCode: { $in: ["FAZERCARDS", "WONDD"] } }).select("_id supplierCode name").lean();
    const supplierByCode = new Map(suppliers.map(row => [row.supplierCode, row]));
    const report = [];
    for (const [supplierCode, name] of targets) {
        const supplier = supplierByCode.get(supplierCode);
        const products = supplier ? await Product.find({ supplierId: supplier._id, $or: [{ displayName: new RegExp(name, "i") }, { rawName: new RegExp(name, "i") }] }).select("_id supplierId catalogNamespace supplierProductCode supplierMarketCode displayName rawName normalizedInputContract metadata rawSnapshotHash sourceRevision lastChangedAt").lean() : [];
        for (const product of products) {
            const authorities = resolvedAuthorities(product); let plan;
            try { plan = await generateAddProductPlan({ supplierCatalogProductId: product._id, sellingRegions: ["TH"] }); }
            catch (error) { report.push({ supplierCode, requestedName: name, product: { supplierCatalogProductId: id(product), namespace: product.catalogNamespace, nativeProductCode: product.supplierProductCode, displayName: product.displayName || product.rawName }, nativeMarket: product.supplierMarketCode, planningError: { code: error.code || error.name, message: error.message }, ownerResolvableInAdmin: error.code !== "UNSUPPORTED_PROTOCOL", externalEvidenceRequired: error.code === "CANONICAL_PRODUCT_IDENTITY_CONFLICT" }); continue; }
            report.push({ supplierCode, requestedName: name, product: { supplierCatalogProductId: id(product), namespace: product.catalogNamespace, nativeProductCode: product.supplierProductCode, displayName: product.displayName || product.rawName }, nativeMarket: product.supplierMarketCode, marketAuthority: authorities.market ? { scope: authorities.market.scope, nativeMarketEvidence: authorities.market.nativeMarketEvidence, allowedCustomerMarkets: authorities.market.fulfillmentEligibility?.allowedCustomerMarkets || [], decisionVersion: authorities.market.decisionVersion } : null, inputContractAuthority: product.normalizedInputContract?.authority || "MISSING", executionAuthority: authorities.execution ? { scope: authorities.execution.scope, fields: Object.keys(authorities.execution.executionIdentity || {}).sort(), decisionVersion: authorities.execution.decisionVersion } : null, packageIdentity: { offers: plan.offers.length, ready: plan.offers.filter(row => row.state === "READY").length, preparable: plan.offers.filter(row => row.state === "PREPARABLE").length, needsAttention: plan.offers.filter(row => row.state === "NEEDS_ATTENTION").length, unavailable: plan.offers.filter(row => row.state === "UNAVAILABLE").length }, blockers: [...new Set(plan.offers.flatMap(row => row.blockers))].sort(), ownerResolvableInAdmin: [...new Set(plan.offers.flatMap(row => row.blockers))].every(code => ["SUPPLIER_MARKET_AUTHORITY_REQUIRED", "CUSTOMER_MARKET_INELIGIBLE", "INPUT_CONTRACT_REQUIRED", "EXECUTION_IDENTITY_REQUIRED", "PACKAGE_IDENTITY_REVIEW", "STALE_SOURCE"].includes(code)), externalEvidenceRequired: [...new Set(plan.offers.flatMap(row => row.blockers))].some(code => ["SUPPLIER_MARKET_AUTHORITY_REQUIRED", "CUSTOMER_MARKET_INELIGIBLE", "INPUT_CONTRACT_REQUIRED", "EXECUTION_IDENTITY_REQUIRED", "PACKAGE_IDENTITY_REVIEW"].includes(code)) });
        }
        if (!products.length) report.push({ supplierCode, requestedName: name, found: false });
    }
    const mappings = await Mapping.find({ archivedAt: null }).select("productCode packageCode supplierId region supplierCatalogOfferId").lean();
    const products = await CatalogProduct.find({ productCode: { $in: [...new Set(mappings.map(row => row.productCode))] } }).select("productCode metadata.sellableMarketScope").lean();
    const crossMarket = [];
    for (const product of products) {
        const rows = mappings.filter(row => row.productCode === product.productCode), markets = [...new Set(rows.map(row => row.region).filter(Boolean))].sort();
        if (markets.length > 1) crossMarket.push({ productCode: product.productCode, supplierMarkets: markets, explicitSellableMarketScope: product.metadata?.sellableMarketScope || [], classification: product.metadata?.sellableMarketScope?.length ? "EXPLICIT_SCOPE" : "LEGACY_REVIEW_REQUIRED" });
    }
    console.log(JSON.stringify({ result: "PASS", mode: "READ_ONLY", targets: report, crossMarketCanonicalLinks: crossMarket, writes: 0, supplierCalls: 0 }, null, 2));
    await mongoose.disconnect();
})().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(error.message); process.exit(1); });
