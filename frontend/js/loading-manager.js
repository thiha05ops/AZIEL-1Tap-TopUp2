// Shared, explicit operation tracker for the storefront's top loading bar.
(function initAzielLoadingManager() {
    if (window.__AZIEL_LOADING_MANAGER__) return;
    window.__AZIEL_LOADING_MANAGER__ = true;

    const bootstrapState = window.__AZIEL_LOADING_BOOTSTRAP__;
    const operations = new Set(bootstrapState?.pending || []);
    const timeouts = new Map();
    let sequence = 0;
    let progress = 0;
    let progressTimer = null;
    let hideTimer = null;

    function ensureElement() {
        let element = document.querySelector(".az-global-progress[data-aziel-global-progress]");
        if (!element) {
            element = document.createElement("div");
            element.className = "az-global-progress";
            element.dataset.azielGlobalProgress = "true";
            element.setAttribute("aria-hidden", "true");
            element.innerHTML = '<div class="az-global-progress__bar"></div>';
        }

        const mount = document.getElementById("azHeaderMount");
        const parent = mount || document.body || document.documentElement;
        element.classList.toggle("is-viewport-mounted", !mount);
        if (element.parentElement !== parent) parent.appendChild(element);
        return element;
    }

    function paint(value, active = true) {
        const element = ensureElement();
        progress = Math.max(0, Math.min(1, value));
        element.style.setProperty("--az-loading-progress", String(progress));
        element.classList.toggle("is-active", active);
    }

    function scheduleEstimate() {
        clearInterval(progressTimer);
        progressTimer = window.setInterval(() => {
            if (!operations.size) return;
            const ceiling = .92;
            paint(progress + Math.max(.008, (ceiling - progress) * .12));
        }, 360);
    }

    function start(label = "operation") {
        const token = `${label}:${Date.now()}:${++sequence}`;
        operations.add(token);
        clearTimeout(hideTimer);
        if (operations.size === 1) {
            paint(.08);
            scheduleEstimate();
        }

        // Expiry is distinct from successful completion so unresolved work
        // never makes the indicator jump to 100%.
        timeouts.set(token, window.setTimeout(() => expire(token), 30000));
        return token;
    }

    function settleIfIdle(completed) {
        if (operations.size) return;
        clearInterval(progressTimer);
        progressTimer = null;
        if (completed) {
            paint(1);
            hideTimer = window.setTimeout(() => paint(0, false), 180);
        } else {
            paint(progress, false);
        }
    }

    function finish(token) {
        if (!token || !operations.delete(token)) return false;
        clearTimeout(timeouts.get(token));
        timeouts.delete(token);
        settleIfIdle(true);
        return true;
    }

    function expire(token) {
        if (!token || !operations.delete(token)) return false;
        timeouts.delete(token);
        settleIfIdle(false);
        window.dispatchEvent(new CustomEvent("aziel:loadingExpired", { detail: { token } }));
        return true;
    }

    function track(value, label) {
        const token = start(label);
        return Promise.resolve(value).finally(() => finish(token));
    }

    function isEligibleNavigation(anchor, event) {
        if (!anchor || event.defaultPrevented || event.button !== 0) return false;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
        if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return false;
        let target;
        try { target = new URL(anchor.href, window.location.href); } catch (_) { return false; }
        if (!/^https?:$/.test(target.protocol) || target.origin !== window.location.origin) return false;
        const current = window.location;
        return !(target.pathname === current.pathname && target.search === current.search && target.hash);
    }

    window.addEventListener("click", event => {
        const anchor = event.target.closest?.("a[href]");
        if (!isEligibleNavigation(anchor, event)) return;
        start("navigation");
        try { sessionStorage.setItem("aziel:navigation-pending", "1"); } catch (_) {}
    });

    window.addEventListener("pagehide", () => {
        try { sessionStorage.setItem("aziel:navigation-pending", "1"); } catch (_) {}
    });

    function completeArrivalWhenReady() {
        const token = start("arrival");
        const complete = () => window.requestAnimationFrame(() => window.requestAnimationFrame(() => finish(token)));
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", complete, { once: true });
        else complete();
    }

    function consumePendingNavigation() {
        try {
            if (sessionStorage.getItem("aziel:navigation-pending") === "1") {
                sessionStorage.removeItem("aziel:navigation-pending");
                completeArrivalWhenReady();
            }
        } catch (_) {}
    }

    window.addEventListener("pageshow", consumePendingNavigation);

    window.addEventListener("aziel:headerLoaded", ensureElement);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensureElement, { once: true });
    } else {
        ensureElement();
    }
    consumePendingNavigation();

    bootstrapState?.pending?.clear();
    if (operations.size) {
        paint(.08);
        scheduleEstimate();
        operations.forEach(token => {
            timeouts.set(token, window.setTimeout(() => expire(token), 30000));
        });
    }
    window.AZIEL_LOADING = Object.freeze({ start, finish, track, isActive: () => operations.size > 0 });
})();
