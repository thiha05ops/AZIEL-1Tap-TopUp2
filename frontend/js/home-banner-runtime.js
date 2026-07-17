// frontend/js/home-banner-runtime.js
// Runtime owner for Admin-managed Home hero banners.

(function () {
    const API_URL = "/api/home/banners";
    const AUTO_DELAY = 4500;

    let autoTimer = null;
    let current = 0;
    let cards = [];
    let dots = [];
    let activeBanners = [];
    let dragStartX = 0;
    let dragCurrentX = 0;
    let isDragging = false;
    let didDrag = false;
    let autoResumeTimer = null;
    let ambientBufferIndex = 0;

    const DRAG_LIMIT = 180;
    const DRAG_THRESHOLD = 56;

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
            await preloadImages(banners.slice(0, 2).map(banner => banner.imageUrl));

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
        track.innerHTML = banners.map((banner, index) => {
            const target = normalizeTarget(banner.ctaTarget);
            const label = banner.imageAltText || banner.name || "AZIEL banner";
            const loading = index < 2 ? "eager" : "lazy";
            const fetchPriority = index === 0 ? "high" : "auto";

            return `
                <a href="${escapeAttr(target)}" class="az-banner-card" data-home-banner-id="${escapeAttr(banner.id)}" aria-label="${escapeAttr(label)}" style="--az-banner-object-position: ${escapeAttr(resolveObjectPosition(banner))}">
                    <img src="${escapeAttr(banner.imageUrl)}" alt="${escapeAttr(label)}" loading="${loading}" decoding="async" fetchpriority="${fetchPriority}" style="object-position: var(--az-banner-object-position)">
                </a>
            `;
        }).join("");

        dotsBox.innerHTML = banners.map((_, index) => (
            `<button type="button" aria-label="Show banner ${index + 1}" aria-current="false"></button>`
        )).join("");
    }

    function bindManagedCarousel(track, dotsBox) {
        clearInterval(autoTimer);
        current = 0;
        cards = [...track.querySelectorAll(".az-banner-card")];
        dots = [...dotsBox.querySelectorAll("button")];
        activeBanners = cards.map(card => ({
            imageUrl: card.querySelector("img")?.currentSrc || card.querySelector("img")?.src || "",
            objectPosition: card.style.getPropertyValue("--az-banner-object-position") || "center center"
        }));

        if (!cards.length) return;
        track.setAttribute("role", "region");
        track.setAttribute("aria-roledescription", "carousel");
        track.setAttribute("aria-label", "Home banners");
        track.tabIndex = 0;

        const goTo = index => {
            current = (index + cards.length) % cards.length;
            commitBannerVisualState(track.closest(".az-banner-zone"));
            renderCards(0);
            updateDots();
        };

        dots.forEach((dot, index) => {
            dot.addEventListener("click", () => {
                clearInterval(autoTimer);
                goTo(index);
                startAuto(goTo);
            });
        });

        track.addEventListener("pointerdown", event => {
            if (event.button !== undefined && event.button !== 0) return;
            isDragging = true;
            didDrag = false;
            dragStartX = event.clientX;
            dragCurrentX = 0;
            pauseAuto();
            track.setPointerCapture?.(event.pointerId);
        });

        track.addEventListener("pointermove", event => {
            if (!isDragging) return;
            dragCurrentX = clampDrag(event.clientX - dragStartX);
            if (Math.abs(dragCurrentX) > 8) didDrag = true;
            renderCards(dragCurrentX);
        });

        track.addEventListener("pointerup", event => {
            if (!isDragging) return;
            isDragging = false;
            track.releasePointerCapture?.(event.pointerId);
            finishDrag(goTo);
        });

        track.addEventListener("pointercancel", event => {
            isDragging = false;
            track.releasePointerCapture?.(event.pointerId);
            dragCurrentX = 0;
            renderCards(0);
            scheduleAuto(goTo);
        });

        track.addEventListener("click", event => {
            if (!didDrag) return;
            event.preventDefault();
            event.stopPropagation();
            didDrag = false;
        }, true);

        track.addEventListener("dragstart", event => event.preventDefault());
        track.addEventListener("mouseenter", pauseAuto);
        track.addEventListener("mouseleave", () => scheduleAuto(goTo));
        track.addEventListener("keydown", event => {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                pauseAuto();
                goTo(current - 1);
                scheduleAuto(goTo);
            }
            if (event.key === "ArrowRight") {
                event.preventDefault();
                pauseAuto();
                goTo(current + 1);
                scheduleAuto(goTo);
            }
        });

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) pauseAuto();
            else scheduleAuto(goTo);
        });

        window.addEventListener("resize", () => renderCards(0));
        goTo(0);
        startAuto(goTo);
    }

    function startAuto(goTo) {
        clearTimeout(autoResumeTimer);
        clearInterval(autoTimer);
        autoTimer = setInterval(() => goTo(current + 1), AUTO_DELAY);
    }

    function pauseAuto() {
        clearTimeout(autoResumeTimer);
        clearInterval(autoTimer);
    }

    function scheduleAuto(goTo) {
        clearTimeout(autoResumeTimer);
        autoResumeTimer = setTimeout(() => startAuto(goTo), AUTO_DELAY);
    }

    function clampDrag(value) {
        return Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, value));
    }

    function finishDrag(goTo) {
        const diff = dragCurrentX;
        dragCurrentX = 0;

        if (diff < -DRAG_THRESHOLD) {
            goTo(current + 1);
        } else if (diff > DRAG_THRESHOLD) {
            goTo(current - 1);
        } else {
            renderCards(0);
        }

        scheduleAuto(goTo);
    }

    function renderCards(dragOffset = 0) {
        const activeCard = cards[current];
        const cardWidth = activeCard?.offsetWidth || 0;
        const step = cardWidth * 0.92;

        cards.forEach((card, index) => {
            card.classList.toggle("active", index === current);
            const offset = getShortestOffset(index);
            const x = offset * step + dragOffset;
            const distance = Math.abs(x) / Math.max(step, 1);
            const scale = Math.max(0.9, 1 - distance * 0.06);
            const opacity = Math.max(0.24, 1 - distance * 0.55);
            const brightness = Math.max(0.78, 1 - distance * 0.12);
            const blur = Math.min(distance * 2, 4);

            card.style.transform = `translateX(calc(-50% + ${x}px)) scale(${scale})`;
            card.style.opacity = opacity;
            card.style.filter = `brightness(${brightness}) blur(${blur}px)`;
            card.style.zIndex = 100 - Math.floor(distance * 10);
            card.style.pointerEvents = Math.abs(offset) <= 1 ? "auto" : "none";
            card.style.transition = isDragging
                ? "none"
                : "transform var(--az-banner-transition-duration, 560ms) var(--az-banner-transition-ease, cubic-bezier(.22, 1, .36, 1)), opacity var(--az-banner-transition-duration, 560ms) var(--az-banner-transition-ease, cubic-bezier(.22, 1, .36, 1)), filter var(--az-banner-transition-duration, 560ms) var(--az-banner-transition-ease, cubic-bezier(.22, 1, .36, 1))";
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
            dot.setAttribute("aria-current", index === current ? "true" : "false");
        });
    }

    function commitBannerVisualState(zone) {
        const activeCard = cards[current];
        const activeImg = activeCard?.querySelector("img");
        const banner = activeBanners[current] || {};
        const imageUrl = banner.imageUrl || activeImg?.currentSrc || activeImg?.src || "";
        const objectPosition = banner.objectPosition || activeCard?.style.getPropertyValue("--az-banner-object-position") || "center center";

        if (!zone || !imageUrl) return;

        const home = zone.closest(".az-home");
        zone.style.setProperty("--az-banner-ambient-image", cssUrl(imageUrl));
        zone.style.setProperty("--az-banner-active-position", objectPosition);
        home?.style.setProperty("--az-banner-ambient-image", cssUrl(imageUrl));
        home?.style.setProperty("--az-banner-active-position", objectPosition);
        commitHomeAmbientBuffer(home, imageUrl, objectPosition);
        activeImg?.style.setProperty("object-position", objectPosition);
    }

    function commitHomeAmbientBuffer(home, imageUrl, objectPosition) {
        if (!home || !imageUrl) return;
        const buffers = ensureHomeAmbientBuffers(home);
        ambientBufferIndex = (ambientBufferIndex + 1) % buffers.length;
        const active = buffers[ambientBufferIndex];
        const inactive = buffers[(ambientBufferIndex + 1) % buffers.length];

        active.style.backgroundImage = cssUrl(imageUrl);
        active.style.backgroundPosition = objectPosition || "center center";
        active.classList.add("is-active");
        inactive.classList.remove("is-active");
    }

    function ensureHomeAmbientBuffers(home) {
        const existing = home.querySelectorAll(".az-home-ambient-buffer");
        if (existing.length >= 2) return Array.from(existing).slice(0, 2);

        const fragment = document.createDocumentFragment();
        for (let i = existing.length; i < 2; i += 1) {
            const buffer = document.createElement("div");
            buffer.className = "az-home-ambient-buffer";
            buffer.setAttribute("aria-hidden", "true");
            fragment.appendChild(buffer);
        }
        home.prepend(fragment);
        return Array.from(home.querySelectorAll(".az-home-ambient-buffer")).slice(0, 2);
    }

    function resolveObjectPosition(banner = {}) {
        const raw = banner.objectPosition || banner.focalPoint || banner.focalPosition || banner.position || "";
        const value = String(raw || "").trim().toLowerCase();
        if (["left", "center", "right"].includes(value)) return `${value} center`;
        if (/^(left|center|right)\s+(top|center|bottom)$/.test(value)) return value;
        if (/^\d{1,3}%\s+\d{1,3}%$/.test(value)) return value;
        return "center center";
    }

    function cssUrl(url = "") {
        return `url("${String(url).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}")`;
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
