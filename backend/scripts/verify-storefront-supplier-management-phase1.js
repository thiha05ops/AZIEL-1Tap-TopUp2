"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const routes = read("backend/routes/catalog.js");
const ui = read("frontend/js/admin-catalog.js");
const css = read("frontend/css/admin-v2/components.css");
const prices = read("frontend/js/prices.js");
const runtime = read("frontend/js/catalog-runtime.js");
const checkout = read("backend/services/supplierProductionSelectionService.js");
const fulfillment = read("backend/services/fulfillmentService.js");

assert(routes.includes('router.get("/admin/catalog/products/:productCode/packages/:packageCode/supplier-selection"'));
assert(!routes.includes('router.post("/admin/catalog/products/:productCode/packages/:packageCode/supplier-selection"'));
assert(routes.includes("CATALOG_PACKAGE_ICON_ATTACHED") && routes.includes("CATALOG_PACKAGE_ICON_CLEARED"));
assert(ui.includes("catalog-manage-package-drawer"));
assert(ui.includes('category: "package_icon"'));
assert(ui.includes("Supplier selection required"));
assert(ui.includes("Customer price is managed in Pricing."));
assert(ui.includes("data-merch-modal-reference") && ui.includes("data-save-merch-modal"), "existing merchandising controls must remain");
assert(css.includes(".catalog-manage-package-drawer") && css.includes(".catalog-supplier-candidate"));
assert(runtime.includes('artwork: String(item.iconUrl || "").trim()'));
assert(prices.includes("data-package-media") && prices.includes("bindPackageIconFallbacks"));
assert(checkout.includes("const resolveCheckoutRouteSnapshot = createRoutingAuthority();"));
assert(fulfillment.includes("async function startFulfillmentForOrder"));
console.log("PASS Phase 1 API/UI/media/audit and routing-boundary static verification");
