const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const FRONTEND = path.join(ROOT, "frontend");

const ICONS = [
    ["/icons/aziel-app-icon-192.png", 192, 192, "any"],
    ["/icons/aziel-app-icon-512.png", 512, 512, "any"],
    ["/icons/aziel-app-icon-maskable-192.png", 192, 192, "maskable"],
    ["/icons/aziel-app-icon-maskable-512.png", 512, 512, "maskable"]
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

    const appleIcon = publicFile("/icons/apple-touch-icon.png");
    assert(fs.existsSync(appleIcon), "Apple touch icon must resolve from the public root.");
    assert.deepStrictEqual(pngDimensions(appleIcon), { width: 180, height: 180 }, "Apple touch icon must be 180x180.");

    const sw = read("frontend/sw.js");
    [
        "/icons/aziel-app-icon-192.png",
        "/icons/aziel-app-icon-512.png",
        "/icons/aziel-app-icon-maskable-192.png",
        "/icons/aziel-app-icon-maskable-512.png",
        "/icons/apple-touch-icon.png"
    ].forEach(src => assert(sw.includes(`"${src}"`), `Service worker must precache ${src}.`));

    assert(!sw.includes("/assets/icons/icon-192.png"), "Service worker must not precache old 192 app icon.");
    assert(!sw.includes("/assets/icons/icon-512.png"), "Service worker must not precache old 512 app icon.");

    htmlFiles().forEach(name => {
        const html = read(`frontend/${name}`);
        const manifestLinks = html.match(/<link\s+rel=["']manifest["'][^>]*>/gi) || [];
        const appleLinks = html.match(/<link\s+rel=["']apple-touch-icon["'][^>]*>/gi) || [];
        assert.strictEqual(manifestLinks.length, 1, `${name} must have exactly one manifest link.`);
        assert(manifestLinks[0].includes('href="/manifest.json"'), `${name} manifest link must use /manifest.json.`);
        assert.strictEqual(appleLinks.length, 1, `${name} must have exactly one Apple touch icon link.`);
        assert(appleLinks[0].includes('sizes="180x180"'), `${name} Apple touch icon must declare 180x180.`);
        assert(appleLinks[0].includes('href="/icons/apple-touch-icon.png"'), `${name} Apple touch icon must use the app icon path.`);
    });

    [
        "frontend/assets/logo.png",
        "frontend/assets/logo/aziel-icon.webp",
        "frontend/assets/logo/aziel-wordmark.webp",
        "frontend/assets/icons/favicon.ico",
        "frontend/assets/icons/favicon-16.png",
        "frontend/assets/icons/favicon-32.png"
    ].forEach(file => assert(fs.existsSync(path.join(ROOT, file)), `${file} must remain present.`));

    console.log("PWA icon verification passed.");
}

main();
