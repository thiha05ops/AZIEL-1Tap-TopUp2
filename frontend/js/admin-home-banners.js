// frontend/js/admin-home-banners.js
// AZIEL Admin Site Content: Home Banners controller.

let adminHomeBannersInitialized = false;
let adminHomeBanners = [];
let homeBannerEditorAssetId = "";

document.addEventListener("DOMContentLoaded", () => {
    initAdminHomeBannersController();
});

function initAdminHomeBannersController() {
    if (adminHomeBannersInitialized) return;
    adminHomeBannersInitialized = true;

    document.getElementById("addHomeBannerBtn")?.addEventListener("click", () => openHomeBannerEditor());

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "site-content") {
            loadAdminHomeBanners();
        }
    });

    window.addEventListener("aziel:admin-locale-changed", () => {
        renderAdminHomeBanners();
    });
}

async function loadAdminHomeBanners(force = false) {
    const list = document.getElementById("adminHomeBannersList");
    if (!list) return;

    if (adminHomeBanners.length && !force) {
        renderAdminHomeBanners();
        return;
    }

    list.innerHTML = `
        <div class="admin-dashboard-skeleton"></div>
        <div class="admin-dashboard-skeleton"></div>
    `;

    const data = await adminFetch("/api/admin/home-banners");

    if (!data?.success) {
        list.innerHTML = `<p class="admin-empty-state">${escapeHomeBannerHtml(data?.message || adminT("catalog_data_unavailable", "Catalog data unavailable"))}</p>`;
        return;
    }

    adminHomeBanners = Array.isArray(data.banners) ? data.banners : [];
    renderAdminHomeBanners();
}

function renderAdminHomeBanners() {
    const list = document.getElementById("adminHomeBannersList");
    if (!list) return;

    if (!adminHomeBanners.length) {
        list.innerHTML = `<p class="admin-empty-state">${adminT("no_home_banners_found", "No home banners found")}</p>`;
        return;
    }

    list.innerHTML = adminHomeBanners.map((banner, index) => {
        const imageUrl = banner.mediaAsset?.secureUrl || banner.mediaAsset?.url || "";
        const statusClass = banner.enabled ? "is-ok" : "is-muted";
        const statusText = adminT(banner.enabled ? "enabled" : "disabled", banner.enabled ? "Enabled" : "Disabled");

        return `
            <article class="home-banner-row" data-home-banner-id="${escapeHomeBannerHtml(banner.id)}">
                <div class="home-banner-preview">
                    ${imageUrl
                        ? `<img src="${escapeHomeBannerHtml(imageUrl)}" alt="${escapeHomeBannerHtml(banner.mediaAsset?.altText || banner.name)}">`
                        : `<span>${adminT("select_banner_image", "Select Banner Image")}</span>`}
                </div>
                <div>
                    <strong>${escapeHomeBannerHtml(banner.name)}</strong>
                    <small>${adminT("sort_order", "Sort Order")}: ${Number(banner.sortOrder || 0)} · ${formatHomeBannerSchedule(banner)}</small>
                    <small>${escapeHomeBannerHtml(banner.ctaTarget || adminT("no_cta_target", "No CTA target"))}</small>
                    <b class="admin-status-pill ${statusClass}">${statusText}</b>
                </div>
                <div class="catalog-package-actions">
                    <button class="admin-secondary-btn" type="button" data-preview-home-banner="${escapeHomeBannerHtml(banner.id)}">${adminT("preview", "Preview")}</button>
                    <button class="admin-secondary-btn" type="button" data-edit-home-banner="${escapeHomeBannerHtml(banner.id)}">${adminT("edit_banner", "Edit Banner")}</button>
                    <button class="admin-secondary-btn ${banner.enabled ? "danger" : ""}" type="button" data-toggle-home-banner="${escapeHomeBannerHtml(banner.id)}">
                        ${adminT(banner.enabled ? "disable" : "enable", banner.enabled ? "Disable" : "Enable")}
                    </button>
                    <button class="admin-secondary-btn" type="button" data-move-home-banner="${escapeHomeBannerHtml(banner.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""}>${adminT("move_up", "Move Up")}</button>
                    <button class="admin-secondary-btn" type="button" data-move-home-banner="${escapeHomeBannerHtml(banner.id)}" data-direction="1" ${index === adminHomeBanners.length - 1 ? "disabled" : ""}>${adminT("move_down", "Move Down")}</button>
                    <button class="admin-icon-btn danger" type="button" data-delete-home-banner="${escapeHomeBannerHtml(banner.id)}">${adminT("remove_banner", "Remove Banner")}</button>
                </div>
            </article>
        `;
    }).join("");

    list.querySelectorAll("[data-preview-home-banner]").forEach(btn => {
        btn.addEventListener("click", () => previewHomeBanner(btn.dataset.previewHomeBanner));
    });
    list.querySelectorAll("[data-edit-home-banner]").forEach(btn => {
        btn.addEventListener("click", () => openHomeBannerEditor(findHomeBanner(btn.dataset.editHomeBanner)));
    });
    list.querySelectorAll("[data-toggle-home-banner]").forEach(btn => {
        btn.addEventListener("click", () => toggleHomeBanner(findHomeBanner(btn.dataset.toggleHomeBanner)));
    });
    list.querySelectorAll("[data-move-home-banner]").forEach(btn => {
        btn.addEventListener("click", () => moveHomeBanner(btn.dataset.moveHomeBanner, Number(btn.dataset.direction || 0)));
    });
    list.querySelectorAll("[data-delete-home-banner]").forEach(btn => {
        btn.addEventListener("click", () => deleteHomeBanner(btn.dataset.deleteHomeBanner));
    });
}

