const CACHE_PREFIX = "aziel-runtime";
// Keep the suffix equal to the deterministic CORE_ASSETS content digest. The
// migration verifier fails if a precached dependency changes without a bump.
const SHELL_REVISION = "v10-faf74fe4cd4fa0b0";
const CORE_CACHE = `${CACHE_PREFIX}-core-${SHELL_REVISION}`;
const PAGE_CACHE = `${CACHE_PREFIX}-pages-v3-${SHELL_REVISION}`;
const CODE_CACHE = `${CACHE_PREFIX}-code-${SHELL_REVISION}`;
const MEDIA_CACHE = `${CACHE_PREFIX}-media-v3-storefront-performance`;
const PRESENTATION_CACHE = `${CACHE_PREFIX}-presentation-v1`;

const CORE_ASSETS = [
    "/offline.html",
    "/manifest.json",
    "/css/theme/aziel-design-system.css",
    "/css/core/motion.css",
    "/css/core/ui-feedback.css",
    "/css/core/loading-progress.css",
    "/css/core/offline-home.css?v=20261026-pwa-offline-v1",
    "/css/core/main.css",
    "/css/core/layout.css",
    "/css/core/components.css",
    "/css/core/footer.css",
    "/css/theme/wave-background.css",
    "/css/home/home.css",
    "/css/home/aziel-home.css",
    "/css/home/marketplace-reference.css",
    "/css/home/home-product-system.css",
    "/css/theme/aziel-header.css",
    "/css/theme/desktop.css",
    "/css/theme/mobile.css",
    "/js/asset.js",
    "/js/site-settings.js",
    "/js/locale-loader.js",
    "/js/i18n.js",
    "/js/user-state.js",
    "/js/campaign-runtime.js",
    "/js/auth-check.js",
    "/js/header-loader.js",
    "/js/pwa-install.js",
    "/js/offline-home.js?v=20261026-pwa-offline-v1",
    "/js/loading-manager.js",
    "/core/settings/theme.js",
    "/js/locale-switcher.js",
    "/js/catalog-presentation.js",
    "/js/catalog-runtime.js",
    "/js/customer-discovery-state.js",
    "/js/home.js",
    "/js/home-placement-runtime.js",
    "/js/home-banner-runtime.js",
    "/js/home-product-accent.js",
    "/js/home-footer-accordion.js",
    "/js/home-deferred-runtime.js",
    "/js/live-chat.js",
    "/css/support/live-chat.css",
    "/js/header.js",
    "/js/pwa-fix.js",
    "/assets/banners/hero-desktop-wide.webp",
    "/assets/banners/hero-mobile.webp",
    "/assets/brand/favicon-16.png",
    "/assets/brand/favicon-32.png",
    "/assets/brand/favicon-48.png",
    "/assets/brand/aziel-logo-primary.svg",
    "/assets/brand/icon-192.png",
    "/assets/brand/icon-512.png",
    "/assets/brand/apple-touch-icon.png"
];

const PUBLIC_HTML_ALLOWLIST = new Set([
    "/",
    "/explore",
    "/mobile-games",
    "/pc-games",
    "/gift-cards",
    "/social-topup",
    "/games/mlbb",
    "/games/pubg",
    "/games/freefire",
    "/games/hok",
    "/games/aov-id",
    "/games/pubg-rp",
    "/products/telegram",
    "/games/genshin",
    "/games/roblox",
    "/faq",
    "/about",
    "/contact",
    "/policies/privacy",
    "/policies/terms",
    "/policies/payment",
    "/policies/refund",
    "/policies/support"
]);

// Only canonical, public, non-personalized routes may receive the offline
// shell. Auth, customer, checkout, payment, OAuth, and product-price routes
// deliberately remain browser/network owned.
const OFFLINE_NAVIGATION_ALLOWLIST = new Set([
    "/",
    "/explore",
    "/mobile-games",
    "/pc-games",
    "/gift-cards",
    "/social-topup",
    "/entertainment",
    "/mobile-recharge",
    "/about",
    "/contact",
    "/faq",
    "/help",
    "/coming-soon",
    "/policies/privacy",
    "/policies/terms",
    "/policies/payment",
    "/policies/refund",
    "/policies/support"
]);

