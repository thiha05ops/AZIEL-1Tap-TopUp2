// frontend/js/game-presentation-runtime.js
// Shared customer game-page presentation runtime. Catalog remains financial truth.

(function () {
    const state = {
        timers: new Map()
    };

    function onReady(callback) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", callback);
        } else {
            callback();
        }
    }

    function getProductCode() {
        return document.getElementById("packages")?.dataset.game ||
            document.querySelector("[data-product-code]")?.dataset.productCode ||
            "";
    }

    function escapeHtml(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
    }

    function isSafeCtaTarget(target = "") {
        return !/^\s*(javascript|data|vbscript):/i.test(String(target || ""));
    }

    function createSlideMarkup(banner, index) {
        const href = banner.ctaTarget && isSafeCtaTarget(banner.ctaTarget) ? banner.ctaTarget : "";
        const image = `
            <img src="${escapeHtml(banner.imageUrl)}"
                alt="${escapeHtml(banner.imageAltText || banner.name || "Game banner")}"
                data-game-banner-image>
        `;
        const cta = banner.ctaLabel && href
            ? `<span class="game-banner-cta">${escapeHtml(banner.ctaLabel)}</span>`
            : "";
        const content = `${image}${cta}`;

        return href
            ? `<a class="game-banner-slide ${index === 0 ? "active" : ""}" href="${escapeHtml(href)}" data-slide-index="${index}">${content}</a>`
            : `<div class="game-banner-slide ${index === 0 ? "active" : ""}" data-slide-index="${index}">${content}</div>`;
    }

    function setActive(root, index) {
        const slides = Array.from(root.querySelectorAll(".game-banner-slide"));
        const dots = Array.from(root.querySelectorAll(".game-banner-dot"));
        const total = slides.length;
        if (!total) return;
        const next = ((index % total) + total) % total;

        slides.forEach((slide, slideIndex) => {
            slide.classList.toggle("active", slideIndex === next);
            slide.classList.toggle("prev", slideIndex === (next - 1 + total) % total);
            slide.classList.toggle("next", slideIndex === (next + 1) % total);
        });
        dots.forEach((dot, dotIndex) => {
            dot.classList.toggle("active", dotIndex === next);
        });
        root.dataset.activeBannerIndex = String(next);
    }

    function bindSlider(root, banners) {
        root.querySelectorAll(".game-banner-dot").forEach(dot => {
            dot.addEventListener("click", () => setActive(root, Number(dot.dataset.bannerDot || 0)));
        });

        root.querySelectorAll("[data-game-banner-image]").forEach(img => {
            img.addEventListener("error", () => {
                img.closest(".game-banner-slide")?.classList.add("is-broken");
            });
        });

        if (banners.length > 1) {
            const timer = setInterval(() => {
                const current = Number(root.dataset.activeBannerIndex || 0);
                setActive(root, current + 1);
            }, 5500);
            state.timers.set(root, timer);
        }
    }

    function renderManagedBanners(root, banners) {
        state.timers.has(root) && clearInterval(state.timers.get(root));
        state.timers.delete(root);

        if (!banners.length) {
            root.classList.add("game-banner-managed-empty");
            root.innerHTML = "";
            return;
        }

        root.classList.add("game-banner-managed");
        root.innerHTML = `
            <div class="game-banner-slider" data-game-banner-slider>
                <div class="game-banner-slides">
                    ${banners.map(createSlideMarkup).join("")}
                </div>
                <div class="game-banner-dots" aria-label="Game banners">
                    ${banners.map((banner, index) => `
                        <button class="game-banner-dot ${index === 0 ? "active" : ""}" type="button" data-banner-dot="${index}" aria-label="${escapeHtml(banner.name || `Banner ${index + 1}`)}"></button>
                    `).join("")}
                </div>
            </div>
        `;
        setActive(root, 0);
        bindSlider(root, banners);
    }

    async function loadBanners(productCode) {
        const response = await fetch(`/api/catalog/${encodeURIComponent(productCode)}/banners`, {
            cache: "no-store",
            headers: { Accept: "application/json" }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.message || "Banner data unavailable");
        return data;
    }

    async function initGameBanners() {
        const root = document.querySelector(".game-banner");
        const productCode = getProductCode();
        if (!root || !productCode) return;
        root.setAttribute("data-managed-content-state", "resolving");

        try {
            const data = await loadBanners(productCode);
            if (!data.managed) {
                releaseStaticFallback(root);
                return;
            }

            const banners = Array.isArray(data.banners) ? data.banners : [];
            if (banners.length) {
                root.setAttribute("data-managed-content-state", "preparing");
                await preloadImages(banners.map(banner => banner.imageUrl));
            }
            renderManagedBanners(root, banners);
            root.setAttribute("data-managed-content-state", banners.length ? "active" : "empty");
        } catch (error) {
            root.dataset.bannerRuntimeError = "true";
            releaseStaticFallback(root);
        }
    }

    function releaseStaticFallback(root) {
        root.setAttribute("data-managed-content-state", "fallback");
    }

    async function preloadImages(urls = []) {
        const uniqueUrls = [...new Set(urls.filter(Boolean))];
        await Promise.all(uniqueUrls.map(preloadImage));
    }

    async function preloadImage(url) {
        const image = new Image();
        image.src = url;
        try {
            if (image.decode) {
                await image.decode();
                return;
            }
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
            });
        } catch {
            // Preserve the existing broken-image marker path instead of blocking banner rendering.
        }
    }

    window.AZIEL_GAME_PRESENTATION = {
        initGameBanners,
        renderManagedBanners
    };

    onReady(initGameBanners);
})();
