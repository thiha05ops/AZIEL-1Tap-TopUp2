"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const MediaAsset = require("../models/MediaAsset");
const SitePlacement = require("../models/SitePlacement");
const {
    CANONICAL_OPERATIONAL_PRODUCTS,
    CANONICAL_PRODUCT_CODES,
    resolveCanonicalProductRoute
} = require("../catalog/canonicalOperationalCatalog");
const { createPackage, updateProduct } = require("../services/catalogAdminService");
const { setProductPresentationAsset } = require("../services/catalogPresentationService");
const {
    resolveAdminCatalogProduct,
    resolvePackagePrice,
    toPublicCatalog
} = require("../services/catalogService");
const { loadCatalogPackage: loadCommercePreviewPackage } = require("../services/commerce/commercePricingPreviewService");
const { resolveHomePlacements, updateAdminPlacement } = require("../services/sitePlacementService");

const ROOT = path.resolve(__dirname, "../..");
const PRODUCT_CODE = "capcut";
const PACKAGE_CODE = "ADMIN_COMPLETENESS_MM";
const ASSET_ID = "admin-completeness-product-image";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function verifySourceAuthority() {
    assert.strictEqual(new Set(CANONICAL_PRODUCT_CODES).size, CANONICAL_PRODUCT_CODES.length, "Canonical identities must be unique.");
    const routes = read("backend/routes/catalog.js");
    const admin = read("frontend/js/admin-catalog.js");
    const service = read("backend/services/catalogAdminService.js");
    assert(routes.includes("CANONICAL_OPERATIONAL_PRODUCTS.map"));
    assert(routes.includes("resolveAdminCatalogProduct(canonical.productCode"));
    assert(routes.includes("commerceReadiness") && routes.includes("publicReadiness") && routes.includes("publicState"));
    assert(routes.includes("fulfillment: product.fulfillment"), "Admin DTO must project manual fulfillment configuration.");
    assert(admin.includes("catalogProductManualMM") && admin.includes("catalogProductManualTH"), "Admin must expose bounded manual-fulfillment region controls.");
    assert(admin.includes("publicState === \"AVAILABLE\"") && admin.includes("Needs Setup"), "Admin list must distinguish enabled from purchasable.");
    assert(service.includes('"fulfillment.manualAllowedRegions"'), "Admin product writes must persist manual fulfillment regions.");
    assert(!routes.includes('router.post("/admin/catalog/products"'), "Closed registry must not expose arbitrary product creation.");
}

