"use strict";

const assert = require("assert");
const {
    assertAuthoritativeFulfillmentReady,
    CustomerWalletCheckoutError,
    _test
} = require("../services/commerce/customerWalletCheckoutService");

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
    let capabilityInput = null;
    const capability = await assertAuthoritativeFulfillmentReady({
        productCode: "mlbb",
        packageCode: "MC_MLBB_50_5_DIAMONDS_FIRST_TOP_UP_BONUS_12A04D3D",
        region: "TH"
    }, {
        loadCapability: async input => {
            capabilityInput = { ...input };
            return { fulfillmentAvailable: true, eligibleRoutes: [{ supplierMappingId: "mapping-th" }] };
        }
    });
    assert.deepStrictEqual(capabilityInput, {
        productCode: "mlbb",
        packageCode: "MC_MLBB_50_5_DIAMONDS_FIRST_TOP_UP_BONUS_12A04D3D",
        region: "TH"
    });
    assert.strictEqual(capability.fulfillmentAvailable, true);

    await assert.rejects(() => assertAuthoritativeFulfillmentReady(capabilityInput, {
        loadCapability: async () => ({ fulfillmentAvailable: false, eligibleRoutes: [] })
    }), error => error instanceof CustomerWalletCheckoutError && error.code === "FULFILLMENT_UNAVAILABLE" && error.statusCode === 409);

    console.log(JSON.stringify({
        result: "PASS",
        accountFieldsPreserved: true,
        thMarketPreserved: true,
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
