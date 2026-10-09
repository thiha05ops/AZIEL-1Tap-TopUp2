"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    isPaidFulfillmentRecoveryEnabled,
    startPaidFulfillmentBackgroundRecovery
} = require("../server");

const ROOT = path.join(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

async function main() {
    assert.strictEqual(isPaidFulfillmentRecoveryEnabled({}), false, "Recovery must be disabled by default.");
    assert.strictEqual(isPaidFulfillmentRecoveryEnabled({ PAID_FULFILLMENT_RECOVERY_ENABLED: "false" }), false);
    assert.strictEqual(isPaidFulfillmentRecoveryEnabled({ PAID_FULFILLMENT_RECOVERY_ENABLED: "1" }), false);
    assert.strictEqual(isPaidFulfillmentRecoveryEnabled({ PAID_FULFILLMENT_RECOVERY_ENABLED: " true " }), true, "Only explicit true enables recovery.");

    let disabledRecoveries = 0;
    let disabledSchedules = 0;
    let disabledRegistrations = 0;
    const disabled = startPaidFulfillmentBackgroundRecovery({
        env: {},
        recover: async () => { disabledRecoveries += 1; },
        setInterval: () => { disabledSchedules += 1; return {}; },
        registerTimer: () => { disabledRegistrations += 1; }
    });
    assert.deepStrictEqual(disabled, { enabled: false, initialRun: null, timer: null });
    assert.strictEqual(disabledRecoveries, 0, "OFF must not query or claim recovery handoffs.");
    assert.strictEqual(disabledSchedules, 0, "OFF must not schedule interval recovery.");
    assert.strictEqual(disabledRegistrations, 0, "OFF must not register a recovery timer.");

    let enabledRecoveries = 0;
    let scheduledCallback = null;
    let scheduledDelay = 0;
    let unrefs = 0;
    let registrations = 0;
    const timer = { unref() { unrefs += 1; } };
    const enabled = startPaidFulfillmentBackgroundRecovery({
        env: {
            PAID_FULFILLMENT_RECOVERY_ENABLED: "true",
            PAID_FULFILLMENT_RECOVERY_BATCH_SIZE: "7",
            PAID_FULFILLMENT_RECOVERY_INTERVAL_MS: "60000"
        },
        recover: async input => { enabledRecoveries += 1; assert.deepStrictEqual(input, { limit: 7 }); return { processed: 0 }; },
        setInterval: (callback, delay) => { scheduledCallback = callback; scheduledDelay = delay; return timer; },
        registerTimer: value => { registrations += 1; assert.strictEqual(value, timer); }
    });
    assert.strictEqual(enabled.enabled, true);
    await enabled.initialRun;
    assert.strictEqual(enabledRecoveries, 1, "ON must perform one startup recovery.");
    assert.strictEqual(scheduledDelay, 60000);
    assert.strictEqual(unrefs, 1);
    assert.strictEqual(registrations, 1);
    await scheduledCallback();
    assert.strictEqual(enabledRecoveries, 2, "ON must permit scheduled recovery.");

    const serverSource = read("backend/server.js");
    const walletSource = read("backend/services/commerce/customerWalletCheckoutService.js");
    const providerSource = read("backend/services/commerce/manualPaymentApplicationService.js");
    const handoffSource = read("backend/services/paidFulfillmentHandoffService.js");
    assert(serverSource.includes("startPaidFulfillmentBackgroundRecovery();"), "Server startup must use the fail-closed recovery wrapper.");
    assert(walletSource.includes("processHandoff(orderId)"), "Wallet paid settlement must retain immediate handoff processing.");
    assert(providerSource.includes("processPaidFulfillmentHandoff(order.orderId)"), "Verified provider settlement must retain immediate handoff processing.");
    assert(!handoffSource.includes("seedMissing") && !handoffSource.includes("repos.ensure"), "Historical paid orders without paidHandoff must remain excluded.");

    console.log(JSON.stringify({
        result: "PASS",
        recoveryDefaultEnabled: false,
        explicitTrueRequired: true,
        disabledStartupRecoveries: disabledRecoveries,
        disabledIntervalSchedules: disabledSchedules,
        enabledStartupRecoveries: 1,
        enabledIntervalRecoveries: 1,
        immediateWalletHandoffPreserved: true,
        immediateProviderHandoffPreserved: true,
        historicalSeeding: false,
        providerCalls: 0,
        walletOperations: 0,
        productionWrites: 0
    }, null, 2));
}

main().catch(error => {
    console.error("VERIFY_PAID_FULFILLMENT_RECOVERY_SWITCH_FAILED:", error.stack || error);
    process.exitCode = 1;
});
