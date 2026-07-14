(function () {
    function t(key, fallback = "") {
        return window.AZIEL_ADMIN_I18N?.t?.(key, fallback) || fallback || key;
    }

    function ensureModal() {
        let modal = document.getElementById("adminActionModal");
        if (modal) return modal;

        modal = document.createElement("div");
        modal.id = "adminActionModal";
        modal.className = "admin-action-modal";
        modal.innerHTML = `
            <div class="admin-action-modal-box">
                <h3 id="adminActionModalTitle"></h3>
                <p id="adminActionModalMessage"></p>
                <label id="adminActionModalLabel" for="adminActionModalInput"></label>
                <textarea id="adminActionModalInput"></textarea>
                <div class="admin-action-modal-error" id="adminActionModalError"></div>
                <div class="admin-action-modal-actions">
                    <button id="adminActionModalCancel" type="button"></button>
                    <button id="adminActionModalConfirm" type="button"></button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    }

    function open(options = {}) {
        return new Promise(resolve => {
            const modal = ensureModal();
            const title = modal.querySelector("#adminActionModalTitle");
            const message = modal.querySelector("#adminActionModalMessage");
            const label = modal.querySelector("#adminActionModalLabel");
            const input = modal.querySelector("#adminActionModalInput");
            const error = modal.querySelector("#adminActionModalError");
            const cancel = modal.querySelector("#adminActionModalCancel");
            const confirm = modal.querySelector("#adminActionModalConfirm");

            title.textContent = options.title || "";
            message.textContent = options.message || "";
            label.textContent = options.label || "";
            input.value = options.value || "";
            input.placeholder = options.placeholder || "";
            input.style.display = options.input === false ? "none" : "";
            label.style.display = options.input === false ? "none" : "";
            error.textContent = "";
            cancel.textContent = options.cancelText || t("cancel", "Cancel");
            confirm.textContent = options.confirmText || t("save", "Save");
            confirm.classList.toggle("danger", Boolean(options.danger));

            function cleanup(result) {
                modal.classList.remove("show");
                cancel.removeEventListener("click", onCancel);
                confirm.removeEventListener("click", onConfirm);
                modal.removeEventListener("click", onBackdrop);
                document.removeEventListener("keydown", onKey);
                resolve(result);
            }

            function onCancel() {
                cleanup({ confirmed: false, value: "" });
            }

            function onConfirm() {
                const value = input.value.trim();
                if (options.required && !value) {
                    error.textContent = options.requiredMessage || t("reason_required", "Reason is required.");
                    input.focus();
                    return;
                }

                cleanup({ confirmed: true, value });
            }

            function onBackdrop(event) {
                if (event.target === modal) onCancel();
            }

            function onKey(event) {
                if (event.key === "Escape") onCancel();
            }

            cancel.addEventListener("click", onCancel);
            confirm.addEventListener("click", onConfirm);
            modal.addEventListener("click", onBackdrop);
            document.addEventListener("keydown", onKey);

            modal.classList.add("show");
            setTimeout(() => input.focus(), 30);
        });
    }

    window.AZIEL_ADMIN_ACTION_MODAL = {
        open
    };
})();
