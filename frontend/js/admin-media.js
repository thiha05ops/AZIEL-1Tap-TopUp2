// frontend/js/admin-media.js
// AZIEL Admin Media Library controller.

let adminMediaInitialized = false;
let adminMediaAssets = [];

document.addEventListener("DOMContentLoaded", () => {
    initAdminMediaController();
});

function initAdminMediaController() {
    if (adminMediaInitialized) return;
    adminMediaInitialized = true;

    document.getElementById("uploadMediaBtn")?.addEventListener("click", openMediaUploadModal);
    document.getElementById("mediaSearchBtn")?.addEventListener("click", () => loadAdminMedia(true));
    document.getElementById("mediaRefreshBtn")?.addEventListener("click", () => loadAdminMedia(true));
    document.getElementById("mediaCategoryFilter")?.addEventListener("change", () => loadAdminMedia(true));
    document.getElementById("mediaSearchInput")?.addEventListener("keydown", event => {
        if (event.key === "Enter") loadAdminMedia(true);
    });

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "media") {
            loadAdminMedia();
        }
    });
}

function mediaQueryString() {
    const params = new URLSearchParams({
        limit: "80"
    });
    const category = document.getElementById("mediaCategoryFilter")?.value || "";
    const q = document.getElementById("mediaSearchInput")?.value || "";

    if (category) params.set("category", category);
    if (q.trim()) params.set("q", q.trim());

    return params.toString();
}

async function loadAdminMedia(force = false) {
    const grid = document.getElementById("adminMediaGrid");
    if (!grid) return;
    if (adminMediaAssets.length && !force) {
        renderAdminMedia();
        return;
    }

    grid.innerHTML = `
        <div class="admin-dashboard-skeleton"></div>
        <div class="admin-dashboard-skeleton"></div>
        <div class="admin-dashboard-skeleton"></div>
    `;

    const data = await adminFetch(`/api/admin/media?${mediaQueryString()}`);

    if (!data?.success) {
        grid.innerHTML = `<p class="admin-empty-state">${escapeMediaHtml(data?.message || adminT("catalog_data_unavailable", "Catalog data unavailable"))}</p>`;
        return;
    }

    adminMediaAssets = Array.isArray(data.assets) ? data.assets : [];
    renderAdminMedia();
}

function renderAdminMedia() {
    const grid = document.getElementById("adminMediaGrid");
    if (!grid) return;

    if (!adminMediaAssets.length) {
        grid.innerHTML = `<p class="admin-empty-state">${adminT("no_media_assets", "No media assets found")}</p>`;
        return;
    }

    grid.innerHTML = adminMediaAssets.map(asset => `
        <article class="media-asset-card" data-asset-id="${escapeMediaHtml(asset.assetId)}">
            <img src="${escapeMediaHtml(asset.secureUrl || asset.url)}" alt="${escapeMediaHtml(asset.altText || asset.name)}">
            <div class="media-asset-info">
                <strong>${escapeMediaHtml(asset.name)}</strong>
                <small>${escapeMediaHtml(asset.category)} · ${formatMediaSize(asset.sizeBytes)}</small>
                <small>${escapeMediaHtml(asset.originalName || "")}</small>
            </div>
            <button class="admin-icon-btn danger" type="button" data-delete-media="${escapeMediaHtml(asset.assetId)}">${adminT("delete", "Delete")}</button>
        </article>
    `).join("");

    grid.querySelectorAll("[data-delete-media]").forEach(btn => {
        btn.addEventListener("click", () => deleteMediaAsset(btn.dataset.deleteMedia));
    });
}

function openMediaUploadModal() {
    ensureMediaUploadModal();
    const modal = document.getElementById("adminMediaUploadModal");
    modal.querySelector("form")?.reset();
    modal.classList.add("show");
}

function ensureMediaUploadModal() {
    if (document.getElementById("adminMediaUploadModal")) return;

    const modal = document.createElement("div");
    modal.id = "adminMediaUploadModal";
    modal.className = "admin-action-modal media-upload-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box">
            <h3>${adminT("upload_asset", "Upload Asset")}</h3>
            <form id="adminMediaUploadForm" class="media-upload-form">
                <label>${adminT("asset_name", "Asset Name")} <input name="name" type="text" required></label>
                <label>${adminT("category", "Category")}
                    <select name="category" required>
                        <option value="product_image">${adminT("product_image", "Product Image")}</option>
                        <option value="product_banner">${adminT("product_banner", "Product Banner")}</option>
                        <option value="home_banner">${adminT("home_banner", "Home Banner")}</option>
                        <option value="package_icon">${adminT("package_icon", "Package Icon")}</option>
                        <option value="campaign">${adminT("campaign", "Campaign")}</option>
                        <option value="promotion">${adminT("promotion", "Promotion")}</option>
                        <option value="announcement">${adminT("announcement", "Announcement")}</option>
                        <option value="other">${adminT("other", "Other")}</option>
                    </select>
                </label>
                <label>${adminT("alt_text", "Alt Text")} <input name="altText" type="text"></label>
                <label>${adminT("image", "Image")} <input name="file" type="file" accept="image/jpeg,image/png,image/webp" required></label>
            </form>
            <div class="admin-action-modal-actions">
                <button id="adminMediaUploadCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="adminMediaUploadSubmit" type="button">${adminT("upload_asset", "Upload Asset")}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) closeMediaUploadModal();
    });
    modal.querySelector("#adminMediaUploadCancel")?.addEventListener("click", closeMediaUploadModal);
    modal.querySelector("#adminMediaUploadSubmit")?.addEventListener("click", submitMediaUpload);
    document.body.appendChild(modal);
}

function closeMediaUploadModal() {
    document.getElementById("adminMediaUploadModal")?.classList.remove("show");
}

async function submitMediaUpload() {
    const modal = document.getElementById("adminMediaUploadModal");
    const form = modal?.querySelector("#adminMediaUploadForm");
    const submitBtn = modal?.querySelector("#adminMediaUploadSubmit");
    if (!form) return;

    const formData = new FormData(form);

    try {
        window.AZIEL_UI?.button?.setLoading(submitBtn, { text: adminT("loading", "Loading") });
        const data = await adminFetch("/api/admin/media", {
            method: "POST",
            body: formData
        });

        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("media_upload_failed", "Media upload failed"), "error");
            return;
        }

        showAdminToast?.(adminT("media_asset_uploaded", "Media asset uploaded"), "success");
        adminMediaAssets = [];
        closeMediaUploadModal();
        await loadAdminMedia(true);
    } finally {
        window.AZIEL_UI?.button?.reset(submitBtn);
    }
}

async function deleteMediaAsset(assetId) {
    const confirmed = await window.AZIEL_UI?.confirm?.({
        title: adminT("delete", "Delete"),
        message: adminT("delete_media_asset_message", "Delete this media asset? Attached assets cannot be deleted."),
        confirmText: adminT("delete", "Delete"),
        cancelText: adminT("cancel", "Cancel"),
        danger: true
    });

    if (!confirmed) return;

    const data = await adminFetch(`/api/admin/media/${encodeURIComponent(assetId)}`, {
        method: "DELETE"
    });

    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }

    showAdminToast?.(adminT("media_asset_deleted", "Media asset deleted"), "success");
    adminMediaAssets = [];
    await loadAdminMedia(true);
}

function formatMediaSize(size) {
    const bytes = Number(size || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "-";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeMediaHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
