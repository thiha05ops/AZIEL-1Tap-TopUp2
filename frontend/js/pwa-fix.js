initAzielFooterPolish();
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
