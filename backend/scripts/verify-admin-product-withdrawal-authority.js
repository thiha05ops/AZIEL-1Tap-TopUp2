"use strict";

const assert = require("assert");
const mongoose = require("mongoose");

const CatalogProduct = require("../models/CatalogProduct");
const CatalogPackage = require("../models/CatalogPackage");
const {
    CatalogAdminError,
    classifyProductEnabledTransition,
    shouldValidateProductReadiness,
    updateProduct
} = require("../services/catalogAdminService");
const { CatalogError, resolvePackagePrice, toPublicCatalog } = require("../services/catalogService");
const {
    CommercePricingPreviewError,
    resolveCommercePricingPreview
} = require("../services/commerce/commercePricingPreviewService");

const productCode = "capcut";
const packageCode = "ADMIN_WITHDRAWAL_ISOLATED";

async function expectError(promise, ErrorType, code) {
    let caught = null;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert(caught instanceof ErrorType, `Expected ${ErrorType.name}, received ${caught?.constructor?.name || "no error"}`);
    assert.strictEqual(caught.code, code);
}

function verifyTransitionContract() {
    assert.strictEqual(classifyProductEnabledTransition(true, false), "WITHDRAWAL");
    assert.strictEqual(classifyProductEnabledTransition(false, true), "ACTIVATION");
    assert.strictEqual(classifyProductEnabledTransition(true, true), "ACTIVE_EDIT");
    assert.strictEqual(classifyProductEnabledTransition(false, false), "INACTIVE_EDIT");
    assert.strictEqual(shouldValidateProductReadiness({ transition: "WITHDRAWAL", previousCommerceState: "PURCHASABLE", nextCommerceState: "PURCHASABLE", changedFields: ["enabled"] }), false);
    assert.strictEqual(shouldValidateProductReadiness({ transition: "ACTIVATION", previousCommerceState: "PURCHASABLE", nextCommerceState: "PURCHASABLE", changedFields: ["enabled"] }), true);
    assert.strictEqual(shouldValidateProductReadiness({ transition: "ACTIVE_EDIT", previousCommerceState: "PURCHASABLE", nextCommerceState: "PURCHASABLE", changedFields: ["name"] }), false);
    assert.strictEqual(shouldValidateProductReadiness({ transition: "ACTIVE_EDIT", previousCommerceState: "PURCHASABLE", nextCommerceState: "PURCHASABLE", changedFields: ["supportedRegions"] }), true);
    assert.strictEqual(shouldValidateProductReadiness({ transition: "INACTIVE_EDIT", previousCommerceState: "PURCHASABLE", nextCommerceState: "PURCHASABLE", changedFields: ["name"] }), false);
    assert.strictEqual(shouldValidateProductReadiness({ transition: "INACTIVE_EDIT", previousCommerceState: "HIDDEN", nextCommerceState: "PURCHASABLE", changedFields: ["commerceState"] }), false);
    assert.strictEqual(shouldValidateProductReadiness({ transition: "ACTIVE_EDIT", previousCommerceState: "HIDDEN", nextCommerceState: "PURCHASABLE", changedFields: ["commerceState"] }), true);
}

function isolatedMongoUri() {
    require("dotenv").config({ quiet: true });
    const configured = String(process.env.MONGO_URI || "").trim();
    if (!configured) throw new Error("MONGO_URI is required for isolated verification.");
    const parsed = new URL(configured);
    parsed.pathname = "/aziel_e2e_admin_product_withdrawal";
    const uri = parsed.toString();
    if (!uri.includes("/aziel_e2e_admin_product_withdrawal")) {
        throw new Error("Product withdrawal verifier refused a non-isolated database URI.");
    }
    return uri;
}

async function currentProduct() {
    return CatalogProduct.findOne({ productCode });
}

async function update(patch) {
    const product = await currentProduct();
    return updateProduct({
        productCode,
        patch: { ...patch, expectedUpdatedAt: product.updatedAt },
        actor: "isolated-verifier"
    });
}

async function publicProduct() {
    const products = await toPublicCatalog({ source: "database", includeDisabled: false });
    return products.find(item => item.productCode === productCode) || null;
}

