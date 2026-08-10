// frontend/js/catalog-presentation.js
// Presentation compatibility for customer catalog routes, categories, and media.
// Backend catalog owns product/package availability and financial truth.

(function () {
    const CANONICAL_PRODUCT_ROUTES = Object.freeze({
        mlbb: "mlbb.html",
        "mlbb-twilight-weekly-pass": "product.html?product=mlbb-twilight-weekly-pass",
        pubg: "pubg.html",
        pubgrp: "pubg-rp.html",
        freefire: "freefire.html",
        "marvel-rivals": "product.html?product=marvel-rivals",
        "blood-strike": "product.html?product=blood-strike",
        "blood-strike-pass": "product.html?product=blood-strike-pass",
        "age-of-empires-mobile": "product.html?product=age-of-empires-mobile",
        "lineage-2m": "product.html?product=lineage-2m",
        overmortal: "product.html?product=overmortal",
        "magic-chess-go-go": "product.html?product=magic-chess-go-go",
        lifeafter: "product.html?product=lifeafter",
        hok: "hok.html",
        telegram: "telegram.html",
        capcut: "product.html?product=capcut"
    });
    const CANONICAL_HOME_PRODUCT_GROUPS = Object.freeze({
        popularMobileGames: Object.freeze(["mlbb", "pubg", "freefire", "hok", "marvel-rivals", "blood-strike"]),
        mobileGames: Object.freeze([
            "mlbb", "mlbb-twilight-weekly-pass", "pubg", "pubgrp", "freefire", "marvel-rivals", "blood-strike",
            "blood-strike-pass", "age-of-empires-mobile", "lineage-2m", "overmortal", "magic-chess-go-go",
            "lifeafter", "hok"
        ]),
        socialTopUp: Object.freeze(["telegram", "capcut"])
    });

    function assetFallback(path) {
        return String(path || "").replace(/^\/+/, "");
    }

    function assetFor(productCode, path) {
        const code = String(productCode || "").trim();
        const cleanPath = String(path || "").replace(/^\/+/, "");
        return window.ASSET?.[code]?.(cleanPath) || assetFallback(`assets/${code}/${cleanPath}`);
    }

    const PRODUCT_PRESENTATION = {
        mlbb: {
            route: "mlbb.html",
            image: "assets/games/mlbb.webp",
            category: "mobile",
            featured: true,
            description: "Diamonds • Myanmar / Thailand",
            searchDescription: "Instant Top Up",
            theme: "purple"
        },
        pubg: {
            route: "pubg.html",
            image: "assets/games/pubg.webp",
            category: "mobile",
            featured: true,
            description: "UC Top Up • Global",
            searchDescription: "Global / Thailand",
            theme: "blue"
        },
        freefire: {
            route: "freefire.html",
            image: "assets/games/freefire.webp",
            category: "mobile",
            featured: false,
            description: "Diamonds Top Up",
            searchDescription: "Fast Delivery"
        },
        hok: {
            route: "hok.html",
            image: "assets/games/hok.webp",
            category: "mobile",
            featured: true,
            description: "Tokens • Global",
            searchDescription: "MOBA Top Up",
            theme: "pink"
        },
        "marvel-rivals": {
            route: CANONICAL_PRODUCT_ROUTES["marvel-rivals"],
            image: "assets/fallbacks/game-topup.svg",
            category: "mobile",
            featured: true,
            description: "Top Up",
            searchDescription: "Top Up"
        },
        "blood-strike": {
            route: CANONICAL_PRODUCT_ROUTES["blood-strike"],
            image: "assets/fallbacks/game-topup.svg",
            category: "mobile",
            featured: true,
            description: "Golds, Pass",
            searchDescription: "Golds, Pass"
        },
        "age-of-empires-mobile": {
            route: CANONICAL_PRODUCT_ROUTES["age-of-empires-mobile"],
            image: "assets/fallbacks/game-topup.svg",
            category: "mobile",
            description: "Top Up",
            searchDescription: "Top Up"
        },
        "lineage-2m": {
            route: CANONICAL_PRODUCT_ROUTES["lineage-2m"],
            image: "assets/fallbacks/game-topup.svg",
            category: "mobile",
            description: "Top Up",
            searchDescription: "Top Up"
        },
        overmortal: {
            route: CANONICAL_PRODUCT_ROUTES.overmortal,
            image: "assets/fallbacks/game-topup.svg",
            category: "mobile",
            description: "Voucher",
            searchDescription: "Voucher"
        },
        "magic-chess-go-go": {
            route: CANONICAL_PRODUCT_ROUTES["magic-chess-go-go"],
            image: "assets/fallbacks/game-topup.svg",
            category: "mobile",
            description: "Top Up",
            searchDescription: "Top Up"
        },
        lifeafter: {
            route: CANONICAL_PRODUCT_ROUTES.lifeafter,
            image: "assets/fallbacks/game-topup.svg",
            category: "mobile",
            description: "Credits & Package",
            searchDescription: "Credits & Package"
        },
        "mlbb-twilight-weekly-pass": {
            route: CANONICAL_PRODUCT_ROUTES["mlbb-twilight-weekly-pass"],
            image: "assets/games/mlbb.webp",
            category: "mobile",
            description: "Twilight Pass & Weekly Pass",
            searchDescription: "Twilight Pass & Weekly Pass"
        },
        "blood-strike-pass": {
            route: CANONICAL_PRODUCT_ROUTES["blood-strike-pass"],
            image: "assets/fallbacks/game-topup.svg",
            category: "mobile",
            description: "Pass",
            searchDescription: "Pass"
        },
        aovid: {
            route: "aov-id.html",
            image: "assets/games/aov-id.webp",
            category: "mobile",
            featured: false,
            description: "Vouchers Top Up",
            searchDescription: "Vouchers Top Up"
        },
        pubgrp: {
            route: "pubg-rp.html",
            image: "assets/games/pubg-rp.webp",
            category: "mobile",
            featured: false,
            description: "Royale Pass Pack",
            searchDescription: "Royale Pass Pack"
        },
        telegram: {
            route: "telegram.html",
            image: "assets/giftcards/telegram.webp",
            category: "gift-card",
            featured: false,
            description: "Stars & Premium",
            searchDescription: "Stars & Premium"
        },
        capcut: {
            route: CANONICAL_PRODUCT_ROUTES.capcut,
            image: "assets/fallbacks/digital-services.svg",
            category: "gift-card",
            featured: false,
            description: "Top Up",
            searchDescription: "Top Up"
        },
        genshin: {
            route: "genshin.html",
            image: "assets/games/genshin.webp",
            category: "mobile",
            unsupportedWhenDisabled: true,
            description: "Coming Soon",
            searchDescription: "Coming Soon"
        },
        roblox: {
            route: "roblox.html",
            image: "assets/games/roblox.webp",
            category: "mobile",
            unsupportedWhenDisabled: true,
            description: "Coming Soon",
            searchDescription: "Coming Soon"
        },
        valorant: {
            route: "",
            image: "assets/games/valorant.webp",
            category: "pc",
            unsupportedWhenDisabled: true,
            description: "Coming Soon",
            searchDescription: "Coming Soon"
        }
    };

    const HOME_PRESENTATION_RECORDS = Object.freeze({
        mlbb: { name: "Mobile Legends", description: "Diamonds" },
        pubg: { name: "PUBG Mobile", description: "UC" },
        freefire: { name: "Free Fire", description: "Diamonds" },
        hok: { name: "Honor of Kings", description: "Tokens & Packages" },
        "marvel-rivals": { name: "Marvel Rivals", description: "Top Up" },
        "blood-strike": { name: "Blood Strike", description: "Golds, Pass" },
        "age-of-empires-mobile": { name: "Age of Empires Mobile", description: "Top Up" },
        "lineage-2m": { name: "Lineage 2M", description: "Top Up" },
        overmortal: { name: "OverMortal", description: "Voucher" },
        "magic-chess-go-go": { name: "Magic Chess: Go Go", description: "Top Up" },
        lifeafter: { name: "LifeAfter", description: "Credits & Package" },
        pubgrp: { name: "PUBG Mobile Royale Pass Pack", description: "Royale Pass Pack" },
        "mlbb-twilight-weekly-pass": { name: "Mobile Legends Twilight Pass & Weekly Pass", description: "Twilight Pass & Weekly Pass" },
        "blood-strike-pass": { name: "Blood Strike Pass", description: "Pass" },
        telegram: { name: "Telegram Top Up", description: "Stars & Premium" },
        capcut: { name: "CapCut Top Up", description: "Top Up" }
    });

    const DEFAULT_PRODUCT_ICON = "assets/fallbacks/game-topup.svg";
    const DEFAULT_PACKAGE_ICONS = {
        mlbb: "assets/mlbb/icons/small.webp",
        pubg: "assets/games/pubg.webp",
        freefire: "assets/games/freefire.webp",
        hok: "assets/games/hok.webp",
        aovid: "assets/games/aov-id.webp",
        pubgrp: "assets/games/pubg-rp.webp",
        telegram: "assets/giftcards/telegram.webp",
        genshin: "assets/games/genshin.webp",
        roblox: "assets/games/roblox.webp",
        valorant: "assets/games/valorant.webp"
    };

    const PACKAGE_ICON_RULES = {
        mlbb: [
            [/WEEKLY/i, "weekly.webp"],
            [/13_1|22|42/i, "small.webp"],
            [/56|86|112|172/i, "medium.webp"],
            [/284/i, "big.webp"],
            [/344/i, "cheset.webp"],
            [/570|716/i, "cheset2.webp"],
            [/1163|1160_186|1360_335/i, "cheset3.webp"],
            [/2015_475/i, "cheset4.webp"],
            [/5000_1000|7740_1548/i, "cheset5.webp"]
        ],
        pubg: [[/.*/, "uc.webp"]],
        freefire: [[/.*/, "diamond.webp"]],
        hok: [
            [/WEEKLY_CARD_PLUS/i, "weekly-plus.webp"],
            [/WEEKLY/i, "weekly.webp"],
            [/.*/, "token.webp"]
        ],
        aovid: [[/.*/, "voucher.webp"]],
        pubgrp: [[/.*/, "rp.webp"]],
        telegram: [
            [/PREMIUM/i, "premium.webp"],
            [/.*/, "stars.webp"]
        ]
    };

    function getProductPresentation(productCode) {
        const code = String(productCode || "").trim().toLowerCase();
        return PRODUCT_PRESENTATION[code] || null;
    }

    function getProductRoute(productCode) {
        return getProductPresentation(productCode)?.route || "";
    }

    function getProductImage(productCode) {
        return getProductPresentation(productCode)?.image || DEFAULT_PRODUCT_ICON;
    }

    function getCanonicalHomeProductCodes(group = "") {
        return [...(CANONICAL_HOME_PRODUCT_GROUPS[group] || [])];
    }

    function getHomePresentationRecord(productCode) {
        const code = String(productCode || "").trim().toLowerCase();
        const presentation = getProductPresentation(code);
        const record = HOME_PRESENTATION_RECORDS[code];
        if (!presentation || !record) return null;
        return {
            productCode: code,
            name: record.name,
            description: record.description || presentation.description || "Top Up",
            image: presentation.image,
            route: resolveCanonicalProductRoute(code, presentation.route || `coming-soon.html?product=${encodeURIComponent(code)}`),
            category: presentation.category || "mobile",
            enabled: true,
            homepageEnabled: true,
            discoverable: true,
            purchasable: false,
            commerceState: "COMING_SOON",
            homepageSections: presentation.category === "gift-card" ? ["SOCIAL_TOPUP"] : ["POPULAR_GAME_TOPUP"]
        };
    }

    function mediaFirst(value, fallback = "") {
        const mediaUrl = String(value || "").trim();
        if (mediaUrl) return mediaUrl;
        return fallback;
    }

    function resolveProductImage(product = {}) {
        const fallback = getProductImage(product.productCode);
        return mediaFirst(product.imageUrl || product.image || product.artworkPath, fallback);
    }

    function resolveProductBanner(product = {}) {
        return mediaFirst(product.bannerUrl || product.banner, "");
    }

    function resolveMobilePackagePreview(product = {}) {
        const productCode = typeof product === "object" && product !== null
            ? product.productCode
            : product;
        const fallback = getProductImage(productCode);
        if (typeof product !== "object" || product === null) return fallback;

        return mediaFirst(
            product.mobilePackagePreviewUrl ||
            product.mobilePackagePreview?.url ||
            product.mobilePackagePreview?.asset?.secureUrl ||
            product.mobilePackagePreview?.asset?.url,
            fallback
        );
    }

    function getPackageIcon(productCode, packageCode) {
        const code = String(productCode || "").trim().toLowerCase();
        const packageId = String(packageCode || "").trim().toUpperCase();
        const rules = PACKAGE_ICON_RULES[code] || [];
        const match = rules.find(([pattern]) => pattern.test(packageId));

        if (match) {
            return assetFor(code, `icons/${match[1]}`);
        }

        return DEFAULT_PACKAGE_ICONS[code] || getProductImage(code);
    }

    function resolvePackageIcon(productOrPackage, packageCode = "") {
        const item = typeof productOrPackage === "object" && productOrPackage !== null
            ? productOrPackage
            : { productCode: productOrPackage, packageCode };
        const productCode = item.productCode;
        const code = item.packageCode || packageCode;

        return mediaFirst(item.iconUrl || item.icon, getPackageIcon(productCode, code));
    }

    function imageFallbackAttributes(fallback = "") {
        const safeFallback = String(fallback || "").trim();
        if (!safeFallback) return "";
        return ` data-fallback-src="${safeFallback.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`;
    }

    function bindImageFallbacks(root = document) {
        root.querySelectorAll("img[data-fallback-src]").forEach(img => {
            if (img.dataset.azielFallbackBound === "true") return;
            img.dataset.azielFallbackBound = "true";
            img.addEventListener("error", () => {
                const fallback = img.dataset.fallbackSrc || "";
                if (!fallback || img.getAttribute("src") === fallback) return;
                img.src = fallback;
            });
        });
    }

    function isDiscoverable(productCode, category) {
        const presentation = getProductPresentation(productCode);
        if (!presentation?.route) return false;
        if (!category) return true;
        return presentation.category === category;
    }

    function buildDisplayProduct(product) {
        const presentation = getProductPresentation(product?.productCode);
        const route = resolveCanonicalProductRoute(product?.productCode, product?.productRoute || presentation?.route || "");
        if (!product || !route) return null;
        const authoritativeCategory = String(product.homepageCategory || product.catalogCategory || "").toLowerCase().replaceAll("_", "-");

        return {
            ...product,
            route,
            image: resolveProductImage(product),
            fallbackImage: presentation?.image || DEFAULT_PRODUCT_ICON,
            banner: resolveProductBanner(product),
            category: authoritativeCategory || presentation?.category || "",
            featured: (product.homepageFlags || []).includes("FEATURED") || Boolean(presentation?.featured),
            isNew: (product.homepageFlags || []).includes("NEW"),
            trending: (product.homepageFlags || []).includes("TRENDING"),
            description: product.description || presentation?.description || "",
            searchDescription: product.description || presentation?.searchDescription || presentation?.description || "",
            theme: presentation?.theme || ""
        };
    }

    window.AZIEL_CATALOG_PRESENTATION = {
        CANONICAL_PRODUCT_ROUTES,
        CANONICAL_HOME_PRODUCT_GROUPS,
        PRODUCT_PRESENTATION,
        HOME_PRESENTATION_RECORDS,
        DEFAULT_PACKAGE_ICONS,
        getProductPresentation,
        getHomePresentationRecord,
        getCanonicalHomeProductCodes,
        getProductRoute,
        resolveCanonicalProductRoute,
        getProductImage,
        resolveProductImage,
        resolveProductBanner,
        resolveMobilePackagePreview,
        getPackageIcon,
        resolvePackageIcon,
        imageFallbackAttributes,
        bindImageFallbacks,
        isDiscoverable,
        buildDisplayProduct
    };

    function resolveCanonicalProductRoute(productCode, fallbackRoute = "") {
        const code = String(productCode || "").trim().toLowerCase();
        return CANONICAL_PRODUCT_ROUTES[code] || String(fallbackRoute || "").trim();
    }
})();
