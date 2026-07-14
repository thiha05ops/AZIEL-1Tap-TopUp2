const assert = require("assert");
const fs = require("fs");
const path = require("path");

const MediaAsset = require("../models/MediaAsset");
const {
    MEDIA_CATEGORIES,
    MediaError,
    createAsset,
    projectMediaAsset,
    projectPublicMediaAsset
} = require("../services/mediaService");

async function verifyServiceContract() {
    const fakeReference = {
        provider: "local",
        key: "media-assets/product_image/test.webp",
        url: "/uploads/media-assets/product_image/test.webp",
        mimeType: "image/webp",
        size: 12345,
        originalName: "test.webp"
    };
    let uploaded = false;
    let cleaned = false;

    const asset = await createAsset({
        file: {
            mimetype: "image/webp",
            size: 12345,
            originalname: "test.webp",
            buffer: Buffer.from("test")
        },
        name: "MLBB Poster",
        category: "product_image",
        altText: "MLBB poster",
        actor: "qa",
        deps: {
            uploadFile: async payload => {
                uploaded = payload.category === "mediaAsset" && payload.ownerReference === "product_image";
                return fakeReference;
            },
            createMediaAsset: async payload => ({
                ...payload,
                createdAt: new Date("2026-07-14T00:00:00.000Z"),
                updatedAt: new Date("2026-07-14T00:00:00.000Z")
            }),
            cleanupAfterFailedPersistence: async () => {
                cleaned = true;
            }
        }
    });

    assert.strictEqual(uploaded, true, "media uploads must use the shared mediaAsset storage category");
    assert.strictEqual(cleaned, false, "successful media persistence must not trigger cleanup");
    assert.strictEqual(asset.category, "product_image");
    assert.strictEqual(asset.secureUrl, fakeReference.url);
    assert.strictEqual(asset.storageProvider, undefined, "admin projection must not expose storage provider");

    await assert.rejects(
        () => createAsset({
            file: { mimetype: "image/webp", size: 1, originalname: "x.webp", buffer: Buffer.from("x") },
            category: "payment_qr",
            deps: {
                uploadFile: async () => fakeReference,
                createMediaAsset: async payload => payload
            }
        }),
        error => error instanceof MediaError && error.code === "MEDIA_CATEGORY_INVALID"
    );
}

function verifyModelMetadataOnly() {
    const schemaPaths = Object.keys(MediaAsset.schema.paths);
    ["buffer", "data", "binary", "file"].forEach(forbidden => {
        assert.ok(!schemaPaths.includes(forbidden), `MediaAsset must not store ${forbidden}`);
    });
}

function verifyRouteProtection() {
    const routeFile = fs.readFileSync(path.join(__dirname, "../routes/catalog.js"), "utf8");
    [
        'router.get("/admin/media", adminMiddleware',
        'router.post("/admin/media", adminMiddleware, upload.single("file")',
        'router.get("/admin/media/:assetId", adminMiddleware',
        'router.delete("/admin/media/:assetId", adminMiddleware',
        'router.patch("/admin/catalog/products/:productCode/presentation/image", adminMiddleware',
        'router.patch("/admin/catalog/products/:productCode/packages/:packageCode/presentation/icon", adminMiddleware'
    ].forEach(fragment => {
        assert.ok(routeFile.includes(fragment), `Missing protected route: ${fragment}`);
    });
}

function verifyProjectionSafety() {
    const full = projectMediaAsset({
        assetId: "media_test",
        name: "Asset",
        category: "product_image",
        altText: "Alt",
        secureUrl: "https://cdn.example.com/a.webp",
        storageProvider: "cloudinary",
        storageKey: "secret/public-id",
        mimeType: "image/webp",
        sizeBytes: 42,
        status: "active"
    });
    const safe = projectPublicMediaAsset({
        ...full,
        status: "active",
        storageProvider: "cloudinary",
        storageKey: "secret/public-id"
    });

    assert.strictEqual(full.storageProvider, undefined, "admin asset projection must omit storageProvider");
    assert.strictEqual(full.storageKey, undefined, "admin asset projection must omit storageKey");
    assert.strictEqual(safe.url, "https://cdn.example.com/a.webp");
    assert.strictEqual(safe.storageKey, undefined, "public asset projection must omit storageKey");
}

async function main() {
    assert.ok(MEDIA_CATEGORIES.includes("product_image"));
    assert.ok(MEDIA_CATEGORIES.includes("package_icon"));
    verifyModelMetadataOnly();
    verifyRouteProtection();
    verifyProjectionSafety();
    await verifyServiceContract();
    console.log("verify-admin-media-library: ok");
}

main().catch(error => {
    console.error("verify-admin-media-library: failed");
    console.error(error);
    process.exit(1);
});