async function verifyIsolatedLifecycle() {
    await mongoose.connect(isolatedMongoUri());
    try {
        await CatalogPackage.deleteMany({ productCode, packageCode });
        await CatalogProduct.deleteMany({ productCode });
        await CatalogProduct.create({
            productCode,
            name: "Admin Withdrawal Isolated Product",
            description: "Isolated product used to verify intentional Admin withdrawal authority.",
            enabled: true,
            catalogCategory: "DIGITAL_SERVICE",
            lifecycleStatus: "ACTIVE",
            commerceState: "PURCHASABLE",
            publicDiscoveryEnabled: true,
            homepageEnabled: false,
            productRoute: "product.html?product=capcut",
            artworkPath: "assets/giftcards/capcut.webp",
            supportedRegions: ["MM", "TH"],
            fulfillment: { manualAllowedRegions: ["MM", "TH"] },
            source: "admin"
        });
        await CatalogPackage.create({
            productCode,
            packageCode,
            name: "Admin Withdrawal Package",
            enabled: true,
            prices: {
                MM: { amount: 1000, currency: "MMK", enabled: true, supplierCost: 500, supplierCurrency: "MMK", publishedPriceMode: "LEGACY_COMPATIBILITY_PRICE" },
                TH: { amount: 30, currency: "THB", enabled: true, supplierCost: 20, supplierCurrency: "THB", publishedPriceMode: "LEGACY_COMPATIBILITY_PRICE" }
            },
            source: "admin"
        });

        assert((await publicProduct())?.purchasable, "Fixture must begin publicly purchasable.");
        const beforePackage = await CatalogPackage.findOne({ productCode, packageCode }).lean();
        const preservedBefore = JSON.stringify({
            id: String(beforePackage._id),
            enabled: beforePackage.enabled,
            prices: beforePackage.prices
        });

        const withdrawal = await update({ enabled: false });
        assert.strictEqual(withdrawal.changed, true);
        assert.strictEqual((await currentProduct()).enabled, false, "Withdrawal must persist disabled state.");
        assert.strictEqual(await publicProduct(), null, "Disabled product must leave public catalog.");
        await expectError(resolveCommercePricingPreview({ productCode, packageCode, region: "TH", currency: "THB" }), CommercePricingPreviewError, "PRODUCT_UNAVAILABLE");
        await expectError(resolvePackagePrice({ productCode, packageCode, region: "TH" }, { source: "database" }), CatalogError, "PRODUCT_DISABLED");
        const afterPackage = await CatalogPackage.findOne({ productCode, packageCode }).lean();
        assert.strictEqual(JSON.stringify({ id: String(afterPackage._id), enabled: afterPackage.enabled, prices: afterPackage.prices }), preservedBefore, "Withdrawal must preserve package identity and regional pricing configuration.");

        const repeated = await update({ enabled: false });
        assert.strictEqual(repeated.changed, false, "Repeated withdrawal must be idempotent.");

        const activation = await update({ enabled: true });
        assert.strictEqual(activation.changed, true);
        assert.strictEqual((await currentProduct()).enabled, true);
        assert((await publicProduct())?.purchasable, "Valid reactivation must restore public eligibility.");
        const preview = await resolveCommercePricingPreview({ productCode, packageCode, region: "TH", currency: "THB" });
        assert.strictEqual(preview.productCode, productCode);
        const commerce = await resolvePackagePrice({ productCode, packageCode, region: "TH" }, { source: "database" });
        assert.strictEqual(commerce.amount, 30);

        await CatalogPackage.updateOne({ productCode, packageCode }, { $set: { enabled: false } });
        const activeEdit = await update({ name: "Active Edit During Package Maintenance" });
        assert.strictEqual(activeEdit.changed, true, "Unrelated active edits must not be blocked by temporary package maintenance.");
        assert.strictEqual((await currentProduct()).enabled, true);
        await CatalogPackage.updateOne({ productCode, packageCode }, { $set: { enabled: true } });

        await update({ enabled: false });
        await CatalogPackage.updateOne({ productCode, packageCode }, { $set: { enabled: false } });
        await expectError(update({ enabled: true }), CatalogAdminError, "CATALOG_COMMERCE_CONFIGURATION_INCOMPLETE");
        assert.strictEqual((await currentProduct()).enabled, false, "Failed activation must remain atomically disabled.");
        assert.strictEqual(await publicProduct(), null, "Failed activation must not partially expose product.");

        const inactiveEdit = await update({ name: "Prepared While Disabled" });
        assert.strictEqual(inactiveEdit.changed, true, "Inactive product preparation must be allowed.");
        assert.strictEqual((await currentProduct()).enabled, false);
        await CatalogPackage.updateOne({ productCode, packageCode }, { $set: { enabled: true } });

        await update({ supportedRegions: ["MM"], manualAllowedRegions: ["MM"] });
        await update({ enabled: true });
        const regionRestricted = await publicProduct();
        assert(regionRestricted?.purchasable, "MM-ready product must reactivate.");
        assert.strictEqual(regionRestricted.packages[0].prices.TH, undefined, "Reactivation must not bypass product-region price authority.");
        assert.strictEqual(regionRestricted.packages[0].fulfillmentRegions.TH, false, "Reactivation must not bypass product-region fulfillment authority.");
        await expectError(resolveCommercePricingPreview({ productCode, packageCode, region: "TH", currency: "THB" }), CommercePricingPreviewError, "PRODUCT_REGION_UNAVAILABLE");
        await expectError(resolvePackagePrice({ productCode, packageCode, region: "TH" }, { source: "database" }), CatalogError, "REGION_NOT_SUPPORTED");
        assert((await CatalogPackage.findOne({ productCode, packageCode }).lean()).prices.TH, "Stored TH package configuration must survive region restriction and reactivation.");

        console.log("Isolated Admin product withdrawal lifecycle verification passed.");
    } finally {
        await CatalogPackage.deleteMany({ productCode, packageCode });
        await CatalogProduct.deleteMany({ productCode });
        await mongoose.disconnect();
    }
}

async function main() {
    verifyTransitionContract();
    if (process.argv.includes("--isolated")) await verifyIsolatedLifecycle();
    console.log("Admin product withdrawal authority verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
