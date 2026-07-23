if (!window.__AZIEL_PWA_FIX_INITIALIZED__) {
    window.__AZIEL_PWA_FIX_INITIALIZED__ = true;

    initAzielFooterPolish();
    scheduleAzielTrustLogoRender();
    loadPendingPaymentRecoveryOverlay();
    registerAzielServiceWorker();

    document.addEventListener("click", e => {
        const link = e.target.closest("a");

        if (!link) return;

        const href = link.getAttribute("href");

        if (!href) return;

        if (
            href.startsWith("http") ||
            href.startsWith("https") ||
            href.startsWith("//")
        ) {
            return;
        }

        if (
            href.startsWith("#") ||
            href.startsWith("mailto:") ||
            href.startsWith("tel:")
        ) {
            return;
        }

        e.preventDefault();

        window.location.href = href;
    });
}

function initAzielFooterPolish() {
    const footers = document.querySelectorAll(".site-footer, .game-mini-footer");
    if (!footers.length) return;

    const year = new Date().getFullYear();

    footers.forEach((footer, footerIndex) => {
        if (!footer.getAttribute("aria-label")) {
            footer.setAttribute("aria-label", "AZIEL footer");
        }

        footer.querySelectorAll("a[href^='http'], a[href^='//']").forEach(link => {
            link.setAttribute("target", "_blank");
            link.setAttribute("rel", "noopener noreferrer");
        });

        footer.querySelectorAll(".payment-logos").forEach((logos, index) => {
            if (!logos.getAttribute("aria-label")) {
                logos.setAttribute("aria-label", "Accepted payment methods");
            }
            logos.querySelectorAll("img").forEach(img => {
                if (!img.getAttribute("loading")) img.setAttribute("loading", "lazy");
                if (!img.getAttribute("decoding")) img.setAttribute("decoding", "async");
                if (!img.getAttribute("alt")) img.setAttribute("alt", "Payment method");
            });
            if (!logos.id) logos.id = `footerPaymentLogos-${footerIndex}-${index}`;
        });

        const copy = footer.querySelector(".footer-copy span:first-child");
        if (copy) {
            copy.textContent = copy.textContent.replace(/©\s*\d{4}/, `© ${year}`);
        }
    });
}

function scheduleAzielTrustLogoRender() {
    const render = (options = {}) => {
        window.AZIEL_PAYMENT_TRUST?.renderFooterTrustLogos?.(options).catch(error => {
            if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
                console.warn("Footer payment trust logos failed to render:", error.message);
            }
        });
    };

    render();
    document.addEventListener("DOMContentLoaded", () => {
        render();
        setTimeout(() => render(), 0);
        setTimeout(() => render(), 120);
    });
    window.addEventListener("load", () => render());
    window.addEventListener("aziel:shopRegionChanged", event => {
        render({ region: event?.detail?.region, refresh: true });
    });
}

function loadPendingPaymentRecoveryOverlay() {
    const loaderState = window.__AZIEL_PENDING_PAYMENT_RECOVERY_LOADER__ || {
        loading: false,
        loaded: false
    };
    window.__AZIEL_PENDING_PAYMENT_RECOVERY_LOADER__ = loaderState;

    if (loaderState.loaded || loaderState.loading || window.__AZIEL_PENDING_PAYMENT_RECOVERY_INITIALIZED__) return;

    const page = (window.location.pathname.split("/").pop() || "home.html").toLowerCase();
    const eligiblePages = new Set([
        "home.html",
        "mlbb.html",
        "pubg.html",
        "freefire.html",
        "hok.html",
        "aov-id.html",
        "pubg-rp.html",
        "telegram.html",
        "genshin.html",
        "roblox.html",
        "wallet.html",
        "tracking.html",
        "notifications.html",
        "account.html"
    ]);

    if (!eligiblePages.has(page)) return;
    if (!document.getElementById("azHeaderMount")) return;
    if (document.querySelector('script[data-aziel-pending-payment-recovery="true"]')) return;

    if (!document.querySelector('link[data-aziel-pending-payment-recovery="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/css/payment/pending-payment-recovery.css?v=20260723-recovery-ux";
        link.dataset.azielPendingPaymentRecovery = "true";
        document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = "/js/payment/pending-payment-recovery.js?v=20260723-recovery-ux";
    script.defer = true;
    script.dataset.azielPendingPaymentRecovery = "true";
    loaderState.loading = true;
    script.onload = () => {
        loaderState.loading = false;
        loaderState.loaded = true;
    };
    script.onerror = () => {
        loaderState.loading = false;
    };
    document.head.appendChild(script);
}

function registerAzielServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(location.hostname)) return;

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" })
            .then(registration => {
                registration.addEventListener("updatefound", () => {
                    const worker = registration.installing;
                    if (!worker) return;
                    worker.addEventListener("statechange", () => {
                        if (worker.state === "installed" && navigator.serviceWorker.controller) {
                            window.dispatchEvent(new CustomEvent("aziel:pwaUpdateReady"));
                        }
                    });
                });
            })
            .catch(() => {
                // PWA installability must never block storefront navigation.
            });
    }, { once: true });
}
