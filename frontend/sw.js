const AZIEL_SW_VERSION = "aziel-v26-pwa-icons";
const STATIC_CACHE = `${AZIEL_SW_VERSION}-static`;
const PUBLIC_PAGE_CACHE = `${AZIEL_SW_VERSION}-pages`;

const STATIC_ASSETS = [
    "/offline.html",
    "/manifest.json",
    "/assets/logo/aziel-wordmark.webp",
    "/icons/aziel-app-icon-192.png",
    "/icons/aziel-app-icon-512.png",
    "/icons/aziel-app-icon-maskable-192.png",
    "/icons/aziel-app-icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/css/theme/aziel-design-system.css",
    "/css/theme/aziel-header.css",
    "/css/core/main.css",
    "/css/core/footer.css",
    "/css/support/live-chat.css",
    "/js/pwa-fix.js"
];

const PUBLIC_HTML_ALLOWLIST = new Set([
    "/",
    "/home.html",
    "/mobile-games.html",
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

const PRIVATE_OR_DYNAMIC_PATHS = [
    "/api/",
    "/socket.io/",
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
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith("aziel-") && ![STATIC_CACHE, PUBLIC_PAGE_CACHE].includes(key))
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (isPrivateOrDynamic(url.pathname)) return;

    if (request.mode === "navigate") {
        event.respondWith(networkFirstPublicPage(request, url));
        return;
    }

    if (isStaticAsset(url.pathname)) {
        event.respondWith(cacheFirst(request));
    }
});

function isPrivateOrDynamic(pathname) {
    return PRIVATE_OR_DYNAMIC_PATHS.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

function isPublicHtml(pathname) {
    return PUBLIC_HTML_ALLOWLIST.has(pathname);
}

function isStaticAsset(pathname) {
    return /\.(?:css|js|png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(pathname);
}

async function networkFirstPublicPage(request, url) {
    if (!isPublicHtml(url.pathname)) {
        return fetch(request).catch(() => caches.match("/offline.html"));
    }

    const cache = await caches.open(PUBLIC_PAGE_CACHE);

    try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return (await cache.match(request)) || caches.match("/offline.html");
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, response.clone());
    }
    return response;
}
