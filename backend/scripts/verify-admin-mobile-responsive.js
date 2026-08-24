const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const adminHtml = read("frontend/admin.html");
const adminCss = read("frontend/css/admin/admin-design-system.css");
const adminShellCss = read("frontend/css/admin/admin-mobile-shell.css");
const adminApp = read("frontend/js/admin-app.js");
const adminOrders = read("frontend/js/admin-orders.js");
const adminWallet = read("frontend/js/admin-wallet.js");
const adminCatalog = read("frontend/js/admin-catalog.js");
const adminStats = read("frontend/js/admin-stats.js");
const adminLiveChat = read("frontend/js/admin-live-chat.js");
const en = read("frontend/lang/admin/en.js");
const my = read("frontend/lang/admin/my.js");

function assertIncludes(source, fragment, message) {
    assert.ok(source.includes(fragment), message || `Missing ${fragment}`);
}

assertIncludes(adminCss, "@media (max-width: 767px)", "Admin phone presentation breakpoint contract must exist");
assertIncludes(adminCss, "--admin-mobile-header-height", "Mobile header token must exist");
assertIncludes(adminCss, "--admin-mobile-gutter", "Mobile gutter token must exist");
assertIncludes(adminCss, "--admin-touch-target", "Mobile touch target token must exist");

assertIncludes(adminApp, "window.AZIEL_ADMIN_LAYOUT", "Central responsive layout owner must exist");
assertIncludes(adminApp, "matchMedia(\"(max-width: 767px)\")", "Phone interaction mode must use the <768px boundary");
assertIncludes(adminApp, "matchMedia(\"(max-width: 1023px)\")", "Tablet/compact shell boundary must exist");
assert.ok(!adminApp.includes("matchMedia(\"(max-width: 768px)\")"), "JavaScript must not retain the conflicting inclusive 768px phone boundary");
assertIncludes(adminApp, "admin-drawer-lock", "Drawer body scroll lock must exist");
assertIncludes(adminApp, "aria-expanded", "Drawer menu button must expose expanded state");
assertIncludes(adminHtml, "adminMobileLocaleSelect", "Mobile drawer locale control must exist");
assertIncludes(adminHtml, "adminMobileLogoutBtn", "Mobile drawer logout control must exist");
assertIncludes(adminHtml, "admin-mobile-drawer-actions", "Mobile drawer actions must exist");

assertIncludes(adminHtml, "adminMobileBottomNav", "Phone bottom navigation must exist");
assertIncludes(adminHtml, "adminMobileMore", "Mobile More surface must exist");
assertIncludes(adminHtml, "adminMobileSearch", "Mobile search surface must exist");
assertIncludes(adminHtml, "admin-mobile-header-actions", "Compact mobile header actions must exist");
assertIncludes(adminHtml, "dashboard-mobile-analytics", "Secondary Dashboard analytics must use one mobile disclosure");
assertIncludes(adminHtml, "dashboardSecondaryKpis", "Secondary KPI mount must exist inside the disclosure");
assertIncludes(adminHtml, "dashboard-mobile-filter-disclosure", "Dashboard filters must use the shared mobile disclosure surface");
assertIncludes(adminHtml, "aria-label=\"Primary Admin navigation\"", "Bottom navigation must be a named landmark");
assertIncludes(adminHtml, "aria-modal=\"true\"", "Mobile overlays must expose modal semantics");

[
    ["dashboard", "DASHBOARD_READ"],
    ["orders", "ORDERS_READ"],
    ["wallet", "WALLET_READ"],
    ["catalog", "CATALOG_READ"]
].forEach(([section, permission]) => {
    assert.ok(
        adminHtml.includes(`data-mobile-section="${section}" data-admin-permission="${permission}"`),
        `${section} mobile destination must preserve its permission contract`
    );
});
assert.ok(/id="adminMobileMoreBtn"[\s\S]*?<span>More<\/span>/.test(adminHtml), "More must be the fifth primary destination");

