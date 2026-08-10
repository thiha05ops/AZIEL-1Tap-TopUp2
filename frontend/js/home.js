// frontend/js/home.js

document.addEventListener("DOMContentLoaded", () => {
    initUserHeader();
    initDrawer();
    initRegionPayments();
    initWalletPreview();
    initHomeHero();

    initAzielBanner();
});

function initHomeHero() {
    const searchButton = document.getElementById("homeHeroSearchBtn");
    if (!searchButton || searchButton.dataset.ready === "true") return;

    searchButton.dataset.ready = "true";
    searchButton.addEventListener("click", () => {
        if (window.AZIEL_SEARCH?.open) {
            window.AZIEL_SEARCH.open(searchButton);
            return;
        }

        window.addEventListener("aziel:searchReady", () => {
            window.AZIEL_SEARCH?.open?.(searchButton);
        }, { once: true });
    });
}

function initUserHeader() {
    const username = localStorage.getItem("username");
    const displayName = localStorage.getItem("displayName") || username;

    const avatarText = document.getElementById("avatarText");

    if (avatarText) {
        avatarText.innerText = username
            ? displayName.charAt(0).toUpperCase()
            : "👤";
    }
}

function initDrawer() {
    const mobileMenuBtn = document.getElementById("mobileMenuBtn");
    const mobileDrawer = document.getElementById("mobileDrawer");
    const mobileDrawerOverlay = document.getElementById("mobileDrawerOverlay");
    const closeDrawerBtn = document.getElementById("closeDrawerBtn");

    if (!mobileMenuBtn || !mobileDrawer || !mobileDrawerOverlay) return;

    function openMobileDrawer() {
        mobileDrawer.classList.add("show");
        mobileDrawerOverlay.classList.add("show");
        document.body.style.overflow = "hidden";
    }

    function closeMobileDrawer() {
        mobileDrawer.classList.remove("show");
        mobileDrawerOverlay.classList.remove("show");
        document.body.style.overflow = "";
    }

    mobileMenuBtn.addEventListener("click", openMobileDrawer);
    mobileDrawerOverlay.addEventListener("click", closeMobileDrawer);

    if (closeDrawerBtn) {
        closeDrawerBtn.addEventListener("click", closeMobileDrawer);
    }

    document.querySelectorAll(".az-mobile-drawer a").forEach(link => {
        link.addEventListener("click", closeMobileDrawer);
    });
}

function initRegionPayments() {
    const paymentLogos = document.getElementById("paymentLogos");
    if (!paymentLogos) return;

    const rawRegion =
        localStorage.getItem("selectedRegion") ||
        localStorage.getItem("region") ||
        localStorage.getItem("userRegion") ||
        localStorage.getItem("azielRegion") ||
        "MM";

    const region = rawRegion.toLowerCase();

    const isThailand =
        region.includes("thai") ||
        region.includes("thailand") ||
        region === "th" ||
        region.includes("ไทย");

    const logos = isThailand
        ? ["promptpay.png", "scb.png", "visa.png"]
        : ["kbzpay.png", "wavepay.png", "ayapay.png"];

    paymentLogos.innerHTML = logos.map(logo => `
        <img src="assets/payment/${logo}" alt="${logo}">
    `).join("");
}

function initWalletPreview() {
    const headerWalletText = document.getElementById("headerWalletText");

    if (!headerWalletText) return;

    const rawRegion =
        localStorage.getItem("selectedRegion") ||
        localStorage.getItem("region") ||
        "MM";

    const region = rawRegion.toLowerCase();

    const isThailand =
        region.includes("thai") ||
        region === "th" ||
        region.includes("ไทย");

    const currency = isThailand ? "THB" : "MMK";

    const walletMMK =
        localStorage.getItem("walletMMK") ||
        localStorage.getItem("balanceMMK") ||
        "48500";

    const walletTHB =
        localStorage.getItem("walletTHB") ||
        localStorage.getItem("balanceTHB") ||
        "0";

    const amount = isThailand ? walletTHB : walletMMK;

    headerWalletText.innerText = `${currency} ${Number(amount).toLocaleString()}`;
}

