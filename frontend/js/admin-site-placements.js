// frontend/js/admin-site-placements.js
// AZIEL Admin Site Content: Home placement membership and order controller.

let adminSitePlacementsInitialized = false;
let adminSitePlacements = [];
let activeSitePlacement = null;
let activeSitePlacementAvailable = [];
let activeSitePlacementSelected = [];

document.addEventListener("DOMContentLoaded", () => {
    initAdminSitePlacementsController();
});

function initAdminSitePlacementsController() {
    if (adminSitePlacementsInitialized) return;
    adminSitePlacementsInitialized = true;

    document.getElementById("refreshSitePlacementsBtn")?.addEventListener("click", () => loadAdminSitePlacements(true));

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "site-content") {
            loadAdminSitePlacements();
        }
    });

    window.addEventListener("aziel:admin-locale-changed", () => {
        renderAdminSitePlacements();
        renderSitePlacementEditor();
    });
}

async function loadAdminSitePlacements(force = false) {
    const list = document.getElementById("adminSitePlacementsList");
    if (!list) return;

    if (adminSitePlacements.length && !force) {
        renderAdminSitePlacements();
        return;
    }

    list.innerHTML = `
        <div class="admin-dashboard-skeleton"></div>
        <div class="admin-dashboard-skeleton"></div>
        <div class="admin-dashboard-skeleton"></div>
    `;

    const data = await adminFetch("/api/admin/site-placements");

    if (!data?.success) {
        list.innerHTML = `<p class="admin-empty-state">${escapeSitePlacementHtml(data?.message || adminT("catalog_data_unavailable", "Catalog data unavailable"))}</p>`;
        return;
    }

    adminSitePlacements = Array.isArray(data.placements) ? data.placements : [];
    renderAdminSitePlacements();
}

function renderAdminSitePlacements() {
    const list = document.getElementById("adminSitePlacementsList");
    if (!list) return;

    if (!adminSitePlacements.length) {
        list.innerHTML = `<p class="admin-empty-state">${adminT("no_home_placements_found", "No Home placements found")}</p>`;
        return;
    }

    list.innerHTML = adminSitePlacements.map(placement => {
        const count = Array.isArray(placement.items) ? placement.items.length : 0;
        const stateClass = placement.managed ? (count ? "is-ok" : "is-muted") : "is-muted";
        const stateText = placement.managed
            ? (count ? adminT("managed", "Managed") : adminT("managed_empty", "Managed Empty"))
            : adminT("static_fallback", "Static Fallback");

        return `
            <article class="site-placement-row" data-site-placement="${escapeSitePlacementHtml(placement.placementCode)}">
                <div class="site-placement-main">
                    <strong>${escapeSitePlacementHtml(sitePlacementLabel(placement))}</strong>
                    <small>${escapeSitePlacementHtml(sitePlacementDescription(placement))}</small>
                    <b class="admin-status-pill ${stateClass}">${stateText}</b>
                </div>
                <div class="site-placement-meta">
                    <span>${count}</span>
                    <small>${adminT("items", "Items")}</small>
                </div>
                <div class="catalog-package-actions">
                    <button class="admin-secondary-btn" type="button" data-edit-site-placement="${escapeSitePlacementHtml(placement.placementCode)}">${adminT("manage", "Manage")}</button>
                </div>
            </article>
        `;
    }).join("");

    list.querySelectorAll("[data-edit-site-placement]").forEach(button => {
        button.addEventListener("click", () => openSitePlacementEditor(button.dataset.editSitePlacement));
    });
}

async function openSitePlacementEditor(placementCode) {
    ensureSitePlacementEditorModal();
    const modal = document.getElementById("sitePlacementEditorModal");
    const body = modal.querySelector("#sitePlacementEditorBody");

    modal.classList.add("show");
    body.innerHTML = `
        <div class="admin-dashboard-skeleton"></div>
        <div class="admin-dashboard-skeleton"></div>
    `;

    const data = await adminFetch(`/api/admin/site-placements/${encodeURIComponent(placementCode)}`);
    if (!data?.success) {
        body.innerHTML = `<p class="admin-empty-state">${escapeSitePlacementHtml(data?.message || adminT("catalog_data_unavailable", "Catalog data unavailable"))}</p>`;
        return;
    }

    activeSitePlacement = data.placement || null;
    activeSitePlacementAvailable = Array.isArray(data.availableItems) ? data.availableItems : [];
    activeSitePlacementSelected = (activeSitePlacement?.items || []).map(item => item.productCode || item.promoCode).filter(Boolean);
    renderSitePlacementEditor();
}

