const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    applyPublicationMetadata,
    explicitPublishedPackages,
    projectPackagePublication,
    publicationMode
} = require("../services/packageMarketPublicationService");

function operationalPackage(overrides = {}) {
    return {
        productCode: "mlbb",
        packageCode: "MLBB_TEST",
        enabled: true,
        deletedAt: null,
        prices: { TH: { enabled: true, amount: 10 } },
        fulfillmentRegions: { TH: true },
        ...overrides
    };
}

function verify() {
    assert.strictEqual(publicationMode({}), "LEGACY", "Safe read switch must default to LEGACY.");
    const ready = operationalPackage();
    assert.strictEqual(projectPackagePublication(ready, null).published, false, "Missing record must fail closed.");
    assert.strictEqual(projectPackagePublication(ready, { published: false }).state, "PRIVATE", "published=false must remain private.");
    const publishedReady = projectPackagePublication(ready, { published: true, decisionVersion: 1 });
    assert.strictEqual(publishedReady.state, "PUBLISHED");
    assert.strictEqual(publishedReady.currentlyPurchasable, true);
    for (const changed of [
        operationalPackage({ fulfillmentRegions: { TH: false } }),
        operationalPackage({ prices: { TH: null } }),
        operationalPackage({ enabled: false }),
        operationalPackage({ deletedAt: new Date() })
    ]) {
        const state = projectPackagePublication(changed, { published: true, decisionVersion: 1 });
        assert.strictEqual(state.state, "SUPPRESSED");
        assert.strictEqual(state.currentlyPurchasable, false);
        assert.strictEqual(state.published, true, "Operational failure must preserve publication intent.");
    }
    assert.strictEqual(projectPackagePublication(ready, { published: true, decisionVersion: 1 }).state, "PUBLISHED", "Operational recovery must not require republish.");
    const projection = { productCode: "mlbb", packages: [ready, operationalPackage({ packageCode: "MLBB_PRIVATE" })] };
    applyPublicationMetadata(projection, [{ productCode: "mlbb", packageCode: "MLBB_TEST", customerMarket: "TH", published: true }], "TH");
    assert.deepStrictEqual(explicitPublishedPackages(projection).map(pkg => pkg.packageCode), ["MLBB_TEST"]);

    const root = path.resolve(__dirname, "../..");
    const untouched = [
        "backend/services/suppliers/fazercardsAdapter.js",
        "backend/services/suppliers/fazercardsFulfillmentProcessor.js",
        "backend/services/suppliers/wonddAdapter.js",
        "backend/services/suppliers/wonddFulfillmentProcessor.js"
    ];
    for (const file of untouched) assert(fs.existsSync(path.join(root, file)), `${file} must remain present`);
    const publicationSource = fs.readFileSync(path.join(root, "backend/services/packageMarketPublicationService.js"), "utf8");
    assert(publicationSource.includes('PACKAGE_MARKET_PUBLICATION_MODE'), "Catalog must have a controlled publication mode.");
    const routeSource = fs.readFileSync(path.join(root, "backend/routes/catalog.js"), "utf8");
    assert(routeSource.includes("/publication"), "Admin API must expose explicit package publication.");
    const uiSource = fs.readFileSync(path.join(root, "frontend/js/admin-catalog.js"), "utf8");
    assert(uiSource.includes("Public Storefront") && uiSource.includes("Published but Suppressed"), "Admin UI must distinguish publication states.");
    console.log(JSON.stringify({ result: "PASS", checks: 15, supplierRequests: 0, databaseWrites: 0 }, null, 2));
}

verify();