function openHomeBannerEditor(banner = null) {
    ensureHomeBannerEditorModal();
    const modal = document.getElementById("homeBannerEditorModal");
    homeBannerEditorAssetId = banner?.mediaAssetId || "";

    modal.querySelector("#homeBannerTitle").textContent = banner ? adminT("edit_banner", "Edit Banner") : adminT("add_home_banner", "Add Banner");
    modal.querySelector("#homeBannerName").value = banner?.name || "";
    modal.querySelector("#homeBannerEnabled").checked = banner?.enabled !== false;
    modal.querySelector("#homeBannerSort").value = banner?.sortOrder ?? adminHomeBanners.length + 1;
    modal.querySelector("#homeBannerCtaLabel").value = banner?.ctaLabel || "";
    modal.querySelector("#homeBannerCtaTarget").value = banner?.ctaTarget || "";
    modal.querySelector("#homeBannerStarts").value = toHomeBannerDatetimeValue(banner?.startsAt);
    modal.querySelector("#homeBannerEnds").value = toHomeBannerDatetimeValue(banner?.endsAt);
    modal.querySelector("#homeBannerMediaLabel").textContent = banner?.mediaAsset?.name || adminT("select_banner_image", "Select Banner Image");

    modal.querySelector("#homeBannerMedia").onclick = async () => {
        const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ category: "home_banner" });
        if (!asset) return;
        homeBannerEditorAssetId = asset.assetId;
        modal.querySelector("#homeBannerMediaLabel").textContent = asset.name || asset.assetId;
    };
    modal.querySelector("#homeBannerCancel").onclick = () => modal.classList.remove("show");
    modal.querySelector("#homeBannerSave").onclick = () => readAndSaveHomeBanner(banner);

    modal.classList.add("show");
}

function ensureHomeBannerEditorModal() {
    if (document.getElementById("homeBannerEditorModal")) return;

    const modal = document.createElement("div");
    modal.id = "homeBannerEditorModal";
    modal.className = "admin-action-modal catalog-edit-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box">
            <h3 id="homeBannerTitle"></h3>
            <label>${adminT("banner_name", "Banner Name")} <input id="homeBannerName" type="text"></label>
            <label><input id="homeBannerEnabled" type="checkbox" checked> ${adminT("enabled", "Enabled")}</label>
            <label>${adminT("sort_order", "Sort Order")} <input id="homeBannerSort" type="number" step="1" value="0"></label>
            <button id="homeBannerMedia" class="admin-secondary-btn" type="button">${adminT("select_banner_image", "Select Banner Image")}</button>
            <p id="homeBannerMediaLabel"></p>
            <label>${adminT("cta_label", "CTA Label")} <input id="homeBannerCtaLabel" type="text"></label>
            <label>${adminT("cta_target", "CTA Target")} <input id="homeBannerCtaTarget" type="text"></label>
            <label>${adminT("start_date", "Start Date")} <input id="homeBannerStarts" type="datetime-local"></label>
            <label>${adminT("end_date", "End Date")} <input id="homeBannerEnds" type="datetime-local"></label>
            <div class="admin-action-modal-actions">
                <button id="homeBannerCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="homeBannerSave" type="button">${adminT("save_changes", "Save Changes")}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    document.body.appendChild(modal);
}

