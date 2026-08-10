// frontend/js/admin-media.js
// AZIEL Admin Media Library controller.

let adminMediaInitialized = false;
let adminMediaAssets = [];
let adminMediaLoadController = null;
let adminMediaLoadSequence = 0;
let adminMediaUploading = false;
const adminMediaDeleting = new Set();

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

    const sequence = ++adminMediaLoadSequence;
    adminMediaLoadController?.abort();
    adminMediaLoadController = new AbortController();
    grid.innerHTML = Array.from({ length: 8 }, () => '<div class="media-asset-skeleton admin-dashboard-skeleton"></div>').join("");

    try {
        const data = await adminFetch(`/api/admin/media?${mediaQueryString()}`, { signal: adminMediaLoadController.signal });
        if (sequence !== adminMediaLoadSequence) return;
        if (!data?.success) throw new Error(data?.message || adminT("catalog_data_unavailable", "Catalog data unavailable"));
        adminMediaAssets = Array.isArray(data.assets) ? data.assets : [];
        renderAdminMedia();
    } catch (error) {
        if (error?.name === "AbortError" || sequence !== adminMediaLoadSequence) return;
        grid.innerHTML = mediaStateMarkup("error", adminT("media_load_failed", "Media assets could not be loaded."), adminT("retry", "Retry"));
        grid.querySelector("[data-media-retry]")?.addEventListener("click", () => loadAdminMedia(true));
    }
}

function renderAdminMedia() {
    const grid = document.getElementById("adminMediaGrid");
    if (!grid) return;

    if (!adminMediaAssets.length) {
        const filtered = Boolean(document.getElementById("mediaCategoryFilter")?.value || document.getElementById("mediaSearchInput")?.value.trim());
        grid.innerHTML = filtered
            ? mediaStateMarkup("empty", adminT("no_matching_media", "No media matches these filters."), adminT("clear_filters", "Clear filters"))
            : mediaStateMarkup("empty", adminT("no_media_assets", "No media assets yet."), adminT("upload_asset", "Upload Asset"));
        const action = grid.querySelector("[data-media-state-action]");
        action?.addEventListener("click", () => {
            if (filtered) {
                document.getElementById("mediaCategoryFilter").value = "";
                document.getElementById("mediaSearchInput").value = "";
                loadAdminMedia(true);
            } else openMediaUploadModal();
        });
        return;
    }

    grid.innerHTML = adminMediaAssets.map(asset => `
        <article class="media-asset-card" data-asset-id="${escapeMediaHtml(asset.assetId)}">
            <button class="media-asset-preview" type="button" data-preview-media="${escapeMediaHtml(asset.assetId)}" aria-label="${escapeMediaHtml(`Preview ${asset.name}`)}">
                <img class="${mediaFitClass(asset.category)}" src="${escapeMediaHtml(asset.secureUrl || asset.url)}" alt="${escapeMediaHtml(asset.altText || asset.name)}">
                <span class="media-image-fallback" hidden>Image unavailable</span>
            </button>
            <div class="media-asset-info">
                <strong title="${escapeMediaHtml(asset.name)}">${escapeMediaHtml(asset.name)}</strong>
                <small><span class="media-category-badge">${escapeMediaHtml(formatMediaCategory(asset.category))}</span> ${formatMediaSize(asset.sizeBytes)}</small>
                <small class="media-asset-filename" title="${escapeMediaHtml(asset.originalName || "")}">${escapeMediaHtml(asset.originalName || "Unnamed file")}</small>
            </div>
            <details class="media-asset-menu">
                <summary class="admin-icon-btn" aria-label="More actions">•••</summary>
                <div class="media-asset-menu-popover">
                    <button type="button" data-preview-media="${escapeMediaHtml(asset.assetId)}">Preview</button>
                    <button class="danger" type="button" data-delete-media="${escapeMediaHtml(asset.assetId)}">${adminT("delete", "Delete")}</button>
                </div>
            </details>
        </article>
    `).join("");

    grid.querySelectorAll("img").forEach(image => image.addEventListener("error", () => {
        image.hidden = true;
        image.nextElementSibling.hidden = false;
    }, { once: true }));
    grid.querySelectorAll("[data-preview-media]").forEach(btn => btn.addEventListener("click", () => openMediaPreview(btn.dataset.previewMedia)));
    grid.querySelectorAll("[data-delete-media]").forEach(btn => {
        btn.addEventListener("click", () => deleteMediaAsset(btn.dataset.deleteMedia, btn));
    });
}

