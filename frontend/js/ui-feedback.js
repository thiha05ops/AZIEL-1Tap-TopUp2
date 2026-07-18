// frontend/js/ui-feedback.js
// AZIEL shared UI feedback primitives.

(function () {
    if (window.AZIEL_UI) return;

    const DEFAULT_TOAST_DURATION = 3200;
    const buttonState = new WeakMap();
    let toastContainer = null;
    let loadingOverlay = null;
    let confirmDialog = null;
    let confirmResolver = null;
    let offlineToastOpen = false;

    function tr(key, fallback = "") {
        return window.AZIEL_I18N?.t?.(key, fallback) || fallback || key;
    }

    function ensureToastContainer() {
        if (toastContainer?.isConnected) return toastContainer;

        toastContainer = document.createElement("div");
        toastContainer.className = "az-ui-toast-stack";
        toastContainer.setAttribute("aria-live", "polite");
        toastContainer.setAttribute("aria-relevant", "additions");
        document.body.appendChild(toastContainer);

        return toastContainer;
    }

    function normalizeToastArgs(input, typeFallback = "info") {
        if (typeof input === "string") {
            return {
                type: typeFallback,
                message: input
            };
        }

        return {
            type: input?.type || typeFallback,
            title: input?.title ? tr(input.title, input.title) : "",
            message: input?.message || input?.text ? tr(input.message || input.text, input.message || input.text) : "",
            duration: input?.duration,
            persistent: Boolean(input?.persistent),
            action: input?.action || null
        };
    }

    function toast(input, typeFallback) {
        const options = normalizeToastArgs(input, typeFallback);
        const stack = ensureToastContainer();
        const item = document.createElement("div");
        const type = ["success", "error", "warning", "info"].includes(options.type)
            ? options.type
            : "info";

        item.className = `az-ui-toast az-ui-toast-${type}`;
        item.setAttribute("role", type === "error" ? "alert" : "status");

        const content = document.createElement("div");
        content.className = "az-ui-toast-content";

        if (options.title) {
            const title = document.createElement("strong");
            title.textContent = options.title;
            content.appendChild(title);
        }

        if (options.message) {
            const message = document.createElement("span");
            message.textContent = options.message;
            content.appendChild(message);
        }

        item.appendChild(content);

        if (options.action?.label && typeof options.action.onClick === "function") {
            const action = document.createElement("button");
            action.type = "button";
            action.className = "az-ui-toast-action";
            action.textContent = tr(options.action.label, options.action.label);
            action.addEventListener("click", () => {
                options.action.onClick();
                closeToast(item);
            });
            item.appendChild(action);
        }

        const close = document.createElement("button");
        close.type = "button";
        close.className = "az-ui-toast-close";
        close.setAttribute("aria-label", tr("dismissNotification", "Dismiss notification"));
        close.textContent = "x";
        close.addEventListener("click", () => closeToast(item));
        item.appendChild(close);

        stack.appendChild(item);
        requestAnimationFrame(() => item.classList.add("show"));

        if (!options.persistent) {
            window.setTimeout(() => closeToast(item), options.duration || DEFAULT_TOAST_DURATION);
        }

        return item;
    }

    function closeToast(item) {
        if (!item?.isConnected) return;
        item.classList.remove("show");
        window.setTimeout(() => item.remove(), 180);
    }

    toast.success = input => toast(input, "success");
    toast.error = input => toast(input, "error");
    toast.warning = input => toast(input, "warning");
    toast.info = input => toast(input, "info");

    function setButtonLoading(button, options = {}) {
        if (!button) return;

        if (!buttonState.has(button)) {
            buttonState.set(button, {
                html: button.innerHTML,
                text: button.textContent,
                disabled: button.disabled,
                ariaBusy: button.getAttribute("aria-busy")
            });
        }

        const label = tr(options.text || options.label || "Loading...", options.text || options.label || "Loading...");
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.classList.add("az-ui-button-loading");
        button.textContent = label;
    }

    function resetButton(button) {
        if (!button) return;
        const state = buttonState.get(button);

        if (state) {
            button.innerHTML = state.html;
            button.disabled = state.disabled;

            if (state.ariaBusy === null) {
                button.removeAttribute("aria-busy");
            } else {
                button.setAttribute("aria-busy", state.ariaBusy);
            }
        } else {
            button.disabled = false;
            button.removeAttribute("aria-busy");
        }

        button.classList.remove("az-ui-button-loading");
        buttonState.delete(button);
    }

    function ensureLoadingOverlay() {
        if (loadingOverlay?.isConnected) return loadingOverlay;

        loadingOverlay = document.createElement("div");
        loadingOverlay.className = "az-ui-loading-overlay";
        loadingOverlay.innerHTML = `
            <div class="az-ui-loading-card" role="status" aria-live="polite">
                <span class="az-ui-spinner" aria-hidden="true"></span>
                <span class="az-ui-loading-text">${tr("Loading...", "Loading...")}</span>
            </div>
        `;
        document.body.appendChild(loadingOverlay);

        return loadingOverlay;
    }

    function showLoading(options = {}) {
        const overlay = ensureLoadingOverlay();
        const text = overlay.querySelector(".az-ui-loading-text");
        if (text) text.textContent = tr(options.message || options.text || "Loading...", options.message || options.text || "Loading...");
        overlay.classList.add("show");
    }

    function hideLoading() {
        ensureLoadingOverlay().classList.remove("show");
    }

    function renderState(container, options = {}) {
        if (!container) return null;

        const type = options.type || "empty";
        const icon = options.icon || ({
            loading: "",
            empty: "",
            error: "",
            offline: ""
        }[type] || "");

        container.innerHTML = "";

        const state = document.createElement("div");
        state.className = `az-ui-state az-ui-state-${type}`;

        if (type === "loading") {
            const spinner = document.createElement("span");
            spinner.className = "az-ui-spinner";
            spinner.setAttribute("aria-hidden", "true");
            state.appendChild(spinner);
        } else if (icon) {
            const iconEl = document.createElement("span");
            iconEl.className = "az-ui-state-icon";
            iconEl.textContent = icon;
            state.appendChild(iconEl);
        }

        const title = document.createElement("strong");
        title.textContent = tr(options.title || stateTitle(type), options.title || stateTitle(type));
        state.appendChild(title);

        if (options.message) {
            const message = document.createElement("p");
            message.textContent = tr(options.message, options.message);
            state.appendChild(message);
        }

        const retry = options.retry || options.onRetry;
        if (typeof retry === "function") {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "az-ui-state-action";
            button.textContent = tr(options.retryLabel || "Retry", options.retryLabel || "Retry");
            button.addEventListener("click", retry);
            state.appendChild(button);
        }

        container.appendChild(state);
        return state;
    }

    function stateTitle(type) {
        return {
            loading: tr("Loading", "Loading"),
            empty: tr("Nothing here yet", "Nothing here yet"),
            error: tr("Something went wrong", "Something went wrong"),
            offline: tr("You are offline", "You are offline")
        }[type] || tr("Status", "Status");
    }

    function renderSkeletonList(container, options = {}) {
        if (!container) return;
        const rows = Number(options.rows || 3);
        const lines = Number(options.lines || 3);
        container.innerHTML = "";

        for (let i = 0; i < rows; i++) {
            const card = document.createElement("div");
            card.className = "az-ui-skeleton-card";

            for (let line = 0; line < lines; line++) {
                const bar = document.createElement("span");
                bar.className = `az-ui-skeleton-line az-ui-skeleton-line-${line + 1}`;
                card.appendChild(bar);
            }

            container.appendChild(card);
        }
    }

    function ensureConfirmDialog() {
        if (confirmDialog?.isConnected) return confirmDialog;

        confirmDialog = document.createElement("div");
        confirmDialog.className = "az-ui-confirm-backdrop";
        confirmDialog.innerHTML = `
            <div class="az-ui-confirm" role="dialog" aria-modal="true" aria-labelledby="azUiConfirmTitle">
                <strong id="azUiConfirmTitle">${tr("Confirm action", "Confirm action")}</strong>
                <p id="azUiConfirmMessage"></p>
                <div class="az-ui-confirm-actions">
                    <button type="button" class="az-ui-confirm-cancel">${tr("Cancel", "Cancel")}</button>
                    <button type="button" class="az-ui-confirm-ok">${tr("Confirm", "Confirm")}</button>
                </div>
            </div>
        `;

        confirmDialog.addEventListener("click", event => {
            if (event.target === confirmDialog) resolveConfirm(false);
        });

        confirmDialog.querySelector(".az-ui-confirm-cancel")
            ?.addEventListener("click", () => resolveConfirm(false));

        confirmDialog.querySelector(".az-ui-confirm-ok")
            ?.addEventListener("click", () => resolveConfirm(true));

        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && confirmDialog?.classList.contains("show")) {
                resolveConfirm(false);
            }
        });

        document.body.appendChild(confirmDialog);
        return confirmDialog;
    }

    function confirmAction(options = {}) {
        if (confirmResolver) resolveConfirm(false);

        const dialog = ensureConfirmDialog();
        dialog.querySelector("#azUiConfirmTitle").textContent = tr(options.title || "Confirm action", options.title || "Confirm action");
        dialog.querySelector("#azUiConfirmMessage").textContent = options.message ? tr(options.message, options.message) : "";
        dialog.querySelector(".az-ui-confirm-ok").textContent = tr(options.confirmText || "Confirm", options.confirmText || "Confirm");
        dialog.querySelector(".az-ui-confirm-cancel").textContent = tr(options.cancelText || "Cancel", options.cancelText || "Cancel");

        dialog.classList.add("show");

        return new Promise(resolve => {
            confirmResolver = resolve;
            window.setTimeout(() => dialog.querySelector(".az-ui-confirm-ok")?.focus(), 0);
        });
    }

    function resolveConfirm(value) {
        if (!confirmResolver) return;
        const resolve = confirmResolver;
        confirmResolver = null;
        confirmDialog?.classList.remove("show");
        resolve(value);
    }

    function normalizeError(error, fallback = "Something went wrong.") {
        if (!error) return tr(fallback, fallback);
        if (typeof error === "string") return tr(error, error);
        if (error.message) return tr(error.message, error.message);
        if (error.error) return tr(error.error, error.error);
        return tr(fallback, fallback);
    }

    function initOfflineFeedback() {
        window.addEventListener("offline", () => {
            offlineToastOpen = true;
            toast.warning({
                title: tr("You are offline", "You are offline"),
                message: tr("Some actions may not complete until your connection returns.", "Some actions may not complete until your connection returns."),
                persistent: true
            });
        });

        window.addEventListener("online", () => {
            if (offlineToastOpen) {
                offlineToastOpen = false;
                toast.success(tr("Back online", "Back online"));
            }
        });
    }

    window.AZIEL_UI = {
        toast,
        button: {
            setLoading: setButtonLoading,
            reset: resetButton,
            disable(button) {
                if (button) button.disabled = true;
            },
            enable(button) {
                if (button) button.disabled = false;
            }
        },
        loading: {
            show: showLoading,
            hide: hideLoading
        },
        state: {
            render: renderState,
            skeletonList: renderSkeletonList,
            clear(container) {
                if (container) container.innerHTML = "";
            }
        },
        confirm: confirmAction,
        error: {
            normalize: normalizeError,
            show(error, fallback) {
                toast.error(normalizeError(error, fallback));
            }
        },
        offline: {
            init: initOfflineFeedback
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initOfflineFeedback, { once: true });
    } else {
        initOfflineFeedback();
    }
})();