function initAzielBanner() {
    const track = document.getElementById("azBannerTrack");
    const cards = [...document.querySelectorAll(".az-banner-card")];
    const dots = [...document.querySelectorAll("#azBannerDots button")];

    if (!track || cards.length === 0) return;

    let current = 0;
    let dragStartX = 0;
    let dragCurrentX = 0;
    let isDragging = false;
    let autoTimer = null;
    let animationFrame = null;

    const GAP = 0.78;
    const DRAG_LIMIT = 160;
    const AUTO_DELAY = 4500;

    function clampDrag(value) {
        return Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, value));
    }

    function getShortestOffset(index) {
        let offset = index - current;

        if (offset > cards.length / 2) {
            offset -= cards.length;
        }

        if (offset < -cards.length / 2) {
            offset += cards.length;
        }

        return offset;
    }

    function updateDots() {
        dots.forEach((dot, index) => {
            dot.classList.toggle("active", index === current);
        });
    }

    function setAtmosphereColor() {
        const activeImg = cards[current].querySelector("img");

        if (!activeImg) return;

        const zone = document.getElementById("bannerZone");
        const home = zone?.closest(".az-home");
        const imageUrl = activeImg.currentSrc || activeImg.src || "";
        if (!zone || !imageUrl) return;

        zone.style.setProperty(
            "--az-banner-ambient-image",
            `url("${String(imageUrl).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}")`
        );
        home?.style.setProperty(
            "--az-banner-ambient-image",
            `url("${String(imageUrl).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}")`
        );
        if (home && !home.querySelector(".az-home-ambient-buffer")) {
            ["", ""].forEach(() => {
                const buffer = document.createElement("div");
                buffer.className = "az-home-ambient-buffer";
                buffer.setAttribute("aria-hidden", "true");
                home.prepend(buffer);
            });
        }
        const buffer = home?.querySelector(".az-home-ambient-buffer");
        if (buffer) {
            buffer.style.backgroundImage = `url("${String(imageUrl).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}")`;
            buffer.classList.add("is-active");
        }
    }

    function render(dragOffset = 0) {
        const cardWidth = cards[0].offsetWidth;
        const step = cardWidth * GAP;

        cards.forEach((card, index) => {
            card.classList.toggle("active", index === current);

            const offset = getShortestOffset(index);
            const x = offset * step + dragOffset;

            const distance = Math.abs(x) / step;

            const scale = Math.max(0.72, 1 - distance * 0.15);
            const opacity = Math.max(0.15, 1 - distance * 0.55);
            const brightness = Math.max(0.72, 1 - distance * 0.18);
            const blur = Math.min(distance * 4, 7);
            const zIndex = 100 - Math.floor(distance * 10);

            card.style.transform =
                `translateX(calc(-50% + ${x}px)) scale(${scale})`;

            card.style.opacity = opacity;
            card.style.filter = `brightness(${brightness}) blur(${blur}px)`;
            card.style.zIndex = zIndex;

            card.style.transition =
                isDragging
                    ? "none"
                    : "transform .5s ease, opacity .5s ease, filter .5s ease";

            card.style.pointerEvents =
                Math.abs(offset) === 0 && Math.abs(dragOffset) < 8
                    ? "auto"
                    : "none";
        });
    }

    function goTo(index) {
        current = (index + cards.length) % cards.length;
        render(0);
        updateDots();
        setAtmosphereColor();
    }

    function next() {
        goTo(current + 1);
    }

    function prev() {
        goTo(current - 1);
    }

    function startAuto() {
        clearInterval(autoTimer);
        autoTimer = setInterval(next, AUTO_DELAY);
    }

    function stopAuto() {
        clearInterval(autoTimer);
    }

    function animateBack() {
        const start = dragCurrentX;
        const duration = 260;
        const startTime = performance.now();

        function frame(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            const value = start * (1 - ease);

            render(value);

            if (progress < 1) {
                animationFrame = requestAnimationFrame(frame);
            } else {
                render(0);
            }
        }

        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(frame);
    }

    function finishDrag() {
        const diff = dragCurrentX;

        if (diff < -70) {
            next();
        } else if (diff > 70) {
            prev();
        } else {
            animateBack();
        }

        dragCurrentX = 0;
        startAuto();
    }

    dots.forEach((dot, index) => {
        dot.addEventListener("click", () => {
            stopAuto();
            goTo(index);
            startAuto();
        });
    });

    track.addEventListener("pointerdown", e => {
        isDragging = true;
        dragStartX = e.clientX;
        dragCurrentX = 0;

        stopAuto();
        track.setPointerCapture(e.pointerId);
    });

    track.addEventListener("pointermove", e => {
        if (!isDragging) return;

        dragCurrentX = clampDrag(e.clientX - dragStartX);
        render(dragCurrentX);
    });

    track.addEventListener("pointerup", e => {
        if (!isDragging) return;

        isDragging = false;
        track.releasePointerCapture(e.pointerId);
        finishDrag();
    });

    track.addEventListener("pointercancel", () => {
        isDragging = false;
        animateBack();
        startAuto();
    });

    window.addEventListener("resize", () => {
        render(0);
    });

    goTo(0);
    startAuto();
}
