const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function includes(relativePath, needle, message) {
    assert.ok(read(relativePath).includes(needle), message || `${relativePath} must include ${needle}`);
}

function notIncludes(relativePath, needle, message) {
    assert.ok(!read(relativePath).includes(needle), message || `${relativePath} must not include ${needle}`);
}

function matches(relativePath, pattern, message) {
    assert.ok(pattern.test(read(relativePath)), message || `${relativePath} must match ${pattern}`);
}

const promos = read("frontend/js/admin-promos.js");
const css = read("frontend/css/admin/admin-design-system.css");

includes("backend/routes/promos.js", '"/promos/quote"', "Promo quote API must remain unchanged.");
includes("backend/routes/promos.js", '"/admin/promos"', "Admin promo API must remain unchanged.");
includes("backend/services/promoCodeService.js", "resolveOrderCatalog", "promoCodeService must remain canonical catalog-backed rule owner.");
includes("backend/services/promoCodeService.js", "calculateDiscount", "Promo financial semantics must remain in promoCodeService.");

includes("frontend/js/admin-promos.js", "promo-editor-box", "Promo editor must have a scoped wide-modal box.");
includes("frontend/css/admin/admin-design-system.css", ".promo-edit-modal .promo-editor-box", "Wide styling must be scoped to Promo editor.");
includes("frontend/css/admin/admin-design-system.css", "width: min(1180px, calc(100vw - 80px))", "Promo editor must use a wide desktop workspace.");
notIncludes("frontend/css/admin/admin-design-system.css", ".admin-action-modal-box {\n  width: min(1180px", "Global admin modals must not be widened.");
includes("frontend/css/admin/admin-design-system.css", ".promo-workspace-grid", "Promo editor must use a desktop grid.");
includes("frontend/css/admin/admin-design-system.css", ".promo-eligibility-section", "Eligibility section must be explicitly scoped.");
includes("frontend/css/admin/admin-design-system.css", "grid-column: 1 / -1", "Eligibility must span full editor width.");
includes("frontend/css/admin/admin-design-system.css", ".promo-edit-modal [hidden]", "Promo editor hidden state must be protected from display overrides.");
includes("frontend/css/admin/admin-design-system.css", "display: none !important", "Promo editor hidden controls must not participate in layout.");

includes("frontend/js/admin-promos.js", 'modal.querySelector("#promoDiscountType").value = promo?.discountType || "PERCENTAGE"', "Default Create state must be PERCENTAGE.");
includes("frontend/js/admin-promos.js", 'modal.querySelector("#promoEligibilityMode").value = promo?.eligibilityMode || "ALL"', "Default Create eligibility must be ALL.");
matches("frontend/js/admin-promos.js", /renderPromoEligibility\(modal, promo\);\s*syncPromoEditorMode\(modal\);[\s\S]+modal\.classList\.add\("show"\);/, "Conditional state must synchronize before first visible paint.");
includes("frontend/js/admin-promos.js", 'type !== (discountType === "FIXED" ? "fixed" : "percentage")', "Discount type must control visible amount fields.");
includes("frontend/js/admin-promos.js", 'field.hidden = Boolean(typeHidden || regionHidden)', "Irrelevant discount/region controls must be hidden as whole fields.");
includes("frontend/js/admin-promos.js", 'eligibilityMode !== "PACKAGES"', "Selected Packages must be the only mode showing package controls.");
includes("frontend/js/admin-promos.js", 'eligibilityMode !== "PRODUCTS"', "Selected Products must be the only mode showing product controls.");
includes("frontend/js/admin-promos.js", 'eligibilityMode !== "ALL"', "All Products summary must be mode-aware.");
includes("frontend/js/admin-promos.js", 'modal.querySelector("#promoEligibilityList").hidden = eligibilityMode === "ALL"', "ALL must hide product and package selector container.");
includes("frontend/js/admin-promos.js", 'modal.querySelector("#promoPackageProductTabs").hidden = eligibilityMode !== "PACKAGES"', "ALL/PRODUCTS must hide package product navigation.");
includes("frontend/js/admin-promos.js", 'modal.querySelector("#promoPackageSearch").hidden = eligibilityMode !== "PACKAGES"', "ALL/PRODUCTS must hide package search.");
includes("frontend/js/admin-promos.js", 'classList.toggle("is-hidden", eligibilityMode !== "PRODUCTS")', "PRODUCTS mode must be the only product selector owner.");
includes("frontend/js/admin-promos.js", 'classList.toggle("is-hidden", eligibilityMode !== "PACKAGES")', "PACKAGES mode must be the only package selector owner.");
includes("frontend/js/admin-promos.js", 'data-promo-region="MM"', "MM amount fields must be region-targetable.");
includes("frontend/js/admin-promos.js", 'data-promo-region="TH"', "TH amount fields must be region-targetable.");
includes("frontend/js/admin-promos.js", 'const regionHidden = (region === "MM" && !mmTargeted) || (region === "TH" && !thTargeted)', "Region changes must recompute regional amount visibility.");
includes("frontend/js/admin-promos.js", "promoAllProductsSummary", "All Products must show a concise summary.");
includes("frontend/js/admin-promos.js", "promo-product-grid", "Selected Products must use a product grid.");
includes("frontend/js/admin-promos.js", "promo-package-tabs", "Selected Packages must use product-aware package navigation.");
includes("frontend/js/admin-promos.js", "promo-package-workspace", "Package selector must have a bounded local workspace.");
includes("frontend/css/admin/admin-design-system.css", "max-height: 340px", "Package selector must have bounded local scrolling.");

