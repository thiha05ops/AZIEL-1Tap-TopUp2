const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const FRONTEND = path.join(ROOT, "frontend");

const ICONS = [
    ["/assets/brand/icon-192.png", 192, 192, "any"],
    ["/assets/brand/icon-512.png", 512, 512, "any"]
];

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function publicFile(urlPath) {
    return path.join(FRONTEND, urlPath.replace(/^\//, ""));
}

function pngDimensions(file) {
    const buffer = fs.readFileSync(file);
    assert.strictEqual(buffer.toString("ascii", 1, 4), "PNG", `${file} must be a PNG.`);
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
    };
}

function htmlFiles() {
    return fs.readdirSync(FRONTEND)
        .filter(name => name.endsWith(".html"))
        .filter(name => !name.startsWith("admin") && name !== "old-admin-orders.html")
        .filter(name => name !== "googlef3b883efac53feee.html");
}

function main() {
    const manifest = JSON.parse(read("frontend/manifest.json"));

    assert.strictEqual(manifest.name, "AZIEL 1Tap Shop");
    assert.strictEqual(manifest.short_name, "AZIEL");
    assert.strictEqual(manifest.start_url, "/");
    assert.strictEqual(manifest.scope, "/");
    assert.strictEqual(manifest.display, "standalone");
    assert.strictEqual(manifest.background_color, "#070716");
    assert.strictEqual(manifest.theme_color, "#070716");

    assert.deepStrictEqual(
        manifest.icons.map(icon => ({
            src: icon.src,
            sizes: icon.sizes,
            type: icon.type,
            purpose: icon.purpose
        })),
        ICONS.map(([src, width, height, purpose]) => ({
            src,
            sizes: `${width}x${height}`,
            type: "image/png",
            purpose
        }))
    );

    ICONS.forEach(([src, width, height]) => {
        const file = publicFile(src);
        assert(fs.existsSync(file), `${src} must resolve from the public root.`);
        assert.deepStrictEqual(pngDimensions(file), { width, height }, `${src} must be ${width}x${height}.`);
    });

    const appleIcon = publicFile("/assets/brand/apple-touch-icon.png");
    assert(fs.existsSync(appleIcon), "Apple touch icon must resolve from the public root.");
    assert.deepStrictEqual(pngDimensions(appleIcon), { width: 192, height: 192 }, "Apple touch icon must match the supplied canonical artwork.");

    [16, 32, 48].forEach(size => {
        const favicon = publicFile(`/assets/brand/favicon-${size}.png`);
        assert(fs.existsSync(favicon), `Canonical ${size}px favicon must resolve from the public root.`);
        assert.deepStrictEqual(pngDimensions(favicon), { width: size, height: size }, `favicon-${size}.png must be ${size}x${size}.`);
    });

    const sw = read("frontend/sw.js");
    [
        "/assets/brand/icon-192.png",
        "/assets/brand/icon-512.png",
        "/assets/brand/apple-touch-icon.png",
        "/assets/brand/favicon-16.png",
        "/assets/brand/favicon-32.png",
        "/assets/brand/favicon-48.png"
    ].forEach(src => assert(sw.includes(`"${src}"`), `Service worker must precache ${src}.`));

    assert(!sw.includes("/icons/aziel-app-icon"), "Service worker must not precache legacy app icons.");
    assert(!sw.includes("/assets/icons/"), "Service worker must not precache legacy icon paths.");

    htmlFiles().forEach(name => {
        const html = read(`frontend/${name}`);
        const manifestLinks = html.match(/<link\s+rel=["']manifest["'][^>]*>/gi) || [];
        const appleLinks = html.match(/<link\s+rel=["']apple-touch-icon["'][^>]*>/gi) || [];
        assert.strictEqual(manifestLinks.length, 1, `${name} must have exactly one manifest link.`);
        assert(manifestLinks[0].includes('href="/manifest.json"'), `${name} manifest link must use /manifest.json.`);
        assert.strictEqual(appleLinks.length, 1, `${name} must have exactly one Apple touch icon link.`);
        assert(appleLinks[0].includes('sizes="180x180"'), `${name} Apple touch icon must declare 180x180.`);
        assert(appleLinks[0].includes('href="/assets/brand/apple-touch-icon.png"'), `${name} Apple touch icon must use the app icon path.`);
    });

    [
        "aziel-logo-primary.svg", "aziel-logo-light.svg", "aziel-logo-dark.svg", "aziel-icon.svg",
        "favicon-16.png", "favicon-32.png", "favicon-48.png", "apple-touch-icon.png",
        "icon-192.png", "icon-512.png", "og-image.png"
    ].forEach(name => assert(fs.existsSync(path.join(ROOT, "frontend/assets/brand", name)), `${name} must exist in the canonical brand directory.`));

    console.log("PWA icon verification passed.");
}

main();