function configuredMongoUri({ isolated = false } = {}) {
    require("dotenv").config({ quiet: true });
    const configured = String(process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
    if (!configured) throw new Error("MONGO_URI is required.");
    if (!isolated) return configured;
    const parsed = new URL(configured);
    parsed.pathname = "/aziel_e2e_admin_catalog_completeness";
    const uri = parsed.toString();
    if (!uri.includes("/aziel_e2e_admin_catalog_completeness")) throw new Error("Completeness verifier refused a non-isolated write database URI.");
    return uri;
}

function priceConfigured(product = {}) {
    return (product.packages || []).some(pkg => Object.values(pkg.prices || {}).some(price => price?.enabled !== false && Number(price?.amount) > 0));
}

async function canonicalMatrix() {
    const rawCodes = new Set((await CatalogProduct.find({ productCode: { $in: CANONICAL_PRODUCT_CODES } }).select("productCode").lean()).map(item => item.productCode));
    const rows = [];
    for (const canonical of CANONICAL_OPERATIONAL_PRODUCTS) {
        const product = await resolveAdminCatalogProduct(canonical.productCode, {
            includeAssetProjection: false,
            includeAdminPricing: false
        });
        rows.push({
            productCode: canonical.productCode,
            family: canonical.family,
            group: canonical.adminCategory,
            route: resolveCanonicalProductRoute(canonical.productCode),
            page: resolveCanonicalProductRoute(canonical.productCode).startsWith("product.html?") ? "generic" : "dedicated",
            mongoExists: rawCodes.has(canonical.productCode),
            adminVisible: Boolean(product),
            editable: true,
            enabled: product?.enabled !== false,
            category: product?.catalogCategory || canonical.catalogCategory,
            supportedRegions: product?.supportedRegions || [],
            discovery: product?.publicDiscoveryEnabled === true,
            homepage: product?.homepageEnabled === true,
            commerceState: product?.commerceState || "HIDDEN",
            packageCount: Number(product?.packageCount || 0),
            enabledPackageCount: (product?.packages || []).filter(pkg => pkg.enabled !== false && !pkg.deletedAt).length,
            pricingConfigured: priceConfigured(product),
            fulfillmentConfigured: product?.commerceReadiness?.checks?.fulfillment === true,
            presentationConfigured: Boolean(product?.imageUrl || product?.artworkPath || product?.imageAsset),
            publicState: product?.publicState || "HIDDEN",
            blockers: product?.publicReadiness?.blockers || [],
            missing: product?.commerceReadiness?.missing || [],
            metadataRecordMissing: product?.metadataRecordMissing === true
        });
    }
    assert.strictEqual(rows.length, CANONICAL_PRODUCT_CODES.length);
    assert.strictEqual(new Set(rows.map(row => row.productCode)).size, rows.length);
    assert(rows.every(row => row.adminVisible), "Every canonical identity must appear exactly once in Admin projection.");
    return rows;
}

async function expectCode(promise, code) {
    await assert.rejects(promise, error => error?.code === code, `Expected ${code}.`);
}

async function publicProduct() {
    return (await toPublicCatalog({ source: "database", includeDisabled: false })).find(product => product.productCode === PRODUCT_CODE) || null;
}

async function patchFixture(patch) {
    const product = await CatalogProduct.findOne({ productCode: PRODUCT_CODE });
    return updateProduct({
        productCode: PRODUCT_CODE,
        patch: { ...patch, ...(product ? { expectedUpdatedAt: product.updatedAt } : {}) },
        actor: "isolated-admin-completeness-verifier"
    });
}

async function verifyIsolatedLifecycle() {
    await mongoose.connect(configuredMongoUri({ isolated: true }));
    try {
        await SitePlacement.deleteMany({ placementCode: "HOME_POPULAR_GAMES" });
        await CatalogPackage.deleteMany({ productCode: { $in: [PRODUCT_CODE, "mlbb"] } });
        await CatalogProduct.deleteMany({ productCode: { $in: [PRODUCT_CODE, "mlbb", "authoritynoncanonicalfixture"] } });
        await MediaAsset.deleteMany({ assetId: ASSET_ID });

        await CatalogProduct.create({
            productCode: "mlbb",
            name: "Existing Canonical Control",
            enabled: false,
            catalogCategory: "MOBILE_GAME_TOPUP",
            commerceState: "HIDDEN",
            publicDiscoveryEnabled: false,
            supportedRegions: ["MM"],
            source: "admin"
        });
        const controlBefore = JSON.stringify(await CatalogProduct.findOne({ productCode: "mlbb" }).lean());

        let adminProduct = await resolveAdminCatalogProduct(PRODUCT_CODE);
        assert(adminProduct && adminProduct.metadataRecordMissing === true, "Missing canonical record must remain Admin-manageable.");
        assert.strictEqual(adminProduct.publicState, "HIDDEN");
        assert.strictEqual(await publicProduct(), null);
        await expectCode(resolvePackagePrice({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE, region: "MM" }, { source: "database" }), "PRODUCT_NOT_FOUND");

        await patchFixture({
            name: "CapCut Isolated Admin Lifecycle",
            description: "Admin-configured canonical lifecycle fixture with safe staged publication.",
            enabled: false,
            catalogCategory: "DIGITAL_SERVICE",
            supportedRegions: ["MM"],
            manualAllowedRegions: ["MM"],
            commerceState: "HIDDEN",
            publicDiscoveryEnabled: false,
            homepageEnabled: true
        });
        let stored = await CatalogProduct.findOne({ productCode: PRODUCT_CODE }).lean();
        assert(stored && stored.metadata?.initializedFromCanonical === true);
        assert.deepStrictEqual(stored.fulfillment.manualAllowedRegions, ["MM"]);
        assert.strictEqual(await publicProduct(), null);

        await createPackage({
            productCode: PRODUCT_CODE,
            patch: {
                packageCode: PACKAGE_CODE,
                name: "CapCut Isolated MM Package",
                enabled: true,
                prices: { MM: { enabled: true, amount: 1000 } }
            },
            actor: "isolated-admin-completeness-verifier"
        });
        assert.strictEqual(await publicProduct(), null, "Package creation must not publish a hidden product.");

        await MediaAsset.create({
            assetId: ASSET_ID,
            name: "Admin Completeness Fixture",
            category: "product_image",
            url: "/assets/fallbacks/digital-services.svg",
            mimeType: "image/svg+xml",
            status: "active",
            uploadedBy: "isolated-admin-completeness-verifier"
        });
        stored = await CatalogProduct.findOne({ productCode: PRODUCT_CODE }).lean();
        await setProductPresentationAsset({
            productCode: PRODUCT_CODE,
            assetId: ASSET_ID,
            expectedUpdatedAt: new Date(stored.updatedAt).toISOString(),
            actor: "isolated-admin-completeness-verifier"
        });
        assert.strictEqual(await publicProduct(), null);

        await patchFixture({ enabled: true });
        assert.strictEqual(await publicProduct(), null, "Enabled alone must not mean public.");
        await patchFixture({ commerceState: "PURCHASABLE", publicDiscoveryEnabled: true });
        let publicReady = await publicProduct();
        assert(publicReady && publicReady.publicState === "AVAILABLE");
        assert.strictEqual(publicReady.publicCategory, "social");
        assert.strictEqual(publicReady.productRoute, "product.html?product=capcut");
        assert.strictEqual(publicReady.packages[0].prices.TH, undefined, "Product Region Authority must remain intact.");

        const previewCatalog = await loadCommercePreviewPackage({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE, region: "MM", currency: "MMK" });
        assert.strictEqual(previewCatalog.productCode, PRODUCT_CODE);
        const commerceCatalog = await resolvePackagePrice({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE, region: "MM" }, { source: "database" });
        assert.strictEqual(commerceCatalog.amount, 1000);
        await expectCode(resolvePackagePrice({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE, region: "TH" }, { source: "database" }), "REGION_NOT_SUPPORTED");

        await patchFixture({ catalogCategory: "MOBILE_GAME_TOPUP" });
        publicReady = await publicProduct();
        assert.strictEqual(publicReady.publicCategory, "mobile");
        assert.strictEqual(publicReady.productRoute, "product.html?product=capcut");
        await updateAdminPlacement("HOME_POPULAR_GAMES", { managed: true, items: [{ productCode: PRODUCT_CODE }] }, "isolated-admin-completeness-verifier");
        assert((await resolveHomePlacements({ region: "MM" })).placements.HOME_POPULAR_GAMES.items.some(product => product.productCode === PRODUCT_CODE));

        await patchFixture({ enabled: false });
        assert.strictEqual(await publicProduct(), null);
        assert(!(await resolveHomePlacements({ region: "MM" })).placements.HOME_POPULAR_GAMES.items.some(product => product.productCode === PRODUCT_CODE));
        await expectCode(loadCommercePreviewPackage({ productCode: PRODUCT_CODE, packageCode: PACKAGE_CODE, region: "MM", currency: "MMK" }), "PRODUCT_UNAVAILABLE");

        const controlAfter = JSON.stringify(await CatalogProduct.findOne({ productCode: "mlbb" }).lean());
        assert.strictEqual(controlAfter, controlBefore, "Existing configured canonical control must remain unchanged.");
        assert(!(await toPublicCatalog({ source: "database", includeDisabled: true })).some(product => product.productCode === "authoritynoncanonicalfixture"));
        console.log("Isolated Admin Catalog completeness lifecycle verification passed.");
    } finally {
        await SitePlacement.deleteMany({ placementCode: "HOME_POPULAR_GAMES" });
        await CatalogPackage.deleteMany({ productCode: { $in: [PRODUCT_CODE, "mlbb"] } });
        await CatalogProduct.deleteMany({ productCode: { $in: [PRODUCT_CODE, "mlbb", "authoritynoncanonicalfixture"] } });
        await MediaAsset.deleteMany({ assetId: ASSET_ID });
        await mongoose.disconnect();
    }
}

async function main() {
    verifySourceAuthority();
    if (process.argv.includes("--matrix")) {
        await mongoose.connect(configuredMongoUri());
        try {
            console.log(JSON.stringify(await canonicalMatrix(), null, 2));
        } finally {
            await mongoose.disconnect();
        }
    }
    if (process.argv.includes("--isolated")) await verifyIsolatedLifecycle();
    console.log("Admin Catalog completeness verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
