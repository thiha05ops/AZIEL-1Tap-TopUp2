"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { PAGE_ROUTES, LEGACY_ALIASES } = require("../config/storefrontRouteContract");
const { CANONICAL_PRODUCT_CODES, resolveCanonicalProductRoute } = require("../catalog/canonicalOperationalCatalog");
const { app, configureBaseApplication } = require("../server");

const root = path.resolve(__dirname, "../..");

function request(port, requestPath) {
    return new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path: requestPath, headers: { Host: "localhost" } }, response => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { body += chunk; });
            response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
        }).on("error", reject);
    });
}

async function main() {
    PAGE_ROUTES.forEach(entry => {
        assert(entry.route === "/" || (!entry.route.endsWith("/") && !entry.route.includes(".html")));
        assert(fs.existsSync(path.join(root, "frontend", entry.file)), `missing physical page ${entry.file}`);
    });
    CANONICAL_PRODUCT_CODES.forEach(code => {
        const route = resolveCanonicalProductRoute(code);
        assert(route.startsWith("/games/") || route === "/products/telegram" || route === `/products/${code}`, `${code} has non-clean route ${route}`);
    });
    assert.strictEqual(resolveCanonicalProductRoute("not-canonical"), "");

    configureBaseApplication();
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const port = server.address().port;
    try {
        for (const route of ["/", "/account", "/games/mlbb", "/products/valorant", "/policies/privacy", "/auth/google/success"]) {
            const response = await request(port, route);
            assert.strictEqual(response.status, 200, `${route} should render directly`);
            assert(/<!DOCTYPE html>/i.test(response.body), `${route} should serve HTML`);
        }

        const legacy = await request(port, "/tracking.html?orderId=AZL-1&attemptId=ATT-1");
        assert.strictEqual(legacy.status, 308);
        assert.strictEqual(legacy.headers.location, "/orders?orderId=AZL-1&attemptId=ATT-1");
        const generic = await request(port, "/product.html?product=valorant&feature=test");
        assert.strictEqual(generic.status, 308);
        assert.strictEqual(generic.headers.location, "/products/valorant?feature=test");
        const legacyVariant = await request(port, "/mlbb.html?product=mlbb-twilight-weekly-pass&feature=test");
        assert.strictEqual(legacyVariant.headers.location, "/products/mlbb-twilight-weekly-pass?feature=test");
        assert.strictEqual((await request(port, "/products/not-canonical")).status, 404);
        assert.notStrictEqual((await request(port, "/api/not-a-route")).status, 308, "API paths must not canonicalize as pages");
        assert.strictEqual((await request(port, "/css/core/main.css")).status, 200, "static assets must remain available");
    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    const sitemap = fs.readFileSync(path.join(root, "frontend/sitemap.xml"), "utf8");
    assert(!/<loc>[^<]*\.html/i.test(sitemap), "sitemap must not expose HTML filenames");
    const robots = fs.readFileSync(path.join(root, "frontend/robots.txt"), "utf8");
    assert(robots.includes("Disallow: /payment") && !robots.includes(".html"));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "frontend/manifest.json"), "utf8"));
    assert.strictEqual(manifest.start_url, "/");
    assert(manifest.shortcuts.every(shortcut => !shortcut.url.includes(".html")));
    assert.strictEqual(manifest.id, "/home.html", "installed-PWA identity must remain stable during route migration");

    const oauth = fs.readFileSync(path.join(root, "backend/routes/socialAuth.js"), "utf8");
    assert(oauth.includes("/api/auth/google/callback"));
    assert(oauth.includes("/auth/google/success") && !oauth.includes("google-success.html"));
    assert(Object.keys(LEGACY_ALIASES).every(route => route.endsWith(".html")));

    console.log("Clean storefront route verification passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