const NEVER_CACHE_PREFIXES = [
    "/api/",
    "/socket.io/"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches
            .open(CORE_CACHE)
            .then(cache => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(activateAzielWorker());
});

async function activateAzielWorker() {
    const cacheNames = await caches.keys();
    const migratesLegacyShell = cacheNames.some(name =>
        name.startsWith(`${CACHE_PREFIX}-core-`) && name !== CORE_CACHE
    );

    await Promise.all([
        deleteOldAzielCaches(),
        self.registration.navigationPreload?.enable()
    ]);
    await self.clients.claim();

    // The v5 shell can keep a running, pre-authority Live Chat DOM even after
    // controller takeover. Refresh only public storefront clients once during
    // this specific cache migration; fresh installs and future activations do not
    // enter this branch.
    if (migratesLegacyShell) {
        await refreshLegacyPublicClients();
    }
}

async function refreshLegacyPublicClients() {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.allSettled(clients.map(client => {
        try {
            const url = new URL(client.url);
            if (url.origin !== self.location.origin || (url.pathname !== "/home.html" && !isPublicHtml(url.pathname))) return null;
            return client.navigate(client.url);
        } catch {
            return null;
        }
    }));
}

self.addEventListener("message", event => {
    if (event.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }

    if (event.data?.type === "CLEAR_RUNTIME_CACHES") {
        event.waitUntil(clearRuntimeCaches());
    }

    if (event.data?.type === "REFRESH_PUBLIC_HOME") {
        event.waitUntil(refreshPublicHomePresentation().then(result => {
            event.ports?.[0]?.postMessage(result);
        }));
    }
});

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        if (isOfflineSafeNavigation(url)) {
            event.respondWith(networkFirstPublicNavigation(event, request));
        }
        return;
    }

    if (url.pathname === "/api/public/home-presentation") {
        event.respondWith(staleWhileRevalidatePresentation(event, request));
        return;
    }

    if (isNeverCachePath(url.pathname)) {
        event.respondWith(networkOnly(request));
        return;
    }

    if (isCodeAsset(url.pathname)) {
        event.respondWith(staleWhileRevalidateCodeAsset(event, request));
        return;
    }

    if (isMediaAsset(url.pathname)) {
        event.respondWith(cacheFirstMediaAsset(request));
    }
});

function isNeverCachePath(pathname) {
    return NEVER_CACHE_PREFIXES.some(prefix =>
        pathname === prefix || pathname.startsWith(prefix)
    );
}

function isPublicHtml(pathname) {
    return PUBLIC_HTML_ALLOWLIST.has(pathname);
}

function isOfflineSafeNavigation(url) {
    return !url.searchParams.has("code") &&
        !url.searchParams.has("state") &&
        !url.searchParams.has("payment") &&
        OFFLINE_NAVIGATION_ALLOWLIST.has(url.pathname);
}

