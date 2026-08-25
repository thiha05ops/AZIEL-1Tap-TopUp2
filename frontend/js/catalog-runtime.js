// frontend/js/catalog-runtime.js
// Customer catalog store. Public catalog API is the primary frontend catalog source.

(function () {
    const CACHE_TTL_MS = 45000;
    const REGION_CURRENCIES = {
        MM: "MMK",
        TH: "THB"
    };
    const AVAILABILITY_MESSAGES = Object.freeze({
        AVAILABLE: "Available.",
        COMING_SOON: "Coming soon.",
        PRODUCT_HIDDEN: "This product is currently unavailable.",
        PRODUCT_DISABLED: "This product is currently unavailable.",
        REGION_UNAVAILABLE: "This product is not available in your region.",
        PACKAGE_UNAVAILABLE: "This package is currently unavailable.",
        SETUP_INCOMPLETE: "This product is currently unavailable.",
        PRICING_UNAVAILABLE: "Prices are temporarily unavailable. Please try again shortly.",
        CATALOG_UNAVAILABLE: "Catalog is temporarily unavailable. Please try again shortly."
    });

    let catalog = null;
    let productIndex = new Map();
    let packageIndex = new Map();
    let loadedAt = 0;
    let loadingPromise = null;
    let lastError = "";
    let status = "idle";

    function now() {
        return Date.now();
    }

    function normalizeProductCode(productCode) {
        return String(productCode || "").trim().toLowerCase();
    }

    function normalizePackageCode(packageCode) {
        return String(packageCode || "").trim().toUpperCase();
    }

    function normalizeRegion(region) {
        return String(region || "MM").trim().toUpperCase() === "TH" ? "TH" : "MM";
    }

    function clone(value) {
        return value ? JSON.parse(JSON.stringify(value)) : value;
    }

    function emitCatalogUpdated(detail = {}) {
        document.dispatchEvent(
            new CustomEvent("aziel:catalog-updated", {
                detail: {
                    status,
                    updatedAt: getUpdatedAt(),
                    ...detail
                }
            })
        );
    }

    function buildIndexes(nextCatalog) {
        productIndex = new Map();
        packageIndex = new Map();

        (nextCatalog?.products || []).forEach(product => {
            const productCode = normalizeProductCode(product.productCode);
            if (!productCode) return;

            const normalizedProduct = {
                ...product,
                productCode,
                packages: Array.isArray(product.packages) ? product.packages : []
            };

            productIndex.set(productCode, normalizedProduct);

            normalizedProduct.packages.forEach(item => {
                const packageCode = normalizePackageCode(item.packageCode);
                if (!packageCode) return;
                packageIndex.set(`${productCode}:${packageCode}`, {
                    ...item,
                    productCode,
                    packageCode
                });
            });
        });
    }

    function isFresh() {
        return Boolean(catalog && now() - loadedAt < CACHE_TTL_MS);
    }

    function isReady() {
        return Boolean(catalog && status === "ready");
    }

    async function load(options = {}) {
        if (loadingPromise) return loadingPromise;
        if (!options.force && isFresh()) return catalog;

        status = "loading";
        emitCatalogUpdated({ loading: true, source: options.source || "catalog" });

        loadingPromise = fetch("/api/catalog", {
            cache: "no-store",
            headers: { Accept: "application/json" }
        })
            .then(async response => {
                const data = await response.json().catch(() => ({}));

                if (!response.ok || !data.success || !Array.isArray(data.products)) {
                    throw new Error(data.message || "Catalog unavailable");
                }

                catalog = data;
                loadedAt = now();
                lastError = "";
                status = "ready";
                buildIndexes(catalog);
                emitCatalogUpdated({ loading: false, source: options.source || "catalog" });
                return catalog;
            })
            .catch(error => {
                lastError = error?.message || "Catalog unavailable";
                catalog = null;
                loadedAt = 0;
                status = "error";
                buildIndexes(null);
                emitCatalogUpdated({ loading: false, error: lastError, source: options.source || "catalog" });
                throw error;
            })
            .finally(() => {
                loadingPromise = null;
            });

        return loadingPromise;
    }

    function refresh() {
        return load({ force: true });
    }

    async function ensureFresh(options = {}) {
        if (!options.force && isFresh()) return catalog;
        return load({ force: true });
    }

    async function ensureFreshForPurchase() {
        await load({ force: true, source: "purchase" });
        return isReady();
    }

    function getProducts(options = {}) {
        const category = options.category || "";
        const presentation = window.AZIEL_CATALOG_PRESENTATION;

        return Array.from(productIndex.values())
            .filter(product => product.enabled !== false)
            .map(product => presentation?.buildDisplayProduct?.(product) || product)
            .filter(Boolean)
            .filter(product => !category || product.publicCategory === category);
    }

    function getProduct(productCode) {
        return productIndex.get(normalizeProductCode(productCode)) || null;
    }

    function getPackages(productCode, region = "MM") {
        const normalizedRegion = normalizeRegion(region);
        const product = getProduct(productCode);
        const presentation = window.AZIEL_CATALOG_PRESENTATION;

        if (!product || product.enabled === false || product.supportedRegions?.includes(normalizedRegion) === false) return [];

        return (product.packages || [])
            .map(item => projectPackage(product, item, normalizedRegion, presentation))
            .filter(Boolean);
    }

    function projectPackage(product, item, region, presentation) {
        if (!item || item.enabled === false) return null;
        if (item.fulfillmentRegions && item.fulfillmentRegions[region] !== true) return null;

        const price = item.prices?.[region] || null;
        if (!price || price.enabled === false) return null;

        const amount = Number(price.amount);
        if (!Number.isFinite(amount) || amount <= 0) return null;

        const referencePrice = Number(price.referencePrice || 0);
        const saveAmount = Number(price.saveAmount || 0);
        const discountPercent = Number(price.discountPercent || 0);

        const hasReferencePrice =
            Number.isFinite(referencePrice) &&
            referencePrice > amount;

        return {
            productCode: product.productCode,
            productName: product.name,
            packageCode: normalizePackageCode(item.packageCode),
            name: item.name,
            packageFamily: item.packageFamily || null,

            amount,
            price: amount,
            currency: price.currency || REGION_CURRENCIES[region],
            region,

            referencePrice: hasReferencePrice ? referencePrice : 0,
            originalPrice: hasReferencePrice ? referencePrice : 0,

            saveAmount:
                hasReferencePrice && Number.isFinite(saveAmount)
                    ? Math.max(0, saveAmount)
                    : 0,

            discountPercent:
                hasReferencePrice && Number.isFinite(discountPercent)
                    ? Math.max(0, discountPercent)
                    : 0,

            showDiscount:
                hasReferencePrice && price.showDiscount === true,

            showOriginalPrice:
                hasReferencePrice && price.showOriginalPrice === true,

            showSaveAmount:
                hasReferencePrice && price.showSaveAmount === true,

            discountLabel:
                hasReferencePrice
                    ? String(price.discountLabel || "").trim()
                    : "",

            publishedPriceMode: price.publishedPriceMode || "",
            manualOverrideReason: price.manualOverrideReason || "",

            sortOrder: Number(item.sortOrder || 0),
            updatedAt: item.updatedAt || product.updatedAt || "",
            customerNote: resolveLocalizedCustomerNote(item),

            icon:
                presentation?.resolvePackageIcon?.(item) ||
                presentation?.getPackageIcon?.(
                    product.productCode,
                    item.packageCode
                ) ||
                "",

            // Catalog-managed package media is optional. Keep it separate from
            // legacy presentation icons so desktop cards never imply artwork
            // where the package itself has none.
            artwork: String(item.iconUrl || "").trim(),
            artworkAlt: String(item.iconAltText || item.name || "").trim(),

            fallbackIcon:
                presentation?.getPackageIcon?.(
                    product.productCode,
                    item.packageCode
                ) || "",

            rawPrice: price,
            rawPackage: item,
            rawProduct: product
        };
    }

    function resolveLocalizedCustomerNote(item = {}) {
        const locale = window.AZIEL_LOCALE?.getLocale?.() || window.AZIEL_I18N?.getLang?.() || "en";
        const locales = item.customerNoteLocales || {};
        return String(locales[locale] || locales.en || item.customerNote || "").trim();
    }

    function getPackage(productCode, packageCode, region = "MM") {
        const normalizedProductCode = normalizeProductCode(productCode);
        const product = getProduct(normalizedProductCode);
        const item = packageIndex.get(`${normalizedProductCode}:${normalizePackageCode(packageCode)}`);

        if (!product || product.enabled === false || !item) return null;

        return projectPackage(
            product,
            item,
            normalizeRegion(region),
            window.AZIEL_CATALOG_PRESENTATION
        );
    }

    function getAvailability(productCode, region = "MM") {
        if (!isReady()) return { code: "CATALOG_UNAVAILABLE", message: availabilityMessage("CATALOG_UNAVAILABLE") };
        const product = getProduct(productCode);
        if (!product) return { code: "PRODUCT_HIDDEN", message: availabilityMessage("PRODUCT_HIDDEN") };
        const normalizedRegion = normalizeRegion(region);
        const regional = product.publicReadiness?.regions?.[normalizedRegion];
        const useRegionalAvailability = product.availabilityCode === "AVAILABLE";
        const code = useRegionalAvailability && regional?.availabilityCode
            ? regional.availabilityCode
            : (product.availabilityCode || product.publicReadiness?.availabilityCode || "SETUP_INCOMPLETE");
        return {
            code,
            message: (useRegionalAvailability ? regional?.availabilityReason : product.availabilityReason) || availabilityMessage(code),
            product,
            region: normalizedRegion
        };
    }

    function availabilityMessage(code) {
        return AVAILABILITY_MESSAGES[String(code || "").toUpperCase()] || AVAILABILITY_MESSAGES.SETUP_INCOMPLETE;
    }

    function overlayGamePrices(productCode, fallbackPackages = []) {
        const product = getProduct(productCode);

        if (!catalog) {
            return {
                synced: false,
                unavailable: false,
                packages: []
            };
        }

        if (!product || product.enabled === false) {
            return {
                synced: true,
                unavailable: true,
                packages: []
            };
        }

        const fallbackByCode = new Map(
            (fallbackPackages || []).map(item => [normalizePackageCode(item.code || item.packageCode), item])
        );

        return {
            synced: true,
            unavailable: false,
            packages: (product.packages || [])
                .filter(item => item.enabled !== false)
                .map(item => {
                    const packageCode = normalizePackageCode(item.packageCode);
                    const fallback = fallbackByCode.get(packageCode) || {};
                    return {
                        ...fallback,
                        productCode: product.productCode,
                        name: item.name,
                        packageFamily: item.packageFamily || null,
                        code: packageCode,
                        packageCode,
                        mmk: Number(item.prices?.MM?.amount || 0),
                        thb: Number(item.prices?.TH?.amount || 0),
                        icon: window.AZIEL_CATALOG_PRESENTATION?.resolvePackageIcon?.({
                            ...item,
                            productCode: product.productCode,
                            packageCode
                        }) || fallback.icon || "",
                        fallbackIcon: window.AZIEL_CATALOG_PRESENTATION?.getPackageIcon?.(product.productCode, packageCode) || fallback.icon || "",
                        catalogUpdatedAt: item.updatedAt || product.updatedAt || "",
                        catalogSynced: true
                    };
                })
        };
    }

    function getCatalog() {
        return clone(catalog);
    }

    function getUpdatedAt() {
        return loadedAt ? new Date(loadedAt).toISOString() : "";
    }

    function getStatus() {
        return status;
    }

    const api = {
        load,
        refresh,
        ensureFresh,
        ensureFreshForPurchase,
        getProducts,
        getProduct,
        getPackages,
        getPackage,
        getAvailability,
        availabilityMessage,
        overlayGamePrices,
        isReady,
        isFresh,
        getUpdatedAt,
        getStatus,
        getLastError: () => lastError,
        getCatalog,
        normalizeRegion
    };

    window.AZIEL_CATALOG = api;
    window.AZIEL_CATALOG_RUNTIME = {
        loadCatalog: load,
        ensureFreshForPurchase,
        getPackage,
        getProduct,
        getAvailability,
        availabilityMessage,
        overlayGamePrices,
        isFresh,
        getLastError: () => lastError,
        getCatalog
    };
})();
