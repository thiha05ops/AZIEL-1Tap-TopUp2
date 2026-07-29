const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertIncludes(source, fragment, message) {
    assert.ok(source.includes(fragment), message || `Missing ${fragment}`);
}

const html = read("frontend/admin.html");
const app = read("frontend/js/admin-app.js");
const css = read("frontend/css/admin/admin-design-system.css");
const en = read("frontend/lang/admin/en.js");
const my = read("frontend/lang/admin/my.js");
const th = read("frontend/lang/admin/th.js");
const packageJson = read("package.json");

const expectedModules = [
    ["dashboard", "DASHBOARD_READ"],
    ["website", "SITE_CONTENT_READ"],
    ["orders", "ORDERS_READ"],
    ["wallet", "WALLET_READ"],
    ["fulfillment", "SUPPLIERS_READ,FULFILLMENT_READ"],
    ["support", "SUPPORT_READ"],
    ["chat", "LIVE_CHAT_READ"],
    ["catalog", "CATALOG_READ"],
    ["promos", "PROMOS_READ"],
    ["media", "MEDIA_READ"],
    ["site-content", "SITE_CONTENT_READ"],
    ["campaigns", "CAMPAIGNS_READ"],
    ["users", "USERS_READ"],
    ["broadcast", "SETTINGS_MANAGE"],
    ["payments", "PAYMENT_METHODS_READ,PAYMENT_METHODS_MANAGE"],
    ["settings", "SETTINGS_MANAGE"]
];

expectedModules.forEach(([section, permission]) => {
    assertIncludes(html, `data-section="${section}"`, `Admin nav missing ${section} section.`);
    assertIncludes(html, `id="section-${section}"`, `Admin content section missing ${section}.`);
    assertIncludes(html, `data-admin-permission="${permission}"`, `Admin nav ${section} permission marker changed.`);
});

assertIncludes(html, `data-section="admin-security"`, "Admin Team nav item must exist.");
assertIncludes(html, `data-admin-permission="ADMIN_ACCOUNTS_READ,ADMIN_SESSIONS_READ,AUDIT_LOG_READ"`, "Admin Security RBAC group marker must remain.");
assertIncludes(html, `href="/admin-design-studio.html"`, "Design Studio must remain a direct route.");
assertIncludes(html, `data-admin-permission="DESIGN_STUDIO_READ"`, "Design Studio RBAC marker must remain.");

[
    "Home",
    "Growth",
    "Commerce",
    "Operations",
    "Customers",
    "Administration",
    "System"
].forEach(group => assertIncludes(html, group, `Navigation group ${group} must exist.`));

assertIncludes(html, `id="adminSidebarCollapse"`, "Desktop collapsed sidebar control must exist.");
assertIncludes(html, `id="adminNavSearch"`, "Admin nav search control must exist.");
assertIncludes(html, `id="adminSidebarOverlay"`, "Mobile drawer backdrop must exist.");
assertIncludes(html, `aria-controls="adminSidebar"`, "Topbar menu must target the sidebar.");
assertIncludes(html, `id="adminSectionPill"`, "Topbar active group context pill must exist.");
assertIncludes(html, `admin-sidebar-header`, "Sidebar must expose an explicit header region.");
assertIncludes(html, `admin-sidebar-navigation`, "Sidebar must expose an explicit navigation region.");
assertIncludes(html, `admin-sidebar-footer`, "Sidebar must expose an explicit footer region.");

assertIncludes(app, "ADMIN_SIDEBAR_COLLAPSED_KEY", "Collapsed state storage key must exist.");
assertIncludes(app, "localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_KEY", "Collapsed state must persist.");
assertIncludes(app, "admin-sidebar-collapsed", "Collapsed body class must be owned by JS.");
assertIncludes(app, "aria-current", "Active nav item must expose aria-current.");
assertIncludes(app, "getAdminDrawerFocusable", "Mobile drawer focus trap helper must exist.");
assertIncludes(app, "drawerReturnFocus", "Mobile drawer must restore focus to opener.");
assertIncludes(app, "admin-drawer-lock", "Mobile drawer must lock background scroll.");
assertIncludes(app, "keydown", "Escape/focus keyboard handling must exist.");
assertIncludes(app, "initAdminNavSearch", "Navigation search must be initialized.");
assertIncludes(app, "window.AZIEL_ADMIN_LAYOUT?.closeDrawer", "Route selection must close the mobile drawer.");

assertIncludes(css, "--admin-sidebar-width", "Sidebar width token must exist.");
assertIncludes(css, "--admin-sidebar-collapsed-width", "Collapsed sidebar width token must exist.");
assertIncludes(css, "grid-template-rows: minmax(76px, auto) minmax(0, 1fr) auto", "Expanded sidebar must reserve header, navigation, and footer rows.");
assertIncludes(css, ".admin-sidebar-navigation", "Sidebar navigation region styles must exist.");
assertIncludes(css, "grid-template-rows: auto minmax(0, 1fr)", "Navigation region must keep search separate from the scrollable menu.");
assertIncludes(css, ".admin-body .admin-menu", "Navigation menu must own its scroll lane.");
assertIncludes(css, "overflow-y: auto", "Navigation menu must scroll independently instead of entering the header area.");
assertIncludes(css, "grid-template-rows: minmax(88px, auto) minmax(0, 1fr) auto", "Collapsed sidebar must reserve enough header height for logo and collapse button.");
assertIncludes(css, "flex-wrap: nowrap", "Collapsed sidebar header must not wrap over the navigation hit area.");
assertIncludes(css, ".admin-body.admin-sidebar-collapsed .admin-app", "Collapsed grid rule must exist.");
assertIncludes(css, ".admin-body.admin-sidebar-collapsed .admin-nav::after", "Collapsed tooltip rule must exist.");
assertIncludes(css, ".admin-nav-search", "Navigation search styling must exist.");
assertIncludes(css, "@media (min-width: 769px)", "Desktop/tablet sidebar ownership must be explicit.");
assertIncludes(css, "@media (max-width: 768px)", "Mobile drawer breakpoint must remain.");
assertIncludes(css, "background: rgba(2, 6, 23, .18)", "Mobile backdrop must stay light utility-drawer style.");
assertIncludes(css, "@media (prefers-reduced-motion: reduce)", "Reduced motion contract must remain available.");

["design_studio", "website", "commerce", "operations", "customers", "nav_search_placeholder", "collapse_navigation", "expand_navigation"].forEach(key => {
    assertIncludes(en, `${key}:`, `English dictionary missing ${key}.`);
    assertIncludes(my, `${key}:`, `Myanmar dictionary missing ${key}.`);
    assertIncludes(th, `${key}:`, `Thai dictionary missing ${key}.`);
});

const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g)).map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepStrictEqual([...new Set(duplicates)], [], "Admin HTML must not contain duplicate IDs.");

assertIncludes(packageJson, `"verify:admin-navigation"`, "package.json must expose verify:admin-navigation.");

console.log("Admin navigation verification checks passed.");
