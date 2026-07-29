const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, fragment, message) {
    assert(read(file).includes(fragment), `${file}: ${message}`);
}

function notIncludes(file, fragment, message) {
    assert(!read(file).includes(fragment), `${file}: ${message}`);
}

function verifyBackend() {
    includes("backend/routes/adminPricingEngine.js", "/admin/pricing-engine/workspace/preview", "Daily Pricing Workspace preview endpoint must exist.");
    includes("backend/routes/adminPricingEngine.js", "/admin/pricing-engine/workspace/publish", "Daily Pricing Workspace publish endpoint must exist.");
    includes("backend/routes/adminPricingEngine.js", "requireAdminPermission(PERMISSIONS.CATALOG_READ)", "Preview must be admin/RBAC protected.");
    includes("backend/routes/adminPricingEngine.js", "requireAdminPermission(PERMISSIONS.CATALOG_MANAGE)", "Publish must require catalog manage permission.");
    includes("backend/routes/adminPricingEngine.js", "requireOwner", "Publish must remain owner-only.");
    includes("backend/routes/adminPricingEngine.js", "batchPreviewDailyPricing", "Route must call server-side batch preview.");
    includes("backend/routes/adminPricingEngine.js", "publishDailyPricing", "Route must call server-side publish.");

    includes("backend/services/commerce/adminPricingControlCenterService.js", "MAX_WORKSPACE_ROWS = 250", "Workspace must have a bounded batch size.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "batchPreviewDailyPricing", "Batch preview service must exist.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "publishDailyPricing", "Batch publish service must exist.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "previewLoadedPackageRegion", "Batch preview must evaluate regional pricing server-side.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "WORKSPACE_REGIONS.map", "Batch preview must calculate Thailand and Myanmar together.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "createPricingQuote", "Batch preview must use Commerce quote runtime.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "buildProductionPricingContext", "Batch preview must use production pricing context.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "PAYMENT_FEE_METHODS", "Payment fee impact simulation must be explicit.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "displayDiscountPercent", "Marketing display discount must be represented separately.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "expectedUpdatedAt", "Publish must use optimistic concurrency data.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "updatePackage", "Publish must persist through Catalog authority and history.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "Blocked by pricing preview", "Blocked rows must be reported per row.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "failed: true", "Partial publish failures must be explicit.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "invalidWorkspaceRow", "Invalid pasted rows must become row-scoped blocked rows.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "invalidRows.concat(previewRows)", "Valid rows must still preview when invalid rows exist.");
}

function verifyFrontend() {
    includes("frontend/admin.html", "Pricing Workspace", "Admin navigation surface must be renamed for daily operations.");
    includes("frontend/admin.html", "pricingWorkspaceGrid", "Workspace grid must exist.");
    includes("frontend/admin.html", "pricingPastePanel", "Paste workflow must exist.");
    includes("frontend/admin.html", "pricingReviewPanel", "Review workflow must exist.");
    includes("frontend/admin.html", "pricingWorkspacePublishSelectedBtn", "Publish selected action must exist.");
    includes("frontend/admin.html", "pricingWorkspacePublishAllBtn", "Publish all action must exist.");
    includes("frontend/admin.html", "Business Rules", "Low-frequency policy controls must be visually separated.");
    includes("frontend/admin.html", "Supplier THB → Selling THB", "Thailand exchange copy must name source and target.");
    includes("frontend/admin.html", "Supplier THB → Selling MMK", "Myanmar exchange copy must name source and target.");

    includes("frontend/js/admin-pricing-engine.js", "workspace: {", "Controller must maintain staged workspace state.");
    includes("frontend/js/admin-pricing-engine.js", "buildWorkspaceRows", "Workspace must load many packages into a staged grid.");
    includes("frontend/js/admin-pricing-engine.js", "data-pricing-cost-input", "Inline supplier-cost editing must exist.");
    includes("frontend/js/admin-pricing-engine.js", "parseWorkspacePaste", "Paste parser must exist.");
    includes("frontend/js/admin-pricing-engine.js", "duplicates", "Paste workflow must surface duplicates.");
    includes("frontend/js/admin-pricing-engine.js", "duplicate`", "Paste workflow must show duplicate count.");
    includes("frontend/js/admin-pricing-engine.js", "/api/admin/pricing-engine/workspace/preview", "Inline edits must use server-authoritative batch preview.");
    includes("frontend/js/admin-pricing-engine.js", "/api/admin/pricing-engine/workspace/publish", "Publish must use server endpoint.");
    includes("frontend/js/admin-pricing-engine.js", "workspacePayloadRows", "Frontend must send raw intended supplier-cost changes.");
    includes("frontend/js/admin-pricing-engine.js", "newSupplierCost", "Frontend must stage intended supplier costs.");
    includes("frontend/js/admin-pricing-engine.js", "paymentFeeSimulation", "Frontend must render payment-fee simulation output.");
    includes("frontend/js/admin-pricing-engine.js", "displayDiscountPercent", "Frontend must keep display discount separate.");
    includes("frontend/js/admin-pricing-engine.js", "state.workspace.previewRows", "Frontend must render server preview rows.");
    includes("frontend/js/admin-pricing-engine.js", "previewSeq", "Debounced previews must protect against stale response overwrite.");
    includes("frontend/js/admin-pricing-engine.js", "window.confirm", "Publish must require explicit confirmation.");
    includes("frontend/js/admin-pricing-engine.js", "publishedKeys", "Successful published rows must be cleared from staged retry state.");
    notIncludes("frontend/js/admin-pricing-engine.js", "fetch('/api/admin/pricing-engine/workspace", "Workspace must use centralized pricingFetch helper, not ad hoc fetch.");

    includes("frontend/css/admin/admin-design-system.css", ".pricing-daily-workspace", "Daily workspace styles must exist.");
    includes("frontend/css/admin/admin-design-system.css", "max-width: 720px", "Mobile card workflow breakpoint must exist.");
    includes("frontend/css/admin/admin-design-system.css", "min-width: 1180px", "Desktop grid must use intentional contained horizontal scrolling.");
    includes("frontend/css/admin/admin-design-system.css", "grid-template-columns: 1fr", "Mobile layout must collapse to one column.");
}

