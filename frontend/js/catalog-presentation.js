// frontend/js/catalog-presentation.js
// Presentation compatibility for customer catalog routes, categories, and media.
// Backend catalog owns product/package availability and financial truth.

(function () {
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
            description: "RP Pack",
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

    const DEFAULT_PRODUCT_ICON = "assets/games/mlbb.webp";
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

    function mediaFirst(value, fallback = "") {
        const mediaUrl = String(value || "").trim();
        if (mediaUrl) return mediaUrl;
        return fallback;
    }

    function resolveProductImage(product = {}) {
        const fallback = getProductImage(product.productCode);
        return mediaFirst(product.imageUrl || product.image, fallback);
    }

    function resolveProductBanner(product = {}) {
        return mediaFirst(product.bannerUrl || product.banner, "");
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
        if (!product || !presentation?.route) return null;

        return {
            ...product,
            route: presentation.route,
            image: resolveProductImage(product),
            fallbackImage: presentation.image,
            banner: resolveProductBanner(product),
            category: presentation.category,
            featured: Boolean(presentation.featured),
            description: presentation.description || "",
            searchDescription: presentation.searchDescription || presentation.description || "",
            theme: presentation.theme || ""
        };
    }

    window.AZIEL_CATALOG_PRESENTATION = {
        PRODUCT_PRESENTATION,
        DEFAULT_PACKAGE_ICONS,
        getProductPresentation,
        getProductRoute,
        getProductImage,
        resolveProductImage,
        resolveProductBanner,
        getPackageIcon,
        resolvePackageIcon,
        imageFallbackAttributes,
        bindImageFallbacks,
        isDiscoverable,
        buildDisplayProduct
    };
})();
