#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const catalogService = read("backend/services/catalogService.js");
const catalogRoute = read("backend/routes/catalog.js");
const catalogRuntime = read("frontend/js/catalog-runtime.js");
const prices = read("frontend/js/prices.js");
const promoRoutes = read("backend/routes/promos.js");
const { buildBatchCatalogLoader, resolveCommercePricingPreviewBatch } = require("../services/commerce/commercePricingPreviewBatchService");

async function verifyCatalogSingleFlight() {
    const start = catalogService.indexOf("const PUBLIC_CATALOG_CACHE_TTL_MS");
    const end = catalogService.indexOf("const PUBLIC_PRODUCT_DETAIL_CACHE_TTL_MS");
    assert(start >= 0 && end > start, "Public catalog cache implementation must be locatable");

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const sandbox = {
        databaseLoads: 0,
        gate,
        Date,
        Map,
        Boolean,
        String,
        Promise,
        getCatalogSource: () => "database",
        storeCatalogSelectionMode: () => "EXPLICIT",
        publicationMode: () => "EXPLICIT",
        toDatabasePublicCatalog: async options => {
            sandbox.databaseLoads += 1;
            await sandbox.gate;
            return [{ productCode: "fixture", region: options.customerMarket }];
        }
    };
    vm.runInNewContext(`${catalogService.slice(start, end)}\nthis.toPublicCatalog = toPublicCatalog;`, sandbox);

    const firstTiming = {};
    const sharedTiming = {};
    const first = sandbox.toPublicCatalog({ includeDisabled: false, customerMarket: "TH", timing: firstTiming });
    const shared = sandbox.toPublicCatalog({ includeDisabled: false, customerMarket: "TH", timing: sharedTiming });
    const otherRegion = sandbox.toPublicCatalog({ includeDisabled: false, customerMarket: "MM" });
    assert.strictEqual(sandbox.databaseLoads, 2, "Concurrent identical reads must share work while regions remain isolated");
    assert.strictEqual(firstTiming.cache, "miss");
    assert.strictEqual(sharedTiming.cache, "shared");

    release();
    const [firstValue, sharedValue, mmValue] = await Promise.all([first, shared, otherRegion]);
    assert.deepStrictEqual(firstValue, sharedValue, "Shared callers must receive the exact catalog projection");
    assert.strictEqual(mmValue[0].region, "MM", "Region-specific catalog keys must remain separate");

    const hitTiming = {};
    const cached = await sandbox.toPublicCatalog({ includeDisabled: false, customerMarket: "TH", timing: hitTiming });
    assert.strictEqual(sandbox.databaseLoads, 2, "Warm process-local reads must not repeat database assembly");
    assert.strictEqual(hitTiming.cache, "hit");
    assert.deepStrictEqual(cached, firstValue);
}

