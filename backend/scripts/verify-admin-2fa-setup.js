const assert = require("assert");

process.env.NODE_ENV = "test";
process.env.TWO_FACTOR_ENCRYPTION_KEY = process.env.TWO_FACTOR_ENCRYPTION_KEY ||
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const AdminAccount = require("../models/AdminAccount");
const AdminAuditLog = require("../models/AdminAuditLog");

AdminAuditLog.create = async payload => ({ _id: "audit-1", ...payload });

const {
    startAdmin2FASetup,
    verifyAdmin2FASetup
} = require("../services/adminAuthService");
const {
    decryptSecret,
    generateTotpTokenForSmokeTest
} = require("../services/twoFactorService");

function makeAccount(overrides = {}) {
    return {
        _id: "507f191e810c19729de860ea",
        username: "owner",
        displayName: "Owner",
        role: "OWNER",
        status: "ACTIVE",
        permissions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        twoFactor: {
            enabled: false,
            secretEncrypted: "",
            pendingSecretEncrypted: "",
            pendingExpiresAt: null,
            enabledAt: null,
            ...(overrides.twoFactor || {})
        },
        saveCount: 0,
        async save() {
            this.saveCount += 1;
            return this;
        },
        toObject() {
            return {
                _id: this._id,
                username: this.username,
                displayName: this.displayName,
                role: this.role,
                status: this.status,
                twoFactor: { ...this.twoFactor },
                createdAt: this.createdAt,
                updatedAt: this.updatedAt
            };
        }
    };
}

async function assertRejectsInvalid(fn, label) {
    await assert.rejects(
        fn,
        error => error?.code === "ADMIN_2FA_INVALID",
        label
    );
}

async function run() {
    let account = makeAccount();
    AdminAccount.findById = async () => account;

    const firstSetup = await startAdmin2FASetup({ id: account._id });
    assert(firstSetup.manualKey, "setup must return a manual key");
    assert(firstSetup.provisioningUri.includes(`secret=${encodeURIComponent(firstSetup.manualKey)}`), "QR URI must encode the generated manual key");
    assert(account.twoFactor.pendingSecretEncrypted, "setup must persist encrypted pending secret");
    assert(account.twoFactor.pendingExpiresAt > new Date(), "setup must persist a future pending expiry");
    assert.strictEqual(decryptSecret(account.twoFactor.pendingSecretEncrypted), firstSetup.manualKey, "encrypted pending secret must round-trip exactly");

    const secondSetup = await startAdmin2FASetup({ id: account._id });
    assert.strictEqual(secondSetup.manualKey, firstSetup.manualKey, "active setup calls must reuse the same pending secret");
    assert.strictEqual(account.saveCount, 1, "duplicate active setup must not rotate or resave the pending secret");

    await assertRejectsInvalid(
        () => verifyAdmin2FASetup({ id: account._id, username: account.username }, "000000", {}),
        "invalid setup code must be rejected"
    );
    assert.strictEqual(account.twoFactor.enabled, false, "invalid code must not enable 2FA");
    assert(account.twoFactor.pendingSecretEncrypted, "invalid code must preserve pending setup for retry");

    account = makeAccount({
        twoFactor: {
            pendingSecretEncrypted: account.twoFactor.pendingSecretEncrypted,
            pendingExpiresAt: new Date(Date.now() - 1000)
        }
    });
    const expiredCode = await generateTotpTokenForSmokeTest(firstSetup.manualKey);
    await assertRejectsInvalid(
        () => verifyAdmin2FASetup({ id: account._id, username: account.username }, expiredCode, {}),
        "expired setup must be rejected"
    );

    account = makeAccount();
    const setup = await startAdmin2FASetup({ id: account._id });
    const validCode = await generateTotpTokenForSmokeTest(setup.manualKey);
    const projected = await verifyAdmin2FASetup({ id: account._id, username: account.username }, validCode, {});
    assert.strictEqual(projected.twoFactorEnabled, true, "valid setup code must enable 2FA");
    assert.strictEqual(account.twoFactor.enabled, true, "account must be marked 2FA enabled");
    assert.strictEqual(account.twoFactor.pendingSecretEncrypted, "", "successful setup must clear pending secret");
    assert.strictEqual(account.twoFactor.pendingExpiresAt, null, "successful setup must clear pending expiry");
    assert.strictEqual(decryptSecret(account.twoFactor.secretEncrypted), setup.manualKey, "enabled secret must equal setup secret");

    await assertRejectsInvalid(
        () => verifyAdmin2FASetup({ id: account._id, username: account.username }, validCode, {}),
        "successful setup must not be reusable"
    );
}

run()
    .then(() => {
        console.log("Admin 2FA setup verifier passed.");
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
