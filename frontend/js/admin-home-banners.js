// frontend/js/admin-home-banners.js
// AZIEL Admin Site Content: Home Banners controller.

let adminHomeBannersInitialized = false;
let adminHomeBanners = [];
let homeBannerEditorAssetId = "";
let homeBannerSavePending = false;
const homeBannerActionsInFlight = new Set();

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

    let data;
    try {
        data = await adminFetch("/api/admin/home-banners");
    } catch (error) {
        data = { success: false, message: adminT("site_content_unavailable", "Site Content unavailable") };
    }

    if (!data?.success) {
        list.innerHTML = renderHomeBannerState({
            title: data?.message || adminT("catalog_data_unavailable", "Site Content unavailable"),
            action: `<button class="admin-secondary-btn" type="button" data-retry-home-banners>${adminT("retry", "Retry")}</button>`
        });
        list.querySelector("[data-retry-home-banners]")?.addEventListener("click", () => loadAdminHomeBanners(true));
        return;
    }

    adminHomeBanners = Array.isArray(data.banners) ? data.banners : [];
    renderAdminHomeBanners();
}

function renderAdminHomeBanners() {
    const list = document.getElementById("adminHomeBannersList");
    if (!list) return;

    if (!adminHomeBanners.length) {
        list.innerHTML = renderHomeBannerState({
            title: adminT("no_home_banners_found", "No home banners yet"),
            description: adminT("home_banner_empty_helper", "Add a managed banner for the Home hero area."),
            action: `<button class="admin-primary-btn" type="button" data-empty-add-home-banner>${adminT("add_home_banner", "Add Banner")}</button>`
        });
        list.querySelector("[data-empty-add-home-banner]")?.addEventListener("click", () => openHomeBannerEditor());
        return;
    }

    list.innerHTML = adminHomeBanners.map((banner, index) => {
        const imageUrl = banner.mediaAsset?.secureUrl || banner.mediaAsset?.url || "";
        const status = homeBannerOperationalStatus(banner);

        return `
            <article class="home-banner-row" data-home-banner-id="${escapeHomeBannerHtml(banner.id)}">
                <div class="home-banner-preview" data-banner-media>
                    ${imageUrl
                        ? `<img src="${escapeHomeBannerHtml(imageUrl)}" alt="${escapeHomeBannerHtml(banner.mediaAsset?.altText || banner.name)}"><span hidden>${adminT("media_unavailable", "Media unavailable")}</span>`
                        : `<span>${adminT("media_unavailable", "Media unavailable")}</span>`}
                </div>
                <div class="home-banner-info">
                    <strong>${escapeHomeBannerHtml(banner.name)}</strong>
                    <div class="home-banner-metadata">
                        <small>${adminT("sort_order", "Order")}: ${Number(banner.sortOrder || 0)}</small>
                        ${banner.startsAt || banner.endsAt ? `<small>${escapeHomeBannerHtml(formatHomeBannerSchedule(banner))}</small>` : ""}
                        ${banner.ctaTarget ? `<small>${escapeHomeBannerHtml(banner.ctaTarget)}</small>` : ""}
                    </div>
                    <b class="admin-status-pill ${status.className}">${escapeHomeBannerHtml(status.label)}</b>
                </div>
                <div class="home-banner-actions">
                    <button class="admin-secondary-btn" type="button" data-move-home-banner="${escapeHomeBannerHtml(banner.id)}" data-direction="-1" ${index === 0 ? "disabled" : ""}>${adminT("move_up", "Move Up")}</button>
                    <button class="admin-secondary-btn" type="button" data-move-home-banner="${escapeHomeBannerHtml(banner.id)}" data-direction="1" ${index === adminHomeBanners.length - 1 ? "disabled" : ""}>${adminT("move_down", "Move Down")}</button>
                    <details class="catalog-action-menu home-banner-more">
                        <summary class="admin-icon-btn" aria-label="${adminT("more_actions", "More actions")}"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></summary>
                        <div class="catalog-action-menu-popover">
                            <button type="button" data-preview-home-banner="${escapeHomeBannerHtml(banner.id)}"><i class="fa-regular fa-eye" aria-hidden="true"></i>${adminT("preview", "Preview")}</button>
                            <button type="button" data-edit-home-banner="${escapeHomeBannerHtml(banner.id)}"><i class="fa-solid fa-pen" aria-hidden="true"></i>${adminT("edit_banner", "Edit Banner")}</button>
                            <button type="button" data-toggle-home-banner="${escapeHomeBannerHtml(banner.id)}"><i class="fa-solid ${banner.enabled ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i>${adminT(banner.enabled ? "disable" : "enable", banner.enabled ? "Disable" : "Enable")}</button>
                            <button class="danger" type="button" data-delete-home-banner="${escapeHomeBannerHtml(banner.id)}"><i class="fa-solid fa-trash" aria-hidden="true"></i>${adminT("remove_banner", "Remove Banner")}</button>
                        </div>
                    </details>
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
        btn.addEventListener("click", () => toggleHomeBanner(findHomeBanner(btn.dataset.toggleHomeBanner), btn));
    });
    list.querySelectorAll("[data-move-home-banner]").forEach(btn => {
        btn.addEventListener("click", () => moveHomeBanner(btn.dataset.moveHomeBanner, Number(btn.dataset.direction || 0), btn));
    });
    list.querySelectorAll("[data-delete-home-banner]").forEach(btn => {
        btn.addEventListener("click", () => deleteHomeBanner(btn.dataset.deleteHomeBanner, btn));
    });
    list.querySelectorAll("[data-banner-media] img").forEach(image => {
        image.addEventListener("error", () => {
            image.hidden = true;
            const fallback = image.nextElementSibling;
            if (fallback) fallback.hidden = false;
        }, { once: true });
    });
}

function renderHomeBannerState({ title = "", description = "", action = "" } = {}) {
    return `<div class="admin-empty-state home-banner-state"><strong>${escapeHomeBannerHtml(title)}</strong>${description ? `<span>${escapeHomeBannerHtml(description)}</span>` : ""}${action}</div>`;
}

function homeBannerOperationalStatus(banner = {}, now = new Date()) {
    const startsAt = banner.startsAt ? new Date(banner.startsAt) : null;
    const endsAt = banner.endsAt ? new Date(banner.endsAt) : null;
    if (!banner.enabled) return { key: "disabled", label: adminT("disabled", "Disabled"), className: "is-muted" };
    if (endsAt && !Number.isNaN(endsAt.getTime()) && endsAt <= now) return { key: "expired", label: adminT("expired", "Expired"), className: "is-danger" };
    if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt > now) return { key: "scheduled", label: adminT("scheduled", "Scheduled"), className: "is-warning" };
    return { key: "enabled", label: adminT("enabled", "Enabled"), className: "is-ok" };
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
    modal.querySelector("#homeBannerCtaLabelMy").value = banner?.ctaLabelLocales?.my || "";
    modal.querySelector("#homeBannerCtaLabelTh").value = banner?.ctaLabelLocales?.th || "";
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
    modal.className = "admin-action-modal catalog-edit-modal home-banner-editor-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box home-banner-editor-box">
            <header class="home-banner-editor-head"><div><span>${adminT("site_content", "Site Content")}</span><h3 id="homeBannerTitle"></h3></div><button class="admin-icon-btn" type="button" data-close-home-banner aria-label="${adminT("close", "Close")}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header>
            <div class="home-banner-editor-body">
            <label>${adminT("banner_name", "Banner Name")} <input id="homeBannerName" type="text"></label>
            <label class="catalog-toggle-row"><span>${adminT("enabled", "Enabled")}</span><input id="homeBannerEnabled" type="checkbox" checked></label>
            <label>${adminT("sort_order", "Sort Order")} <input id="homeBannerSort" type="number" step="1" value="0"></label>
            <button id="homeBannerMedia" class="admin-secondary-btn" type="button">${adminT("select_banner_image", "Select Banner Image")}</button>
            <p id="homeBannerMediaLabel"></p>
            <label>${adminT("cta_label", "CTA Label")} · English <input id="homeBannerCtaLabel" type="text" maxlength="40"></label>
            <label>${adminT("cta_label", "CTA Label")} · မြန်မာ <input id="homeBannerCtaLabelMy" type="text" maxlength="40"></label>
            <label>${adminT("cta_label", "CTA Label")} · ไทย <input id="homeBannerCtaLabelTh" type="text" maxlength="40"></label>
            <label>${adminT("cta_target", "CTA Target")} <input id="homeBannerCtaTarget" type="text"></label>
            <label>${adminT("start_date", "Start Date")} <input id="homeBannerStarts" type="datetime-local"></label>
            <label>${adminT("end_date", "End Date")} <input id="homeBannerEnds" type="datetime-local"></label>
            </div>
            <footer class="admin-action-modal-actions home-banner-editor-footer">
                <button id="homeBannerCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="homeBannerSave" class="admin-primary-btn" type="button">${adminT("save_changes", "Save Changes")}</button>
            </footer>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    modal.querySelector("[data-close-home-banner]").addEventListener("click", () => modal.classList.remove("show"));
    document.body.appendChild(modal);
}

async function readAndSaveHomeBanner(existing = null) {
    const modal = document.getElementById("homeBannerEditorModal");
    const saveBtn = modal?.querySelector("#homeBannerSave");
    if (homeBannerSavePending) return;
    homeBannerSavePending = true;
    const payload = {
        name: modal.querySelector("#homeBannerName")?.value || "",
        mediaAssetId: homeBannerEditorAssetId,
        enabled: Boolean(modal.querySelector("#homeBannerEnabled")?.checked),
        sortOrder: modal.querySelector("#homeBannerSort")?.value || 0,
        ctaLabel: modal.querySelector("#homeBannerCtaLabel")?.value || "",
        ctaLabelLocales: {
            en: modal.querySelector("#homeBannerCtaLabel")?.value || "",
            my: modal.querySelector("#homeBannerCtaLabelMy")?.value || "",
            th: modal.querySelector("#homeBannerCtaLabelTh")?.value || ""
        },
        ctaTarget: modal.querySelector("#homeBannerCtaTarget")?.value || "",
        startsAt: fromHomeBannerDatetimeValue(modal.querySelector("#homeBannerStarts")?.value),
        endsAt: fromHomeBannerDatetimeValue(modal.querySelector("#homeBannerEnds")?.value)
    };

    let result;
    try {
        result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
            title: adminT("save_home_banner", "Save home banner?"),
            message: adminT("home_banner_save_message", "The Home page carousel will use this managed banner data."),
            input: false,
            confirmText: adminT("save_changes", "Save Changes")
        });
    } catch (error) {
        homeBannerSavePending = false;
        showAdminToast?.(adminT("site_content_update_failed", "Site Content update failed"), "error");
        return;
    }

    if (result && result.confirmed === false) {
        homeBannerSavePending = false;
        return;
    }

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
    } catch (error) {
        showAdminToast?.(adminT("site_content_update_failed", "Site Content update failed"), "error");
    } finally {
        homeBannerSavePending = false;
        window.AZIEL_UI?.button?.reset(saveBtn);
    }
}

async function toggleHomeBanner(banner, actionButton = null) {
    if (!banner || homeBannerActionsInFlight.has(banner.id)) return;

    homeBannerActionsInFlight.add(banner.id);
    if (actionButton) actionButton.disabled = true;

    try {
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
    } catch (error) {
        showAdminToast?.(adminT("site_content_update_failed", "Site Content update failed"), "error");
    } finally {
        homeBannerActionsInFlight.delete(banner.id);
        if (actionButton?.isConnected) actionButton.disabled = false;
    }
}

async function moveHomeBanner(bannerId, direction, actionButton = null) {
    if (homeBannerActionsInFlight.has(bannerId)) return;
    const index = adminHomeBanners.findIndex(item => item.id === bannerId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= adminHomeBanners.length) return;

    const next = [...adminHomeBanners];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];

    homeBannerActionsInFlight.add(bannerId);
    if (actionButton) actionButton.disabled = true;
    try {
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
    showAdminToast?.(adminT("banner_order_updated", "Banner order updated"), "success");
    } catch (error) {
        showAdminToast?.(adminT("site_content_update_failed", "Site Content update failed"), "error");
    } finally {
        homeBannerActionsInFlight.delete(bannerId);
        if (actionButton?.isConnected) actionButton.disabled = false;
    }
}

async function deleteHomeBanner(bannerId, actionButton = null) {
    if (homeBannerActionsInFlight.has(bannerId)) return;
    homeBannerActionsInFlight.add(bannerId);
    if (actionButton) actionButton.disabled = true;
    try {
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
    } catch (error) {
        showAdminToast?.(adminT("site_content_update_failed", "Site Content update failed"), "error");
    } finally {
        homeBannerActionsInFlight.delete(bannerId);
        if (actionButton?.isConnected) actionButton.disabled = false;
    }
}

function previewHomeBanner(bannerId) {
    const banner = findHomeBanner(bannerId);
    const url = banner?.mediaAsset?.secureUrl || banner?.mediaAsset?.url || "";

    ensureHomeBannerPreviewModal();
    const modal = document.getElementById("homeBannerPreviewModal");
    const status = homeBannerOperationalStatus(banner);
    modal.querySelector("[data-home-banner-preview-body]").innerHTML = `<div class="home-banner-preview-art">${url ? `<img src="${escapeHomeBannerHtml(url)}" alt="${escapeHomeBannerHtml(banner?.mediaAsset?.altText || banner?.name || "Banner preview")}">` : `<span>${adminT("media_unavailable", "Media unavailable")}</span>`}</div><div class="home-banner-preview-details"><h3>${escapeHomeBannerHtml(banner?.name || "")}</h3><b class="admin-status-pill ${status.className}">${escapeHomeBannerHtml(status.label)}</b>${banner?.ctaLabel || banner?.ctaTarget ? `<p>${escapeHomeBannerHtml([banner.ctaLabel, banner.ctaTarget].filter(Boolean).join(" → "))}</p>` : ""}<small>${escapeHomeBannerHtml(formatHomeBannerSchedule(banner))}</small></div>`;
    const previewImage = modal.querySelector(".home-banner-preview-art img");
    previewImage?.addEventListener("error", () => {
        previewImage.replaceWith(Object.assign(document.createElement("span"), { textContent: adminT("media_unavailable", "Media unavailable") }));
    }, { once: true });
    modal.classList.add("show");
}

function ensureHomeBannerPreviewModal() {
    if (document.getElementById("homeBannerPreviewModal")) return;
    const modal = document.createElement("div");
    modal.id = "homeBannerPreviewModal";
    modal.className = "admin-action-modal home-banner-preview-modal";
    modal.innerHTML = `<div class="admin-action-modal-box"><header class="home-banner-editor-head"><h3>${adminT("banner_preview", "Home Banner Preview")}</h3><button class="admin-icon-btn" type="button" data-close-banner-preview aria-label="${adminT("close", "Close")}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header><div data-home-banner-preview-body></div></div>`;
    modal.querySelector("[data-close-banner-preview]").addEventListener("click", () => modal.classList.remove("show"));
    modal.addEventListener("click", event => { if (event.target === modal) modal.classList.remove("show"); });
    document.body.appendChild(modal);
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
