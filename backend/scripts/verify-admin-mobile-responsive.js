const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const adminHtml = read("frontend/admin.html");
const adminCss = read("frontend/css/admin/admin-design-system.css");
const adminApp = read("frontend/js/admin-app.js");
const adminOrders = read("frontend/js/admin-orders.js");
const adminWallet = read("frontend/js/admin-wallet.js");
const adminCatalog = read("frontend/js/admin-catalog.js");
const adminLiveChat = read("frontend/js/admin-live-chat.js");
const en = read("frontend/lang/admin/en.js");
const my = read("frontend/lang/admin/my.js");

function assertIncludes(source, fragment, message) {
    assert.ok(source.includes(fragment), message || `Missing ${fragment}`);
}

assertIncludes(adminCss, "@media (max-width: 768px)", "Admin mobile breakpoint contract must exist");
assertIncludes(adminCss, "--admin-mobile-header-height", "Mobile header token must exist");
assertIncludes(adminCss, "--admin-mobile-gutter", "Mobile gutter token must exist");
assertIncludes(adminCss, "--admin-touch-target", "Mobile touch target token must exist");

assertIncludes(adminApp, "window.AZIEL_ADMIN_LAYOUT", "Central responsive layout owner must exist");
assertIncludes(adminApp, "matchMedia(\"(max-width: 768px)\")", "Responsive helper must own breakpoint");
assertIncludes(adminApp, "admin-drawer-lock", "Drawer body scroll lock must exist");
assertIncludes(adminApp, "aria-expanded", "Drawer menu button must expose expanded state");
assertIncludes(adminHtml, "adminMobileLocaleSelect", "Mobile drawer locale control must exist");
assertIncludes(adminHtml, "adminMobileLogoutBtn", "Mobile drawer logout control must exist");
assertIncludes(adminHtml, "admin-mobile-drawer-actions", "Mobile drawer actions must exist");

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
    /@media \(max-width: 768px\)[\s\S]*\.customer-crm-workspace\s*\{[\s\S]*display:\s*block;/.test(adminCss),
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