function mediaStateMarkup(type, message, actionLabel) {
    const retry = type === "error" ? "data-media-retry" : "data-media-state-action";
    return `<div class="media-library-state"><strong>${escapeMediaHtml(message)}</strong><button class="admin-secondary-btn" type="button" ${retry}>${escapeMediaHtml(actionLabel)}</button></div>`;
}

function mediaFitClass(category) {
    return ["home_banner", "product_banner", "campaign", "promotion", "announcement"].includes(category) ? "is-cover" : "is-contain";
}

function formatMediaCategory(category) {
    return String(category || "other").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function openMediaPreview(assetId) {
    const asset = adminMediaAssets.find(item => item.assetId === assetId);
    if (!asset) return;
    ensureMediaPreviewModal();
    const modal = document.getElementById("adminMediaPreviewModal");
    modal.querySelector("[data-media-preview-image]").src = asset.secureUrl || asset.url;
    modal.querySelector("[data-media-preview-image]").alt = asset.altText || asset.name;
    modal.querySelector("[data-media-preview-name]").textContent = asset.name;
    modal.querySelector("[data-media-preview-meta]").textContent = `${formatMediaCategory(asset.category)} · ${formatMediaSize(asset.sizeBytes)} · ${asset.mimeType || "Unknown type"}`;
    modal.querySelector("[data-media-preview-alt]").textContent = asset.altText || "No alt text";
    modal.querySelector("[data-media-preview-file]").textContent = asset.originalName || "Unnamed file";
    modal.querySelector("[data-media-preview-date]").textContent = asset.createdAt ? new Date(asset.createdAt).toLocaleString() : "Date unavailable";
    modal.classList.add("show");
}

function ensureMediaPreviewModal() {
    if (document.getElementById("adminMediaPreviewModal")) return;
    const modal = document.createElement("div");
    modal.id = "adminMediaPreviewModal";
    modal.className = "admin-action-modal media-preview-modal";
    modal.innerHTML = `<div class="admin-action-modal-box"><div class="media-preview-head"><div><h3 data-media-preview-name></h3><small data-media-preview-meta></small></div><button class="admin-icon-btn" type="button" data-media-preview-close aria-label="Close">×</button></div><div class="media-preview-stage"><img data-media-preview-image></div><dl class="media-preview-details"><div><dt>Filename</dt><dd data-media-preview-file></dd></div><div><dt>Alt text</dt><dd data-media-preview-alt></dd></div><div><dt>Uploaded</dt><dd data-media-preview-date></dd></div></dl></div>`;
    modal.addEventListener("click", event => { if (event.target === modal) modal.classList.remove("show"); });
    modal.querySelector("[data-media-preview-close]").addEventListener("click", () => modal.classList.remove("show"));
    document.body.appendChild(modal);
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
    if (!form || adminMediaUploading) return;

    const formData = new FormData(form);

    try {
        adminMediaUploading = true;
        submitBtn.disabled = true;
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
    } catch (error) {
        showAdminToast?.(error?.message || adminT("media_upload_failed", "Media upload failed"), "error");
    } finally {
        adminMediaUploading = false;
        submitBtn.disabled = false;
        window.AZIEL_UI?.button?.reset(submitBtn);
    }
}

async function deleteMediaAsset(assetId, button) {
    if (!assetId || adminMediaDeleting.has(assetId)) return;
    const confirmed = await window.AZIEL_UI?.confirm?.({
        title: adminT("delete", "Delete"),
        message: adminT("delete_media_asset_message", "Delete this media asset? Attached assets cannot be deleted."),
        confirmText: adminT("delete", "Delete"),
        cancelText: adminT("cancel", "Cancel"),
        danger: true
    });

    if (!confirmed) return;

    try {
        adminMediaDeleting.add(assetId);
        if (button) button.disabled = true;
        const data = await adminFetch(`/api/admin/media/${encodeURIComponent(assetId)}`, { method: "DELETE" });
        if (!data?.success) throw new Error(data?.message || adminT("catalog_update_failed", "Catalog update failed"));
        showAdminToast?.(adminT("media_asset_deleted", "Media asset deleted"), "success");
        adminMediaAssets = [];
        await loadAdminMedia(true);
    } catch (error) {
        showAdminToast?.(error?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
    } finally {
        adminMediaDeleting.delete(assetId);
        if (button?.isConnected) button.disabled = false;
    }
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
