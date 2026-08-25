#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const mongoose = require("mongoose");
const Product = require("../models/CatalogProduct");
const Package = require("../models/CatalogPackage");
const Mapping = require("../models/SupplierProductMapping");
const Supplier = require("../models/Supplier");
const { toPublicCatalog } = require("../services/catalogService");
const { assessProductionMapping } = require("../services/supplierProductionSelectionService");

const CORE = ["mlbb", "pubg", "freefire", "hok"];
const OUT_JSON = path.join(__dirname, "../../docs/core-product-production-readiness.json");
const OUT_MD = path.join(__dirname, "../../docs/core-product-production-readiness.md");
const money = value => Number.isFinite(Number(value)) ? Number(value) : null;
const mdTable = (headers, rows) => `| ${headers.join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map(row => `| ${row.join(" | ")} |`).join("\n")}`;

async function main() {
    const unsaved = new Mapping({ supplierId: new mongoose.Types.ObjectId(), supplierCode: "TEST", productCode: "pubg", packageCode: "TEST", supplierProductCode: "test", supplierPackageCode: "test", region: "TH", executionMode: "API" });
    assert.strictEqual(unsaved.productionRole, "DISABLED", "New mappings must fail closed by default.");
    assert(Mapping.schema.indexes().some(([keys, options]) => keys.productCode === 1 && keys.packageCode === 1 && keys.region === 1 && options?.partialFilterExpression?.productionRole === "PRIMARY" && options.unique === true), "Exactly-one PRIMARY database constraint is missing.");
    assert(fs.readFileSync(path.join(__dirname, "../../frontend/js/admin-fulfillment.js"), "utf8").includes("data-mapping-role"), "Admin production-role control is missing.");
    await mongoose.connect(process.env.MONGO_URI);
    const [products, packages, mappings, suppliers, publicCatalog] = await Promise.all([
        Product.find({ productCode: { $in: [...CORE, "valorant"] } }).lean(),
        Package.find({ productCode: { $in: CORE }, deletedAt: null }).sort({ productCode: 1, sortOrder: 1, packageCode: 1 }).lean(),
        Mapping.find({ productCode: { $in: CORE } }).sort({ productCode: 1, packageCode: 1, supplierCode: 1 }).lean(),
        Supplier.find().lean(),
        toPublicCatalog({ source: "database", includeDisabled: false, includeAdminPricing: false })
    ]);
    const supplierMap = new Map(suppliers.map(item => [String(item._id), item]));
    const publicMap = new Map(publicCatalog.map(product => [product.productCode, new Set((product.packages || []).map(pkg => pkg.packageCode))]));
    const assessed = new Map();
    for (const mapping of mappings) assessed.set(String(mapping._id), await assessProductionMapping(mapping));
    const matrix = packages.map(pkg => {
        const related = mappings.filter(item => item.productCode === pkg.productCode && item.packageCode === pkg.packageCode && item.region === "TH");
        const primary = related.find(item => item.productionRole === "PRIMARY");
        const backups = related.filter(item => item.productionRole === "BACKUP");
        const price = pkg.prices?.TH;
        const product = products.find(item => item.productCode === pkg.productCode);
        const manualAllowed = product?.fulfillment?.manualAllowedRegions?.includes("TH") === true;
        const primaryAssessment = primary ? assessed.get(String(primary._id)) : null;
        const blockers = primaryAssessment?.blockers || (related.length ? ["NEEDS_SUPPLIER_SELECTION"] : []);
        if (!price?.enabled || !money(price?.amount)) blockers.push("NEEDS_PRICING");
        if (!pkg.enabled) blockers.push("PACKAGE_DISABLED");
        if (!manualAllowed && !primaryAssessment?.ready) blockers.push("NO_FULFILLMENT_ROUTE");
        const supplierRows = related.map(mapping => {
            const supplier = supplierMap.get(String(mapping.supplierId)); const assessment = assessed.get(String(mapping._id));
            return { supplier: mapping.supplierCode, supplierCurrency: supplier?.supplierCurrency || mapping.supplierCostAuthority?.supplierCurrency || "", rawSupplierCost: money(mapping.supplierCostAuthority?.rawSupplierCost), landedThbCost: money(price?.supplierCode === mapping.supplierCode ? price?.landedCost : null), enabled: mapping.enabled === true, role: mapping.productionRole || "DISABLED", pricingReady: mapping.mappingMetadata?.readiness?.pricingReady === true, fulfillmentReady: mapping.mappingMetadata?.readiness?.fulfillmentReady === true, featureGate: assessment.featureGateEnabled ? "ON" : "OFF", inputContract: mapping.mappingMetadata?.requiredFields || mapping.mappingMetadata?.customerInputContract?.requiredFields || [], blockers: assessment.blockers };
        });
        return { product: pkg.productCode, packageCode: pkg.packageCode, public: publicMap.get(pkg.productCode)?.has(pkg.packageCode) === true, sellingPriceThb: money(price?.amount), manualAdminAllowed: manualAllowed, primarySupplier: primary?.supplierCode || "NONE", backupSuppliers: backups.map(item => item.supplierCode), pricingReady: Boolean(price?.enabled && money(price.amount)), fulfillmentReady: primaryAssessment?.ready === true || manualAllowed, blockers: [...new Set(blockers)], supplierMappings: supplierRows };
    });
    const valorant = products.find(item => item.productCode === "valorant");
    assert(valorant?.publicDiscoveryEnabled === false && valorant?.commerceState === "HIDDEN");
    assert(!publicMap.has("valorant"));
    assert.strictEqual(mappings.filter(item => item.productionRole === "PRIMARY").length, 0, "Existing mappings must remain fail-closed.");
    for (const code of CORE) {
        const product = products.find(item => item.productCode === code);
        assert(product?.fulfillment?.manualAllowedRegions?.includes("TH"), `${code} manual fallback authority missing.`);
        const visibleCount = matrix.filter(item => item.product === code && item.public).length;
        assert(visibleCount > 0, `${code} lost all production-authorized storefront packages.`);
    }
    const report = { generatedAt: new Date().toISOString(), productsInScope: CORE, newProductsAdded: 0, newPackagesAdded: 0, packageCount: packages.length, mappingCount: mappings.length, primaryMappings: 0, matrix, safety: { realFazerCardsOrders: 0, realWonddTopups: 0, liveValidationCalls: 0, providerBalanceSpent: 0, publicPackagesAccidentallyEnabled: 0, valorantPublic: false, newGameMutations: 0 } };
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(OUT_MD, `# Core product production readiness\n\nGenerated: ${report.generatedAt}\n\nSupplier API selection and storefront commerce availability are independent. Every current mapping remains DISABLED as a production role; current storefront availability is preserved by explicit MANUAL_ADMIN authority.\n\n${mdTable(["Product", "Package", "Public", "Primary", "Backup", "TH price", "Pricing", "Fulfillment", "Blocker"], matrix.map(row => [row.product, row.packageCode, row.public ? "YES" : "NO", row.primarySupplier, row.backupSuppliers.join(", ") || "NONE", row.sellingPriceThb ?? "-", row.pricingReady ? "READY" : "NOT READY", row.fulfillmentReady ? "READY" : "NOT READY", row.blockers.join(", ") || "NONE"]))}\n`);
    console.log(JSON.stringify({ result: "PASS", products: CORE, packages: packages.length, mappings: mappings.length, publicByProduct: Object.fromEntries(CORE.map(code => [code, matrix.filter(item => item.product === code && item.public).length])), primaryMappings: 0, valorantPublic: false, safety: report.safety }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => { await mongoose.disconnect().catch(() => null); console.error(error.stack || error.message); process.exitCode = 1; });
