// Customer-local discovery memory for storefront personalization.
// Stores only product codes and lightweight rotation state in this browser.

(function () {
    "use strict";

    const STORAGE_KEY = "aziel:customer-discovery:v1";
    const MAX_RECENT_PRODUCTS = 12;

    let documentHomeCursor = null;
    let currentProductRecorded = false;

    function normalizeCode(value = "") {
        return String(value || "").trim().toLowerCase();
    }

    function readState() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

            return {
                recentProducts: Array.isArray(parsed?.recentProducts)
                    ? parsed.recentProducts
                        .map(item => ({
                            productCode: normalizeCode(item?.productCode),
                            viewedAt: Number(item?.viewedAt || 0)
                        }))
                        .filter(item => item.productCode)
                        .slice(0, MAX_RECENT_PRODUCTS)
                    : [],
                homeVisitCursor: Number.isFinite(Number(parsed?.homeVisitCursor))
                    ? Math.max(0, Number(parsed.homeVisitCursor))
                    : 0
            };
        } catch (_) {
            return {
                recentProducts: [],
                homeVisitCursor: 0
            };
        }
    }

    function writeState(state) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (_) {
            // Personalization is best-effort only.
        }
    }

    function recordProductView(productCode) {
        const code = normalizeCode(productCode);
        if (!code) return;

        const state = readState();
        const recentProducts = state.recentProducts
            .filter(item => item.productCode !== code);

        recentProducts.unshift({
            productCode: code,
            viewedAt: Date.now()
        });

        state.recentProducts = recentProducts.slice(0, MAX_RECENT_PRODUCTS);
        writeState(state);
    }

    function recentProductCodes() {
        return readState().recentProducts
            .map(item => item.productCode)
            .filter(Boolean);
    }

    function beginHomeVisit() {
        if (documentHomeCursor !== null) {
            return documentHomeCursor;
        }

        const state = readState();
        state.homeVisitCursor = (state.homeVisitCursor + 1) % 1000000;
        documentHomeCursor = state.homeVisitCursor;
        writeState(state);

        return documentHomeCursor;
    }

    function homeRotationCursor() {
        return documentHomeCursor !== null
            ? documentHomeCursor
            : readState().homeVisitCursor;
    }

    function rotate(items = [], cursor = 0) {
        if (!Array.isArray(items) || items.length < 2) {
            return Array.isArray(items) ? [...items] : [];
        }

        const offset = Math.abs(Number(cursor || 0)) % items.length;

        if (!offset) return [...items];

        return [
            ...items.slice(offset),
            ...items.slice(0, offset)
        ];
    }

    function viewedFirst(items = [], productCodeForItem = item => item?.productCode) {
        if (!Array.isArray(items) || items.length < 2) {
            return Array.isArray(items) ? [...items] : [];
        }

        const viewed = recentProductCodes();
        if (!viewed.length) return [...items];

        const rank = new Map(
            viewed.map((productCode, index) => [productCode, index])
        );

        return items
            .map((item, index) => ({
                item,
                index,
                productCode: normalizeCode(productCodeForItem(item))
            }))
            .sort((a, b) => {
                const aRank = rank.has(a.productCode)
                    ? rank.get(a.productCode)
                    : Number.MAX_SAFE_INTEGER;

                const bRank = rank.has(b.productCode)
                    ? rank.get(b.productCode)
                    : Number.MAX_SAFE_INTEGER;

                return aRank - bRank || a.index - b.index;
            })
            .map(entry => entry.item);
    }

    function currentProductCandidate() {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = normalizeCode(params.get("product"));

        if (fromUrl) return fromUrl;

        return normalizeCode(
            document.getElementById("packages")?.dataset?.game
        );
    }

    function tryRecordCurrentProduct() {
        if (currentProductRecorded) return true;

        const candidate = currentProductCandidate();
        if (!candidate) return false;

        const catalog = window.AZIEL_CATALOG;
        const product = catalog?.getProduct?.(candidate);

        if (!product) return false;

        recordProductView(product.productCode || candidate);
        currentProductRecorded = true;
        return true;
    }

    function initializeCurrentPage() {
        const page = window.location.pathname.split("/").pop() || "/";

        if (page === "/" || page === "") {
            beginHomeVisit();
            return;
        }

        if (tryRecordCurrentProduct()) return;

        document.addEventListener("aziel:catalog-updated", event => {
            if (event.detail?.status === "ready") {
                tryRecordCurrentProduct();
            }
        });
    }

    window.AZIEL_CUSTOMER_DISCOVERY = Object.freeze({
        recordProductView,
        recentProductCodes,
        beginHomeVisit,
        homeRotationCursor,
        rotate,
        viewedFirst
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeCurrentPage, {
            once: true
        });
    } else {
        initializeCurrentPage();
    }
})();
