(function () {
    const root = window.AZIEL_ADMIN_UI || {};

    function escapeHTML(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function setText(element, value) {
        if (element) element.textContent = value == null ? "" : String(value);
    }

    function clearElement(element) {
        if (element) element.replaceChildren();
    }

    function createRequestGate() {
        let generation = 0;
        let currentSignature = "";
        const inFlight = new Map();

        function begin(signature = "", options = {}) {
            const key = options.coalesceKey || "";
            if (key && inFlight.has(key)) {
                return {
                    coalesced: true,
                    promise: inFlight.get(key),
                    isCurrent: () => currentSignature === signature
                };
            }

            generation += 1;
            currentSignature = signature;
            const id = generation;

            return {
                coalesced: false,
                id,
                signature,
                isCurrent: () => generation === id && currentSignature === signature,
                track(promise) {
                    if (!key) return promise;
                    inFlight.set(key, promise);
                    promise.finally(() => {
                        if (inFlight.get(key) === promise) inFlight.delete(key);
                    });
                    return promise;
                }
            };
        }

        return {
            begin,
            isCurrent(id, signature = currentSignature) {
                return generation === id && currentSignature === signature;
            },
            get signature() {
                return currentSignature;
            },
            get generation() {
                return generation;
            }
        };
    }

    function createPaginatedState(options = {}) {
        const getId = typeof options.getId === "function"
            ? options.getId
            : item => item?._id || item?.id;

        return {
            items: [],
            limit: Number(options.limit || 50),
            nextCursor: "",
            hasMore: false,
            loadingInitial: false,
            loadingMore: false,
            error: "",
            reset() {
                this.items = [];
                this.nextCursor = "";
                this.hasMore = false;
                this.loadingInitial = false;
                this.loadingMore = false;
                this.error = "";
            },
            replace(items = [], pagination = {}) {
                this.items = Array.isArray(items) ? items.slice() : [];
                this.applyPagination(pagination);
                this.error = "";
            },
            append(items = [], pagination = {}) {
                const seen = new Set(this.items.map(item => String(getId(item) || "")));
                (Array.isArray(items) ? items : []).forEach(item => {
                    const id = String(getId(item) || "");
                    if (id && seen.has(id)) return;
                    if (id) seen.add(id);
                    this.items.push(item);
                });
                this.applyPagination(pagination);
                this.error = "";
            },
            applyPagination(pagination = {}) {
                this.hasMore = Boolean(pagination.hasMore);
                this.nextCursor = pagination.nextCursor || "";
                this.limit = Number(pagination.limit || this.limit || 50);
            },
            canLoadMore() {
                return Boolean(this.hasMore && !this.loadingMore);
            },
            setLoadingInitial(value) {
                this.loadingInitial = Boolean(value);
            },
            setLoadingMore(value) {
                this.loadingMore = Boolean(value);
            },
            setError(message = "") {
                this.error = String(message || "");
            }
        };
    }

    function createAdminModal(options = {}) {
        const modal = typeof options.root === "string"
            ? document.querySelector(options.root)
            : options.root;
        let open = false;
        let pending = false;

        function close() {
            if (!modal || !open || pending) return;
            open = false;
            modal.classList.remove("show");
            options.onClose?.();
        }

        function onBackdrop(event) {
            if (options.closeOnBackdrop !== false && event.target === modal) close();
        }

        function onKey(event) {
            if (options.closeOnEscape !== false && event.key === "Escape") close();
        }

        if (modal) {
            modal.addEventListener("click", onBackdrop);
            document.addEventListener("keydown", onKey);
        }

        return {
            open() {
                if (!modal) return;
                open = true;
                modal.classList.add("show");
                options.onOpen?.();
            },
            close,
            isOpen: () => open,
            setPending(value) {
                pending = Boolean(value);
                modal?.classList.toggle("is-pending", pending);
            }
        };
    }

    async function withPendingAction(button, action, options = {}) {
        if (typeof action !== "function") return undefined;
        const wasDisabled = Boolean(button?.disabled);
        const previousText = button?.textContent;

        try {
            if (button) {
                button.disabled = true;
                if (options.pendingLabel) button.textContent = options.pendingLabel;
            }
            return await action();
        } finally {
            if (button) {
                button.disabled = wasDisabled;
                if (previousText != null) button.textContent = previousText;
            }
        }
    }

    function confirmAdminAction(options = {}) {
        if (window.AZIEL_UI?.confirm) {
            return window.AZIEL_UI.confirm({
                title: options.title || "",
                message: options.message || "",
                confirmText: options.confirmLabel || options.confirmText,
                cancelText: options.cancelLabel || options.cancelText,
                danger: options.tone === "danger" || Boolean(options.danger)
            });
        }

        return Promise.resolve(window.confirm(options.message || options.title || ""));
    }

    root.dom = {
        clearElement,
        escapeHTML,
        setText
    };
    root.request = {
        createRequestGate
    };
    root.pagination = {
        createPaginatedState
    };
    root.modal = {
        createAdminModal
    };
    root.pending = {
        withPendingAction
    };
    root.confirm = {
        confirmAdminAction
    };

    window.AZIEL_ADMIN_UI = root;
})();