function ensureSitePlacementEditorModal() {
    if (document.getElementById("sitePlacementEditorModal")) return;

    const modal = document.createElement("div");
    modal.id = "sitePlacementEditorModal";
    modal.className = "admin-action-modal site-placement-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box site-placement-modal-box">
            <div class="site-placement-editor-head">
                <div>
                    <h3 id="sitePlacementEditorTitle">${adminT("home_placements", "Home Placements")}</h3>
                    <p id="sitePlacementEditorSub"></p>
                </div>
                <button id="sitePlacementEditorClose" class="admin-icon-btn" type="button">×</button>
            </div>
            <div id="sitePlacementEditorBody"></div>
            <div class="admin-action-modal-actions">
                <button id="sitePlacementEditorCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="sitePlacementEditorSave" type="button">${adminT("save_changes", "Save Changes")}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) closeSitePlacementEditor();
    });
    modal.querySelector("#sitePlacementEditorClose").addEventListener("click", closeSitePlacementEditor);
    modal.querySelector("#sitePlacementEditorCancel").addEventListener("click", closeSitePlacementEditor);
    modal.querySelector("#sitePlacementEditorSave").addEventListener("click", saveSitePlacementEditor);
    document.body.appendChild(modal);
}

function renderSitePlacementEditor() {
    const modal = document.getElementById("sitePlacementEditorModal");
    const body = modal?.querySelector("#sitePlacementEditorBody");
    if (!modal || !body || !activeSitePlacement) return;

    modal.querySelector("#sitePlacementEditorTitle").textContent = sitePlacementLabel(activeSitePlacement);
    modal.querySelector("#sitePlacementEditorSub").textContent = sitePlacementDescription(activeSitePlacement);

    const selectedSet = new Set(activeSitePlacementSelected);
    const available = activeSitePlacementAvailable.filter(item => !selectedSet.has(sitePlacementItemCode(item)));
    const selected = activeSitePlacementSelected
        .map(code => activeSitePlacementAvailable.find(item => sitePlacementItemCode(item) === code) || code)
        .filter(Boolean);

    body.innerHTML = `
        <div class="site-placement-workspace">
            <section class="site-placement-column">
                <h4>${adminT("available_items", "Available Items")}</h4>
                <div class="site-placement-item-list">
                    ${available.length ? available.map(item => renderSitePlacementItem(item, "add")).join("") : `<p class="admin-empty-state">${adminT("no_available_items", "No available items")}</p>`}
                </div>
            </section>
            <section class="site-placement-column">
                <h4>${adminT("selected_order", "Selected Order")}</h4>
                <div class="site-placement-item-list">
                    ${selected.length ? selected.map((item, index) => renderSitePlacementItem(item, "selected", index, selected.length)).join("") : `<p class="admin-empty-state">${adminT("managed_empty_hint", "Saving with no items hides this Home section.")}</p>`}
                </div>
            </section>
        </div>
    `;

    body.querySelectorAll("[data-add-site-placement-item]").forEach(button => {
        button.addEventListener("click", () => {
            activeSitePlacementSelected.push(button.dataset.addSitePlacementItem);
            renderSitePlacementEditor();
        });
    });
    body.querySelectorAll("[data-remove-site-placement-item]").forEach(button => {
        button.addEventListener("click", () => {
            activeSitePlacementSelected = activeSitePlacementSelected.filter(code => code !== button.dataset.removeSitePlacementItem);
            renderSitePlacementEditor();
        });
    });
    body.querySelectorAll("[data-move-site-placement-item]").forEach(button => {
        button.addEventListener("click", () => {
            moveSitePlacementItem(button.dataset.moveSitePlacementItem, Number(button.dataset.direction || 0));
        });
    });
}