assertIncludes(adminShellCss, "@media (max-width: 767px)", "Phone CSS must use the <768px boundary");
assertIncludes(adminShellCss, "@media (min-width: 768px) and (max-width: 1023px)", "Tablet CSS tier must exist");
assertIncludes(adminShellCss, "@media (min-width: 1024px)", "Desktop CSS tier must restore the persistent workspace");
assertIncludes(adminShellCss, "@media (max-width: 479px)", "Compact phone tier must exist");
assertIncludes(adminShellCss, "env(safe-area-inset-top", "Mobile header must reserve the top safe area");
assertIncludes(adminShellCss, "env(safe-area-inset-bottom", "Bottom navigation must reserve the bottom safe area");
assertIncludes(adminShellCss, ".admin-mobile-sticky-actions", "Shared sticky action primitive must exist");
assertIncludes(adminShellCss, ".admin-mobile-sheet-dialog", "Shared bottom sheet primitive must exist");
assertIncludes(adminShellCss, "font-size: 18px", "Phone section title scale must be reduced");
assertIncludes(adminShellCss, "grid-auto-flow: column", "Urgent Dashboard KPI rail must scan horizontally");
assertIncludes(adminShellCss, "grid-auto-columns: minmax(148px, 68vw)", "KPI rail must remain compact at phone widths");
assertIncludes(adminShellCss, "#section-dashboard .dashboard-mobile-analytics:not([open]) > :not(summary)", "Secondary analytics must remain collapsed by default on phones");
assertIncludes(adminShellCss, "#section-dashboard .dashboard-mobile-filter-disclosure:not([open]) > .dashboard-filter-bar", "Compact filters must remain collapsed by default on phones");
assertIncludes(adminShellCss, "--admin-bg: #171b26", "Phone dark mode must use the softer charcoal hierarchy");
assertIncludes(adminShellCss, "border-width: 0 0 1px", "Operational queues must flatten nested card presentation");
assertIncludes(adminShellCss, ".admin-mobile-action-overflow", "Secondary operational actions must use an overflow primitive");
assertIncludes(adminShellCss, "@media (min-width: 768px)", "Desktop compatibility rules must preserve transparent disclosures");

assertIncludes(adminStats, "adminDashboardPhoneQuery.matches", "Dashboard KPI reduction must be phone-conditional");
assertIncludes(adminStats, "cards.slice(0, 4)", "Phone Dashboard must render only four urgent KPIs outside disclosure");
assertIncludes(adminStats, "cards.slice(4)", "Phone secondary KPIs must render inside More analytics");
assertIncludes(adminStats, "box.innerHTML = cards.map", "Tablet and desktop must restore all KPI cards to the canonical grid");
assertIncludes(adminStats, 'secondaryBox.innerHTML = ""', "Desktop restoration must clear the phone-only secondary KPI mount");
assertIncludes(adminStats, "analytics.open = !phone", "Analytics disclosure must be forced open outside phone mode");
assertIncludes(adminStats, "filters.open = !phone", "Full filter controls must be forced open outside phone mode");
assertIncludes(adminOrders, "admin-mobile-action-overflow", "Orders secondary actions must use mobile overflow");
assertIncludes(adminWallet, "admin-mobile-action-overflow", "Wallet rejection must use focused mobile overflow");
assertIncludes(adminOrders, 'isMobile?.() ? "" : "open"', "Orders desktop action overflow must render open");
assertIncludes(adminWallet, 'isMobile?.() ? "" : "open"', "Wallet desktop action overflow must render open");
assertIncludes(adminApp, "disclosure.open = !event.detail?.mobile", "Cross-breakpoint changes must restore desktop operational actions");

[
    "dashboardSalesChart",
    "dashboardStatusChart",
    "dashboardAttentionQueue",
    "dashboardRegionPerformance",
    "dashboardTopGames",
    "dashboardPaymentMethods",
    "dashboardRecentActivity",
    "dashboardQuickActions"
].forEach(id => assertIncludes(adminHtml, `id="${id}"`, `Dashboard node ${id} must remain in the DOM`));
assert.ok(
    /@media \(min-width: 768px\) and \(max-width: 1023px\)[\s\S]*?\.admin-mobile-bottom-nav[\s\S]*?display:\s*none !important/.test(adminShellCss),
    "Tablet tier must not display phone bottom navigation"
);
assert.ok(
    /@media \(min-width: 1024px\)[\s\S]*?\.admin-body \.admin-sidebar[\s\S]*?position:\s*sticky[\s\S]*?transform:\s*none/.test(adminShellCss),
    "Desktop tier must restore persistent sidebar behavior"
);

assertIncludes(adminApp, "openAdminSection(item.dataset.mobileSection)", "Mobile navigation must use canonical section selection");
assertIncludes(adminApp, "syncAdminMobileNavigation(sectionName)", "Canonical section selection must synchronize mobile active state");
assertIncludes(adminApp, "aziel:admin-auth-ready", "Mobile destinations must reapply permission visibility after auth");
assertIncludes(adminApp, "event.key === \"Escape\"", "Escape must close mobile surfaces");
assertIncludes(adminApp, "trapAdminMobileSurfaceFocus", "Mobile surfaces must trap keyboard focus");
assert.ok(!adminApp.includes("/api/mobile"), "Responsive shell must not introduce a mobile backend contract");