function verifyCalculationExamples() {
    const { calculateBasePrice } = require("../services/commerce/pricingCalculationEngine");
    const th = calculateBasePrice({
        supplierCost: 40,
        supplierCurrency: "THB",
        targetCurrency: "THB",
        policy: {
            supplierFee: { enabled: true, type: "PERCENT", value: 1 },
            businessCost: { enabled: true, type: "FIXED", value: 2 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
            platformCost: { enabled: true, type: "FIXED", value: 1 },
            profitRule: { enabled: true, type: "PERCENT", value: 20 },
            tax: { enabled: false, type: "PERCENT", value: 0 },
            roundingRule: { enabled: true, mode: "NEAREST", increment: 1 }
        },
        context: { region: "TH", packageCode: "VERIFY_TH" }
    });
    assert.strictEqual(th.regularPrice, 53, "TH same-currency preview must produce expected customer price.");

    const mm = calculateBasePrice({
        supplierCost: 40,
        supplierCurrency: "THB",
        targetCurrency: "MMK",
        exchangeRate: { rate: 120, sourceCurrency: "THB", targetCurrency: "MMK", source: "verify" },
        policy: {
            supplierFee: { enabled: true, type: "PERCENT", value: 1 },
            businessCost: { enabled: true, type: "FIXED", value: 120 },
            gatewayFee: { enabled: true, type: "PERCENT", value: 2 },
            platformCost: { enabled: true, type: "FIXED", value: 200 },
            profitRule: { enabled: true, type: "PERCENT", value: 20 },
            tax: { enabled: false, type: "PERCENT", value: 0 },
            roundingRule: { enabled: true, mode: "NEAREST", increment: 100 }
        },
        context: { region: "MM", packageCode: "VERIFY_MM" }
    });
    assert.strictEqual(mm.regularPrice, 6300, "MM THB→MMK preview must produce expected customer price.");
}

function verifyOrder() {
    const source = read("backend/services/commerce/adminPricingControlCenterService.js");
    const body = source.match(/async function previewLoadedPackageRegion[\s\S]*?function rowStatusFromRegional/)?.[0] || "";
    assert(body.includes("buildProductionPricingContext"), "Regional preview must resolve production pricing context.");
    assert(body.includes("createPricingQuote"), "Regional preview must create a Commerce quote.");
    assert(body.indexOf("buildProductionPricingContext") < body.indexOf("createPricingQuote"), "Regional preview must resolve context before quote creation.");
}

function main() {
    verifyBackend();
    verifyFrontend();
    verifyCalculationExamples();
    verifyOrder();
    console.log("Daily Pricing Workspace verifier passed.");
}

main();