async function networkFirstPublicNavigation(event, request) {
    try {
        const preload = await event.preloadResponse;
        return preload || await fetch(request);
    } catch {
        return await caches.match("/offline.html", { cacheName: CORE_CACHE }) ||
            new Response("AZIEL is offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
}

function isCodeAsset(pathname) {
    return /\.(?:js|css|json)$/i.test(pathname);
}

function isVersionedCodeAsset(url) {
    return ["v", "version", "build"].some(key => Boolean(url.searchParams.get(key)));
}

function isMediaAsset(pathname) {
    return /\.(?:png|jpg|jpeg|webp|svg|ico|gif|woff|woff2|ttf|otf)$/i.test(pathname);
}

/**
 * Removes manual cache-busting query parameters such as:
 * ?v=20260731
 *
 * This prevents hundreds of duplicate cache entries.
 */
function createNormalizedCacheKey(request) {
    const url = new URL(request.url);

    url.searchParams.delete("v");
    url.searchParams.delete("version");
    url.searchParams.delete("build");
    url.hash = "";

    return new Request(url.toString(), {
        method: "GET",
        credentials: "same-origin"
    });
}

/**
 * Immutable versioned code is safe to serve from Cache Storage immediately.
 * Unversioned code remains network-first so a deployment can never be hidden
 * behind an old runtime entry.
 */
async function staleWhileRevalidateCodeAsset(event, request) {
    const cache = await caches.open(CODE_CACHE);
    const url = new URL(request.url);
    const cacheKey = isVersionedCodeAsset(url) ? request : createNormalizedCacheKey(request);

    if (isVersionedCodeAsset(url)) {
        const cached = await cache.match(cacheKey) || await caches.match(cacheKey);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") await cache.put(cacheKey, response.clone());
        return response;
    }

    try {
        const response = await fetch(request, { cache: "no-cache" });

        if (response.ok && response.type === "basic") {
            await cache.put(cacheKey, response.clone());
        }

        return response;
    } catch {
        const cached =
            await cache.match(cacheKey) ||
            await caches.match(createNormalizedCacheKey(request));

        return cached || new Response("", {
            status: 503,
            statusText: "Asset unavailable"
        });
    }
}

async function staleWhileRevalidatePresentation(event, request) {
    const cache = await caches.open(PRESENTATION_CACHE);
    const cached = await cache.match(request);
    const update = fetch(request, { cache: "no-cache" }).then(async response => {
        if (response.ok) await cache.put(request, response.clone());
        return response;
    }).catch(() => null);
    if (cached) { event.waitUntil(update); return cached; }
    return await update || new Response(JSON.stringify({ success: false, code: "HOME_PRESENTATION_UNAVAILABLE" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
    });
}

async function refreshPublicHomePresentation() {
    const cache = await caches.open(PRESENTATION_CACHE);
    const regions = ["MM", "TH"];
    const results = await Promise.allSettled(regions.map(async region => {
        const request = new Request(new URL(`/api/public/home-presentation?region=${region}`, self.location.origin), {
            credentials: "omit",
            cache: "no-cache"
        });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`home-presentation-${region}-${response.status}`);
        await cache.put(request, response.clone());
        return region;
    }));
    return {
        ok: results.every(result => result.status === "fulfilled"),
        refreshed: results.filter(result => result.status === "fulfilled").map(result => result.value)
    };
}

/**
 * Images and fonts rarely change.
 * Serve cached media immediately and download it only when missing.
 */
async function cacheFirstMediaAsset(request) {
    const cache = await caches.open(MEDIA_CACHE);
    const url = new URL(request.url);
    const cacheKey = isVersionedCodeAsset(url) ? request : createNormalizedCacheKey(request);
    const cached = await cache.match(cacheKey);

    if (cached) return cached;

    const response = await fetch(request);

    if (response.ok && response.type === "basic") {
        await cache.put(cacheKey, response.clone());
    }

    return response;
}

async function networkOnly(request) {
    return fetch(request, {
        cache: "no-store"
    });
}

async function deleteOldAzielCaches() {
    const activeCaches = new Set([
        CORE_CACHE,
        PAGE_CACHE,
        CODE_CACHE,
        MEDIA_CACHE,
        PRESENTATION_CACHE
    ]);

    const cacheNames = await caches.keys();

    await Promise.all(
        cacheNames
            .filter(cacheName =>
                (
                    cacheName.startsWith("aziel-") ||
                    cacheName.startsWith(CACHE_PREFIX)
                ) &&
                !activeCaches.has(cacheName)
            )
            .map(cacheName => caches.delete(cacheName))
    );
}

async function clearRuntimeCaches() {
    await Promise.all([
        caches.delete(PAGE_CACHE),
        caches.delete(CODE_CACHE),
        caches.delete(MEDIA_CACHE),
        caches.delete(PRESENTATION_CACHE)
    ]);
}