assertIncludes(adminCss, ".admin-body .top-actions", "Mobile topbar must control desktop top actions");
assertIncludes(adminCss, "display: none", "Mobile CSS must hide nonessential permanent shell controls");
assert.ok(
    /#section-orders\s+\.orders-command-panel\s*>\s*\.panel-head/.test(adminCss),
    "Orders duplicate heading must be controlled on mobile"
);
assert.ok(
    /#section-wallet\s+\.wallet-command-panel\s*>\s*\.panel-head/.test(adminCss),
    "Wallet duplicate heading must be controlled on mobile"
);
assertIncludes(adminCss, "#section-wallet.admin-mobile-detail-open .wallet-command-panel", "Wallet mobile detail state must hide the queue panel");
assertIncludes(adminCss, "#section-wallet.admin-mobile-list-open .wallet-detail-panel", "Wallet mobile list state must hide the detail panel");
assertIncludes(adminCss, ".wallet-queue-filters,\n  .wallet-summary-grid", "Wallet filters and summary must collapse to one mobile column");
assertIncludes(adminCss, ".wallet-review-sticky {\n    position: static;", "Wallet sticky desktop header must release on mobile");
assertIncludes(adminCss, "#section-users.admin-mobile-detail-open .customer-crm-list-panel", "Customer CRM mobile list/detail state must exist");
assertIncludes(adminCss, "#section-users.admin-mobile-list-open .customer-crm-detail-panel", "Customer CRM mobile detail panel must hide in list mode");
assert.ok(
    /@media \(max-width: 767px\)[\s\S]*\.customer-crm-workspace\s*\{[\s\S]*display:\s*block;/.test(adminCss),
    "Customer CRM must return to single-column mobile layout"
);
assertIncludes(adminCss, ".customer-crm-list,\n  .customer-tab-panel", "Customer CRM mobile scroll containers must release desktop overflow ownership");
assertIncludes(adminCss, "max-height: none;\n    overflow: visible;", "Customer CRM mobile must use normal page scrolling");

assertIncludes(adminOrders, "showDetail?.(\"orders\")", "Orders must open mobile detail from queue selection");
assertIncludes(adminOrders, "showList?.(\"orders\")", "Orders detail must support back to list");
assertIncludes(adminWallet, "showDetail?.(\"wallet\")", "Wallet must open mobile detail from queue selection");
assertIncludes(adminWallet, "showList?.(\"wallet\")", "Wallet detail must support back to list");
assertIncludes(adminCatalog, "showDetail?.(\"catalog\")", "Catalog must open mobile detail from product selection");
assertIncludes(adminCatalog, "showList?.(\"catalog\")", "Catalog detail must support back to list");
assertIncludes(adminLiveChat, "admin-chat-detail-open", "Live Chat must use inbox-to-conversation mobile state");
assertIncludes(adminApp, "showList?.(\"users\")", "Customer CRM must integrate central mobile list/detail controller");

assertIncludes(adminCss, ".orders-queue-tabs", "Orders tab strip CSS must exist");
assertIncludes(adminCss, "overscroll-behavior-x: contain", "Mobile tabs must use local horizontal scroll");
assertIncludes(adminCss, ".orders-queue-row::after", "Mobile order rows must be card-like drill-in rows");
assertIncludes(adminCss, ".wallet-queue-row::after", "Mobile wallet rows must be card-like drill-in rows");
assertIncludes(adminCss, ".catalog-package-header", "Catalog mobile package table header must be controlled");
assertIncludes(adminCss, "min-width: 0", "Horizontal overflow prevention must exist");
assertIncludes(adminCss, "overflow-x: hidden", "Full-page horizontal overflow must be prevented");
assertIncludes(adminCss, "env(safe-area-inset-bottom)", "Safe-area bottom handling must exist");
assertIncludes(adminCss, ".admin-action-modal-box", "Shared modal primitive must be used");
assertIncludes(adminCss, "max-height: calc(100dvh", "Mobile modal max-height contract must exist");
assertIncludes(adminCss, ".media-asset-grid", "Media mobile grid contract must exist");

assert.ok(!adminApp.includes("/api/mobile"), "No mobile-specific Admin API should be introduced");
assert.ok(!adminOrders.includes("/api/mobile"), "Orders must keep canonical API ownership");
assert.ok(!adminWallet.includes("/api/mobile"), "Wallet must keep canonical API ownership");
assert.ok(!adminCatalog.includes("/api/mobile"), "Catalog must keep canonical API ownership");

[
    "language",
    "back_to_orders",
    "back_to_wallet",
    "back_to_catalog",
    "back_to_chats",
    "open_details",
    "no_actions_available"
].forEach(key => {
    assertIncludes(en, `${key}:`, `English admin dictionary missing ${key}`);
    assertIncludes(my, `${key}:`, `Myanmar admin dictionary missing ${key}`);
});

assert.ok(!/window\.confirm\s*\(/.test(adminApp + adminOrders + adminWallet + adminCatalog), "Mobile pass must not introduce native confirm");

console.log("Admin mobile responsive verification checks passed.");