async function verifyPricingBatch() {
    const active = { count: 0, maximum: 0 };
    const seen = [];
    const context = { user: { id: "customer-1" }, sessionId: "session-1" };
    const items = [
        { productCode: "mlbb", packageCode: "MM_ONE", region: "MM", currency: "MMK" },
        { productCode: "mlbb", packageCode: "TH_TWO", region: "TH", currency: "THB" },
        { productCode: "mlbb", packageCode: "TH_FAIL", region: "TH", currency: "THB" },
        { productCode: "mlbb", packageCode: "MM_FOUR", region: "MM", currency: "MMK" },
        { productCode: "mlbb", packageCode: "TH_FIVE", region: "TH", currency: "THB" }
    ];
    const results = await resolveCommercePricingPreviewBatch(items, context, {
        concurrency: 2,
        resolvePreview: async (item, receivedContext) => {
            active.count += 1;
            active.maximum = Math.max(active.maximum, active.count);
            seen.push({ item, context: receivedContext });
            await new Promise(resolve => setImmediate(resolve));
            active.count -= 1;
            if (item.packageCode === "TH_FAIL") {
                const error = new Error("Package unavailable");
                error.code = "PACKAGE_UNAVAILABLE";
                error.availabilityCode = "PACKAGE_UNAVAILABLE";
                throw error;
            }
            return {
                packageCode: item.packageCode,
                region: item.region,
                currency: item.currency,
                finalAmount: item.region === "TH" ? 25.5 : 1500,
                discountAmount: item.region === "TH" ? 2.5 : 100
            };
        },
        projectError: error => ({ code: error.code, availabilityCode: error.availabilityCode, message: error.message })
    });

    assert.strictEqual(results.length, items.length, "Batch response must remain one-to-one with its request");
    assert.deepStrictEqual(results.map(result => result.packageCode), items.map(item => item.packageCode), "Package ordering and identity must be preserved");
    assert.strictEqual(results[0].resolvedPackageCode, "MM_ONE", "Successful results must expose the authoritative resolved package identity");
    assert.strictEqual(active.maximum, 2, "Batch concurrency must remain bounded");
    assert.strictEqual(results[0].quote.currency, "MMK");
    assert.strictEqual(results[1].quote.currency, "THB");
    assert.strictEqual(results[1].quote.finalAmount, 25.5, "Authoritative decimal THB amount must remain exact");
    assert.strictEqual(results[0].quote.finalAmount, 1500, "Authoritative whole-MMK amount must remain exact");
    assert.strictEqual(results[2].success, false, "One package error must remain isolated");
    assert.strictEqual(results[2].error.availabilityCode, "PACKAGE_UNAVAILABLE");
    assert(results.filter(result => result.success).length === 4, "Partial failure must not remove successful packages");
    assert(seen.every(entry => entry.context === context), "Authentication/session context must reach every authoritative resolver call");
}

async function verifyBatchCatalogProjection() {
    let productQueries = 0;
    let packageQueries = 0;
    let fallbackQueries = 0;
    const product = {
        productCode: "mlbb",
        enabled: true,
        deletedAt: null,
        lifecycleStatus: "ACTIVE",
        commerceState: "PURCHASABLE",
        publicDiscoveryEnabled: true
    };
    const pkg = {
        productCode: "mlbb",
        packageCode: "BATCH_ONE",
        enabled: true,
        deletedAt: null,
        prices: {
            MM: { amount: 1500, currency: "MMK", enabled: true },
            TH: { amount: 25.5, currency: "THB", enabled: true }
        }
    };
    const loader = await buildBatchCatalogLoader([
        { productCode: "mlbb", packageCode: "BATCH_ONE" },
        { productCode: "mlbb", packageCode: "BATCH_ONE" }
    ], {
        findProducts: async codes => { productQueries += 1; assert.deepStrictEqual(codes, ["mlbb"]); return [product]; },
        findPackages: async (products, packages) => { packageQueries += 1; assert.deepStrictEqual(products, ["mlbb"]); assert.deepStrictEqual(packages, ["BATCH_ONE"]); return [pkg]; },
        findFallbackPackage: async () => { fallbackQueries += 1; return null; }
    });
    const mm = await loader({ productCode: "mlbb", packageCode: "BATCH_ONE", region: "MM", currency: "MMK" });
    const th = await loader({ productCode: "mlbb", packageCode: "BATCH_ONE", region: "TH", currency: "THB" });
    assert.strictEqual(mm.price.amount, 1500);
    assert.strictEqual(th.price.amount, 25.5);
    assert.strictEqual(productQueries, 1, "Batch must preload products with one query");
    assert.strictEqual(packageQueries, 1, "Batch must preload packages with one query");
    assert.strictEqual(fallbackQueries, 0, "Canonical package codes must not require fallback queries");
}