async function readAndSaveHomeBanner(existing = null) {
    const modal = document.getElementById("homeBannerEditorModal");
    const saveBtn = modal?.querySelector("#homeBannerSave");
    const payload = {
        name: modal.querySelector("#homeBannerName")?.value || "",
        mediaAssetId: homeBannerEditorAssetId,
        enabled: Boolean(modal.querySelector("#homeBannerEnabled")?.checked),
        sortOrder: modal.querySelector("#homeBannerSort")?.value || 0,
        ctaLabel: modal.querySelector("#homeBannerCtaLabel")?.value || "",
        ctaTarget: modal.querySelector("#homeBannerCtaTarget")?.value || "",
        startsAt: fromHomeBannerDatetimeValue(modal.querySelector("#homeBannerStarts")?.value),
        endsAt: fromHomeBannerDatetimeValue(modal.querySelector("#homeBannerEnds")?.value)
    };

    const result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
        title: adminT("save_home_banner", "Save home banner?"),
        message: adminT("home_banner_save_message", "The Home page carousel will use this managed banner data."),
        input: false,
        confirmText: adminT("save_changes", "Save Changes")
    });

    if (result && result.confirmed === false) return;

    const url = existing
        ? `/api/admin/home-banners/${encodeURIComponent(existing.id)}`
        : "/api/admin/home-banners";
    const method = existing ? "PATCH" : "POST";

    try {
        window.AZIEL_UI?.button?.setLoading(saveBtn, { text: adminT("loading", "Loading") });
        const data = await adminFetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
            return;
        }

        adminHomeBanners = Array.isArray(data.banners) ? data.banners : [];
        renderAdminHomeBanners();
        modal.classList.remove("show");
        showAdminToast?.(adminT("home_banner_saved", "Home banner saved"), "success");
    } finally {
        window.AZIEL_UI?.button?.reset(saveBtn);
    }
}

async function toggleHomeBanner(banner) {
    if (!banner) return;

    const data = await adminFetch(`/api/admin/home-banners/${encodeURIComponent(banner.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !banner.enabled })
    });

    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }

    adminHomeBanners = Array.isArray(data.banners) ? data.banners : [];
    renderAdminHomeBanners();
    showAdminToast?.(adminT("home_banner_saved", "Home banner saved"), "success");
}

async function moveHomeBanner(bannerId, direction) {
    const index = adminHomeBanners.findIndex(item => item.id === bannerId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= adminHomeBanners.length) return;

    const next = [...adminHomeBanners];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];

    const data = await adminFetch("/api/admin/home-banners/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: next.map(item => item.id) })
    });

    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }

    adminHomeBanners = Array.isArray(data.banners) ? data.banners : [];
    renderAdminHomeBanners();
}

async function deleteHomeBanner(bannerId) {
    const result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
        title: adminT("remove_banner", "Remove Banner"),
        message: adminT("remove_home_banner_message", "This removes the Home banner record only. The media asset remains in the Media Library."),
        input: false,
        confirmText: adminT("remove_banner", "Remove Banner"),
        danger: true
    });

    if (result && result.confirmed === false) return;

    const data = await adminFetch(`/api/admin/home-banners/${encodeURIComponent(bannerId)}`, {
        method: "DELETE"
    });

    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
        return;
    }

    adminHomeBanners = Array.isArray(data.banners) ? data.banners : [];
    renderAdminHomeBanners();
    showAdminToast?.(adminT("home_banner_removed", "Home banner removed"), "success");
}

function previewHomeBanner(bannerId) {
    const banner = findHomeBanner(bannerId);
    const url = banner?.mediaAsset?.secureUrl || banner?.mediaAsset?.url || "";

    if (!url) {
        showAdminToast?.(adminT("select_banner_image", "Select Banner Image"), "info");
        return;
    }

    window.open(url, "_blank", "noopener");
}

function findHomeBanner(bannerId) {
    return adminHomeBanners.find(item => item.id === bannerId) || null;
}

function formatHomeBannerSchedule(banner = {}) {
    if (!banner.startsAt && !banner.endsAt) return adminT("not_scheduled", "Not scheduled");
    return `${banner.startsAt ? new Date(banner.startsAt).toLocaleString() : "…"} → ${banner.endsAt ? new Date(banner.endsAt).toLocaleString() : "…"}`;
}

function toHomeBannerDatetimeValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromHomeBannerDatetimeValue(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function escapeHomeBannerHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