includes("frontend/js/admin-promos.js", "/api/admin/catalog/products", "Product selector must use admin catalog data.");
includes("frontend/js/admin-promos.js", "/packages", "Package selector must use catalog package data.");
includes("frontend/js/admin-promos.js", "productCode: input.dataset.promoPackageProduct", "Package payload must preserve canonical productCode.");
includes("frontend/js/admin-promos.js", "packageCode: input.dataset.promoPackage", "Package payload must preserve canonical packageCode.");

includes("frontend/js/admin-promos.js", "promo-editor-footer", "Promo editor must have reachable footer actions.");
includes("frontend/css/admin/admin-design-system.css", "grid-template-rows: auto minmax(0, 1fr) auto", "Header/body/footer layout must keep actions reachable.");
includes("frontend/js/admin-promos.js", "AZIEL_ADMIN_ACTION_MODAL", "Save must still transition through confirmation.");
matches("frontend/js/admin-promos.js", /modal\?\.classList\.remove\("show"\);\s*const result = await window\.AZIEL_ADMIN_ACTION_MODAL/s, "Editor must hide before confirmation opens.");
includes("frontend/js/admin-promos.js", "promoSavePending", "Duplicate-submit protection must remain.");
includes("frontend/js/admin-promos.js", "readOnly = Boolean(promo)", "Promo code identity must remain immutable on edit.");

includes("frontend/css/admin/admin-design-system.css", "@media (max-width: 768px)", "Mobile breakpoint must use existing max-width 768px.");
matches("frontend/css/admin/admin-design-system.css", /@media \(max-width: 768px\)[\s\S]+\.promo-workspace-grid,[\s\S]+grid-template-columns: 1fr;/, "Mobile layout must stack promo editor grids.");
includes("frontend/css/admin/admin-design-system.css", "width: calc(100vw - 32px)", "Mobile promo editor must fit viewport width.");

[
    "basic_information",
    "discount_rules",
    "limits_schedule",
    "all_active_products_packages",
    "search_packages",
    "immutable"
].forEach(key => {
    includes("frontend/lang/admin/en.js", key, `English i18n must include ${key}.`);
    includes("frontend/lang/admin/my.js", key, `Myanmar i18n must include ${key}.`);
});

assert.ok(!/promoCodeService|PromoCode|PromoRedemption|PromoUsageState/.test(css), "Layout CSS must not alter promo financial ownership.");
assert.ok(promos.includes("readPromoPayload"), "Admin editor must preserve existing payload submission path.");

console.log("✅ Admin Promo editor layout verification passed.");
