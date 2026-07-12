// frontend/js/motion.js
// Narrow motion helper. It reacts to UI state; it does not own domain state.

(function () {
    if (window.AZIEL_MOTION) return;

    const timers = new WeakMap();
    const reducedQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    function prefersReducedMotion() {
        return Boolean(reducedQuery?.matches);
    }

    function getElement(target) {
        if (!target) return null;
        if (typeof target === "string") return document.querySelector(target);
        return target;
    }

    function retrigger(element, className, duration = 520) {
        const el = getElement(element);
        if (!el) return;

        const previous = timers.get(el);
        if (previous) {
            window.clearTimeout(previous.id);
            el.classList.remove(previous.className);
        }

        if (prefersReducedMotion()) {
            el.classList.add(className);
            const id = window.setTimeout(() => {
                el.classList.remove(className);
                timers.delete(el);
            }, 30);
            timers.set(el, { id, className });
            return;
        }

        el.classList.remove(className);
        void el.offsetWidth;
        el.classList.add(className);

        const id = window.setTimeout(() => {
            el.classList.remove(className);
            timers.delete(el);
        }, duration);

        timers.set(el, { id, className });
    }

    function emphasize(element, variant = "updated") {
        const classes = {
            updated: "az-motion-updated",
            live: "az-live-updated",
            value: "az-value-changed",
            ready: "az-motion-ready",
            selected: "az-motion-selected",
            badge: "az-notification-badge-bump"
        };

        retrigger(element, classes[variant] || classes.updated);
    }

    function swapText(element, value) {
        const el = getElement(element);
        if (!el) return;

        const next = String(value ?? "");
        if (el.textContent === next) return;

        el.textContent = next;
        retrigger(el, "az-value-updating", 340);
    }

    function enter(element, variant = "normal") {
        const className = variant === "fast" ? "az-motion-enter-fast" : "az-motion-enter";
        retrigger(element, className, variant === "fast" ? 260 : 380);
    }

    function scrollTo(element, options = {}) {
        const el = getElement(element);
        if (!el) return;

        el.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: options.block || "center",
            inline: options.inline || "nearest"
        });
    }

    window.AZIEL_MOTION = {
        prefersReducedMotion,
        emphasize,
        swapText,
        enter,
        scrollTo
    };
})();
