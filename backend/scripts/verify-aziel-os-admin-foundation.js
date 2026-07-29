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

function assertOrder(file, fragments, message) {
    const source = read(file);
    let cursor = -1;
    fragments.forEach(fragment => {
        const index = source.indexOf(fragment);
        assert(index > cursor, `${file}: ${message} (${fragment})`);
        cursor = index;
    });
}

function main() {
    includes("frontend/admin.html", "<title>AZIEL OS · Commerce Operating System</title>", "Admin browser title must use AZIEL OS.");
    includes("frontend/admin.html", "AZIEL OS</h1>", "Sidebar must display AZIEL OS.");
    includes("frontend/admin.html", "Commerce Operating System", "Admin OS subtitle must exist.");
    includes("frontend/admin.html", "Version 2.5", "Admin OS version must be visible.");
    includes("frontend/admin.html", "alt=\"AZIEL OS\"", "Admin logo must provide accessible alt text.");
    includes("frontend/admin.html", "adminNotificationsBtn", "Shared topbar notification action must exist.");
    includes("frontend/admin.html", "adminLocaleSelect", "Shared topbar language selector must remain.");
    includes("frontend/admin.html", "adminProfileBtn", "Shared topbar profile action must exist.");
    includes("frontend/admin.html", "adminGlobalSearch", "Existing global search entry must remain.");
    includes("frontend/admin-login.html", "AZIEL OS", "Admin login must use AZIEL OS branding.");
    includes("frontend/admin-login.html", "Commerce Operating System", "Admin login must show OS subtitle.");
    notIncludes("frontend/home.html", "AZIEL OS", "Public storefront Home must not inherit Admin OS branding.");
    includes("frontend/admin.html", "data-aziel-os-brand=\"sidebar\"", "Expanded sidebar must use the reusable AZIEL OS SVG brand component.");
    includes("frontend/admin-login.html", "data-aziel-os-brand=\"login\"", "Login must use the reusable AZIEL OS SVG brand component.");
    includes("frontend/js/admin-os-brand.js", "linearGradient", "AZIEL OS mark must use SVG gradient surfaces.");
    includes("frontend/js/admin-os-brand.js", "feGaussianBlur", "AZIEL OS mark must use restrained SVG glow.");
    includes("frontend/js/admin-os-brand.js", "admin-logo-fallback", "AZIEL OS SVG must retain image fallback.");

    assertOrder("frontend/admin.html", [
        "<span class=\"admin-nav-label\">Home</span>",
        "<span class=\"admin-nav-label\">Growth</span>",
        "<span class=\"admin-nav-label\" data-admin-i18n=\"commerce\">Commerce</span>",
        "<span class=\"admin-nav-label\" data-admin-i18n=\"operations\">Operations</span>",
        "<span class=\"admin-nav-label\" data-admin-i18n=\"customers\">Customers</span>",
        "<span class=\"admin-nav-label\">Administration</span>",
        "<span class=\"admin-nav-label\">System</span>"
    ], "Sidebar must follow AZIEL OS business-domain information architecture.");

    includes("frontend/admin.html", "data-admin-permission=\"ORDERS_READ\"", "Orders route must remain permission gated.");
    includes("frontend/admin.html", "data-admin-permission=\"CATALOG_READ\"", "Catalog/Pricing routes must remain permission gated.");
    includes("frontend/admin.html", "data-admin-permission=\"PAYMENT_METHODS_READ,PAYMENT_METHODS_MANAGE\"", "Payment Methods route must remain permission gated.");
    includes("frontend/admin.html", "Dashboard</h3>", "Dashboard must use operations-centre naming.");
    includes("frontend/admin.html", "Commerce operations overview using live AZIEL data", "Dashboard must state live-data operating scope.");
    includes("frontend/admin.html", "<h3>Pricing</h3>", "Pricing Workspace must migrate to Pricing naming.");
    includes("frontend/admin.html", "Daily Supplier Workspace", "Pricing Workspace subtitle must reflect daily supplier workflow.");
    includes("frontend/admin.html", "pricing-business-rules-drawer", "Business Rules must be outside the default daily flow.");
    includes("frontend/admin.html", "Publish All Disabled", "Unsafe pricing publish-all action must stay disabled.");

    includes("frontend/css/admin/admin-design-system.css", "--aziel-os-bg", "AZIEL OS design tokens must exist.");
    includes("frontend/css/admin/admin-design-system.css", "--aziel-os-purple", "AZIEL OS accent token must exist.");
    includes("frontend/css/admin/admin-design-system.css", "--aziel-os-focus-ring", "AZIEL OS focus ring token must exist.");
    includes("frontend/css/admin/admin-design-system.css", "@media (prefers-reduced-motion", "Admin design system must respect reduced motion.");
    includes("frontend/css/admin/admin-os-brand.css", ".aziel-os-svg-mark", "Admin SVG mark styling must exist.");
    includes("frontend/css/admin/admin-os-brand.css", ".admin-body.admin-sidebar-collapsed", "Collapsed sidebar must show compact AZIEL OS mark.");
    includes("frontend/css/admin/admin-design-system.css", ".admin-icon-btn", "Reusable topbar icon button style must exist.");

    includes("frontend/js/admin-app.js", "document.title = `${titleText} · AZIEL OS`", "Page-specific titles must end with AZIEL OS.");
    includes("frontend/js/admin-app.js", "AZIEL OS V2.5", "Admin controller must identify OS V2.5.");

    includes("frontend/js/admin-pricing-engine.js", "stagedChangesByPackageId: new Map()", "Pricing migration must preserve explicit staged-row state.");
    includes("backend/services/commerce/adminPricingControlCenterService.js", "WORKSPACE_PUBLISH_ALL_DISABLED", "Pricing backend must keep publish-all disabled.");

    console.log("AZIEL OS Admin foundation verifier passed.");
}

main();
