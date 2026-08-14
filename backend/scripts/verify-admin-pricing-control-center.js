"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PricingPolicy = require("../models/PricingPolicy");
const PricingRule = require("../models/PricingRule");
const PriceVersion = require("../models/PriceVersion");
const { buildProductionPricingContext } = require("../services/commerce/productionPricingContextService");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, needle, message) {
    assert(read(file).includes(needle), message || `${file} must include ${needle}`);
}

function notIncludes(file, needle, message) {
    assert(!read(file).includes(needle), message || `${file} must not include ${needle}`);
}

function regex(file, pattern, message) {
    assert(pattern.test(read(file)), message || `${file} must match ${pattern}`);
}

function verifyModel() {
    includes("backend/models/CatalogPackage.js", "supplierCost", "CatalogPackage keeps supplierCost.");
    includes("backend/models/CatalogPackage.js", "supplierCurrency", "CatalogPackage keeps supplierCurrency.");
    includes("backend/models/CatalogPackage.js", "supplierName", "CatalogPackage keeps supplierName.");
    includes("backend/models/CatalogPackage.js", "supplierVersion", "CatalogPackage keeps supplierVersion.");
    includes("backend/models/CatalogPackage.js", "supplierCostTimestamp", "CatalogPackage keeps supplierCostTimestamp.");
    includes("backend/models/CatalogPackage.js", "pricingNote", "CatalogPackage keeps pricingNote.");
    includes("backend/models/CatalogPackage.js", "publishedPriceMode", "CatalogPackage keeps published price mode.");
    includes("backend/models/CatalogPackage.js", "manualOverrideReason", "CatalogPackage keeps manual override reason.");
    includes("backend/models/CatalogPackage.js", "supplierCostHistory", "CatalogPackage keeps immutable supplier cost history.");
}

