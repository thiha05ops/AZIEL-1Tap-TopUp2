const assert = require("assert");
const fs = require("fs/promises");
const path = require("path");

const {
    StorageError,
    cleanupAfterFailedPersistence,
    projectFileUrl,
    uploadFile
} = require("../services/storageService");
const { uploadFileSizeLimit, buildProductionReadiness } = require("../config/security");

const uploadsRoot = path.join(__dirname, "../uploads");

function imageFile(overrides = {}) {
    return {
        buffer: Buffer.from("fake-image-bytes"),
        mimetype: "image/png",
        originalname: "receipt.png",
        size: Buffer.byteLength("fake-image-bytes"),
        ...overrides
    };
}

async function expectStorageError(label, action, code) {
    try {
        await action();
    } catch (error) {
        assert(error instanceof StorageError, `${label}: expected StorageError`);
        assert.strictEqual(error.code, code, `${label}: error code`);
        return error;
    }

    assert.fail(`${label}: expected ${code}`);
}

async function assertFileMissing(reference) {
    const absolutePath = path.join(uploadsRoot, reference.key);

    try {
        await fs.access(absolutePath);
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }

    assert.fail(`Expected upload cleanup for ${reference.key}`);
}

function readiness(overrides = {}) {
    return buildProductionReadiness({
        NODE_ENV: "production",
        MONGO_URI: "mongodb+srv://example.invalid/aziel",
        JWT_SECRET: "0123456789abcdef0123456789abcdef",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef-session",
        ADMIN_USERNAME: "aziel-admin",
        ADMIN_PASSWORD: "StrongAdminPassword123!",
        OMISE_MODE: "live",
        OMISE_PUBLIC_KEY: "pkey_live_placeholder",
        OMISE_SECRET_KEY: "skey_live_placeholder",
        EMAIL_USER: "aziel@example.com",
        EMAIL_PASS: "email-app-password",
        REGISTRATION_OTP_PEPPER: "registration-otp-pepper-production-placeholder",
        TWO_FACTOR_ENCRYPTION_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ALLOWED_ORIGINS: "https://aziel.example.com",
        STORAGE_MODE: "cloudinary",
        CLOUDINARY_CLOUD_NAME: "aziel-test",
        CLOUDINARY_API_KEY: "cloudinary-key",
        CLOUDINARY_API_SECRET: "cloudinary-secret",
        ...overrides
    });
}

function expectReadinessCode(label, overrides, code) {
    const result = readiness(overrides);

    assert.strictEqual(result.ready, false, `${label}: readiness`);
    assert(
        result.errors.some(error => error.code === code),
        `${label}: expected ${code}, got ${result.errors.map(error => error.code).join(", ")}`
    );
}

async function main() {
    const localEnv = {
        NODE_ENV: "development",
        STORAGE_MODE: "local"
    };

    const localEvidence = await uploadFile({
        file: imageFile({ originalname: "../evil.png" }),
        category: "paymentSlip",
        ownerReference: "ORDER-1",
        env: localEnv
    });

    assert.strictEqual(localEvidence.provider, "local");
    assert(localEvidence.key.startsWith("payment-slips/ORDER-1/"));
    assert(!localEvidence.key.includes(".."));
    assert(localEvidence.url.startsWith("/uploads/payment-slips/ORDER-1/"));
    await cleanupAfterFailedPersistence(localEvidence);
    await assertFileMissing(localEvidence);

    await expectStorageError(
        "oversized image",
        () => uploadFile({
            file: imageFile({ size: uploadFileSizeLimit + 1 }),
            category: "paymentSlip",
            ownerReference: "ORDER-2",
            env: localEnv
        }),
        "UPLOAD_FILE_TOO_LARGE"
    );

    await expectStorageError(
        "executable upload",
        () => uploadFile({
            file: imageFile({ mimetype: "application/x-msdownload", originalname: "malware.exe" }),
            category: "paymentSlip",
            ownerReference: "ORDER-3",
            env: localEnv
        }),
        "UPLOAD_TYPE_NOT_ALLOWED"
    );

    const previousFetch = global.fetch;
    global.fetch = async () => ({
        ok: false,
        json: async () => ({ error: { message: "provider failed" } })
    });

    await expectStorageError(
        "cloudinary provider failure",
        () => uploadFile({
            file: imageFile(),
            category: "walletSlip",
            ownerReference: "TOPUP-1",
            env: {
                NODE_ENV: "production",
                STORAGE_MODE: "cloudinary",
                CLOUDINARY_CLOUD_NAME: "aziel-test",
                CLOUDINARY_API_KEY: "cloudinary-key",
                CLOUDINARY_API_SECRET: "cloudinary-secret"
            }
        }),
        "UPLOAD_STORAGE_UNAVAILABLE"
    );

    global.fetch = previousFetch;

    const walletEvidence = await uploadFile({
        file: imageFile(),
        category: "walletSlip",
        ownerReference: "TOPUP-2",
        env: localEnv
    });
    const walletTopup = {
        topupId: "TOPUP-2",
        status: "pending",
        amount: 100,
        paymentSlip: walletEvidence.url,
        paymentEvidence: walletEvidence
    };
    assert.strictEqual(walletTopup.status, "pending");
    assert.strictEqual(walletTopup.amount, 100);
    await cleanupAfterFailedPersistence(walletEvidence);
    await assertFileMissing(walletEvidence);

    const supportEvidence = await uploadFile({
        file: imageFile(),
        category: "supportEvidence",
        ownerReference: "SUP-1",
        env: localEnv
    });
    const supportTicket = {
        ticketId: "SUP-1",
        screenshot: supportEvidence.url,
        screenshotEvidence: supportEvidence
    };
    assert(supportTicket.screenshot.startsWith("/uploads/support/SUP-1/"));
    await cleanupAfterFailedPersistence(supportEvidence);
    await assertFileMissing(supportEvidence);

    const orderEvidence = await uploadFile({
        file: imageFile(),
        category: "paymentSlip",
        ownerReference: "ORDER-4",
        env: localEnv
    });
    const order = {
        orderId: "ORDER-4",
        paymentStatus: "pending",
        paymentSlip: orderEvidence.url,
        paymentEvidence: orderEvidence
    };
    assert.strictEqual(order.paymentStatus, "pending");
    await cleanupAfterFailedPersistence(orderEvidence);
    await assertFileMissing(orderEvidence);

    assert.strictEqual(projectFileUrl("SLIP-1.png", "orders"), "/uploads/orders/SLIP-1.png");
    assert.strictEqual(projectFileUrl("/uploads/orders/SLIP-2.png", "orders"), "/uploads/orders/SLIP-2.png");
    assert.strictEqual(projectFileUrl("https://cdn.example.com/slip.png", "orders"), "https://cdn.example.com/slip.png");

    expectReadinessCode("production local storage", { STORAGE_MODE: "local" }, "PROD_STORAGE_LOCAL_UNSAFE");
    expectReadinessCode("incomplete Cloudinary config", { CLOUDINARY_API_SECRET: "" }, "PROD_STORAGE_CLOUDINARY_CONFIG_MISSING");

    console.log("Storage verification checks passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
