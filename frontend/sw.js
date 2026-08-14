const CACHE_PREFIX = "aziel-runtime";
const CORE_CACHE = `${CACHE_PREFIX}-core-v1`;
const PAGE_CACHE = `${CACHE_PREFIX}-pages-v1`;
const CODE_CACHE = `${CACHE_PREFIX}-code-v2`;
const MEDIA_CACHE = `${CACHE_PREFIX}-media-v1`;

const CORE_ASSETS = [
    "/offline.html",
    "/manifest.json",
    "/assets/logo/aziel-wordmark.webp",
    "/icons/aziel-app-icon-192.png",
    "/icons/aziel-app-icon-512.png",
    "/icons/aziel-app-icon-maskable-192.png",
    "/icons/aziel-app-icon-maskable-512.png",
    "/icons/apple-touch-icon.png"
];

const PUBLIC_HTML_ALLOWLIST = new Set([
    "/",
    "/home.html",
    "/mobile-games.html",
    "/all-games.html",
    "/pc-games.html",
    "/gift-cards.html",
    "/social-topup.html",
    "/mlbb.html",
    "/pubg.html",
    "/freefire.html",
    "/hok.html",
    "/aov-id.html",
    "/pubg-rp.html",
    "/telegram.html",
    "/genshin.html",
    "/roblox.html",
    "/valorant.html",
    "/faq.html",
    "/about.html",
    "/contact.html",
    "/policies/privacy.html",
    "/policies/terms.html",
    "/policies/payment.html",
    "/policies/refund.html",
    "/policies/support.html"
]);

const NEVER_CACHE_PREFIXES = [
    "/api/",
    "/socket.io/"
];

const PRIVATE_NAVIGATION_PREFIXES = [
    "/admin",
    "/account",
    "/wallet",
    "/tracking",
    "/notifications",
    "/support",
    "/login",
    "/register",
    "/verify",
    "/reset",
    "/forgot"
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
    event.waitUntil(
        Promise.all([
            deleteOldAzielCaches(),
            self.registration.navigationPreload?.enable()
        ]).then(() => self.clients.claim())
    );
});

self.addEventListener("message", event => {
    if (event.data?.type === "SKIP_WAITING") {
        self.skipWaiting();
    }

    if (event.data?.type === "CLEAR_RUNTIME_CACHES") {
        event.waitUntil(clearRuntimeCaches());
    }
});

self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    if (isNeverCachePath(url.pathname)) {
        event.respondWith(networkOnly(request));
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(handleNavigation(event, request, url));
        return;
    }

    if (isCodeAsset(url.pathname)) {
        event.respondWith(isVersionedCodeAsset(url)
            ? cacheFirstVersionedCodeAsset(request)
            : networkFirstCodeAsset(request));
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

function isPrivateNavigation(pathname) {
    return PRIVATE_NAVIGATION_PREFIXES.some(prefix =>
        pathname === prefix || pathname.startsWith(prefix)
    );
}

function isPublicHtml(pathname) {
    return PUBLIC_HTML_ALLOWLIST.has(pathname);
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

async function handleNavigation(event, request, url) {
    if (isPrivateNavigation(url.pathname)) {
        return networkOnlyNavigation(event, request);
    }

    if (!isPublicHtml(url.pathname)) {
        return networkOnlyNavigation(event, request);
    }

    return networkFirstPublicPage(event, request);
}

/**
 * Public pages:
 * Always request the latest HTML first.
 * Cached HTML is used only when offline.
 */
async function networkFirstPublicPage(event, request) {
    const cache = await caches.open(PAGE_CACHE);
    const cacheKey = createNormalizedCacheKey(request);

    try {
        const preloadResponse = await event.preloadResponse;

        if (preloadResponse?.ok) {
            await cache.put(cacheKey, preloadResponse.clone());
            return preloadResponse;
        }

        const response = await fetch(request, {
            cache: "no-store"
        });

        if (response.ok && response.type === "basic") {
            await cache.put(cacheKey, response.clone());
        }

        return response;
    } catch {
        return (
            await cache.match(cacheKey) ||
            await caches.match("/offline.html")
        );
    }
}

/**
 * Admin, account, wallet and authentication pages:
 * Never cache their HTML.
 */
async function networkOnlyNavigation(event, request) {
    try {
        const preloadResponse = await event.preloadResponse;

        if (preloadResponse) {
            return preloadResponse;
        }

        return await fetch(request, {
            cache: "no-store"
        });
    } catch {
        return caches.match("/offline.html");
    }
}

/**
 * JavaScript, CSS and JSON:
 * Network-first ensures the latest deployed code is used immediately.
 * Cache is only an offline fallback.
 */
async function networkFirstCodeAsset(request) {
    const cache = await caches.open(CODE_CACHE);
    const cacheKey = createNormalizedCacheKey(request);

    try {
        const response = await fetch(request, {
            cache: "no-store"
        });

        if (response.ok && response.type === "basic") {
            await cache.put(cacheKey, response.clone());
        }

        return response;
    } catch {
        const cached = await cache.match(cacheKey);

        if (cached) return cached;

        return new Response("", {
            status: 503,
            statusText: "Asset unavailable"
        });
    }
}

async function cacheFirstVersionedCodeAsset(request) {
    const cache = await caches.open(CODE_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request, { cache: "no-store" });
    if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
    }
    return response;
}

/**
 * Images and fonts rarely change.
 * Serve cached media immediately and download it only when missing.
 */
async function cacheFirstMediaAsset(request) {
    const cache = await caches.open(MEDIA_CACHE);
    const cacheKey = createNormalizedCacheKey(request);
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
        MEDIA_CACHE
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
        caches.delete(MEDIA_CACHE)
    ]);
}