async function verifyFrontendPricingBatchMapping() {
    const items = [
        { productCode: "mlbb", packageCode: "MM_ONE", region: "MM", currency: "MMK", amount: 1 },
        { productCode: "mlbb", packageCode: "TH_TWO", region: "TH", currency: "THB", amount: 1 },
        { productCode: "mlbb", packageCode: "TH_FAIL", region: "TH", currency: "THB", amount: 1 }
    ];
    let requests = 0;
    let posted = null;
    const sandbox = {
        window: { addEventListener() {} },
        document: { addEventListener() {} },
        fetch: async (url, options) => {
            requests += 1;
            posted = JSON.parse(options.body);
            assert.strictEqual(url, "/api/pricing/preview-batch");
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    results: [
                        { success: true, packageCode: "MM_ONE", resolvedPackageCode: "MM_ONE_CANONICAL", quote: { packageCode: "MM_ONE_CANONICAL", finalAmount: 1500, currency: "MMK", discountAmount: 100 } },
                        { success: true, packageCode: "TH_TWO", resolvedPackageCode: "TH_TWO", quote: { packageCode: "TH_TWO", finalAmount: 25.5, currency: "THB", discountAmount: 2.5 } },
                        { success: false, packageCode: "TH_FAIL", error: { code: "PACKAGE_UNAVAILABLE", availabilityCode: "PACKAGE_UNAVAILABLE", message: "Unavailable" } }
                    ]
                })
            };
        },
        console,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(`${prices}\nthis.settleAuthoritativePrices = settleAuthoritativePrices;`, sandbox);
    const results = await sandbox.settleAuthoritativePrices(items, 0);
    assert.strictEqual(requests, 1, "One product render must make one batch pricing request");
    assert.deepStrictEqual(posted.items.map(item => item.packageCode), items.map(item => item.packageCode));
    assert.strictEqual(results.length, items.length);
    assert.strictEqual(results[0].value.amount, 1500);
    assert.strictEqual(results[0].value.currency, "MMK");
    assert.strictEqual(results[1].value.amount, 25.5);
    assert.strictEqual(results[1].value.currency, "THB");
    assert.strictEqual(results[2].status, "rejected");
    assert.strictEqual(results[2].reason.code, "PACKAGE_UNAVAILABLE");
}

async function main() {
    await verifyCatalogSingleFlight();
    await verifyPricingBatch();
    await verifyBatchCatalogProjection();
    await verifyFrontendPricingBatchMapping();

    assert.match(catalogService, /const publicCatalogInFlight = new Map\(\)/);
    assert.match(catalogService, /const publicProductDetailInFlight = new Map\(\)/);
    assert.match(catalogService, /publicCatalogInFlight\.size >= 20/);
    assert.match(catalogService, /publicProductDetailInFlight\.size >= 100/);
    assert.match(catalogService, /generation === publicCatalogCacheGeneration/);
    assert.match(catalogService, /publicCatalogCacheGeneration \+= 1/);
    assert.match(catalogService, /publicProductDetailInFlight\.clear\(\)/);

    assert.match(catalogRoute, /Server-Timing/);
    assert.match(catalogRoute, /\$\{metric\}-service;dur=/);
    assert.match(catalogRoute, /catalog-detail/);
    assert.match(catalogRoute, /\$\{metric\}-serialize;dur=/);
    assert.match(catalogRoute, /res\.set\("Cache-Control", "no-store"\)/);

    assert.match(catalogRuntime, /ensureFreshForPurchase[\s\S]*load\(\{ force: true, source: "purchase" \}\)/);
    assert.match(catalogRuntime, /detailCode[\s\S]*\/api\/catalog\/\$\{encodeURIComponent\(detailCode\)\}/);
    assert.doesNotMatch(catalogRuntime, /localStorage\.setItem\([^\n]*catalog/i, "Authoritative catalog data must not be persisted in shared browser storage");

    assert.match(prices, /fetch\("\/api\/pricing\/preview-batch"/);
    assert.match(prices, /items\.map\(item => \(\{/);
    assert.match(prices, /\[404, 405\]\.includes\(response\.status\)/);
    assert.match(prices, /settleAuthoritativePricesLegacy/);
    assert.doesNotMatch(prices, /price\.amount\s*\*/, "Browser must not calculate authoritative selling prices");
    assert.match(promoRoutes, /router\.post\("\/pricing\/preview-batch"/);
    assert.match(promoRoutes, /items\.length > 60/);
    assert.match(promoRoutes, /resolveCommercePricingPreviewBatch/);
    assert.match(promoRoutes, /Cache-Control", "no-store/);

    console.log("PASS Phase 2 catalog delivery and diagnostics verification");
    console.log("PASS concurrent identical catalog reads: 1 database assembly");
    console.log("PASS TH/MM cache-key isolation and authoritative purchase refresh");
    console.log("PASS 36-package product pricing request count: 36 -> 1");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