function verifyProjectionBoundary() {
    const source = read("backend/services/catalogService.js");
    assert(source.includes("includeAdminPricing"), "Catalog projection must have explicit admin pricing gate.");
    assert(/if\s*\(\s*includeAdminPricing\s*\)\s*{[\s\S]*supplierCost/.test(source), "Supplier cost must only project under includeAdminPricing.");
    const publicSnippet = source.slice(source.indexOf("function projectCatalogPackage"), source.indexOf("function projectCatalogProduct"));
    assert(publicSnippet.includes("amount: Number(price.amount)"), "Public price amount projection must remain.");
    assert(publicSnippet.includes("if (includeAdminPricing)"), "Admin pricing fields must be gated.");
}

function verifyAdminPatchAndHistory() {
    includes("backend/services/catalogAdminService.js", "\"supplierCost\"", "Catalog admin patch must accept supplierCost.");
    includes("backend/services/catalogAdminService.js", "\"supplierCurrency\"", "Catalog admin patch must accept supplierCurrency.");
    includes("backend/services/catalogAdminService.js", "buildSupplierCostHistoryEntries", "Supplier cost changes must create history entries.");
    includes("backend/services/catalogAdminService.js", "MAX_SUPPLIER_COST_HISTORY", "Supplier cost history must have bounded retention.");
    includes("backend/services/catalogAdminService.js", ".concat(supplierCostHistoryEntries)", "Supplier cost history must be appended.");
    includes("backend/services/catalogAdminService.js", ".slice(-MAX_SUPPLIER_COST_HISTORY)", "Supplier cost history must retain the newest bounded entries.");
    includes("backend/services/catalogAdminService.js", "Manual published-price override requires a reason.", "Manual override must require reason.");
}

function verifyServerAuthoritativePreview() {
    includes("backend/services/commerce/adminPricingControlCenterService.js", "buildProductionPricingContext", "Preview must reuse production pricing context.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "createPricingQuote", "Preview must reuse pricing quote runtime.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "loadCommercePromotionContext", "Coupon preview must use existing promotion bridge.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "UNKNOWN_SUPPLIER_COST", "Missing supplier cost status must exist.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "EXCHANGE_RATE_MISSING", "Missing exchange status must exist.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "bulkBackfillSupplierCosts", "Bulk backfill service must exist.");
}

function queryResult(value) {
    const query = {
        sort() { return query; },
        limit() { return query; },
        lean: async () => value
    };
    return query;
}

async function verifyPublishedPriceModeBehavior() {
    const originals = {
        policyFindOne: PricingPolicy.findOne,
        ruleFind: PricingRule.find,
        versionFind: PriceVersion.find
    };
    PricingPolicy.findOne = () => queryResult(null);
    PricingRule.find = () => queryResult([]);
    PriceVersion.find = () => queryResult([]);
    const input = {
        pkg: { _id: "pricing-control-fixture", productCode: "mlbb", packageCode: "PRICING_CONTROL_FIXTURE", name: "Pricing Control Fixture" },
        catalog: { productCode: "mlbb", packageCode: "PRICING_CONTROL_FIXTURE", productName: "Mobile Legends" },
        region: "TH",
        currency: "THB",
        now: new Date("2026-08-14T00:00:00.000Z")
    };
    try {
        const manual = await buildProductionPricingContext({
            ...input,
            price: { amount: 49, currency: "THB", supplierCost: 40, supplierCurrency: "THB", publishedPriceMode: "MANUAL_OVERRIDE", manualOverrideReason: "Verifier override" }
        });
        assert.strictEqual(manual.pricing.pricingInput.appliedPricingRules[0]?.ruleType, "PRICE_OVERRIDE");
        assert.strictEqual(manual.pricing.pricingInput.appliedPricingRules[0]?.value, 49);

        const policyDerived = await buildProductionPricingContext({
            ...input,
            price: { amount: 49, currency: "THB", supplierCost: 40, supplierCurrency: "THB", publishedPriceMode: "POLICY_DERIVED", manualOverrideReason: "" }
        });
        assert.strictEqual(policyDerived.pricing.pricingInput.appliedPricingRules.length, 0, "POLICY_DERIVED must not inject a published-price override.");
        assert.strictEqual(policyDerived.pricing.pricingInput.context.businessRuntime.publishedPriceMode, "POLICY_DERIVED");
    } finally {
        PricingPolicy.findOne = originals.policyFindOne;
        PricingRule.find = originals.ruleFind;
        PriceVersion.find = originals.versionFind;
    }
}

function verifyRoutes() {
    includes("backend/routes/catalog.js", "/pricing-preview", "Admin catalog must expose pricing preview route.");
    includes("backend/routes/catalog.js", "/admin/catalog/pricing/supplier-costs/bulk", "Admin catalog must expose bulk supplier-cost route.");
    includes("backend/routes/catalog.js", "requireAdminPermission(PERMISSIONS.CATALOG_READ)", "Preview must require admin catalog read permission.");
    includes("backend/routes/catalog.js", "requireAdminPermission(PERMISSIONS.CATALOG_MANAGE)", "Bulk/update must require manage permission.");
}

function verifyFrontend() {
    const source = read("frontend/js/admin-catalog.js");
    assert(source.includes("catalogEdit${region}SupplierCost") && source.includes("renderRegionalPricingEditor(\"MM\"") && source.includes("renderRegionalPricingEditor(\"TH\""), "Package editor must expose supplier-cost inputs for both regions.");
    assert(source.includes("catalogEditCouponPreview"), "Package editor must expose coupon impact preview input.");
    assert(source.includes("catalogEdit${region}PublishedPriceMode") && source.includes("catalogEdit${region}ManualOverrideReason"), "Package editor must expose published-price mode and manual override reason.");
    assert(source.includes("scheduleCatalogPricingPreview"), "Frontend must debounce server-authoritative pricing preview.");
    assert(source.includes("/pricing-preview"), "Frontend must call pricing preview endpoint.");
    assert(!source.includes("calculateBasePrice("), "Frontend must not invoke pricing formulas directly.");
    assert(!/\b(grossProfit|netProfit|marginPercent)\s=[^=]/.test(source), "Frontend must not assign calculated profit or margin.");
    assert(source.includes("Bulk Supplier Cost") && source.includes("data-bulk-supplier-cost"), "Bulk supplier-cost workflow must be visible.");
    includes("frontend/js/admin-orders.js", "renderOrderBusinessSnapshot", "Admin order detail must render stored Commerce business snapshots.");
    includes("frontend/js/admin-orders.js", "Historical data unavailable", "Legacy orders must not fabricate business snapshots.");
}

function verifyCss() {
    includes("frontend/css/admin/admin-design-system.css", ".catalog-pricing-control-grid", "Pricing controls need responsive layout styles.");
    includes("frontend/css/admin/admin-design-system.css", ".catalog-pricing-preview", "Pricing preview needs production styling.");
    includes("frontend/css/admin/admin-design-system.css", ".catalog-bulk-cost-row", "Bulk supplier-cost rows need production styling.");
}

async function run() {
    verifyModel();
    verifyProjectionBoundary();
    verifyAdminPatchAndHistory();
    verifyServerAuthoritativePreview();
    await verifyPublishedPriceModeBehavior();
    verifyRoutes();
    verifyFrontend();
    verifyCss();
    notIncludes("backend/catalog/catalogProjection.js", "supplierCost", "Static/public catalog projection must not expose supplier cost.");
    console.log("Admin Pricing Control Center verifier passed.");
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
