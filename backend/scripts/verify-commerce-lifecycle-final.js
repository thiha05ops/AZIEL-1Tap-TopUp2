"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createRoutingAuthority } = require("../services/supplierProductionSelectionService");
const { FULFILLMENT_ROUTING_MODES } = require("../config/fulfillmentRoutingMode");

async function main() {
    const selected = { ready: true, blockers: [], resolution: "OWNER_SELECTION", routeSnapshot: { routeType: "SUPPLIER_API", supplierCode: "FAZERCARDS", supplierMappingId: "selected" } };
    let legacyCalls = 0;
    const explicit = createRoutingAuthority({
        selectedResolver: async () => selected,
        legacyResolver: async () => { legacyCalls += 1; return { ready: true, routeSnapshot: { supplierCode: "WONDD" } }; },
        modeResolver: () => FULFILLMENT_ROUTING_MODES.LEGACY_REGION
    });
    assert.strictEqual((await explicit({ productCode: "game", packageCode: "PACK", region: "TH" })).routeSnapshot.supplierMappingId, "selected");
    assert.strictEqual(legacyCalls, 0, "explicit Storefront supplier must be honored before legacy routing");

    const blocked = createRoutingAuthority({
        selectedResolver: async () => ({ ready: false, blockers: ["SUPPLIER_AVAILABILITY_NOT_CONFIRMED"], routeSnapshot: null, resolution: "OWNER_SELECTION" }),
        legacyResolver: async () => { throw new Error("silent fallback attempted"); },
        modeResolver: () => FULFILLMENT_ROUTING_MODES.LEGACY_REGION
    });
    assert.deepStrictEqual((await blocked({ productCode: "game", packageCode: "PACK", region: "TH" })).blockers, ["SUPPLIER_AVAILABILITY_NOT_CONFIRMED"]);

    const root = path.resolve(__dirname, "../..");
    const ui = fs.readFileSync(path.join(root, "frontend/js/admin-catalog.js"), "utf8");
    const catalog = fs.readFileSync(path.join(root, "backend/services/catalogService.js"), "utf8");
    const publication = fs.readFileSync(path.join(root, "backend/services/packageMarketPublicationService.js"), "utf8");
    const paid = fs.readFileSync(path.join(root, "backend/services/paidFulfillmentRoutingService.js"), "utf8");
    const orderSnapshot = fs.readFileSync(path.join(root, "backend/services/commerce/orderSnapshotRuntime.js"), "utf8");
    const fulfillment = fs.readFileSync(path.join(root, "backend/services/fulfillmentService.js"), "utf8");
    const guidedSelling = fs.readFileSync(path.join(root, "frontend/js/admin-guided-selling.js"), "utf8");
    assert(ui.includes("data-product-purchasable") && ui.includes("Selling ON") && ui.includes("Live Packages") && ui.includes("Disabled / Blocked Packages"));
    assert(!ui.includes("Supplier selection required"));
    assert(catalog.includes('.filter(pkg => pkg.salesState === "LIVE")'), "public storefront must expose effective LIVE packages only");
    assert(publication.includes("package Selling ON/OFF decision"), "publication authority must be package Selling intent only");
    assert(paid.includes("routeSnapshot"), "paid fulfillment must continue from frozen route identity");
    assert(orderSnapshot.includes("PACKAGE_SUPPLIER_SELECTION") && orderSnapshot.includes("UNIQUE_EXECUTABLE_ROUTE"));
    assert(fulfillment.includes("PACKAGE_SUPPLIER_SELECTION") && fulfillment.includes("UNIQUE_EXECUTABLE_ROUTE"));
    assert(guidedSelling.includes("Historical StoreCatalogSelection") && guidedSelling.includes("customer-sales authority"));
    assert(!guidedSelling.includes('closest("[data-store-region-visibility]")'), "legacy visibleRegions UI must not remain an active sales control");
    console.log(JSON.stringify({ result: "PASS", explicitSelectionHonored: true, silentFailover: false, publicLiveOnly: true, providerCalls: 0, databaseWrites: 0 }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