function renderSitePlacementItem(item, mode, index = 0, total = 0) {
    const code = typeof item === "string" ? item : sitePlacementItemCode(item);
    const title = typeof item === "string" ? item : sitePlacementItemTitle(item);
    const meta = typeof item === "string" ? adminT("missing_or_unavailable", "Missing or unavailable") : sitePlacementItemMeta(item);
    const unavailable = typeof item !== "string" && item.enabled === false;

    return `
        <article class="site-placement-item ${unavailable ? "is-muted" : ""}">
            <div>
                <strong>${escapeSitePlacementHtml(title)}</strong>
                <small>${escapeSitePlacementHtml(meta)}</small>
            </div>
            <div class="catalog-package-actions">
                ${mode === "add"
                    ? `<button class="admin-secondary-btn" type="button" data-add-site-placement-item="${escapeSitePlacementHtml(code)}">${adminT("add", "Add")}</button>`
                    : `
                        <button class="admin-secondary-btn" type="button" data-move-site-placement-item="${escapeSitePlacementHtml(code)}" data-direction="-1" ${index === 0 ? "disabled" : ""}>${adminT("move_up", "Move Up")}</button>
                        <button class="admin-secondary-btn" type="button" data-move-site-placement-item="${escapeSitePlacementHtml(code)}" data-direction="1" ${index === total - 1 ? "disabled" : ""}>${adminT("move_down", "Move Down")}</button>
                        <button class="admin-secondary-btn danger" type="button" data-remove-site-placement-item="${escapeSitePlacementHtml(code)}">${adminT("remove", "Remove")}</button>
                    `}
            </div>
        </article>
    `;
}

function moveSitePlacementItem(code, direction) {
    const index = activeSitePlacementSelected.indexOf(code);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= activeSitePlacementSelected.length) return;
    [activeSitePlacementSelected[index], activeSitePlacementSelected[nextIndex]] = [
        activeSitePlacementSelected[nextIndex],
        activeSitePlacementSelected[index]
    ];
    renderSitePlacementEditor();
}

async function saveSitePlacementEditor() {
    if (!activeSitePlacement) return;

    const saveBtn = document.getElementById("sitePlacementEditorSave");
    const itemType = activeSitePlacement.itemType;
    const items = activeSitePlacementSelected.map(code => (
        itemType === "product" ? { productCode: code } : { promoCode: code }
    ));

    try {
        window.AZIEL_UI?.button?.setLoading(saveBtn, { text: adminT("loading", "Loading") });
        const data = await adminFetch(`/api/admin/site-placements/${encodeURIComponent(activeSitePlacement.placementCode)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                managed: true,
                items
            })
        });

        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("catalog_update_failed", "Catalog update failed"), "error");
            return;
        }

        await loadAdminSitePlacements(true);
        closeSitePlacementEditor();
        showAdminToast?.(adminT("home_placement_saved", "Home placement saved"), "success");
    } finally {
        window.AZIEL_UI?.button?.reset(saveBtn);
    }
}

function closeSitePlacementEditor() {
    document.getElementById("sitePlacementEditorModal")?.classList.remove("show");
}

function sitePlacementItemCode(item = {}) {
    return item.productCode || item.promoCode || "";
}

function sitePlacementItemTitle(item = {}) {
    return item.name || item.productCode || item.promoCode || "";
}

function sitePlacementItemMeta(item = {}) {
    if (activeSitePlacement?.itemType === "promo" || item.promoCode) {
        const regions = Array.isArray(item.regions) ? item.regions.join(", ") : "";
        return [item.promoCode, item.state, regions].filter(Boolean).join(" · ");
    }

    const regions = Array.isArray(item.supportedRegions) ? item.supportedRegions.join(", ") : "";
    return [item.productCode, item.enabled === false ? adminT("disabled", "Disabled") : adminT("enabled", "Enabled"), regions].filter(Boolean).join(" · ");
}

function sitePlacementLabel(placement = {}) {
    const key = `placement_${String(placement.placementCode || "").toLowerCase()}`;
    return adminT(key, placement.label || placement.placementCode || "Placement");
}

function sitePlacementDescription(placement = {}) {
    const key = `placement_${String(placement.placementCode || "").toLowerCase()}_sub`;
    if (placement.itemType === "promo") {
        return adminT(key, "Active PromoCode entries shown on the Home page for eligible regions.");
    }
    return adminT(key, "Catalog products shown on the Home page in the selected order.");
}

function escapeSitePlacementHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
