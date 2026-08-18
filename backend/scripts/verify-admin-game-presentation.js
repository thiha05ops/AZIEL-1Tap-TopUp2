const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function includes(file, pattern, message) {
    assert(read(file).includes(pattern), `${file}: ${message}`);
}

function matches(file, pattern, message) {
    assert(pattern.test(read(file)), `${file}: ${message}`);
}

function verifyCampaignModalUx() {
    const controller = read("frontend/js/admin-campaigns.js");
    const css = read("frontend/css/admin/admin-design-system.css");

    [
        "campaign-editor-section",
        "campaign-editor-grid",
        "campaign-editor-scroll",
        "campaign-editor-header",
        "campaignMediaLabel",
        "campaignSavePending",
        "readCampaignPayload",
        "saveCampaign(campaign)",
        "previewCampaign"
    ].forEach(pattern => assert(controller.includes(pattern), `Campaign editor missing ${pattern}`));

    [
        "Campaign Name",
        "Campaign Code",
        "Campaign Type",
        "Placement",
        "Title",
        "Body",
        "Select Campaign Image",
        "Remove Image",
        "CTA Label",
        "CTA Target",
        "Region",
        "Audience",
        "Frequency",
        "Priority",
        "Start Date",
        "End Date",
        "Enabled"
    ].forEach(label => assert(controller.includes(label), `Campaign field label missing: ${label}`));

    assert(css.includes(".campaign-edit-modal .campaign-editor-box"), "Campaign modal must have scoped editor box CSS.");
    assert(css.includes("max-height: min(820px, calc(100vh - 36px));"), "Campaign modal must be viewport bounded.");
    assert(css.includes(".campaign-editor-scroll"), "Campaign modal must own scroll container.");
    assert(css.includes("overflow-y: auto;"), "Campaign modal scroll container must scroll vertically.");
    assert(css.includes(".campaign-editor-grid"), "Campaign modal must have grouped two-column grid.");
    assert(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"), "Campaign modal desktop grid must be two-column.");
    matches("frontend/css/admin/admin-design-system.css", /@media\s*\(max-width:\s*768px\)[\s\S]*\.campaign-editor-grid,[\s\S]*\.campaign-media-control\s*\{[\s\S]*grid-template-columns:\s*1fr;/, "Campaign modal must collapse to one column on mobile.");
    assert(!controller.includes("/api/campaigns/entry-popup/claim"), "Admin Campaign editor must not change customer Campaign runtime semantics.");
}

function verifyProductPresentationModelAndApi() {
    includes("backend/models/CatalogProduct.js", "mobilePackagePreview", "Product presentation must own mobilePackagePreview.");
    includes("backend/models/CatalogProduct.js", "assetId", "mobilePackagePreview must be a media asset reference.");
    includes("backend/models/CatalogProduct.js", "presentation.mobilePackagePreview.assetId", "mobilePackagePreview must be indexed.");

    includes("backend/services/catalogPresentationService.js", "mobilePackagePreview", "Presentation service must support mobilePackagePreview slot.");
    includes("backend/services/catalogPresentationService.js", "presentation.mobilePackagePreview.assetId", "Presentation service must write the canonical preview reference.");
    includes("backend/services/catalogPresentationService.js", "category: \"product_image\"", "Mobile preview must reuse product image media category.");
    includes("backend/services/mediaService.js", "mobilePackagePreviews", "Media safe-delete must count mobile preview references.");

    includes("backend/routes/catalog.js", "/presentation/mobile-package-preview", "Admin API must expose mobile preview presentation route.");
    includes("backend/routes/catalog.js", "requireAdminPermission(PERMISSIONS.MEDIA_MANAGE)", "Preview mutation must remain protected by media permission.");
    includes("backend/routes/catalog.js", "slot: \"mobilePackagePreview\"", "Preview route must use canonical presentation slot.");

    includes("backend/services/catalogService.js", "mobilePackagePreviewUrl", "Public catalog projection must expose preview URL.");
    includes("backend/services/catalogService.js", "publicId: mobilePackagePreviewAsset?.publicId", "Public projection must expose publicId metadata without storage secrets.");
    includes("backend/services/catalogService.js", "projectMediaAsset(mobilePackagePreviewAsset)", "Admin projection must include selected preview asset.");

    const model = read("backend/models/CatalogProduct.js");
    assert(!/Buffer|buffer|binary|fileData|raw/i.test(model), "CatalogProduct must not store raw image bytes.");
}

function verifyAdminCatalogControl() {
    const adminCatalog = read("frontend/js/admin-catalog.js");

    [
        "renderMobilePackagePreviewControl(product)",
        "Mobile Package Preview",
        "Shown on mobile before a package is selected.",
        "Square PNG or WebP recommended.",
        "data-change-mobile-preview",
        "data-remove-mobile-preview",
        "attachMobilePackagePreview(product)",
        "clearMobilePackagePreview(product)",
        "category: \"product_image\"",
        "/presentation/mobile-package-preview"
    ].forEach(pattern => assert(adminCatalog.includes(pattern), `Admin Catalog preview control missing ${pattern}`));

    assert(!adminCatalog.includes("deleteAsset("), "Removing mobile preview must not delete shared Media Library assets.");
}

function verifySharedGameRuntime() {
    const presentation = read("frontend/js/catalog-presentation.js");
    const prices = read("frontend/js/prices.js");

    [
        "resolveMobilePackagePreview",
        "product.mobilePackagePreviewUrl",
        "product.mobilePackagePreview?.url",
        "getProductImage(productCode)"
    ].forEach(pattern => assert(presentation.includes(pattern), `Catalog presentation missing ${pattern}`));

    [
        "getProductMobilePackagePreview",
        "getStaticPreviewFallbackIcon",
        "getPreviewPlaceholderIcon(icon",
        "product.mobilePackagePreviewUrl",
        "selectedPackage = {",
        "setPackagePreviewIcon(icon, pkg.icon",
        "setPackagePreviewIcon(icon, defaultIcon, staticFallbackIcon || defaultIcon)",
        "icon.onerror = function handlePackagePreviewIconError",
        "clearSelectedPackage",
        "resetSelectedPackagePreview"
    ].forEach(pattern => assert(prices.includes(pattern), `prices.js shared preview flow missing ${pattern}`));

    assert(!prices.includes("mobilePackagePreviewUrl = \"http://localhost"), "Preview flow must not introduce localhost URLs.");
}

function verifySupportedGamePages() {
    const pages = [
        "frontend/mlbb.html",
        "frontend/pubg.html",
        "frontend/freefire.html",
        "frontend/hok.html",
        "frontend/aov-id.html",
        "frontend/pubg-rp.html",
        "frontend/telegram.html"
    ];

    pages.forEach(file => {
        const source = read(file);
        assert(source.includes("mobile-selected-package"), `${file}: mobile selected package control missing.`);
        assert(/id="(?:selectedPackageIcon|mobilePackageIcon)"/.test(source), `${file}: mobile package preview image missing.`);
        assert(source.includes('id="packages"') && source.includes("data-game="), `${file}: packages data-game owner missing.`);
        assert(source.includes("/js/catalog-presentation.js"), `${file}: catalog-presentation.js missing.`);
        assert(source.includes("/js/catalog-runtime.js"), `${file}: catalog-runtime.js missing.`);
        assert(source.includes("/js/prices.js"), `${file}: prices.js missing.`);
    });
}

function verifyCanonicalPresentationIdentityRegression() {
    const presentationService = read("backend/services/catalogPresentationService.js");
    const adminCatalog = read("frontend/js/admin-catalog.js");

    assert(
        presentationService.includes("function normalizeCatalogProductIdentity"),
        "Presentation service must use a catalog-identity normalizer."
    );

    assert(
        presentationService.includes(".trim()") &&
        presentationService.includes(".toLowerCase()"),
        "Catalog identity normalization must be bounded to trim/lowercase."
    );

    assert(
        !presentationService.includes("normalizeProductCode(productCode)"),
        "Presentation writes must not use lossy public product-code normalization."
    );

    assert(
        presentationService.includes(
            "const normalizedProductCode = normalizeCatalogProductIdentity(productCode);"
        ),
        "Presentation writes must preserve canonical hyphenated product identities."
    );

    assert(
        adminCatalog.includes("lifecycleStatus:") &&
        adminCatalog.includes('=== "PURCHASABLE"') &&
        adminCatalog.includes('? "ACTIVE"') &&
        adminCatalog.includes('=== "COMING_SOON"') &&
        adminCatalog.includes('? "COMING_SOON"'),
        "Admin product editor must submit lifecycleStatus consistently with commerceState."
    );
}

function verifyScopeBoundaries() {
    const changedSurface = [
        "backend/models/CatalogProduct.js",
        "backend/services/catalogPresentationService.js",
        "backend/services/catalogService.js",
        "backend/services/mediaService.js",
        "backend/routes/catalog.js",
        "frontend/js/admin-campaigns.js",
        "frontend/js/admin-catalog.js",
        "frontend/js/catalog-presentation.js",
        "frontend/js/prices.js",
        "frontend/css/admin/admin-design-system.css"
    ].map(read).join("\n");

    [
        /\bOmise\b/i,
        /\brefund\b/i,
        /\bwalletService\b/,
        /\borderStateService\b/,
        /\bfulfillmentService\b/,
        /\bAdminSession\b/,
        /\btwoFactor\b/
    ].forEach(pattern => assert(!pattern.test(changedSurface), `Focused pass must not touch ${pattern} semantics.`));
}

function main() {
    verifyCampaignModalUx();
    verifyProductPresentationModelAndApi();
    verifyAdminCatalogControl();
    verifySharedGameRuntime();
    verifySupportedGamePages();
    verifyCanonicalPresentationIdentityRegression();
    verifyScopeBoundaries();
    console.log("verify-admin-game-presentation: ok");
}

main();
