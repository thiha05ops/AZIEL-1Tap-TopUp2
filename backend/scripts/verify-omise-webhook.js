const assert = require("assert");

const {
    OmisePaymentError,
    assertChargeMatchesRecord,
    retrieveVerifiedCharge
} = require("../services/omisePaymentService");

function mockClient(chargesById = {}, failureById = {}) {
    return {
        charges: {
            async retrieve(chargeId) {
                if (failureById[chargeId]) throw failureById[chargeId];
                if (!chargesById[chargeId]) {
                    const error = new Error("not found");
                    error.statusCode = 404;
                    throw error;
                }
                return chargesById[chargeId];
            }
        }
    };
}

function charge(overrides = {}) {
    return {
        id: "chrg_test_verified",
        status: "successful",
        paid: true,
        amount: 149000,
        currency: "THB",
        livemode: false,
        metadata: {
            type: "game_order",
            orderId: "AZL-ORDER-1",
            username: "tester"
        },
        updated_at: "2026-07-13T00:00:00Z",
        ...overrides
    };
}

function order(overrides = {}) {
    return {
        orderId: "AZL-ORDER-1",
        transactionId: "chrg_test_verified",
        amount: 1490,
        currency: "THB",
        status: "pending_payment",
        paymentStatus: "pending",
        processedPaymentEvents: [],
        ...overrides
    };
}

function topup(overrides = {}) {
    return {
        topupId: "WALLET-1",
        transactionId: "chrg_test_wallet",
        amount: 500,
        currency: "THB",
        status: "pending",
        ...overrides
    };
}

async function getVerified(rawCharge, options = {}) {
    return retrieveVerifiedCharge(rawCharge.id, {
        client: mockClient({ [rawCharge.id]: rawCharge }),
        mode: options.mode || "test"
    });
}

async function expectOmiseError(label, fn, code) {
    try {
        await fn();
    } catch (error) {
        assert(error instanceof OmisePaymentError, `${label}: expected OmisePaymentError`);
        assert.strictEqual(error.code, code, `${label}: error code`);
        return;
    }

    throw new Error(`${label}: expected ${code}`);
}

function applyMockOrderPayment(record, verifiedCharge) {
    assertChargeMatchesRecord(verifiedCharge, record, { referenceType: "order" });

    const eventId = `omise:${verifiedCharge.chargeId}:${verifiedCharge.status}:${verifiedCharge.providerUpdatedAt || "verified"}`;

    if (record.processedPaymentEvents.includes(eventId)) {
        return { changed: false, duplicate: true };
    }

    record.status = "paid";
    record.paymentStatus = "paid";
    record.processedPaymentEvents.push(eventId);
    return { changed: true, duplicate: false };
}

function applyMockWalletTopup(record, verifiedCharge, wallet) {
    assertChargeMatchesRecord(verifiedCharge, record, { referenceType: "wallet_topup" });

    const key = `wallet:topup:${record.topupId}:credit`;

    if (wallet.processed.has(key)) {
        return { credited: false, duplicate: true };
    }

    wallet.processed.add(key);
    wallet.balance += Number(record.amount);
    record.status = "paid";
    return { credited: true, duplicate: false };
}

async function main() {
    await expectOmiseError(
        "nonexistent charge",
        () => retrieveVerifiedCharge("chrg_test_missing", {
            client: mockClient(),
            mode: "test"
        }),
        "OMISE_CHARGE_NOT_FOUND"
    );

    await expectOmiseError(
        "provider says not successful",
        async () => {
            const verified = await getVerified(charge({ status: "pending", paid: false }));
            assertChargeMatchesRecord(verified, order(), { referenceType: "order" });
        },
        "OMISE_CHARGE_NOT_PAID"
    );

    await expectOmiseError(
        "amount mismatch",
        async () => {
            const verified = await getVerified(charge({ amount: 100 }));
            assertChargeMatchesRecord(verified, order(), { referenceType: "order" });
        },
        "OMISE_AMOUNT_MISMATCH"
    );

    await expectOmiseError(
        "currency mismatch",
        async () => {
            const verified = await getVerified(charge({ currency: "MMK" }));
            assertChargeMatchesRecord(verified, order(), { referenceType: "order" });
        },
        "OMISE_CURRENCY_MISMATCH"
    );

    await expectOmiseError(
        "charge id mismatch",
        () => retrieveVerifiedCharge("chrg_test_verified", {
            client: mockClient({
                chrg_test_verified: charge({ id: "chrg_test_other" })
            }),
            mode: "test"
        }),
        "OMISE_CHARGE_ID_MISMATCH"
    );

    await expectOmiseError(
        "metadata order mismatch",
        async () => {
            const verified = await getVerified(charge({
                metadata: {
                    type: "game_order",
                    orderId: "AZL-OTHER"
                }
            }));
            assertChargeMatchesRecord(verified, order(), { referenceType: "order" });
        },
        "OMISE_METADATA_MISMATCH"
    );

    const verifiedOrderCharge = await getVerified(charge());
    const mockOrder = order();
    const firstOrderApply = applyMockOrderPayment(mockOrder, verifiedOrderCharge);
    const secondOrderApply = applyMockOrderPayment(mockOrder, verifiedOrderCharge);

    assert.deepStrictEqual(firstOrderApply, { changed: true, duplicate: false });
    assert.deepStrictEqual(secondOrderApply, { changed: false, duplicate: true });
    assert.strictEqual(mockOrder.status, "paid");
    assert.strictEqual(mockOrder.processedPaymentEvents.length, 1);

    const verifiedTopupCharge = await getVerified(charge({
        id: "chrg_test_wallet",
        amount: 50000,
        metadata: {
            type: "wallet_topup",
            topupId: "WALLET-1",
            username: "tester"
        }
    }));
    const mockTopup = topup();
    const wallet = {
        balance: 0,
        processed: new Set()
    };
    const firstTopupApply = applyMockWalletTopup(mockTopup, verifiedTopupCharge, wallet);
    const secondTopupApply = applyMockWalletTopup(mockTopup, verifiedTopupCharge, wallet);

    assert.deepStrictEqual(firstTopupApply, { credited: true, duplicate: false });
    assert.deepStrictEqual(secondTopupApply, { credited: false, duplicate: true });
    assert.strictEqual(wallet.balance, 500);

    const tempFailure = new Error("temporary provider failure");
    tempFailure.statusCode = 503;
    await expectOmiseError(
        "provider temporary failure",
        () => retrieveVerifiedCharge("chrg_test_temp", {
            client: mockClient({}, { chrg_test_temp: tempFailure }),
            mode: "test"
        }),
        "OMISE_PROVIDER_UNAVAILABLE"
    );

    await expectOmiseError(
        "live test mode mismatch",
        async () => {
            const verified = await getVerified(charge(), { mode: "live" });
            assertChargeMatchesRecord(verified, order(), { referenceType: "order" });
        },
        "OMISE_MODE_MISMATCH"
    );

    console.log("Omise webhook verification checks passed.");
}

main().catch(error => {
    console.error("Omise webhook verification failed:", error.message);
    process.exitCode = 1;
});
