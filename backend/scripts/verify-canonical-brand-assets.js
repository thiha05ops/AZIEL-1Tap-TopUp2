const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const FRONTEND = path.join(ROOT, "frontend");
const BRAND = path.join(FRONTEND, "assets/brand");
const ASSETS = [
    "aziel-logo-primary.svg", "aziel-logo-light.svg", "aziel-logo-dark.svg", "aziel-icon.svg",
    "favicon-16.png", "favicon-32.png", "favicon-48.png", "apple-touch-icon.png",
    "icon-192.png", "icon-512.png", "og-image.png"
];
const LEGACY_PATHS = [
    "/assets/logo/", "/assets/icons/", "/assets/logo.png", "/icons/aziel-app-icon", "/icons/apple-touch-icon.png"
];

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(target) : [target];
    });
}

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function main() {
    assert.deepStrictEqual(fs.readdirSync(BRAND).sort(), [...ASSETS].sort(), "Canonical brand directory must contain exactly the approved 11 assets.");

    const runtimeFiles = walk(FRONTEND).filter(file => /\.(?:html|css|js|json)$/i.test(file));
    runtimeFiles.forEach(file => {
        const source = fs.readFileSync(file, "utf8");
        LEGACY_PATHS.forEach(legacy => assert(!source.includes(legacy), `${path.relative(ROOT, file)} retains legacy brand path ${legacy}`));
    });

    const documents = runtimeFiles.filter(file => file.endsWith(".html") && /<head[\s>]/i.test(fs.readFileSync(file, "utf8")));
    documents.forEach(file => {
        const source = fs.readFileSync(file, "utf8");
        ["favicon-16.png", "favicon-32.png", "favicon-48.png", "apple-touch-icon.png"].forEach(asset => {
            assert.strictEqual(source.split(`/assets/brand/${asset}`).length - 1, 1, `${path.relative(ROOT, file)} must reference ${asset} exactly once.`);
        });
        assert.strictEqual((source.match(/<link\s+rel=["'](?:shortcut icon|icon)["'][^>]*>/gi) || []).length, 3, `${path.relative(ROOT, file)} must expose exactly one canonical favicon family.`);
    });

    const socialDocuments = documents.filter(file => /(?:og:image|twitter:image)/i.test(fs.readFileSync(file, "utf8")));
    socialDocuments.forEach(file => {
        const source = fs.readFileSync(file, "utf8");
        assert(!/(?:og:image|twitter:image)[^>]+aziel-logo/i.test(source), `${path.relative(ROOT, file)} must use the social image rather than a wordmark.`);
        assert(source.includes("/assets/brand/og-image.png"), `${path.relative(ROOT, file)} must use the canonical social preview.`);
    });

    const manifest = JSON.parse(read("frontend/manifest.json"));
    assert.deepStrictEqual(manifest.icons.map(icon => icon.src), ["/assets/brand/icon-192.png", "/assets/brand/icon-512.png"]);
    assert(manifest.icons.every(icon => icon.purpose === "any"), "Manifest must not claim unsupported maskable artwork.");

    const server = read("backend/server.js");
    assert(server.includes('express.static(path.join(__dirname, "../frontend"))'), "Express must serve the frontend root containing /assets/brand/.");
    const adminBrand = read("frontend/js/admin-os-brand.js");
    assert(adminBrand.includes('/assets/brand/aziel-icon.svg') && !adminBrand.includes("<svg"), "Admin must consume the canonical icon without inline duplicate artwork.");

    console.log(JSON.stringify({
        result: "PASS",
        canonicalAssets: ASSETS.length,
        documentsChecked: documents.length,
        socialDocumentsChecked: socialDocuments.length,
        oldRuntimeBrandReferences: 0
    }, null, 2));
}

main();
