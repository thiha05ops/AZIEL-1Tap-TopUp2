const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "../..", relativePath), "utf8");
}

function loadPresentationSandbox() {
    const sandbox = {
        window: {
            ASSET: {
                mlbb: assetPath => `/assets/mlbb/${assetPath.replace(/^assets\/mlbb\//, "")}`
            }
        },
        document: {
            querySelectorAll: () => []
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(read("frontend/js/catalog-presentation.js"), sandbox);
    return sandbox.window.AZIEL_CATALOG_PRESENTATION;
}

function verifyResolvers() {
    const presentation = loadPresentationSandbox();

    assert.strictEqual(
        presentation.resolveProductImage({
            productCode: "mlbb",
            imageUrl: "https://cdn.example.com/mlbb.webp"
        }),
        "https://cdn.example.com/mlbb.webp",
        "product media URL must beat static fallback"
    );

    assert.strictEqual(
        presentation.resolveProductImage({ productCode: "mlbb" }),
        "assets/games/mlbb.webp",
        "missing product media must keep static fallback"
    );

    assert.strictEqual(
        presentation.resolvePackageIcon({
            productCode: "mlbb",
            packageCode: "MLBB_7740_1548",
            iconUrl: "https://cdn.example.com/icon.webp"
        }),
        "https://cdn.example.com/icon.webp",
        "package media icon must beat static icon rule"
    );

    assert.ok(
        presentation.resolvePackageIcon({
            productCode: "mlbb",
            packageCode: "MLBB_7740_1548"
        }).includes("cheset5.webp"),
        "missing package media must keep existing MLBB icon rule"
    );
}

function verifyRuntimeConsumption() {
    const runtime = read("frontend/js/catalog-runtime.js");
    const discovery = read("frontend/js/catalog-discovery.js");
    const search = read("frontend/js/search.js");
    const prices = read("frontend/js/prices.js");
    const presentation = read("frontend/js/catalog-presentation.js");

    assert.ok(runtime.includes("resolvePackageIcon"), "catalog runtime must use DB-first package icon resolver");
    assert.ok(discovery.includes("imageFallbackAttributes"), "discovery cards must bind media fallback attributes");
    assert.ok(search.includes("resolveProductImage"), "search must consume DB-first product image resolver");
    assert.ok(prices.includes("data-fallback-icon"), "package renderer must preserve static icon fallback");
    assert.ok(!/mmk|thb|amount|currency/i.test(presentation.split("const PRODUCT_PRESENTATION")[1].split("const DEFAULT_PRODUCT_ICON")[0]), "presentation map must not contain price truth");
}

function main() {
    verifyResolvers();
    verifyRuntimeConsumption();
    console.log("verify-media-presentation: ok");
}

try {
    main();
} catch (error) {
    console.error("verify-media-presentation: failed");
    console.error(error);
    process.exit(1);
}
