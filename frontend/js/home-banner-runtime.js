// frontend/js/home-banner-runtime.js
// Runtime owner for Admin-managed Home hero banners.

(function () {
    const t = (key, fallback, params) => window.AZIEL_LOCALE?.t?.(key, fallback, params) || fallback;
    const API_URL = "/api/home/banners";
    const AUTO_DELAY = 5600;
    const DESKTOP_CAROUSEL_QUERY = "(min-width: 1024px)";
    const FALLBACK_HERO_COLORS = Object.freeze({
        primary: "139 92 246",
        secondary: "59 130 246"
    });
    const DEFAULT_HOME_HERO = Object.freeze({
        id: "aziel-default-home-hero",
        name: "AZIEL default home hero",
        imageUrl: "assets/banners/hero.webp",
        desktopImageUrl: "assets/banners/hero-desktop-wide.png",
        mobileImageUrl: "assets/banners/hero.webp",
        imageAltText: "AZIEL featured game promotion",
        ctaTarget: "#",
        objectPosition: "center center",
        source: "default"
    });

    let autoTimer = null;
    let current = 0;
    let cards = [];
    let dots = [];
    let activeBanners = [];
    let dragStartX = 0;
    let dragCurrentX = 0;
    let isDragging = false;
    let didDrag = false;
    let dragLastX = 0;
    let dragLastTime = 0;
    let dragVelocity = 0;
    let autoResumeTimer = null;
    let ambientBufferIndex = 0;
    let userPaused = false;
    const colorCache = new Map();

    const DRAG_LIMIT = 180;
    const DRAG_THRESHOLD = 56;
    const DRAG_CLICK_THRESHOLD = 8;
    const FLICK_VELOCITY_THRESHOLD = .45;

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
                renderDefaultFallback(zone, track, dotsBox, "api-unmanaged");
                return;
            }

            const banners = Array.isArray(data.banners) ? data.banners.filter(isRenderableBanner) : [];

            if (!banners.length) {
                renderDefaultFallback(zone, track, dotsBox, "no-eligible-campaigns");
                return;
            }

            zone.setAttribute("data-managed-content-state", "preparing");
            await preloadImages([
                DEFAULT_HOME_HERO.desktopImageUrl,
                DEFAULT_HOME_HERO.mobileImageUrl,
                ...banners.slice(0, 2).flatMap(banner => [banner.imageUrl, banner.desktopImageUrl, banner.mobileImageUrl])
            ]);

            const managedTrack = track.cloneNode(false);
            const managedDotsBox = dotsBox.cloneNode(false);

            track.replaceWith(managedTrack);
            dotsBox.replaceWith(managedDotsBox);
            zone.hidden = false;
            zone.setAttribute("data-home-banners-managed", "active");
            zone.dataset.heroAuthority = "campaign";
            zone.dataset.bannerCount = String(banners.length);
            renderManagedBanners(managedTrack, managedDotsBox, banners);
            bindManagedImageFallbacks(managedTrack);
            ensureHeroArrows(zone);
            if (banners.length === 1) {
                bindStaticBanner(managedTrack, managedDotsBox);
            } else {
                bindManagedCarousel(managedTrack, managedDotsBox);
            }
            zone.setAttribute("data-managed-content-state", "active");
        } catch (error) {
            renderDefaultFallback(zone, track, dotsBox, "api-failure");
        }
    }

    function renderDefaultFallback(zone, track = null, dotsBox = null, reason = "fallback") {
        clearTimeout(autoResumeTimer);
        clearInterval(autoTimer);
        const activeTrack = track || zone.querySelector("#azBannerTrack");
        const activeDotsBox = dotsBox || zone.querySelector("#azBannerDots");

        if (activeTrack) {
            activeTrack.innerHTML = defaultHeroMarkup();
        }
        if (activeDotsBox) {
            activeDotsBox.innerHTML = "";
        }

        zone.hidden = false;
        zone.removeAttribute("data-home-banners-managed");
        zone.dataset.heroAuthority = "default";
        zone.dataset.bannerCount = "1";
        zone.dataset.fallbackReason = reason;
        zone.setAttribute("data-managed-content-state", "fallback");
        if (activeTrack && activeDotsBox) bindStaticBanner(activeTrack, activeDotsBox);
    }

    function defaultHeroMarkup() {
        return `
            <div class="az-banner-card active" data-home-banner-id="${escapeAttr(DEFAULT_HOME_HERO.id)}" data-home-banner-source="default" style="--az-banner-object-position: ${escapeAttr(DEFAULT_HOME_HERO.objectPosition)}">
                <picture>
                    <source media="(min-width: 769px)" srcset="${escapeAttr(DEFAULT_HOME_HERO.desktopImageUrl)}">
                    <img src="${escapeAttr(DEFAULT_HOME_HERO.mobileImageUrl)}" alt="${escapeAttr(DEFAULT_HOME_HERO.imageAltText)}" width="3840" height="2159" loading="eager" decoding="async" fetchpriority="high" style="object-position: var(--az-banner-object-position)">
                </picture>
            </div>
        `;
    }

    function bindStaticBanner(track, dotsBox) {
        clearTimeout(autoResumeTimer);
        clearInterval(autoTimer);
        cards = [...track.querySelectorAll(".az-banner-card")];
        dots = [];
        dotsBox.innerHTML = "";
        dotsBox.hidden = true;
        setArrowVisibility(track.closest(".az-banner-zone"), false);
        track.removeAttribute("role");
        track.removeAttribute("aria-roledescription");
        track.removeAttribute("aria-label");
        track.removeAttribute("tabindex");

        const card = cards[0];
        if (!card) return;
        card.classList.add("active");
        if (card.matches("a")) card.tabIndex = 0;
        card.removeAttribute("aria-hidden");
        card.style.transform = "translateX(-50%)";
        card.style.opacity = "1";
        card.style.filter = "none";
        card.style.zIndex = "1";
        card.style.pointerEvents = "auto";
        card.style.transition = "none";
        commitStaticBannerVisualState(track.closest(".az-banner-zone"), card);
    }

    function commitStaticBannerVisualState(zone, card) {
        const image = card?.querySelector("img");
        const imageUrl = image?.currentSrc || image?.src || "";
        const objectPosition = card?.style.getPropertyValue("--az-banner-object-position") || "center center";
        if (!zone || !imageUrl) return;
        zone.style.setProperty("--az-banner-ambient-image", cssUrl(imageUrl));
        zone.style.setProperty("--az-banner-active-position", objectPosition);
        updateHeroAtmosphere(zone, image);
    }

    async function preloadImages(urls = []) {
        const uniqueUrls = [...new Set(urls.filter(Boolean))];
        await Promise.all(uniqueUrls.map(preloadImage));
    }

    async function preloadImage(url) {
        const image = new Image();
        image.crossOrigin = "anonymous";
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

            const desktopImage = banner.desktopImageUrl || banner.imageUrl;
            const mobileImage = banner.mobileImageUrl || banner.imageUrl;
            return `
                <a href="${escapeAttr(target)}" class="az-banner-card" data-home-banner-id="${escapeAttr(banner.id)}" aria-label="${escapeAttr(label)}" style="--az-banner-object-position: ${escapeAttr(resolveObjectPosition(banner))}">
                    <picture>
                        <source media="(min-width: 769px)" srcset="${escapeAttr(desktopImage)}">
                        <img src="${escapeAttr(mobileImage)}" alt="${escapeAttr(label)}" width="3840" height="1200" loading="${loading}" decoding="async" fetchpriority="${fetchPriority}" crossorigin="anonymous" style="object-position: var(--az-banner-object-position)">
                    </picture>
                </a>
            `;
        }).join("");

        dotsBox.innerHTML = banners.map((_, index) => (
            `<button type="button" aria-label="${escapeAttr(t("home.showBanner", "Show banner {number}", { number: index + 1 }))}" aria-current="false"></button>`
        )).join("");
    }

    function bindManagedImageFallbacks(track) {
        track.querySelectorAll(".az-banner-card img").forEach(image => {
            image.addEventListener("error", () => {
                if (image.dataset.defaulted === "true") return;
                image.dataset.defaulted = "true";
                const picture = image.closest("picture");
                picture?.querySelectorAll("source").forEach(source => {
                    source.srcset = DEFAULT_HOME_HERO.desktopImageUrl;
                });
                image.src = DEFAULT_HOME_HERO.mobileImageUrl;
                image.alt = image.alt || DEFAULT_HOME_HERO.imageAltText;
                updateHeroAtmosphere(track.closest(".az-banner-zone"), image, { forceUrl: DEFAULT_HOME_HERO.mobileImageUrl });
            });
        });
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
        userPaused = false;
        dotsBox.hidden = false;
        track.setAttribute("role", "region");
        track.setAttribute("aria-roledescription", "carousel");
        track.setAttribute("aria-label", t("home.banners", "Home banners"));
        track.tabIndex = 0;

        const goTo = index => {
            current = (index + cards.length) % cards.length;
            commitBannerVisualState(track.closest(".az-banner-zone"));
            renderCards(0);
            updateDots();
        };

        setArrowVisibility(track.closest(".az-banner-zone"), true);
        bindHeroArrows(track.closest(".az-banner-zone"), goTo);

        dots.forEach((dot, index) => {
            dot.addEventListener("click", () => {
                pauseForInteraction(goTo);
                goTo(index);
            });
        });

        track.addEventListener("pointerdown", event => {
            if (event.button !== undefined && event.button !== 0) return;
            isDragging = true;
            didDrag = false;
            dragStartX = event.clientX;
            dragLastX = event.clientX;
            dragLastTime = event.timeStamp;
            dragVelocity = 0;
            dragCurrentX = 0;
            track.classList.add("is-dragging");
            pauseForInteraction(goTo);
            track.setPointerCapture?.(event.pointerId);
        });

        track.addEventListener("pointermove", event => {
            if (!isDragging) return;
            dragCurrentX = clampDrag(event.clientX - dragStartX);
            const elapsed = Math.max(1, event.timeStamp - dragLastTime);
            dragVelocity = (event.clientX - dragLastX) / elapsed;
            dragLastX = event.clientX;
            dragLastTime = event.timeStamp;
            if (Math.abs(dragCurrentX) > DRAG_CLICK_THRESHOLD) didDrag = true;
            if (window.matchMedia?.(DESKTOP_CAROUSEL_QUERY)?.matches === true) renderCards(dragCurrentX);
        });

        track.addEventListener("pointerup", event => {
            if (!isDragging) return;
            isDragging = false;
            track.classList.remove("is-dragging");
            track.releasePointerCapture?.(event.pointerId);
            finishDrag(goTo);
        });

        track.addEventListener("pointercancel", event => {
            isDragging = false;
            track.classList.remove("is-dragging");
            track.releasePointerCapture?.(event.pointerId);
            dragCurrentX = 0;
            dragVelocity = 0;
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
                pauseForInteraction(goTo);
                goTo(current - 1);
            }
            if (event.key === "ArrowRight") {
                event.preventDefault();
                pauseForInteraction(goTo);
                goTo(current + 1);
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
        if (userPaused || cards.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        clearTimeout(autoResumeTimer);
        clearInterval(autoTimer);
        autoTimer = setInterval(() => goTo(current + 1), AUTO_DELAY);
    }

    function pauseAuto() {
        clearTimeout(autoResumeTimer);
        clearInterval(autoTimer);
    }

    function pauseForInteraction(goTo) {
        userPaused = true;
        pauseAuto();
        if (typeof goTo === "function") {
            autoResumeTimer = setTimeout(() => {
                userPaused = false;
                startAuto(goTo);
            }, AUTO_DELAY * 2);
        }
    }

    function scheduleAuto(goTo) {
        if (userPaused) return;
        clearTimeout(autoResumeTimer);
        autoResumeTimer = setTimeout(() => startAuto(goTo), AUTO_DELAY);
    }

    function setArrowVisibility(zone, visible) {
        if (!zone) return;
        zone.querySelectorAll(".az-banner-arrow").forEach(button => {
            button.hidden = !visible;
        });
    }

    function ensureHeroArrows(zone) {
        if (!zone || zone.querySelector(".az-banner-arrow")) return;
        const previous = document.createElement("button");
        previous.type = "button";
        previous.className = "az-banner-arrow az-banner-arrow--previous";
        previous.setAttribute("aria-label", t("home.previousBanner", "Show previous banner"));
        previous.innerHTML = '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i>';

        const next = document.createElement("button");
        next.type = "button";
        next.className = "az-banner-arrow az-banner-arrow--next";
        next.setAttribute("aria-label", t("home.nextBanner", "Show next banner"));
        next.innerHTML = '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';

        zone.append(previous, next);
    }

    function bindHeroArrows(zone, goTo) {
        if (!zone || zone.dataset.heroArrowsReady === "true") return;
        zone.dataset.heroArrowsReady = "true";
        zone.querySelector(".az-banner-arrow--previous")?.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            pauseForInteraction(goTo);
            goTo(current - 1);
        });
        zone.querySelector(".az-banner-arrow--next")?.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            pauseForInteraction(goTo);
            goTo(current + 1);
        });
    }

    function clampDrag(value) {
        return Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, value));
    }

    function finishDrag(goTo) {
        const diff = dragCurrentX;
        const velocity = dragVelocity;
        dragCurrentX = 0;
        dragVelocity = 0;

        if (diff < -DRAG_THRESHOLD || velocity < -FLICK_VELOCITY_THRESHOLD) {
            goTo(current + 1);
        } else if (diff > DRAG_THRESHOLD || velocity > FLICK_VELOCITY_THRESHOLD) {
            goTo(current - 1);
        } else {
            renderCards(0);
        }

        scheduleAuto(goTo);
    }

    function renderCards(dragOffset = 0) {
        const desktopCarousel = window.matchMedia?.(DESKTOP_CAROUSEL_QUERY)?.matches === true;
        const stageWidth = cards[current]?.closest(".az-banner-track")?.clientWidth || 0;
        const desktopGap = Math.max(24, Math.min(32, window.innerWidth * .02));
        const desktopStep = (stageWidth * .397) + desktopGap;

        cards.forEach((card, index) => {
            const isActive = index === current;
            card.classList.toggle("active", isActive);
            card.setAttribute("aria-hidden", isActive ? "false" : "true");
            if (card.matches("a")) card.tabIndex = isActive ? 0 : -1;
            const offset = getShortestOffset(index);

            if (desktopCarousel && cards.length > 1) {
                const visibleOffset = Math.max(-1, Math.min(1, offset));
                const isSide = Math.abs(offset) === 1;
                const x = (visibleOffset * desktopStep) + dragOffset;
                card.classList.toggle("is-side", isSide);
                card.classList.toggle("is-previous", isSide && offset < 0);
                card.classList.toggle("is-next", isSide && offset > 0);
                card.style.transform = `translateX(calc(-50% + ${x}px)) scale(${isSide ? ".96" : "1"})`;
                card.style.opacity = Math.abs(offset) > 1 ? "0" : (isSide ? ".68" : "1");
                card.style.filter = isSide ? "brightness(.58) saturate(.58)" : "none";
                card.style.zIndex = isActive ? "3" : "1";
                card.style.pointerEvents = isActive ? "auto" : "none";
                card.style.transition = isDragging ? "none" : "transform var(--az-banner-transition-duration, 560ms) var(--az-banner-transition-ease, ease), opacity var(--az-banner-transition-duration, 560ms) var(--az-banner-transition-ease, ease), filter var(--az-banner-transition-duration, 560ms) var(--az-banner-transition-ease, ease)";
                return;
            }

            card.classList.remove("is-side", "is-previous", "is-next");
            card.style.transform = "translateX(-50%)";
            card.style.opacity = index === current ? "1" : "0";
            card.style.filter = "none";
            card.style.zIndex = index === current ? "2" : "1";
            card.style.pointerEvents = index === current ? "auto" : "none";
            card.style.transition = "opacity var(--az-banner-transition-duration, 640ms) var(--az-banner-transition-ease, ease)";
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
        updateHeroAtmosphere(zone, activeImg, { forceUrl: imageUrl });
        activeImg?.style.setProperty("object-position", objectPosition);
    }

    async function updateHeroAtmosphere(zone, image, options = {}) {
        const home = zone?.closest(".az-home");
        if (!home || !image) return;
        const source = options.forceUrl || image.currentSrc || image.src || "";
        if (!source) return;

        home.dataset.heroAtmosphereState = "resolving";
        try {
            const colors = await resolveHeroColors(image, source);
            home.style.setProperty("--home-hero-rgb-primary", colors.primary);
            home.style.setProperty("--home-hero-rgb-secondary", colors.secondary);
            home.dataset.heroAtmosphereState = colors.fallback ? "fallback" : "sampled";
            window.dispatchEvent(new CustomEvent("aziel:homeHeroAtmosphereChanged", {
                detail: { source, ...colors }
            }));
        } catch {
            applyFallbackHeroAtmosphere(home, source);
        }
    }

    async function resolveHeroColors(image, source) {
        if (colorCache.has(source)) return colorCache.get(source);

        await ensureImageReady(image);
        const colors = sampleHeroImageColors(image);
        if (!colors.fallback) colorCache.set(source, colors);
        return colors;
    }

    async function ensureImageReady(image) {
        if (image.complete && image.naturalWidth > 0) return;
        try {
            if (image.decode) await image.decode();
        } catch {
            // The existing image fallback owns broken media; sampling remains fail-safe.
        }
    }

    function sampleHeroImageColors(image) {
        try {
            const width = 24;
            const height = 12;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) return fallbackHeroColors();

            context.drawImage(image, 0, 0, width, height);
            const data = context.getImageData(0, 0, width, height).data;
            let red = 0;
            let green = 0;
            let blue = 0;
            let count = 0;
            let warmRed = 0;
            let warmGreen = 0;
            let warmBlue = 0;
            let warmCount = 0;
            let coolRed = 0;
            let coolGreen = 0;
            let coolBlue = 0;
            let coolCount = 0;

            for (let index = 0; index < data.length; index += 4) {
                const alpha = data[index + 3];
                const r = data[index];
                const g = data[index + 1];
                const b = data[index + 2];
                if (alpha < 180) continue;
                if (r > 235 && g > 235 && b > 235) continue;
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                if (max < 28) continue;
                const saturation = max - min;
                const weight = saturation > 22 ? 1.5 : 1;

                red += r * weight;
                green += g * weight;
                blue += b * weight;
                count += weight;

                if (r >= b) {
                    warmRed += r * weight;
                    warmGreen += g * weight;
                    warmBlue += b * weight;
                    warmCount += weight;
                } else {
                    coolRed += r * weight;
                    coolGreen += g * weight;
                    coolBlue += b * weight;
                    coolCount += weight;
                }
            }

            if (!count) return fallbackHeroColors();

            const primary = normalizeRgb(red / count, green / count, blue / count);
            const secondary = coolCount > warmCount && warmCount > 0
                ? normalizeRgb(warmRed / warmCount, warmGreen / warmCount, warmBlue / warmCount)
                : normalizeRgb(coolRed / Math.max(coolCount, 1), coolGreen / Math.max(coolCount, 1), coolBlue / Math.max(coolCount, 1));
            return { primary, secondary: secondary || primary, fallback: false };
        } catch {
            return fallbackHeroColors();
        }
    }

    function normalizeRgb(red, green, blue) {
        const channels = [red, green, blue].map(value => Math.max(18, Math.min(210, Math.round(value || 0))));
        return channels.join(" ");
    }

    function fallbackHeroColors() {
        return { ...FALLBACK_HERO_COLORS, fallback: true };
    }

    function applyFallbackHeroAtmosphere(home, source = "") {
        home.style.setProperty("--home-hero-rgb-primary", FALLBACK_HERO_COLORS.primary);
        home.style.setProperty("--home-hero-rgb-secondary", FALLBACK_HERO_COLORS.secondary);
        home.style.setProperty("--home-hero-atmosphere-opacity", ".12");
        home.dataset.heroAtmosphereState = "fallback";
        window.dispatchEvent(new CustomEvent("aziel:homeHeroAtmosphereChanged", {
            detail: { source, ...FALLBACK_HERO_COLORS, fallback: true }
        }));
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
