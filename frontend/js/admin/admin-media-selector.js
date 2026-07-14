(function () {
    let selectorModal = null;
    let selectorState = {
        category: "",
        resolve: null
    };

    function escapeHtml(value = "") {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
    }

    function ensureSelectorModal() {
        if (selectorModal) return selectorModal;

        selectorModal = document.createElement("div");
        selectorModal.id = "adminMediaSelectorModal";
        selectorModal.className = "admin-action-modal media-selector-modal";
        selectorModal.innerHTML = `
            <div class="admin-action-modal-box media-selector-box">
                <h3>${adminT("select_media_asset", "Select media asset")}</h3>
                <div id="adminMediaSelectorGrid" class="media-asset-grid media-selector-grid">
                    <div class="admin-dashboard-skeleton"></div>
                    <div class="admin-dashboard-skeleton"></div>
                </div>
                <div class="admin-action-modal-actions">
                    <button id="adminMediaSelectorCancel" type="button">${adminT("cancel", "Cancel")}</button>
                </div>
            </div>
        `;

        selectorModal.addEventListener("click", event => {
            if (event.target === selectorModal) closeSelector(null);
        });
        selectorModal.querySelector("#adminMediaSelectorCancel")?.addEventListener("click", () => closeSelector(null));
        document.body.appendChild(selectorModal);
        return selectorModal;
    }

    async function loadSelectorAssets() {
        const grid = selectorModal?.querySelector("#adminMediaSelectorGrid");
        if (!grid) return;

        grid.innerHTML = `
            <div class="admin-dashboard-skeleton"></div>
            <div class="admin-dashboard-skeleton"></div>
        `;

        const params = new URLSearchParams({
            limit: "80"
        });
        if (selectorState.category) params.set("category", selectorState.category);

        const data = await adminFetch(`/api/admin/media?${params.toString()}`);

        if (!data?.success) {
            grid.innerHTML = `<p class="admin-empty-state">${escapeHtml(data?.message || adminT("catalog_data_unavailable", "Catalog data unavailable"))}</p>`;
            return;
        }

        const assets = Array.isArray(data.assets) ? data.assets : [];
        if (!assets.length) {
            grid.innerHTML = `<p class="admin-empty-state">${adminT("no_media_assets", "No media assets found")}</p>`;
            return;
        }

        grid.innerHTML = assets.map(asset => `
            <button class="media-asset-card media-selector-card" type="button" data-asset-id="${escapeHtml(asset.assetId)}">
                <img src="${escapeHtml(asset.secureUrl || asset.url)}" alt="${escapeHtml(asset.altText || asset.name)}">
                <span>
                    <b>${escapeHtml(asset.name)}</b>
                    <small>${escapeHtml(asset.category)}</small>
                </span>
            </button>
        `).join("");

        grid.querySelectorAll("[data-asset-id]").forEach(card => {
            card.addEventListener("click", () => {
                const asset = assets.find(item => item.assetId === card.dataset.assetId);
                closeSelector(asset || null);
            });
        });
    }

    function closeSelector(asset) {
        selectorModal?.classList.remove("show");
        const resolve = selectorState.resolve;
        selectorState.resolve = null;
        if (resolve) resolve(asset);
    }

    function open(options = {}) {
        ensureSelectorModal();
        selectorState.category = options.category || "";
        selectorModal.classList.add("show");
        loadSelectorAssets();

        return new Promise(resolve => {
            selectorState.resolve = resolve;
        });
    }

    window.AZIEL_ADMIN_MEDIA_SELECTOR = {
        open
    };
})();
