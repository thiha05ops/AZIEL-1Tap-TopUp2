// Stable, artwork-derived accents for Home product entries.
(function () {
    const FALLBACK = "124 58 237";
    const memory = new Map();
    const storageKey = "aziel:home-product-accents:v1";
    let persisted = readPersisted();

    function readPersisted() {
        try { return JSON.parse(sessionStorage.getItem(storageKey) || "{}"); }
        catch { return {}; }
    }

    function store(src, value) {
        persisted[src] = value;
        try { sessionStorage.setItem(storageKey, JSON.stringify(persisted)); }
        catch { /* Memory cache remains authoritative for this page view. */ }
    }

    function representativeColor(image) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return FALLBACK;
        canvas.width = 12;
        canvas.height = 12;
        context.drawImage(image, 0, 0, 12, 12);
        const pixels = context.getImageData(0, 0, 12, 12).data;
        let red = 0, green = 0, blue = 0, weight = 0;
        for (let index = 0; index < pixels.length; index += 4) {
            const alpha = pixels[index + 3] / 255;
            const brightness = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
            if (alpha < .35 || brightness < 24 || brightness > 238) continue;
            red += pixels[index] * alpha;
            green += pixels[index + 1] * alpha;
            blue += pixels[index + 2] * alpha;
            weight += alpha;
        }
        if (!weight) return FALLBACK;
        return `${Math.round(red / weight)} ${Math.round(green / weight)} ${Math.round(blue / weight)}`;
    }

    function derive(image) {
        const src = image.currentSrc || image.src;
        if (!src) return Promise.resolve(FALLBACK);
        if (persisted[src]) return Promise.resolve(persisted[src]);
        if (memory.has(src)) return memory.get(src);
        const result = new Promise(resolve => {
            const complete = () => {
                try {
                    const value = representativeColor(image);
                    store(src, value);
                    resolve(value);
                } catch { resolve(FALLBACK); }
            };
            if (image.complete && image.naturalWidth) complete();
            else {
                image.addEventListener("load", complete, { once: true });
                image.addEventListener("error", () => resolve(FALLBACK), { once: true });
            }
        });
        memory.set(src, result);
        return result;
    }

    function apply(root = document) {
        root.querySelectorAll(".home-merch-row [data-product-code], .mobile-home-product-row").forEach(entry => {
            if (entry.dataset.artworkAccentBound === "true") return;
            entry.dataset.artworkAccentBound = "true";
            const image = entry.querySelector("img");
            if (!image) return entry.style.setProperty("--product-accent-rgb", FALLBACK);
            derive(image).then(value => entry.style.setProperty("--product-accent-rgb", value));
        });
    }

    function ready() {
        apply();
        document.addEventListener("aziel:home-groups-updated", () => apply());
        new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) apply(node.matches?.(".home-merch-row, .mobile-home-product-row") ? node.parentElement : node);
        }))).observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
})();
