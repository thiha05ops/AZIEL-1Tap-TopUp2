// frontend/js/home-banner-runtime.js
// Runtime owner for Admin-managed Home hero banners.

(function () {
    const API_URL = "/api/home/banners";
    const AUTO_DELAY = 4500;

    let autoTimer = null;
    let current = 0;
    let cards = [];
    let dots = [];

    function ready(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
        } else {
            fn();
        }
    }

    async function loadManagedHomeBanners() {
        const zone = document.getElementById("bannerZone");
        const track = document.getElementById("azBannerTrack");
        const dotsBox = document.getElementById("azBannerDots");

        if (!zone || !track || !dotsBox) return;
        zone.setAttribute("data-managed-content-state", "resolving");

        try {
            const response = await fetch(API_URL, {
                headers: { Accept: "application/json" },
                cache: "no-store"
            });
            const data = await response.json();

            if (!response.ok || !data?.success || data.managed !== true) {
                releaseStaticFallback(zone);
                return;
            }

            const banners = Array.isArray(data.banners) ? data.banners.filter(isRenderableBanner) : [];

            if (!banners.length) {
                clearInterval(autoTimer);
                zone.hidden = true;
                zone.setAttribute("data-home-banners-managed", "empty");
                zone.setAttribute("data-managed-content-state", "empty");
                track.innerHTML = "";
                dotsBox.innerHTML = "";
                return;
            }

            zone.setAttribute("data-managed-content-state", "preparing");
            await preloadImages(banners.map(banner => banner.imageUrl));

            const managedTrack = track.cloneNode(false);
            const managedDotsBox = dotsBox.cloneNode(false);

            track.replaceWith(managedTrack);
            dotsBox.replaceWith(managedDotsBox);
            zone.hidden = false;
            zone.setAttribute("data-home-banners-managed", "active");
            renderManagedBanners(managedTrack, managedDotsBox, banners);
            bindManagedCarousel(managedTrack, managedDotsBox);
            zone.setAttribute("data-managed-content-state", "active");
        } catch (error) {
            // Keep the source-code static fallback when managed data is temporarily unavailable.
            releaseStaticFallback(zone);
        }
    }

    function releaseStaticFallback(zone) {
        zone.hidden = false;
        zone.setAttribute("data-managed-content-state", "fallback");
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
            // Rendering can still proceed; broken images keep existing per-image fallback/error handling.
        }
    }

    function isRenderableBanner(banner = {}) {
        return Boolean(banner.imageUrl && !isUnsafeTarget(banner.ctaTarget || ""));
    }

    function renderManagedBanners(track, dotsBox, banners) {
        track.innerHTML = banners.map(banner => {
            const target = normalizeTarget(banner.ctaTarget);
            const label = banner.imageAltText || banner.name || "AZIEL banner";

            return `
                <a href="${escapeAttr(target)}" class="az-banner-card" data-home-banner-id="${escapeAttr(banner.id)}">
                    <img src="${escapeAttr(banner.imageUrl)}" alt="${escapeAttr(label)}" loading="eager">
                </a>
            `;
        }).join("");

        dotsBox.innerHTML = banners.map((_, index) => (
            `<button type="button" aria-label="Show banner ${index + 1}"></button>`
        )).join("");
    }

    function bindManagedCarousel(track, dotsBox) {
        clearInterval(autoTimer);
        current = 0;
        cards = [...track.querySelectorAll(".az-banner-card")];
        dots = [...dotsBox.querySelectorAll("button")];

        if (!cards.length) return;

        const goTo = index => {
            current = (index + cards.length) % cards.length;
            renderCards();
            updateDots();
            setAtmosphereColor();
        };

        dots.forEach((dot, index) => {
            dot.addEventListener("click", () => {
                clearInterval(autoTimer);
                goTo(index);
                startAuto(goTo);
            });
        });

        track.onpointerdown = event => {
            const startX = event.clientX;
            clearInterval(autoTimer);

            function onPointerUp(upEvent) {
                const diff = upEvent.clientX - startX;
                if (diff < -70) goTo(current + 1);
                if (diff > 70) goTo(current - 1);
                startAuto(goTo);
                window.removeEventListener("pointerup", onPointerUp);
                window.removeEventListener("pointercancel", onPointerCancel);
            }

            function onPointerCancel() {
                startAuto(goTo);
                window.removeEventListener("pointerup", onPointerUp);
                window.removeEventListener("pointercancel", onPointerCancel);
            }

            window.addEventListener("pointerup", onPointerUp);
            window.addEventListener("pointercancel", onPointerCancel);
        };

        window.addEventListener("resize", renderCards);
        goTo(0);
        startAuto(goTo);
    }

    function startAuto(goTo) {
        clearInterval(autoTimer);
        autoTimer = setInterval(() => goTo(current + 1), AUTO_DELAY);
    }

    function renderCards() {
        const activeCard = cards[current];
        const cardWidth = activeCard?.offsetWidth || 0;
        const step = cardWidth * 0.78;

        cards.forEach((card, index) => {
            card.classList.toggle("active", index === current);
            const offset = getShortestOffset(index);
            const x = offset * step;
            const distance = Math.abs(x) / Math.max(step, 1);
            const scale = Math.max(0.72, 1 - distance * 0.15);
            const opacity = Math.max(0.15, 1 - distance * 0.55);
            const brightness = Math.max(0.72, 1 - distance * 0.18);
            const blur = Math.min(distance * 4, 7);

            card.style.transform = `translateX(calc(-50% + ${x}px)) scale(${scale})`;
            card.style.opacity = opacity;
            card.style.filter = `brightness(${brightness}) blur(${blur}px)`;
            card.style.zIndex = 100 - Math.floor(distance * 10);
            card.style.pointerEvents = offset === 0 ? "auto" : "none";
            card.style.transition = "transform .5s ease, opacity .5s ease, filter .5s ease";
        });
    }

    function getShortestOffset(index) {
        let offset = index - current;

        if (offset > cards.length / 2) offset -= cards.length;
        if (offset < -cards.length / 2) offset += cards.length;

        return offset;
    }

    function updateDots() {
        dots.forEach((dot, index) => {
            dot.classList.toggle("active", index === current);
        });
    }

    function setAtmosphereColor() {
        const activeImg = cards[current]?.querySelector("img");
        if (!activeImg) return;

        function readColor() {
            try {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                canvas.width = 24;
                canvas.height = 24;
                ctx.drawImage(activeImg, 0, 0, 24, 24);
                const data = ctx.getImageData(0, 0, 24, 24).data;
                let r = 0;
                let g = 0;
                let b = 0;
                let count = 0;

                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] < 120) continue;
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }

                if (!count) return;
                document.documentElement.style.setProperty(
                    "--banner-rgb",
                    `${Math.floor(r / count)}, ${Math.floor(g / count)}, ${Math.floor(b / count)}`
                );
            } catch (error) {
                document.documentElement.style.setProperty("--banner-rgb", "139, 92, 246");
            }
        }

        if (activeImg.complete) {
            readColor();
        } else {
            activeImg.onload = readColor;
        }
    }

    function normalizeTarget(target = "") {
        const value = String(target || "").trim();
        if (!value || isUnsafeTarget(value)) return "#";
        return value;
    }

    function isUnsafeTarget(target = "") {
        return /^\s*(javascript|data|vbscript):/i.test(String(target || ""));
    }

    function escapeAttr(value = "") {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    window.AZIEL_HOME_BANNERS = {
        refresh: loadManagedHomeBanners
    };

    ready(loadManagedHomeBanners);
})();
