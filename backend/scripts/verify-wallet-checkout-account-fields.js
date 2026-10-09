"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    _test
} = require("../services/commerce/customerWalletCheckoutService");
const { createRoutingAuthority } = require("../services/supplierProductionSelectionService");

async function main() {
    const accountFields = [
        { key: "playerId", label: "Player ID", value: "439488505" },
        { key: "serverId", label: "Server ID", value: "2409" }
    ];
    const gameAccount = _test.walletGameAccount({
        userId: "439488505",
        zoneId: "-",
        accountFields
    });
    assert.deepStrictEqual(gameAccount, {
        userId: "439488505",
        zoneId: "-",
        accountFields
    }, "Wallet checkout must preserve production-shaped MLBB supplier account fields exactly.");
    const source = fs.readFileSync(path.join(__dirname, "../services/commerce/customerWalletCheckoutService.js"), "utf8");
    assert(!source.includes("loadFulfillmentCapability"), "Wallet must not apply the obsolete legacy fulfillment-capability precheck.");
    assert(!source.includes("assertAuthoritativeFulfillmentReady"), "Wallet must not reject an executable selected route through legacy readiness metadata.");
    assert(source.includes("findCatalogPackageByIdentity"), "Canonical package lookup must remain.");
    assert(source.includes("pkg?.prices?.[region]"), "Market-specific published price validation must remain.");
    assert(source.includes("resolveCheckoutRouteSnapshot"), "Wallet checkout must retain authoritative selected-route resolution.");
    assert(source.indexOf("checkoutFromQuote({") < source.indexOf("dependencies.debitWallet || debitWallet"), "Wallet debit must remain after authoritative checkout and frozen-route creation.");

    const request = { productCode: "mlbb-twilight-weekly-pass", packageCode: "MLBB-WEEKLY.PASS", region: "TH" };
    const selectedMapping = { _id: "mapping-fazer", mappingMetadata: { readiness: { pricingReady: false } } };
    let received = null;
    const validRoute = createRoutingAuthority({ selectedResolver: async input => {
        received = { ...input };
        assert.strictEqual(selectedMapping.mappingMetadata.readiness.pricingReady, false);
        return { ready: true, blockers: [], routeSnapshot: { supplierMappingId: selectedMapping._id, supplierCode: "FAZERCARDS" } };
    } });
    const selected = await validRoute(request);
    assert.deepStrictEqual(received, request, "Wallet route authority must preserve the exact product, package and TH market.");
    assert.strictEqual(selected.ready, true, "An authoritative selected route remains executable regardless of obsolete pricingReady metadata.");

    const unavailableRoute = createRoutingAuthority({ selectedResolver: async () => ({ ready: false, blockers: ["SUPPLIER_AVAILABILITY_NOT_CONFIRMED"], routeSnapshot: null }) });
    const blocked = await unavailableRoute(request);
    assert.strictEqual(blocked.ready, false);
    assert.deepStrictEqual(blocked.blockers, ["SUPPLIER_AVAILABILITY_NOT_CONFIRMED"], "Genuinely unavailable routes must continue to fail closed.");

    console.log(JSON.stringify({
        result: "PASS",
        accountFieldsPreserved: true,
        selectedRouteAuthorityPreserved: true,
        obsoletePricingReadinessPrecheckRemoved: true,
        unavailableRoutesFailClosed: true,
        walletDebits: 0,
        productionWrites: 0,
        providerCalls: 0
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
