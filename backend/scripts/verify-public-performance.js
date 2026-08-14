const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const { projectPublicPlacementProduct } = require("../services/sitePlacementService");

function main() {
    const home = read("frontend/home.html");
    const header = read("frontend/js/header.js");
    const homeBanner = read("frontend/js/home-banner-runtime.js");
    const gameRuntime = read("frontend/js/game-presentation-runtime.js");
    const search = read("frontend/js/search.js");
    const headerCss = read("frontend/css/theme/aziel-header.css");
    const homeCss = read("frontend/css/home/aziel-home.css");
    const catalogDiscovery = read("frontend/js/catalog-discovery.js");
    const homePlacement = read("frontend/js/home-placement-runtime.js");
    const placementService = read("backend/services/sitePlacementService.js");
    const serviceWorker = read("frontend/sw.js");
    const payment = read("frontend/js/payment.js");
    const tracking = read("frontend/js/tracking.js");
    const adminEntry = read("frontend/admin-entry.html");
    const adminShell = read("frontend/admin.html");
    const adminAuth = read("frontend/js/admin-auth.js");
    const adminCatalog = read("frontend/js/admin-catalog.js");
    const orderRoutes = read("backend/routes/order.js");
    const fulfillmentService = read("backend/services/fulfillmentService.js");
    const server = read("backend/server.js");

    assert(homeBanner.includes("banners.slice(0, 2).flatMap"), "Home managed banners must preload only current and next responsive hero sources.");
    assert(gameRuntime.includes("banners.slice(0, 2).map"), "Game managed banners must preload only current and next hero.");
    assert(homeBanner.includes('const loading = index < 2 ? "eager" : "lazy"'), "Home late banner images must lazy-load.");
    assert(gameRuntime.includes('const loading = index < 2 ? "eager" : "lazy"'), "Game late banner images must lazy-load.");
    assert(home.includes('fetchpriority="high"') && home.includes('width="3840" height="2159"'), "Static home hero must reserve dimensions and prioritize the first slide.");
    assert(header.includes('window.addEventListener("scroll"') && header.includes("{ passive: true }"), "Header scroll listener must be passive.");
    assert(header.includes("window.__azielCanonicalHeaderScrollReady"), "Header must guard duplicate scroll listener initialization.");
    assert(homeBanner.includes("ensureHomeAmbientBuffers") && homeBanner.includes("i < 2"), "Home ambient buffers must be capped at two.");
    assert(search.includes("DEBOUNCE_MS = 160"), "Search must keep debounced result rendering.");
    assert(search.includes('cache: "no-store"'), "Private/dynamic promotion search calls must avoid stale private cache.");
    assert(headerCss.includes("body.az-search-open") && headerCss.includes("overflow: hidden"), "Search overlay must own body scroll lock.");
    assert(homeCss.includes(".az-home-ambient-buffer"), "Home ambient buffer ownership must remain explicit.");
    assert(!/createElement\\(\"canvas\"\\)/.test(homeBanner), "Hero ambience must not use expensive canvas extraction.");

    const compactPlacementProduct = projectPublicPlacementProduct({
        productCode: "verifier-product",
        name: "Verifier Product",
        enabled: true,
        featured: true,
        publicCategory: "mobile",
        commerceState: "PURCHASABLE",
        productRoute: "product.html?product=verifier-product",
        imageUrl: "/assets/verifier.webp",
        imageAltText: "Verifier",
        publicState: "AVAILABLE",
        purchasable: true,
        discoverable: true,
        availabilityCode: "AVAILABLE",
        packages: Array.from({ length: 20 }, (_, index) => ({ packageCode: `PACKAGE_${index}` })),
        productKnowledge: { about: { summary: "large duplicated content" } }
    });
    assert.strictEqual(compactPlacementProduct.productCode, "verifier-product");
    assert.strictEqual(compactPlacementProduct.purchasable, true);
    assert(!Object.hasOwn(compactPlacementProduct, "packages"), "Home placement projection must not duplicate catalog packages.");
    assert(!Object.hasOwn(compactPlacementProduct, "productKnowledge"), "Home placement projection must not duplicate product knowledge.");
    assert(Buffer.byteLength(JSON.stringify(compactPlacementProduct)) < 1000, "Home placement product projection must remain compact.");
    assert(placementService.includes("const publicCatalog = needsProductCatalog") && placementService.includes("resolveProductPlacement(placementCode, doc, publicCatalog)"), "Home placements must share one catalog projection per request.");
    assert(catalogDiscovery.includes("scheduleDiscoveryRender") && catalogDiscovery.includes("if (renderInFlight) return renderInFlight"), "Catalog discovery must coalesce an in-flight bootstrap render.");
    assert(homePlacement.includes("scheduleHomeRefresh") && homePlacement.includes("if (refreshInFlight)"), "Home placement refresh must coalesce catalog completion events.");
    assert(homePlacement.includes("AZIEL_CATALOG?.getProduct?.(codeOf(product))"), "Compact placement identities must resolve through the loaded catalog authority.");
    assert((catalogDiscovery.match(/loading=\"lazy\" decoding=\"async\"/g) || []).length >= 5, "Below-fold catalog card images must lazy-load and decode asynchronously.");
    assert(homePlacement.includes('loading="lazy" decoding="async"'), "Below-fold Home product images must lazy-load.");
    assert(serviceWorker.includes('const NEVER_CACHE_PREFIXES = [\n    "/api/"'), "Business APIs must remain excluded from service-worker caches.");
    assert(serviceWorker.includes("isVersionedCodeAsset(url)") && serviceWorker.includes("cacheFirstVersionedCodeAsset(request)"), "Versioned code assets must use exact immutable cache keys.");
    assert(serviceWorker.includes("cache.match(request)") && serviceWorker.includes("cache.put(request, response.clone())"), "Versioned code caching must retain version queries.");
    assert(payment.includes("AZIEL_PAYMENT_TRUST?.fetchPublicPaymentMethods"), "Product checkout and footer trust UI must share the regional payment-method request.");
    assert(tracking.includes('trackingApiUrl("/api/order/user/me")'), "Tracking Recent Orders must rely on authenticated ownership rather than profile bootstrap data.");
    assert(!tracking.includes("waitForRecentOrdersUserReady"), "Tracking Recent Orders must not wait for unrelated profile bootstrap.");
    assert(tracking.includes("authKey !== recentOrdersAuthKey"), "Tracking must suppress duplicate same-token Recent Orders initialization.");
    const adminGate = adminEntry.indexOf('localStorage.getItem("adminToken")');
    assert(adminGate > -1, "Admin entry must make an explicit local token decision.");
    assert(!adminEntry.includes('rel="stylesheet"'), "Admin entry gate must not download operational styles.");
    assert(!adminEntry.includes('src="/js/'), "Admin entry gate must not download operational scripts.");
    assert(adminEntry.includes('window.location.replace(destination)') && adminEntry.includes(': "/admin-login.html"'), "Admin no-token gate must replace the operational shell navigation.");
    assert(adminEntry.includes("/admin.html?shell=1"), "Token-bearing Admin entry must continue to the operational shell.");
    assert(adminShell.includes('localStorage.getItem("adminToken")') && adminAuth.includes('adminFetch("/api/admin/me"'), "Admin shell must retain no-token and server-validation authority.");
    assert(server.includes('app.get("/admin.html"') && server.includes('req.query.shell === "1"') && server.includes('frontend/admin-entry.html'), "Server must serve the lightweight gate before the operational Admin shell.");
    assert(adminCatalog.includes('event.detail?.section === "catalog"') && adminCatalog.includes('section-catalog")?.classList.contains("active")'), "Admin Catalog data must initialize only when its section is active.");
    assert(orderRoutes.includes('PaymentAttempt.find({ orderId: { $in: orderIds } })'), "Order projections must bulk-hydrate PaymentAttempt records.");
    assert(fulfillmentService.includes('FulfillmentAttempt.find({ orderId: { $in: ids } })'), "Admin Orders must bulk-hydrate FulfillmentAttempt records.");

    console.log("Public performance verification passed.");
}

main();
