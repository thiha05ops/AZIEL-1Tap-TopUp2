if (!window.__AZIEL_PWA_FIX_INITIALIZED__) {
    window.__AZIEL_PWA_FIX_INITIALIZED__ = true;

    initAzielFooterPolish();
    initAzielPwaRefresh();
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
    script.src = "/js/payment/pending-payment-recovery.js?v=20260723-recovery-runtime";
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

function loadAzielScriptOnce(src, marker, readyCheck) {
    if (typeof readyCheck === "function" && readyCheck()) return Promise.resolve();

    const existing = document.querySelector(`script[data-${marker}="true"]`);
    if (existing) {
        return new Promise((resolve, reject) => {
            if (typeof readyCheck === "function" && readyCheck()) {
                resolve();
                return;
            }
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
            window.setTimeout(() => {
                if (typeof readyCheck !== "function" || readyCheck()) {
                    resolve();
                    return;
                }
                reject(new Error(`${src} is present but not ready`));
            }, 5000);
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.defer = true;
        script.dataset[marker.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = "true";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(script);
    });
}

function loadAzielStylesheetOnce(href, marker) {
    if (document.querySelector(`link[data-${marker}="true"]`)) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset[marker.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = "true";
    document.head.appendChild(link);
}

function waitForAzielRuntime(check, label, timeoutMs = 5000) {
    if (check()) return Promise.resolve(check());

    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            const value = check();
            if (value) {
                window.clearInterval(timer);
                resolve(value);
                return;
            }

            if (Date.now() - startedAt >= timeoutMs) {
                window.clearInterval(timer);
                reject(new Error(`${label} did not become ready`));
            }
        }, 50);
    });
}

async function ensureAzielI18nReady() {
    if (window.AZIEL_I18N?.ready) {
        await window.AZIEL_I18N.ready();
        return;
    }

    await waitForAzielRuntime(() => window.AZIEL_I18N?.getLang, "AZIEL i18n", 3000).catch(() => {});
}

window.ensurePendingPaymentRecoveryRuntime = function ensurePendingPaymentRecoveryRuntime() {
    if (window.__AZIEL_PENDING_PAYMENT_RECOVERY_RUNTIME_PROMISE__) {
        return window.__AZIEL_PENDING_PAYMENT_RECOVERY_RUNTIME_PROMISE__;
    }

    window.__AZIEL_PENDING_PAYMENT_RECOVERY_RUNTIME_PROMISE__ = (async () => {
        await ensureAzielI18nReady();

        loadAzielStylesheetOnce(
            "/css/payment/payment-checkout-sheet.css?v=20260722-promptpay-platform",
            "aziel-payment-checkout-css"
        );
        loadAzielStylesheetOnce(
            "/css/payment/pending-payment-recovery.css?v=20260723-recovery-ux",
            "aziel-pending-payment-recovery"
        );

        await loadAzielScriptOnce(
            "/js/payment/android-app-launch.js?v=20260722-open-app",
            "aziel-android-app-launch",
            () => Boolean(window.AZIEL_ANDROID_APP_LAUNCH)
        );
        await loadAzielScriptOnce(
            "/js/payment/payment-checkout-sheet.js?v=20260723-recovery-runtime",
            "aziel-recovery-checkout-sheet",
            () => Boolean(window.PaymentCheckoutSheet?.openRecoveredPayment)
        );
        await loadAzielScriptOnce(
            "/js/payment/pending-payment-recovery.js?v=20260723-recovery-runtime",
            "aziel-pending-payment-recovery",
            () => Boolean(window.AZIEL_PENDING_PAYMENT_RECOVERY?.resumeAttempt)
        );

        const runtime = await waitForAzielRuntime(
            () => window.AZIEL_PENDING_PAYMENT_RECOVERY?.resumeAttempt && window.AZIEL_PENDING_PAYMENT_RECOVERY,
            "Pending payment recovery runtime"
        );

        return runtime;
    })().catch(error => {
        window.__AZIEL_PENDING_PAYMENT_RECOVERY_RUNTIME_PROMISE__ = null;
        throw error;
    });

    return window.__AZIEL_PENDING_PAYMENT_RECOVERY_RUNTIME_PROMISE__;
};

function initAzielPwaRefresh() {
    if (window.AZIEL_PWA_REFRESH?.requestRefresh) return;

    const t = (key, fallback) => window.AZIEL_I18N?.t?.(key, fallback) || fallback || key;

    const isPaymentFlowOpen = () => Boolean(
        document.querySelector("#azPaymentCheckoutSheet.show") ||
        document.querySelector(".az-payment-bank-chooser.show") ||
        document.body.classList.contains("az-payment-sheet-open") ||
        document.body.dataset.paymentSheetOpen === "true"
    );

    const requestRefresh = () => {
        if (window.__AZIEL_PWA_REFRESHING__) return false;

        if (isPaymentFlowOpen()) {
            const confirmed = window.confirm(t(
                "pwa_refresh_payment_open_confirm",
                "A payment is currently open. Refresh anyway?"
            ));
            if (!confirmed) return false;
        }

        window.__AZIEL_PWA_REFRESHING__ = true;
        window.location.reload();
        return true;
    };

    window.AZIEL_PWA_REFRESH = { requestRefresh, isPaymentFlowOpen };

    window.addEventListener("aziel:pwaUpdateReady", () => {
        if (window.__AZIEL_PWA_UPDATE_NOTICE_SHOWN__) return;
        window.__AZIEL_PWA_UPDATE_NOTICE_SHOWN__ = true;

        if (window.AZIEL_UI?.toast?.info) {
            window.AZIEL_UI.toast.info(t("pwa_update_available", "Update available. Refresh when ready."));
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
