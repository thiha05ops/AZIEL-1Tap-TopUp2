// frontend/js/home-banner-runtime.js
// Runtime owner for Admin-managed Home hero banners.

(function () {
    if (window.__azielHomeBannerRuntimeReady) return;
    window.__azielHomeBannerRuntimeReady = true;

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
        imageUrl: "assets/banners/hero-mobile.webp?v=20260829-p4",
        desktopImageUrl: "assets/banners/hero-desktop-wide.webp?v=20260829-p4",
        mobileImageUrl: "assets/banners/hero-mobile.webp?v=20260829-p4",
        imageAltText: "AZIEL featured game promotion",
        ctaTarget: "#",
        objectPosition: "center center",
        source: "default"
    });

    let autoTimer = null;
    let current = 0;
    let cards = [];
    let trackSlides = [];
    let virtualPosition = 0;
    let dragStartVirtual = 0;
    let dragVirtualPosition = 0;
    let dots = [];
    let activeBanners = [];
    let dragStartX = 0;
    let dragCurrentX = 0;
    let isDragging = false;
    let activePointerId = null;
    let activePointerType = "";
    let didDrag = false;
    let dragLastX = 0;
    let dragLastTime = 0;
    let dragVelocity = 0;
    let autoResumeTimer = null;
    let ambientBufferIndex = 0;
    let userPaused = false;
    let carouselAbort = null;
    let renderFrame = 0;
    let pendingVirtualPosition = 0;
    let ambientAuthoritySource = "";
    let carouselMetrics = { desktop: false, step: 0, centerOffset: 0 };
    const colorCache = new Map();
    const desktopMedia = window.matchMedia(DESKTOP_CAROUSEL_QUERY);
    const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

    const DRAG_CLICK_THRESHOLD = 8;

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
        cleanupCarouselController();
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
            // The fallback picture is already requested by the document and
            // remains visible. Only prepare managed media before swapping it in.
            await preloadFirstResponsiveBanner(banners[0]);

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
        cleanupCarouselController();
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
            <div class="az-banner-card active" data-home-banner-id="${escapeAttr(DEFAULT_HOME_HERO.id)}" data-home-banner-source="default" style="--az-banner-object-position: ${escapeAttr(DEFAULT_HOME_HERO.objectPosition)}; --az-banner-card-image: ${escapeAttr(cssUrl(resolveBannerBackgroundUrl(DEFAULT_HOME_HERO.desktopImageUrl)))}">
                <picture>
                    <source media="(min-width: 769px)" srcset="${escapeAttr(DEFAULT_HOME_HERO.desktopImageUrl)}" type="image/webp">
                    <img src="${escapeAttr(DEFAULT_HOME_HERO.mobileImageUrl)}" alt="${escapeAttr(DEFAULT_HOME_HERO.imageAltText)}" width="1280" height="719" loading="eager" decoding="async" fetchpriority="high" style="object-position: var(--az-banner-object-position)">
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

    async function preloadFirstResponsiveBanner(banner = {}) {
        const desktop = window.matchMedia("(min-width: 769px)").matches;
        const selectedUrl = desktop
            ? (banner.desktopImageUrl || banner.imageUrl)
            : (banner.mobileImageUrl || banner.imageUrl);
        if (selectedUrl) await preloadImage(selectedUrl);
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
            const loading = index === 0 ? "eager" : "lazy";
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
        cleanupCarouselController();
        carouselAbort = new AbortController();
        const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: carouselAbort.signal });
        current = 0;
        cards = [...track.querySelectorAll(".az-banner-card")];
        dots = [...dotsBox.querySelectorAll("button")];
        activeBanners = cards.map(card => ({
            imageUrl: card.querySelector("img")?.currentSrc || card.querySelector("img")?.src || "",
            objectPosition: card.style.getPropertyValue("--az-banner-object-position") || "center center"
        }));

        if (!cards.length) return;
        const firstClone = cards[0].cloneNode(true);
        const lastClone = cards[cards.length - 1].cloneNode(true);
        firstClone.dataset.carouselClone = "first";
        lastClone.dataset.carouselClone = "last";
        firstClone.setAttribute("aria-hidden", "true");
        lastClone.setAttribute("aria-hidden", "true");
        firstClone.tabIndex = -1;
        lastClone.tabIndex = -1;
        track.prepend(lastClone);
        track.append(firstClone);
        trackSlides = [...track.querySelectorAll(".az-banner-card")];
        virtualPosition = 0;
        userPaused = false;
        dotsBox.hidden = false;
        track.setAttribute("role", "region");
        track.setAttribute("aria-roledescription", "carousel");
        track.setAttribute("aria-label", t("home.banners", "Home banners"));
        track.tabIndex = 0;

        const goTo = index => {
            const normalized = (index + cards.length) % cards.length;
            let targetVirtual;
            if (index === current + 1) targetVirtual = virtualPosition + 1;
            else if (index === current - 1) targetVirtual = virtualPosition - 1;
            else targetVirtual = nearestEquivalentPosition(normalized, virtualPosition);
            current = normalized;
            virtualPosition = targetVirtual;
            commitBannerVisualState(track.closest(".az-banner-zone"));
            renderPhysicalPosition(targetVirtual, true);
            updateSlideState(targetVirtual);
            updateDots();
            if (reducedMotionMedia.matches) normalizeSettledPosition();
        };

        const finalizeActiveDrag = (event = null, { preserveVelocity = false } = {}) => {
            if (!isDragging) return false;
            if (event?.pointerId !== undefined && event.pointerId !== activePointerId) return false;

            const pointerId = activePointerId;
            isDragging = false;
            activePointerId = null;
            activePointerType = "";
            track.classList.remove("is-dragging");
            if (!preserveVelocity) dragVelocity = 0;

            try {
                if (pointerId !== null && track.hasPointerCapture?.(pointerId)) {
                    track.releasePointerCapture(pointerId);
                }
            } catch {
                // Capture may already have been released by the browser.
            }

            finishDrag(goTo);
            dragStartX = 0;
            dragStartVirtual = virtualPosition;
            dragVirtualPosition = virtualPosition;
            dragLastX = 0;
            dragLastTime = 0;
            return true;
        };

        listen(track, "transitionend", event => {
            if (event.target !== track || event.propertyName !== "transform") return;
            normalizeSettledPosition();
        });

        dots.forEach((dot, index) => {
            listen(dot, "click", () => {
                pauseForInteraction(goTo);
                goTo(index);
            });
        });

        listen(track, "pointerdown", event => {
            if (isDragging) return;
            if (event.isPrimary === false) return;
            if (event.button !== undefined && event.button !== 0) return;
            measureCarousel(track);
            isDragging = true;
            activePointerId = event.pointerId;
            activePointerType = event.pointerType || "mouse";
            didDrag = false;
            dragStartX = event.clientX;
            dragStartVirtual = virtualPosition;
            dragVirtualPosition = virtualPosition;
            dragLastX = event.clientX;
            dragLastTime = event.timeStamp;
            dragVelocity = 0;
            dragCurrentX = 0;
            track.classList.add("is-dragging");
            pauseForInteraction(goTo);
            try {
                track.setPointerCapture?.(activePointerId);
            } catch {
                // The lifecycle guards still terminate safely if capture is unavailable.
            }
        });

        listen(track, "pointermove", event => {
            if (!isDragging) return;
            if (event.pointerId !== activePointerId) return;
            if (activePointerType === "mouse" && (event.buttons & 1) === 0) {
                finalizeActiveDrag(event);
                return;
            }
            dragCurrentX = event.clientX - dragStartX;
            dragVirtualPosition = dragStartVirtual - (dragCurrentX / carouselMetrics.step);
            const elapsed = Math.max(1, event.timeStamp - dragLastTime);
            dragVelocity = (event.clientX - dragLastX) / elapsed;
            dragLastX = event.clientX;
            dragLastTime = event.timeStamp;
            if (Math.abs(dragCurrentX) > DRAG_CLICK_THRESHOLD) didDrag = true;
            scheduleGestureRender(dragVirtualPosition);
        });

        listen(track, "pointerup", event => {
            finalizeActiveDrag(event, { preserveVelocity: true });
        });

        listen(track, "pointercancel", event => {
            finalizeActiveDrag(event);
        });

        listen(track, "lostpointercapture", event => finalizeActiveDrag(event));
        listen(window, "blur", () => finalizeActiveDrag());

        listen(track, "click", event => {
            if (!didDrag) return;
            event.preventDefault();
            event.stopPropagation();
            didDrag = false;
        }, { capture: true });

        listen(track, "dragstart", event => event.preventDefault());
        listen(track, "mouseenter", pauseAuto);
        listen(track, "mouseleave", () => scheduleAuto(goTo));
        listen(track, "keydown", event => {
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

        listen(document, "visibilitychange", () => {
            if (document.hidden) {
                finalizeActiveDrag();
                pauseAuto();
                userPaused = false;
            }
            else scheduleAuto(goTo);
        });

        listen(desktopMedia, "change", () => scheduleCarouselMeasure(track));
        listen(reducedMotionMedia, "change", event => {
            if (event.matches) pauseAuto();
            else scheduleAuto(goTo);
        });
        listen(window, "resize", () => scheduleCarouselMeasure(track), { passive: true });
        measureCarousel(track);
        current = 0;
        virtualPosition = 0;
        commitBannerVisualState(track.closest(".az-banner-zone"));
        renderPhysicalPosition(0, false);
        updateSlideState(0);
        updateDots();
        startAuto(goTo);
    }

    function cleanupCarouselController() {
        carouselAbort?.abort();
        carouselAbort = null;
        clearTimeout(autoResumeTimer);
        clearInterval(autoTimer);
        cancelAnimationFrame(renderFrame);
        renderFrame = 0;
        autoResumeTimer = null;
        autoTimer = null;
        isDragging = false;
        activePointerId = null;
        activePointerType = "";
        trackSlides = [];
        virtualPosition = 0;
    }

    function measureCarousel(track) {
        const stageWidth = track?.closest(".az-banner-zone")?.clientWidth || track?.clientWidth || 0;
        const viewportWidth = window.innerWidth;
        const fraction = viewportWidth >= 1200 ? .72 : viewportWidth >= 1024 ? .76 : viewportWidth > 768 ? .9 : 1;
        const gap = viewportWidth >= 1024 ? 16 : viewportWidth > 768 ? 12 : 10;
        const slideWidth = stageWidth * fraction;
        track.style.setProperty("--az-banner-slide-width", `${slideWidth}px`);
        track.style.setProperty("--az-banner-slide-gap", `${gap}px`);
        carouselMetrics = {
            desktop: desktopMedia.matches,
            step: slideWidth + gap,
            centerOffset: (stageWidth - slideWidth) / 2
        };
    }

    function scheduleCarouselMeasure(track) {
        if (renderFrame) return;
        renderFrame = requestAnimationFrame(() => {
            renderFrame = 0;
            measureCarousel(track);
            renderPhysicalPosition(moduloPosition(virtualPosition), false);
        });
    }

    function scheduleGestureRender(position) {
        pendingVirtualPosition = position;
        if (renderFrame) return;
        renderFrame = requestAnimationFrame(() => {
            renderFrame = 0;
            const renderedPosition = moduloPosition(pendingVirtualPosition);
            renderPhysicalPosition(renderedPosition, false);
            updatePhysicalEmphasis(renderedPosition);
        });
    }

    function startAuto(goTo) {
        if (userPaused || cards.length < 2 || reducedMotionMedia.matches || document.hidden) return;
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

    function finishDrag(goTo) {
        cancelAnimationFrame(renderFrame);
        renderFrame = 0;
        const velocity = dragVelocity;
        dragCurrentX = 0;
        dragVelocity = 0;

        const velocitySlides = Math.max(-.35, Math.min(.35, -(velocity * 180) / carouselMetrics.step));
        const targetVirtual = Math.round(dragVirtualPosition + velocitySlides);
        const displayedPosition = moduloPosition(dragVirtualPosition);
        const physicalTarget = displayedPosition + (targetVirtual - dragVirtualPosition);
        virtualPosition = targetVirtual;
        current = moduloIndex(targetVirtual);
        commitBannerVisualState(trackSlides[0]?.closest(".az-banner-zone"));
        renderPhysicalPosition(physicalTarget, true);
        updateSlideState(physicalTarget);
        updateDots();
        if (reducedMotionMedia.matches) normalizeSettledPosition();

        scheduleAuto(goTo);
    }

    function renderPhysicalPosition(position, animate = true) {
        const track = trackSlides[0]?.parentElement;
        if (!track) return;
        const x = carouselMetrics.centerOffset - ((position + 1) * carouselMetrics.step);
        track.style.transition = animate && !reducedMotionMedia.matches
            ? "transform var(--az-banner-transition-duration, 560ms) var(--az-banner-transition-ease, ease)"
            : "none";
        track.style.transform = `translate3d(${x}px, 0, 0)`;
    }

    function updateSlideState(position) {
        updatePhysicalEmphasis(position);
        cards.forEach((card, index) => {
            const isActive = index === current;
            card.setAttribute("aria-hidden", isActive ? "false" : "true");
            if (card.matches("a")) card.tabIndex = isActive ? 0 : -1;
        });
    }

    function updatePhysicalEmphasis(position) {
        const activePhysicalIndex = Math.round(position) + 1;
        trackSlides.forEach((slide, index) => {
            slide.classList.toggle("active", index === activePhysicalIndex);
            slide.classList.toggle("is-neighbor", Math.abs(index - activePhysicalIndex) === 1);
        });
    }

    function normalizeSettledPosition() {
        virtualPosition = current;
        renderPhysicalPosition(current, false);
        updateSlideState(current);
    }

    function moduloIndex(position) {
        return ((Math.round(position) % cards.length) + cards.length) % cards.length;
    }

    function moduloPosition(position) {
        return ((position % cards.length) + cards.length) % cards.length;
    }

    function nearestEquivalentPosition(logicalIndex, reference) {
        const cycle = Math.round((reference - logicalIndex) / cards.length);
        return logicalIndex + (cycle * cards.length);
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
        const ambientSource = activeImg?.currentSrc || activeImg?.src || imageUrl;
        updateHeroAtmosphere(zone, activeImg, { forceUrl: ambientSource });
        activeImg?.style.setProperty("object-position", objectPosition);
    }

    async function updateHeroAtmosphere(zone, image, options = {}) {
        const home = zone?.closest(".az-home");
        if (!home || !image) return;
        const source = options.forceUrl || image.currentSrc || image.src || "";
        if (!source) return;

        ambientAuthoritySource = source;
        home.dataset.heroAtmosphereState = "resolving";
        try {
            const colors = await resolveHeroColors(image, source);
            if (ambientAuthoritySource !== source) return;
            home.style.setProperty("--home-hero-rgb-primary", colors.primary);
            home.style.setProperty("--home-hero-rgb-secondary", colors.secondary);
            home.style.setProperty("--home-hero-ambient-primary", `rgb(${colors.primary})`);
            home.style.setProperty("--home-hero-ambient-secondary", `rgb(${colors.secondary})`);
            home.dataset.heroAtmosphereState = colors.fallback ? "fallback" : "sampled";
            window.dispatchEvent(new CustomEvent("aziel:homeHeroAtmosphereChanged", {
                detail: { source, ...colors }
            }));
        } catch {
            if (ambientAuthoritySource !== source) return;
            applyFallbackHeroAtmosphere(home, source);
        }
    }

    async function resolveHeroColors(image, source) {
        if (colorCache.has(source)) return colorCache.get(source);

        await ensureImageReady(image);
        const colors = sampleHeroImageColors(image);
        colorCache.set(source, colors);
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
            const useWarm = coolCount > warmCount && warmCount > 0;
            const secondaryCount = useWarm ? warmCount : coolCount;
            const secondary = secondaryCount > 0
                ? normalizeRgb(
                    (useWarm ? warmRed : coolRed) / secondaryCount,
                    (useWarm ? warmGreen : coolGreen) / secondaryCount,
                    (useWarm ? warmBlue : coolBlue) / secondaryCount
                )
                : primary;
            return { primary, secondary, fallback: false };
        } catch {
            return fallbackHeroColors();
        }
    }

    function normalizeRgb(red, green, blue) {
        const [hue, saturation, lightness] = rgbToHsl(red, green, blue);
        const normalizedSaturation = Math.max(.18, Math.min(.58, saturation));
        const normalizedLightness = Math.max(.22, Math.min(.44, lightness));
        return hslToRgb(hue, normalizedSaturation, normalizedLightness).join(" ");
    }

    function rgbToHsl(red, green, blue) {
        const [r, g, b] = [red, green, blue].map(value => Math.max(0, Math.min(255, value || 0)) / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        let hue = 0;
        if (delta) {
            if (max === r) hue = ((g - b) / delta) % 6;
            else if (max === g) hue = ((b - r) / delta) + 2;
            else hue = ((r - g) / delta) + 4;
            hue = (hue * 60 + 360) % 360;
        }
        const lightness = (max + min) / 2;
        const saturation = delta ? delta / (1 - Math.abs((2 * lightness) - 1)) : 0;
        return [hue, saturation, lightness];
    }

    function hslToRgb(hue, saturation, lightness) {
        const chroma = (1 - Math.abs((2 * lightness) - 1)) * saturation;
        const segment = hue / 60;
        const x = chroma * (1 - Math.abs((segment % 2) - 1));
        let channels = [0, 0, 0];
        if (segment < 1) channels = [chroma, x, 0];
        else if (segment < 2) channels = [x, chroma, 0];
        else if (segment < 3) channels = [0, chroma, x];
        else if (segment < 4) channels = [0, x, chroma];
        else if (segment < 5) channels = [x, 0, chroma];
        else channels = [chroma, 0, x];
        const match = lightness - (chroma / 2);
        return channels.map(value => Math.round((value + match) * 255));
    }

    function fallbackHeroColors() {
        return { ...FALLBACK_HERO_COLORS, fallback: true };
    }

    function applyFallbackHeroAtmosphere(home, source = "") {
        home.style.setProperty("--home-hero-rgb-primary", FALLBACK_HERO_COLORS.primary);
        home.style.setProperty("--home-hero-rgb-secondary", FALLBACK_HERO_COLORS.secondary);
        home.style.setProperty("--home-hero-ambient-primary", `rgb(${FALLBACK_HERO_COLORS.primary})`);
        home.style.setProperty("--home-hero-ambient-secondary", `rgb(${FALLBACK_HERO_COLORS.secondary})`);
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

    function resolveBannerBackgroundUrl(url = "") {
        const value = String(url || "").trim();
        if (!value || /^(?:[a-z]+:|\/)/i.test(value)) return value;
        return `/${value.replace(/^\.\//, "")}`;
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
