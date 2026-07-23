// frontend/js/payment/pending-payment-recovery.js
// Compact entry overlay for resumable manual dynamic PromptPay attempts.

(function () {
    if (window.__AZIEL_PENDING_PAYMENT_RECOVERY_INITIALIZED__) return;
    window.__AZIEL_PENDING_PAYMENT_RECOVERY_INITIALIZED__ = true;

    const MODULE_VERSION = "20260723-recovery-ux";
    const DISMISS_PREFIX = "azielPendingPaymentDismissed:";
    const RECOVERY_EVENT = "aziel:resume-payment";
    const CHECKOUT_SELECTOR = "#azPaymentCheckoutSheet.show";

    const state = {
        initialized: false,
        fetching: false,
        attempts: [],
        activeAttempt: null,
        countdownTimer: null,
        checkoutObserver: null,
        selectedRecovery: null,
        runtimePromise: null,
        lastFetchStartedAt: 0,
        forceShowAttemptId: "",
        closeRefreshInFlight: false,
        closeRefreshTimer: null
    };

    function currentLanguage() {
        return window.AZIEL_I18N?.getLang?.() ||
            localStorage.getItem("azielLanguage") ||
            localStorage.getItem("language") ||
            localStorage.getItem("azielLang") ||
            localStorage.getItem("selectedLanguage") ||
            document.documentElement?.lang ||
            "en";
    }

    function t(key, fallback) {
        const translated = window.AZIEL_I18N?.t?.(key, fallback);
        if (translated && translated !== key && translated !== fallback) return translated;
        const lang = currentLanguage();
        return window.AZIEL_LANG?.[lang]?.[key] ||
            window.AZIEL_LANG?.en?.[key] ||
            translated ||
            fallback ||
            key;
    }

    function isDev() {
        return ["localhost", "127.0.0.1"].includes(window.location.hostname);
    }

    function recoveryDevLog(label, detail = {}) {
        if (!isDev()) return;
        console.info(label, detail);
    }

    function currentPage() {
        return (window.location.pathname.split("/").pop() || "home.html").toLowerCase();
    }

    function isEligiblePage() {
        if (!document.getElementById("azHeaderMount")) return false;
        if (currentPage().startsWith("admin")) return false;

        const allowed = new Set([
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

        return allowed.has(currentPage());
    }

    function getToken() {
        return window.AZIEL?.getToken?.() || localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    }

    function getApiUrl(path) {
        return window.AZIEL?.apiUrl?.(path) || path;
    }

    function isAuthenticated() {
        return Boolean(getToken() && window.AZIEL?.user);
    }

    function isPaymentSheetOpen() {
        return Boolean(document.querySelector(CHECKOUT_SELECTOR));
    }

    function dismissKey(attemptId) {
        return `${DISMISS_PREFIX}${attemptId || "unknown"}`;
    }

    function isDismissed(attempt) {
        if (state.forceShowAttemptId && attempt?.attemptId === state.forceShowAttemptId) return false;
        return sessionStorage.getItem(dismissKey(attempt?.attemptId)) === "1";
    }

    function setDismissed(attempt) {
        if (attempt?.attemptId) sessionStorage.setItem(dismissKey(attempt.attemptId), "1");
    }

    function safeText(value, fallback = "") {
        const text = String(value || fallback || "").trim();
        return text || fallback;
    }

    function formatAmount(attempt = {}) {
        const amount = Number(attempt.finalAmount ?? attempt.amount ?? 0);
        const currency = safeText(attempt.currency, "");
        if (!Number.isFinite(amount) || amount <= 0) return currency || "-";
        return `${amount.toLocaleString()} ${currency}`.trim();
    }

    function formatRemaining(seconds) {
        const total = Math.max(0, Number(seconds || 0));
        const minutes = Math.floor(total / 60);
        const remainingSeconds = Math.floor(total % 60);
        return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
    }

    function computeRemaining(attempt = {}) {
        if (attempt.recoverableExpiresAt) {
            const expires = new Date(attempt.recoverableExpiresAt).getTime();
            if (Number.isFinite(expires)) {
                return Math.max(0, Math.floor((expires - Date.now()) / 1000));
            }
        }
        return Math.max(0, Number(attempt.remainingSeconds || 0));
    }

    function getIconSrc(attempt = {}) {
        const code = safeText(attempt.productCode || attempt.gameCode, "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
        return code ? `/assets/games/${code}.webp` : "";
    }

    function removeOverlay(options = {}) {
        const overlay = document.getElementById("azPendingPaymentOverlay");
        if (state.countdownTimer) {
            clearInterval(state.countdownTimer);
            state.countdownTimer = null;
        }
        if (state.closeRefreshTimer) {
            window.clearTimeout(state.closeRefreshTimer);
            state.closeRefreshTimer = null;
        }
        if (!overlay) return;

        if (options.animate === false) {
            overlay.remove();
            return;
        }

        overlay.classList.add("is-leaving");
        window.setTimeout(() => overlay.remove(), 180);
    }

    function clearState() {
        state.attempts = [];
        state.activeAttempt = null;
        state.selectedRecovery = null;
        state.forceShowAttemptId = "";
        state.closeRefreshInFlight = false;
        removeOverlay({ animate: false });
    }

    function ensureOverlay() {
        let overlay = document.getElementById("azPendingPaymentOverlay");
        if (overlay) return overlay;

        overlay = document.createElement("aside");
        overlay.id = "azPendingPaymentOverlay";
        overlay.className = "az-pending-payment";
        overlay.dataset.version = MODULE_VERSION;
        overlay.setAttribute("aria-label", t("resumePaymentTitle", "Payment Not Completed"));
        document.body.appendChild(overlay);
        return overlay;
    }

    function bindClose(overlay) {
        overlay.querySelector(".az-pending-payment__close")?.addEventListener("click", event => {
            event.preventDefault();
            setDismissed(state.activeAttempt);
            removeOverlay();
        });
    }

    function renderOverlay() {
        const attempt = state.activeAttempt;
        if (!attempt || isPaymentSheetOpen() || isDismissed(attempt)) {
            removeOverlay();
            return;
        }

        const remaining = computeRemaining(attempt);
        if (remaining <= 0) {
            state.activeAttempt = null;
            removeOverlay();
            return;
        }

        const moreCount = Math.max(0, state.attempts.length - 1);
        const iconSrc = getIconSrc(attempt);
        const overlay = ensureOverlay();
        overlay.classList.remove("is-preview", "is-leaving");
        overlay.innerHTML = `
            <div class="az-pending-payment__shell" role="region" aria-labelledby="azPendingPaymentTitle">
                <button type="button" class="az-pending-payment__close" aria-label="${t("resumePaymentClose", "Dismiss resume payment")}">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
                <div class="az-pending-payment__content">
                    <div class="az-pending-payment__identity">
                        <div class="az-pending-payment__icon" aria-hidden="true">
                            <i class="fa-solid fa-bolt"></i>
                        </div>
                        <div class="az-pending-payment__text">
                            <strong id="azPendingPaymentTitle">${t("resumePaymentTitle", "Payment Not Completed")}</strong>
                            <span>${t("resumePaymentSubtitle", "You have a payment waiting to be completed.")}</span>
                        </div>
                    </div>
                    <div class="az-pending-payment__product">
                        <div class="az-pending-payment__thumb" aria-hidden="true">
                            ${iconSrc ? `<img src="${iconSrc}" alt="" loading="lazy" decoding="async">` : `<i class="fa-solid fa-gamepad"></i>`}
                        </div>
                        <div>
                            <strong>${safeText(attempt.productName, t("payment", "Payment"))}</strong>
                            <span>${safeText(attempt.packageName, "-")}</span>
                        </div>
                    </div>
                    <div class="az-pending-payment__meta">
                        <b>${formatAmount(attempt)}</b>
                        <small>
                            <span>${t("resumePaymentRemaining", "Time remaining")}</span>
                            <span id="azPendingPaymentCountdown">${formatRemaining(remaining)}</span>
                        </small>
                        ${moreCount > 0 ? `<em>${t("resumePaymentMore", "+{count} more pending payments").replace("{count}", String(moreCount))}</em>` : ""}
                    </div>
                    <button type="button" class="az-pending-payment__continue">
                        ${t("resumePaymentAction", "Continue Payment")}
                    </button>
                </div>
            </div>
        `;

        bindClose(overlay);
        overlay.querySelector(".az-pending-payment__continue")?.addEventListener("click", event => {
            event.preventDefault();
            resumeAttempt(attempt.attemptId);
        });

        startCountdown();
        recoveryDevLog("RECOVERY_OVERLAY_RENDERED", {
            attemptId: attempt.attemptId,
            remainingSeconds: remaining
        });
        if (state.forceShowAttemptId === attempt.attemptId) state.forceShowAttemptId = "";
    }

    function startCountdown() {
        if (state.countdownTimer) clearInterval(state.countdownTimer);

        state.countdownTimer = window.setInterval(() => {
            const countdown = document.getElementById("azPendingPaymentCountdown");
            if (!countdown || !state.activeAttempt) return;

            const remaining = computeRemaining(state.activeAttempt);
            countdown.textContent = formatRemaining(remaining);

            if (remaining <= 0) {
                clearInterval(state.countdownTimer);
                state.countdownTimer = null;
                state.activeAttempt = null;
                removeOverlay();
            }
        }, 1000);
    }

    function datasetName(marker = "") {
        return marker.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }

    function loadStylesheet(href, marker) {
        if (document.querySelector(`link[data-${marker}="true"]`)) return Promise.resolve();
        return new Promise(resolve => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = href;
            link.dataset[datasetName(marker)] = "true";
            link.onload = resolve;
            link.onerror = resolve;
            document.head.appendChild(link);
        });
    }

    function loadScript(src, marker, readyCheck) {
        if (readyCheck?.()) return Promise.resolve();
        if (document.querySelector(`script[data-${marker}="true"]`)) {
            return new Promise(resolve => {
                const startedAt = Date.now();
                const timer = window.setInterval(() => {
                    if (readyCheck?.() || Date.now() - startedAt > 5000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 40);
            });
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.defer = true;
            script.dataset[datasetName(marker)] = "true";
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Could not load ${src}`));
            document.head.appendChild(script);
        });
    }

    async function ensureRecoveryCheckoutRuntime() {
        if (window.PaymentCheckoutSheet?.openRecoveredPayment) return;
        if (state.runtimePromise) return state.runtimePromise;

        state.runtimePromise = (async () => {
            await loadStylesheet("/css/payment/payment-checkout-sheet.css?v=20260722-promptpay-platform", "aziel-recovery-checkout-css");
            await loadScript("/js/payment/android-app-launch.js?v=20260722-open-app", "aziel-recovery-android-launch", () => Boolean(window.AZIEL_ANDROID_APP_LAUNCH));
            await loadScript("/js/payment/payment-checkout-sheet.js?v=20260722-phase23-recovery", "aziel-recovery-checkout-sheet", () => Boolean(window.PaymentCheckoutSheet?.openRecoveredPayment));
            if (!window.PaymentCheckoutSheet?.openRecoveredPayment) {
                throw new Error("Recovery checkout is unavailable.");
            }
        })();

        try {
            await state.runtimePromise;
        } finally {
            state.runtimePromise = null;
        }
    }

    function chooseActiveAttempt(attempts = []) {
        const currentRegion = window.AZIEL?.getShopRegion?.() || "";
        return attempts
            .filter(item => item?.resumable !== false)
            .filter(item => !currentRegion || !item?.region || String(item.region).toUpperCase() === String(currentRegion).toUpperCase())
            .filter(item => !isDismissed(item))
            .filter(item => computeRemaining(item) > 0)
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null;
    }

    async function fetchRecoverable(options = {}) {
        if (!isEligiblePage()) return null;
        if (state.fetching) return;
        if (!getToken()) {
            clearState();
            return null;
        }
        if (!window.AZIEL?.user) return null;
        if (isPaymentSheetOpen()) {
            removeOverlay();
            return null;
        }

        if (options.forceAttemptId) state.forceShowAttemptId = safeText(options.forceAttemptId, "");

        state.fetching = true;
        state.lastFetchStartedAt = Date.now();
        recoveryDevLog("RECOVERY_REFRESH_STARTED", {
            attemptId: options.forceAttemptId || "",
            forced: Boolean(options.forceAttemptId || options.force)
        });

        try {
            const res = await fetch(getApiUrl("/api/payment/manual/recoverable"), {
                headers: window.AZIEL?.authHeaders?.() || { Authorization: `Bearer ${getToken()}` }
            });

            if (res.status === 401) {
                clearState();
                return null;
            }

            const data = await res.json().catch(() => ({}));
            const attempts = Array.isArray(data.recoverable) ? data.recoverable : [];
            state.attempts = attempts;
            state.activeAttempt = chooseActiveAttempt(attempts);
            recoveryDevLog("RECOVERY_REFRESH_RESULT", {
                forceAttemptId: options.forceAttemptId || "",
                count: attempts.length,
                matched: Boolean(options.forceAttemptId && attempts.some(item => item.attemptId === options.forceAttemptId)),
                activeAttemptId: state.activeAttempt?.attemptId || ""
            });

            if (!state.activeAttempt) {
                removeOverlay();
                return null;
            }

            renderOverlay();
            return state.activeAttempt;
        } catch (error) {
            if (isDev()) console.warn("Pending payment recovery lookup failed:", error.message);
            return null;
        } finally {
            state.fetching = false;
        }
    }

    function scheduleCheckoutCloseRefresh(detail = {}) {
        recoveryDevLog("RECOVERY_CLOSE_EVENT_RECEIVED", {
            attemptId: detail.attemptId || "",
            mode: detail.mode || "",
            receiptSubmitted: Boolean(detail.receiptSubmitted),
            completed: Boolean(detail.completed),
            cancelled: Boolean(detail.cancelled)
        });
        if (state.closeRefreshInFlight) return;
        if (detail.mode !== "new") return;
        if (!detail.attemptId) return;
        if (detail.receiptSubmitted || detail.completed || detail.cancelled) return;

        if (state.closeRefreshTimer) {
            window.clearTimeout(state.closeRefreshTimer);
            state.closeRefreshTimer = null;
        }

        state.closeRefreshInFlight = true;
        state.forceShowAttemptId = safeText(detail.attemptId, "");

        const run = async (attempt = 1) => {
            if (isPaymentSheetOpen()) {
                if (attempt < 2) {
                    state.closeRefreshTimer = window.setTimeout(() => run(attempt + 1), 350);
                    return;
                }
                state.closeRefreshInFlight = false;
                return;
            }

            const active = await fetchRecoverable({
                force: true,
                forceAttemptId: detail.attemptId
            });

            if (!active && attempt < 2) {
                state.closeRefreshTimer = window.setTimeout(() => run(attempt + 1), 350);
                return;
            }

            state.closeRefreshInFlight = false;
            state.closeRefreshTimer = null;
        };

        state.closeRefreshTimer = window.setTimeout(() => run(1), 120);
    }

    function consumePendingCheckoutCloseEvent() {
        const pending = window.__AZIEL_PENDING_PAYMENT_CLOSE_EVENT__;
        if (!pending || pending.consumed) return;
        window.__AZIEL_PENDING_PAYMENT_CLOSE_EVENT__ = {
            ...pending,
            consumed: true
        };
        scheduleCheckoutCloseRefresh(pending);
    }

    async function resumeAttempt(attemptId) {
        const id = safeText(attemptId, "");
        if (!id) return;

        try {
            const button = document.querySelector(".az-pending-payment__continue");
            if (button) {
                button.disabled = true;
                button.textContent = t("Loading...", "Loading...");
            }

            const res = await fetch(getApiUrl(`/api/payment/manual/recoverable/${encodeURIComponent(id)}/resume`), {
                method: "POST",
                headers: window.AZIEL?.authHeaders?.({ "Content-Type": "application/json" }) || {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${getToken()}`
                }
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.success || !data.recoverable?.attemptId) {
                removeOverlay();
                await fetchRecoverable({ force: true });
                return;
            }

            state.selectedRecovery = data.recoverable;
            window.AZIEL_PENDING_PAYMENT_RECOVERY.attempts = state.attempts.slice();
            window.AZIEL_PENDING_PAYMENT_RECOVERY.selectedRecovery = state.selectedRecovery;

            await ensureRecoveryCheckoutRuntime();
            removeOverlay();
            window.dispatchEvent(new CustomEvent(RECOVERY_EVENT, {
                detail: {
                    recovery: data.recoverable,
                    attempts: state.attempts.slice()
                }
            }));
        } catch (error) {
            if (isDev()) console.warn("Pending payment resume failed:", error.message);
            await fetchRecoverable({ force: true });
        }
    }

    function watchCheckoutSheet() {
        if (state.checkoutObserver || !document.body) return;

        state.checkoutObserver = new MutationObserver(() => {
            if (isPaymentSheetOpen()) removeOverlay();
        });

        state.checkoutObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class"]
        });
    }

    function init() {
        if (state.initialized || !isEligiblePage()) return;
        state.initialized = true;

        watchCheckoutSheet();

        window.addEventListener("aziel:ready", () => fetchRecoverable({ force: true }));
        window.addEventListener("aziel:userChanged", () => {
            if (!window.AZIEL?.user) clearState();
            else fetchRecoverable({ force: true });
        });
        window.addEventListener("aziel:languageChanged", () => {
            renderOverlay();
        });
        window.addEventListener("aziel:shopRegionChanged", () => {
            removeOverlay();
            fetchRecoverable({ force: true });
        });
        window.addEventListener("aziel:payment-checkout-closed", event => {
            scheduleCheckoutCloseRefresh(event.detail || {});
        });
        consumePendingCheckoutCloseEvent();
        window.addEventListener("aziel:recovered-payment-submitted", event => {
            const attemptId = event.detail?.attemptId || state.selectedRecovery?.attemptId || state.activeAttempt?.attemptId || "";
            if (attemptId) sessionStorage.setItem(dismissKey(attemptId), "1");
            state.selectedRecovery = null;
            state.activeAttempt = null;
            removeOverlay({ animate: false });
            fetchRecoverable({ force: true });
        });
        window.addEventListener("aziel:recovered-payment-expired", () => {
            state.selectedRecovery = null;
            state.activeAttempt = null;
            removeOverlay({ animate: false });
            fetchRecoverable({ force: true });
        });

        if (isAuthenticated()) fetchRecoverable({ force: true });
    }

    window.AZIEL_PENDING_PAYMENT_RECOVERY = window.AZIEL_PENDING_PAYMENT_RECOVERY || {
        attempts: [],
        selectedRecovery: null,
        resumeAttempt,
        refresh: () => fetchRecoverable({ force: true }),
        dismiss: () => {
            setDismissed(state.activeAttempt);
            removeOverlay();
        }
    };
    window.AZIEL_PENDING_PAYMENT_RECOVERY.resumeAttempt = resumeAttempt;
    window.AZIEL_PENDING_PAYMENT_RECOVERY.refresh = () => fetchRecoverable({ force: true });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
