(function () {
    const STATES = Object.freeze({ IDLE: "IDLE", PREPARING_CHECKOUT: "PREPARING_CHECKOUT", PREPARING_PAYMENT: "PREPARING_PAYMENT", PROCESSING_PAYMENT: "PROCESSING_PAYMENT", SUBMITTING_PAYMENT: "SUBMITTING_PAYMENT" });
    let active = null;

    function acquire(state, options = {}) {
        if (active || !Object.values(STATES).includes(state) || state === STATES.IDLE) return null;
        const controls = [...new Set((options.controls || []).filter(Boolean))];
        const previous = controls.map(control => ({ control, disabled: Boolean(control.disabled), inert: Boolean(control.inert), ariaDisabled: control.getAttribute?.("aria-disabled") }));
        active = { state, previous, statusNode: options.statusNode || null };
        controls.forEach(control => {
            if ("disabled" in control) control.disabled = true;
            control.inert = true;
            control.setAttribute?.("aria-disabled", "true");
        });
        document.documentElement.dataset.purchaseTransition = state;
        if (active.statusNode && options.message) active.statusNode.textContent = options.message;
        document.dispatchEvent(new CustomEvent("aziel:purchase-transition", { detail: { state, locked: true } }));
        return Object.freeze({ state, release: () => release(state) });
    }

    function release(expectedState) {
        if (!active || (expectedState && active.state !== expectedState)) return false;
        const releasing = active;
        active = null;
        releasing.previous.forEach(({ control, disabled, inert, ariaDisabled }) => {
            if ("disabled" in control) control.disabled = disabled;
            control.inert = inert;
            if (ariaDisabled === null) control.removeAttribute?.("aria-disabled"); else control.setAttribute?.("aria-disabled", ariaDisabled);
        });
        delete document.documentElement.dataset.purchaseTransition;
        document.dispatchEvent(new CustomEvent("aziel:purchase-transition", { detail: { state: STATES.IDLE, locked: false } }));
        return true;
    }

    window.AZIEL_PURCHASE_TRANSITION = Object.freeze({ STATES, acquire, release, isLocked: () => Boolean(active), state: () => active?.state || STATES.IDLE });
})();
