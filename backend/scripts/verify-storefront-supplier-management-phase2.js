"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const routes = read("backend/routes/catalog.js");
const ui = read("frontend/js/admin-catalog.js");
const selectionService = read("backend/services/packageSupplierSelectionService.js");
const checkout = read("backend/services/supplierProductionSelectionService.js");
const fulfillment = read("backend/services/fulfillmentService.js");

assert(routes.includes('router.put("/admin/catalog/products/:productCode/packages/:packageCode/supplier-selection"'));
assert(routes.includes("PERMISSIONS.OWNER_ROUTING_MANAGE"));
assert(ui.includes('input type="radio" name="manage-package-supplier"'));
assert(ui.includes("Supplier change not saved") && ui.includes("data-save-package-supplier disabled"));
assert(ui.includes("Change fulfillment supplier?") && ui.includes("Customer price will not change."));
assert(ui.includes("Supplier selection changed elsewhere. Refreshing the latest selection."));
assert(ui.includes("renderPackageSupplierSummary") && ui.includes("data-package-public-state"));
assert(ui.includes('method: asset ? "PATCH" : "DELETE"') && ui.includes("expectedUpdatedAt: pkg.updatedAt"));
assert(ui.includes("Object.assign(pkg, refreshedPackage)"), "image refresh must preserve the open drawer's supplier draft state");
assert(selectionService.includes("candidateBlockers({"), "write validation must reuse Phase 1 readiness authority");
assert(selectionService.includes("customerPriceChanged: false") && selectionService.includes("publicationChanged: false"));
assert(checkout.includes("const resolveCheckoutRouteSnapshot = createRoutingAuthority();"));
assert(fulfillment.includes("async function startFulfillmentForOrder"));
assert(!checkout.includes("PackageSupplierSelection"));
assert(!fulfillment.includes("PackageSupplierSelection"));
console.log("PASS Phase 2 API/drawer/stale/image and checkout/fulfillment boundary verification");
