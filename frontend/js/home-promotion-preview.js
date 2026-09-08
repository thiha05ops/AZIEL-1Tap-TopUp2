// frontend/js/home-promotion-preview.js
// Commerce-driven Exclusive Offers projected from currently sellable discounted packages.

(function () {
    const LIMIT = 8;

    function ready(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
        } else {
            fn();
        }
    }

    function currentRegion() {
        return (
            window.AZIEL?.getShopRegion?.() ||
            window.AZIEL?.getRegion?.() ||
            localStorage.getItem("selectedRegion") ||
            localStorage.getItem("region") ||
            "MM"
        );
    }

    function money(amount, currency) {
        const value = Number(amount || 0);
        if (!Number.isFinite(value)) return "";

        if (currency === "THB") {
            return `฿${value.toLocaleString(undefined, {
                minimumFractionDigits: value % 1 ? 2 : 0,
                maximumFractionDigits: 2
            })}`;
        }

        if (currency === "MMK") {
            return `${value.toLocaleString(undefined, {
                maximumFractionDigits: 0
            })} Ks`;
        }

        return `${value.toLocaleString()} ${currency || ""}`.trim();
    }

    function productRoute(product = {}, packageCode = "") {
        const base =
            window.AZIEL_CATALOG_PRESENTATION?.resolveProductRoute?.(
                product.productRoute || product.route,
                product.productCode
            ) ||
            `product.html?product=${encodeURIComponent(product.productCode || "")}`;

        if (!packageCode) return base;

        const separator = base.includes("?") ? "&" : "?";
        return `${base}${separator}package=${encodeURIComponent(packageCode)}`;
    }

    async function fetchExclusiveOffers() {
        const region = currentRegion();

        const response = await fetch(
            `/api/public/exclusive-offers?region=${encodeURIComponent(region)}`,
            {
                credentials: "same-origin",
                headers: {
                    Accept: "application/json"
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Exclusive offers request failed: ${response.status}`);
        }

        const payload = await response.json();

        if (!payload?.success || !Array.isArray(payload.offers)) {
            return [];
        }

        return payload.offers.slice(0, LIMIT);
    }

    function artworkFor(offer = {}) {
        return String(
            offer.packageIcon ||
            offer.productImage ||
            ""
        ).trim();
    }

    function renderOffer(offer = {}) {
        const artwork = artworkFor(offer);

        const product = {
            productCode: offer.productCode,
            productRoute: offer.productRoute
        };

        const href = productRoute(product, offer.packageCode);
        const original = money(offer.referencePrice, offer.currency);
        const current = money(offer.amount, offer.currency);
        const discount = Number(offer.discountPercent || 0);

        return `
            <a class="home-promotion-card home-commerce-offer"
               href="${escapeAttr(href)}"
               data-product-code="${escapeAttr(offer.productCode)}"
               data-package-code="${escapeAttr(offer.packageCode)}">
                <span class="home-exclusive-visual">
                    ${artwork
                        ? `<img class="home-exclusive-artwork"
                                src="${escapeAttr(artwork)}"
                                alt="${escapeAttr(`${offer.productName || offer.productCode} ${offer.packageName || ""}`)}"
                                loading="lazy"
                                decoding="async"
                                crossorigin="anonymous">`
                        : `<span class="home-exclusive-artwork-fallback" aria-hidden="true"></span>`}

                    <span class="home-exclusive-content">
                        <small class="home-exclusive-product">
                            ${escapeHtml(offer.productName || offer.productCode || "")}
                        </small>

                        <strong class="home-exclusive-package">
                            ${escapeHtml(offer.packageName || offer.packageCode || "")}
                        </strong>

                        <span class="home-exclusive-prices">
                            ${offer.showOriginalPrice !== false
                                ? `<del>${escapeHtml(original)}</del>`
                                : ""}
                            <b>${escapeHtml(current)}</b>
                        </span>
                    </span>
                </span>

                <span class="home-exclusive-footer">
                    <span class="home-exclusive-promo">PROMO</span>

                    ${discount > 0
                        ? `<strong class="home-exclusive-discount">-${escapeHtml(discount.toLocaleString())}%</strong>`
                        : ""}

                    <span class="home-exclusive-view">
                        View Package
                        <i class="fa-solid fa-angle-right" aria-hidden="true"></i>
                    </span>
                </span>
            </a>
        `;
    }

    function applyArtworkAccent(card) {
        const image = card?.querySelector(".home-exclusive-artwork");
        if (!image) return;

        const update = () => {
            try {
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d", {
                    willReadFrequently: true
                });

                if (!context) return;

                canvas.width = 24;
                canvas.height = 24;
                context.drawImage(image, 0, 0, 24, 24);

                const data = context.getImageData(0, 0, 24, 24).data;
                let red = 0;
                let green = 0;
                let blue = 0;
                let weight = 0;

                for (let i = 0; i < data.length; i += 16) {
                    const alpha = data[i + 3] / 255;
                    if (alpha < 0.35) continue;

                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    const saturation = max - min;
                    const brightness = (r + g + b) / 3;

                    if (brightness < 28 || brightness > 238) continue;

                    const sampleWeight = 1 + saturation / 80;

                    red += r * sampleWeight;
                    green += g * sampleWeight;
                    blue += b * sampleWeight;
                    weight += sampleWeight;
                }

                if (!weight) return;

                const r = Math.round(red / weight);
                const g = Math.round(green / weight);
                const b = Math.round(blue / weight);

                card.style.setProperty("--offer-rgb", `${r} ${g} ${b}`);
            } catch (_) {
                // Cross-origin or unreadable artwork keeps AZIEL fallback accent.
            }
        };

        if (image.complete && image.naturalWidth) {
            update();
        } else {
            image.addEventListener("load", update, { once: true });
        }
    }

    function applyOfferAccents(list) {
        list.querySelectorAll(".home-commerce-offer")
            .forEach(applyArtworkAccent);
    }

    async function loadExclusiveOffers() {
        const section = document.getElementById("newsPromotions");
        const panel = document.getElementById("latestPromotionsPanel");
        const list = document.getElementById("latestPromotionsList");
        const viewAll = document.getElementById("latestPromotionsViewAll");

        if (!section || !panel || !list) return;

        section.hidden = true;
        section.dataset.exclusiveOffers = "true";
        panel.dataset.promotionPreviewState = "loading";
        list.innerHTML = "";

        try {
            const offers = await fetchExclusiveOffers();

            if (!offers.length) {
                panel.dataset.promotionPreviewState = "empty";
                return;
            }

            list.innerHTML = offers.map(renderOffer).join("");
            applyOfferAccents(list);
            panel.dataset.promotionPreviewState = "active";

            section.querySelector(".az-section-head h2")
                ?.replaceChildren(document.createTextNode("Exclusive Offers"));

            if (viewAll) {
                viewAll.href = "/mobile-games.html";
                viewAll.hidden = false;
            }

            section.hidden = false;
            window.AZIEL_MOTION?.enter?.(list, "fast");
        } catch (_) {
            panel.dataset.promotionPreviewState = "error";
            list.innerHTML = "";
            section.hidden = true;
        }
    }

    function escapeHtml(value = "") {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function escapeAttr(value = "") {
        return escapeHtml(value);
    }

    ready(() => {
        loadExclusiveOffers();

        window.addEventListener(
            "aziel:shopRegionChanged",
            loadExclusiveOffers
        );

        document.addEventListener("aziel:catalog-updated", event => {
            if (event.detail?.status === "ready") {
                loadExclusiveOffers();
            }
        });
    });
})();
