"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function includes(source, value, message) { assert(source.includes(value), message); }
function excludes(source, value, message) { assert(!source.includes(value), message); }

function main() {
    const html = read("frontend/admin.html");
    const frontend = read("frontend/js/admin-pricing-engine.js");
    const route = read("backend/routes/adminPricingEngine.js");
    const control = read("backend/services/commerce/adminPricingControlCenterService.js");
    const drafts = read("backend/services/commerce/pricingWorkspaceDraftService.js");
    const engineService = read("backend/services/commerce/adminPricingEngineService.js");

    includes(html, "Daily Pricing", "Daily Pricing destination must exist.");
    includes(html, "Pricing Settings", "Pricing Settings destination must exist.");
    includes(html, "pricingSupplierSelect", "Supplier must be a canonical selector.");
    includes(html, "pricingProductSelect", "Daily Pricing must expose a canonical product selector.");
    excludes(html, "pricingWorkspaceSupplier\" type=\"text", "Free-text supplier input must be removed.");
    const dailySection = html.slice(html.indexOf('id="section-pricing-engine"'), html.indexOf('id="section-pricing-settings"'));
    includes(dailySection, "value=\"ALL\"", "Daily Pricing must default to all-region preview and publish scope.");
    ["Package", "Supplier Cost", "Thailand", "Myanmar", "Status"].forEach(label => includes(html, label, `${label} column is required.`));
    excludes(html, "Calculation Detail", "Legacy calculation detail must be removed.");
    excludes(html, "Business Rules", "Legacy Business Rules drawer must be removed.");
    excludes(html, "Storefront Preview", "Legacy storefront simulation must be removed.");

    includes(frontend, "supplierId: daily.supplierId", "Preview and publish must carry canonical supplierId.");
    includes(frontend, "selectedProductId", "Daily Pricing must preserve an explicit product selection.");
    includes(frontend, "published.publishedPriceMode === \"POLICY_DERIVED\"", "Legacy compatibility prices must not render as V3 selling prices.");
    includes(frontend, "dailyBlockingReason", "Disabled inputs must expose their exact blocking contract.");
    includes(frontend, "/workspace/preview", "Daily Pricing must use server preview.");
    includes(frontend, 'region: "ALL"', "One supplier-cost edit must preview all active regions.");
    includes(frontend, "regionalResult", "Daily Pricing must render independent regional results.");
    includes(frontend, "margin == null", "Calculated zero margin must not render as missing.");
    includes(frontend, "daily.previewSeq", "Stale preview sequencing must exist.");
    includes(frontend, "daily.previewController?.abort()", "Previous preview must be abortable.");
    includes(frontend, "savedDraftSupplierCost", "Saved supplier draft must restore after refresh.");
    includes(frontend, "workspaceRows: rows", "Supplier cost drafts must be persisted.");
    includes(frontend, "window.confirm", "Warning rows require owner confirmation.");
    excludes(frontend, "FALLBACK_PRODUCT", "Fallback demo products must be removed.");
    excludes(frontend, "calculateBasePrice", "Browser-side price calculation must be removed.");

    includes(route, "supplierId: req.body?.supplierId", "Routes must forward canonical supplierId.");
    includes(route, "regions: req.body?.regions", "Settings publish must carry the selected region only.");
    includes(control, "resolvePricingSupplier", "Preview and publish must resolve canonical supplier.");
    includes(control, "publishedPriceMode: \"POLICY_DERIVED\"", "Publish must persist policy-derived price mode.");
    includes(control, "amount: calculatedPrice", "Publish must persist server-calculated selling price.");
    includes(control, "regionalResults", "Preview API must return the cross-region result contract.");
    includes(control, "regionalPublishes", "Publish must support all-region server recalculation.");
    includes(control, "canonicalSupplierCost", "Publish must persist one canonical supplier-cost snapshot.");
    includes(drafts, "resolvePricingSupplier", "Draft save must validate canonical supplier.");
    includes(drafts, "supplierId: group.supplierId", "Draft must snapshot canonical supplier identity.");
    excludes(engineService, '"metadata.draftSavedAt"', "Pricing draft save must not update a Mongo parent and child path together.");
    includes(engineService, "requestedRegions", "Pricing Settings publish must isolate the selected region.");
    const migration = read("backend/scripts/migrate-seagm-pricing-currency.js");
    includes(migration, "evidence.some(currency => currency !== \"THB\")", "SEAGM normalization must refuse conflicting currency evidence.");
    includes(migration, "supplierCurrency: \"THB\"", "SEAGM normalization must write the explicit canonical currency.");

    console.log("Daily Pricing Workspace V3 verification passed.");
}

main();
