// frontend/js/admin-promos.js
// AZIEL Admin Promo Code Manager.

let adminPromosInitialized = false;
let adminPromos = [];
let adminPromoCatalog = [];
let promoSavePending = false;

document.addEventListener("DOMContentLoaded", () => {
    initAdminPromosController();
});

function initAdminPromosController() {
    if (adminPromosInitialized) return;
    adminPromosInitialized = true;

    document.getElementById("addPromoBtn")?.addEventListener("click", () => openPromoEditor());

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "promos") {
            loadAdminPromos();
        }
    });

    window.addEventListener("aziel:admin-locale-changed", () => renderAdminPromos());
}

async function loadAdminPromos(force = false) {
    const list = document.getElementById("adminPromoList");
    if (!list) return;

    if (adminPromos.length && !force) {
        renderAdminPromos();
        return;
    }

    list.innerHTML = `
        <div class="admin-dashboard-skeleton"></div>
        <div class="admin-dashboard-skeleton"></div>
    `;

    const data = await adminFetch("/api/admin/promos");
    if (!data?.success) {
        list.innerHTML = `<p class="admin-empty-state">${escapePromoHtml(data?.message || adminT("promo_load_failed", "Promo codes could not be loaded"))}</p>`;
        return;
    }

    adminPromos = Array.isArray(data.promos) ? data.promos : [];
    renderAdminPromos();
}

async function loadPromoCatalog() {
    if (adminPromoCatalog.length) return adminPromoCatalog;
    const data = await adminFetch("/api/admin/catalog/products");
    const products = Array.isArray(data?.products) ? data.products : [];
    adminPromoCatalog = await Promise.all(products.map(async product => {
        const packageData = await adminFetch(`/api/admin/catalog/products/${encodeURIComponent(product.productCode)}/packages`);
        return {
            ...product,
            packages: Array.isArray(packageData?.packages) ? packageData.packages : []
        };
    }));
    return adminPromoCatalog;
}

function renderAdminPromos() {
    const list = document.getElementById("adminPromoList");
    if (!list) return;

    if (!adminPromos.length) {
        list.innerHTML = `<p class="admin-empty-state">${adminT("no_promos_found", "No promo codes found")}</p>`;
        return;
    }

    list.innerHTML = adminPromos.map(promo => `
        <article class="promo-row" data-promo-id="${escapePromoHtml(promo.id)}">
            <div class="promo-row-main">
                <strong>${escapePromoHtml(promo.name)}</strong>
                <small>${escapePromoHtml(promo.code)} · ${adminT(promo.discountType.toLowerCase(), promo.discountType)} · ${formatPromoRegions(promo.regions)}</small>
                <small>${formatPromoDiscount(promo)} · ${adminT("minimum_order", "Minimum")}: ${formatPromoMinimum(promo)}</small>
            </div>
            <div class="promo-row-status">
                <b class="admin-status-pill ${promoStateClass(promo.state)}">${adminT(String(promo.state || "").toLowerCase(), promo.state || "")}</b>
                <small>${Number(promo.consumedCount || 0)} ${adminT("used", "used")} · ${Number(promo.reservedCount || 0)} ${adminT("reserved", "reserved")}</small>
            </div>
            <div class="catalog-package-actions">
                <button class="admin-secondary-btn" type="button" data-edit-promo="${escapePromoHtml(promo.id)}">${adminT("edit", "Edit")}</button>
                <button class="admin-secondary-btn ${promo.enabled ? "danger" : ""}" type="button" data-toggle-promo="${escapePromoHtml(promo.id)}">
                    ${adminT(promo.enabled ? "disable" : "enable", promo.enabled ? "Disable" : "Enable")}
                </button>
                <button class="admin-icon-btn danger" type="button" data-remove-promo="${escapePromoHtml(promo.id)}">${adminT("remove", "Remove")}</button>
            </div>
        </article>
    `).join("");

    list.querySelectorAll("[data-edit-promo]").forEach(btn => {
        btn.addEventListener("click", () => openPromoEditor(findPromo(btn.dataset.editPromo)));
    });
    list.querySelectorAll("[data-toggle-promo]").forEach(btn => {
        btn.addEventListener("click", () => togglePromo(findPromo(btn.dataset.togglePromo)));
    });
    list.querySelectorAll("[data-remove-promo]").forEach(btn => {
        btn.addEventListener("click", () => removePromo(btn.dataset.removePromo));
    });
}

async function openPromoEditor(promo = null) {
    await loadPromoCatalog();
    ensurePromoEditorModal();

    const modal = document.getElementById("promoEditorModal");
    modal.dataset.promoId = promo?.id || "";
    modal.querySelector("#promoEditorTitle").textContent = promo ? adminT("update_promo_code", "Update Promo Code") : adminT("create_promo_code", "Create Promo Code");
    modal.querySelector("#promoName").value = promo?.name || "";
    modal.querySelector("#promoCode").value = promo?.code || "";
    modal.querySelector("#promoCode").readOnly = Boolean(promo);
    modal.querySelector("#promoImmutableNote").hidden = !promo;
    modal.querySelector("#promoDiscountType").value = promo?.discountType || "PERCENTAGE";
    modal.querySelector("#promoPercentageValue").value = promo?.percentageValue || "";
    modal.querySelector("#promoFixedMM").value = promo?.fixedAmounts?.MM || "";
    modal.querySelector("#promoFixedTH").value = promo?.fixedAmounts?.TH || "";
    modal.querySelector("#promoMaxMM").value = promo?.maximumDiscountAmounts?.MM || "";
    modal.querySelector("#promoMaxTH").value = promo?.maximumDiscountAmounts?.TH || "";
    modal.querySelector("#promoMinMM").value = promo?.minimumOrderAmounts?.MM || "";
    modal.querySelector("#promoMinTH").value = promo?.minimumOrderAmounts?.TH || "";
    modal.querySelector("#promoUsageLimit").value = promo?.usageLimit || "";
    modal.querySelector("#promoPerUserLimit").value = promo?.perUserLimit || "";
    modal.querySelector("#promoStarts").value = toPromoDatetimeValue(promo?.startsAt);
    modal.querySelector("#promoEnds").value = toPromoDatetimeValue(promo?.endsAt);
    modal.querySelector("#promoEnabled").checked = promo?.enabled === true;
    modal.querySelector("#promoRegionMM").checked = !promo || promo.regions?.includes("MM");
    modal.querySelector("#promoRegionTH").checked = !promo || promo.regions?.includes("TH");
    modal.querySelector("#promoEligibilityMode").value = promo?.eligibilityMode || "ALL";
    modal.dataset.activePackageProduct = promo?.eligiblePackages?.[0]?.productCode || adminPromoCatalog[0]?.productCode || "";

    renderPromoEligibility(modal, promo);
    syncPromoEditorMode(modal);

    modal.querySelector("#promoDiscountType").onchange = () => syncPromoEditorMode(modal);
    modal.querySelector("#promoEligibilityMode").onchange = () => syncPromoEditorMode(modal);
    modal.querySelector("#promoRegionMM").onchange = () => syncPromoEditorMode(modal);
    modal.querySelector("#promoRegionTH").onchange = () => syncPromoEditorMode(modal);
    modal.querySelector("#promoPackageSearch").oninput = () => filterPromoPackages(modal);
    modal.querySelector("#promoCancel").onclick = () => modal.classList.remove("show");
    modal.querySelector("#promoSave").onclick = () => savePromo(promo);
    modal.querySelector("#promoSave").textContent = promo ? adminT("save_changes", "Save Changes") : adminT("create_promo_code", "Create Promo Code");
    modal.classList.add("show");
}

function ensurePromoEditorModal() {
    if (document.getElementById("promoEditorModal")) return;

    const modal = document.createElement("div");
    modal.id = "promoEditorModal";
    modal.className = "admin-action-modal promo-edit-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box promo-editor-box">
            <header class="promo-editor-head">
                <div>
                    <h3 id="promoEditorTitle">${adminT("create_promo_code", "Create Promo Code")}</h3>
                    <p>${adminT("promo_editor_sub", "Configure one server-authoritative promo rule.")}</p>
                </div>
                <button id="promoEditorClose" class="admin-icon-btn" type="button" aria-label="${adminT("close", "Close")}">&times;</button>
            </header>

            <div class="promo-editor-body">
                <div class="promo-workspace-grid">
                    <section class="promo-editor-section">
                        <h4>${adminT("basic_information", "Basic Information")}</h4>
                        <div class="promo-field-grid">
                            <label>${adminT("name", "Name")}<input id="promoName" type="text"></label>
                            <label class="promo-code-field">${adminT("code", "Code")}
                                <span class="promo-input-with-note">
                                    <input id="promoCode" type="text" maxlength="32">
                                    <small id="promoImmutableNote">${adminT("immutable", "Immutable")}</small>
                                </span>
                            </label>
                            <label>${adminT("discount_type", "Discount Type")}
                                <select id="promoDiscountType">
                                    <option value="PERCENTAGE">${adminT("percentage", "Percentage")}</option>
                                    <option value="FIXED">${adminT("fixed_amount", "Fixed Amount")}</option>
                                </select>
                            </label>
                            <label data-promo-field="percentage">${adminT("percentage", "Percentage")}<input id="promoPercentageValue" type="number" min="0" max="100" step="0.01"></label>
                        </div>
                        <label class="promo-checkbox"><input id="promoEnabled" type="checkbox"> ${adminT("enabled", "Enabled")}</label>
                    </section>

                    <section class="promo-editor-section">
                        <h4>${adminT("limits_schedule", "Limits & Schedule")}</h4>
                        <div class="promo-field-grid">
                            <label>${adminT("usage_limit", "Usage Limit")}<input id="promoUsageLimit" type="number" min="0"></label>
                            <label>${adminT("per_user_limit", "Per User Limit")}<input id="promoPerUserLimit" type="number" min="0"></label>
                            <label>${adminT("starts_at", "Starts At")}<input id="promoStarts" type="datetime-local"></label>
                            <label>${adminT("ends_at", "Ends At")}<input id="promoEnds" type="datetime-local"></label>
                        </div>
                    </section>

                    <section class="promo-editor-section">
                        <h4>${adminT("discount_rules", "Discount Rules")}</h4>
                        <div class="promo-field-grid">
                            <label data-promo-field="fixed" data-promo-region="MM">${adminT("fixed_mmk", "Fixed MMK")}<input id="promoFixedMM" type="number" min="0"></label>
                            <label data-promo-field="fixed" data-promo-region="TH">${adminT("fixed_thb", "Fixed THB")}<input id="promoFixedTH" type="number" min="0"></label>
                            <label data-promo-field="percentage" data-promo-region="MM">${adminT("max_discount_mmk", "Max Discount MMK")}<input id="promoMaxMM" type="number" min="0"></label>
                            <label data-promo-field="percentage" data-promo-region="TH">${adminT("max_discount_thb", "Max Discount THB")}<input id="promoMaxTH" type="number" min="0"></label>
                            <label data-promo-region="MM">${adminT("minimum_mmk", "Minimum MMK")}<input id="promoMinMM" type="number" min="0"></label>
                            <label data-promo-region="TH">${adminT("minimum_thb", "Minimum THB")}<input id="promoMinTH" type="number" min="0"></label>
                        </div>
                    </section>

                    <section class="promo-editor-section promo-region-section">
                        <h4>${adminT("regions", "Regions")}</h4>
                        <div class="promo-region-pills">
                            <label><input id="promoRegionMM" type="checkbox" value="MM"><span>${adminT("myanmar", "Myanmar")} <b>MM</b></span></label>
                            <label><input id="promoRegionTH" type="checkbox" value="TH"><span>${adminT("thailand", "Thailand")} <b>TH</b></span></label>
                        </div>
                    </section>
                </div>

                <section class="promo-editor-section promo-eligibility-section">
                    <div class="promo-section-row">
                        <h4>${adminT("eligibility", "Eligibility")}</h4>
                        <label>${adminT("eligibility_mode", "Eligibility Mode")}
                            <select id="promoEligibilityMode">
                                <option value="ALL">${adminT("all_products", "All Products")}</option>
                                <option value="PRODUCTS">${adminT("selected_products", "Selected Products")}</option>
                                <option value="PACKAGES">${adminT("selected_packages", "Selected Packages")}</option>
                            </select>
                        </label>
                    </div>
                    <p id="promoAllProductsSummary" class="promo-eligibility-summary">${adminT("all_active_products_packages", "All active catalog products and eligible packages.")}</p>
                    <input id="promoPackageSearch" class="promo-package-search" type="search" placeholder="${adminT("search_packages", "Search packages")}">
                    <div id="promoPackageProductTabs" class="promo-package-tabs"></div>
                    <div id="promoEligibilityList" class="promo-eligibility-list"></div>
                </section>
            </div>

            <footer class="promo-editor-footer">
                <p id="promoEditorError" class="admin-action-modal-error"></p>
                <div class="admin-action-modal-actions">
                    <button id="promoCancel" type="button">${adminT("cancel", "Cancel")}</button>
                    <button id="promoSave" type="button">${adminT("create_promo_code", "Create Promo Code")}</button>
                </div>
            </footer>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    modal.querySelector("#promoEditorClose")?.addEventListener("click", () => modal.classList.remove("show"));
    document.body.appendChild(modal);
}

function renderPromoEligibility(modal, promo = null) {
    const list = modal.querySelector("#promoEligibilityList");
    const tabs = modal.querySelector("#promoPackageProductTabs");
    if (!list) return;

    const productSet = new Set(promo?.eligibleProductCodes || []);
    const packageSet = new Set((promo?.eligiblePackages || []).map(item => `${item.productCode}:${item.packageCode}`));

    tabs.innerHTML = adminPromoCatalog.map(product => `
        <button class="promo-package-tab" type="button" data-promo-package-tab="${escapePromoHtml(product.productCode)}">
            ${escapePromoHtml(product.name || product.productCode)}
        </button>
    `).join("");

    list.innerHTML = `
        <div class="promo-product-grid">
            ${adminPromoCatalog.map(product => `
                <label class="promo-select-card">
                    <input type="checkbox" data-promo-product="${escapePromoHtml(product.productCode)}" ${productSet.has(product.productCode) ? "checked" : ""}>
                    <span>${escapePromoHtml(product.name || product.productCode)}</span>
                    <small>${escapePromoHtml(product.productCode)}</small>
                </label>
            `).join("")}
        </div>
        <div class="promo-package-workspace">
            ${adminPromoCatalog.map(product => `
                <section class="promo-package-panel" data-promo-package-panel="${escapePromoHtml(product.productCode)}">
                    <h5>${escapePromoHtml(product.name || product.productCode)}</h5>
                    <div class="promo-package-grid">
                        ${(product.packages || []).map(pkg => `
                            <label class="promo-select-card promo-package-card" data-promo-package-card data-search-text="${escapePromoHtml(`${pkg.name || ""} ${pkg.packageCode || ""}`.toLowerCase())}">
                                <input type="checkbox" data-promo-package-product="${escapePromoHtml(product.productCode)}" data-promo-package="${escapePromoHtml(pkg.packageCode)}" ${packageSet.has(`${product.productCode}:${pkg.packageCode}`) ? "checked" : ""}>
                                <span>${escapePromoHtml(pkg.name || pkg.packageCode)}</span>
                                <small>${escapePromoHtml(pkg.packageCode)}</small>
                            </label>
                        `).join("") || `<p class="admin-empty-state">${adminT("no_packages_found", "No packages found")}</p>`}
                    </div>
                </section>
            `).join("")}
        </div>
    `;

    tabs.querySelectorAll("[data-promo-package-tab]").forEach(tab => {
        tab.addEventListener("click", () => {
            modal.dataset.activePackageProduct = tab.dataset.promoPackageTab || "";
            syncPromoEditorMode(modal);
        });
    });
}

function syncPromoEditorMode(modal) {
    const discountType = modal.querySelector("#promoDiscountType")?.value || "PERCENTAGE";
    const eligibilityMode = modal.querySelector("#promoEligibilityMode")?.value || "ALL";
    const mmTargeted = Boolean(modal.querySelector("#promoRegionMM")?.checked);
    const thTargeted = Boolean(modal.querySelector("#promoRegionTH")?.checked);

    modal.querySelectorAll("[data-promo-field], [data-promo-region]").forEach(field => {
        const type = field.dataset.promoField || "";
        const region = field.dataset.promoRegion;
        const typeHidden = type && type !== (discountType === "FIXED" ? "fixed" : "percentage");
        const regionHidden = (region === "MM" && !mmTargeted) || (region === "TH" && !thTargeted);
        field.hidden = Boolean(typeHidden || regionHidden);
    });

    modal.querySelector("#promoAllProductsSummary").hidden = eligibilityMode !== "ALL";
    modal.querySelector("#promoEligibilityList").hidden = eligibilityMode === "ALL";
    modal.querySelector("#promoPackageProductTabs").hidden = eligibilityMode !== "PACKAGES";
    modal.querySelector("#promoPackageSearch").hidden = eligibilityMode !== "PACKAGES";

    modal.querySelector(".promo-product-grid")?.classList.toggle("is-hidden", eligibilityMode !== "PRODUCTS");
    modal.querySelector(".promo-package-workspace")?.classList.toggle("is-hidden", eligibilityMode !== "PACKAGES");

    const activeProduct =
        modal.dataset.activePackageProduct ||
        adminPromoCatalog[0]?.productCode ||
        "";

    modal.querySelectorAll("[data-promo-package-tab]").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.promoPackageTab === activeProduct);
    });

    modal.querySelectorAll("[data-promo-package-panel]").forEach(panel => {
        panel.hidden = panel.dataset.promoPackagePanel !== activeProduct;
    });

    filterPromoPackages(modal);
}

function filterPromoPackages(modal) {
    const query = String(modal.querySelector("#promoPackageSearch")?.value || "").trim().toLowerCase();
    modal.querySelectorAll("[data-promo-package-card]").forEach(card => {
        const text = card.dataset.searchText || "";
        card.hidden = Boolean(query) && !text.includes(query);
    });
}

async function savePromo(existing = null) {
    if (promoSavePending) return;
    const modal = document.getElementById("promoEditorModal");
    const saveBtn = modal?.querySelector("#promoSave");
    const errorEl = modal?.querySelector("#promoEditorError");
    const payload = readPromoPayload(modal, existing);

    modal?.classList.remove("show");
    const result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
        title: existing ? adminT("update_promo_code", "Update Promo Code") : adminT("create_promo_code", "Create Promo Code"),
        message: existing ? adminT("update_promo_message", "Save changes to this promo code?") : adminT("create_promo_message", "Create this promo code?"),
        input: false,
        confirmText: existing ? adminT("save_changes", "Save Changes") : adminT("create_promo_code", "Create Promo Code"),
        cancelText: adminT("cancel", "Cancel")
    });

    if (result && result.confirmed === false) {
        modal?.classList.add("show");
        return;
    }

    promoSavePending = true;
    if (saveBtn) saveBtn.disabled = true;
    if (errorEl) errorEl.textContent = "";

    try {
        const endpoint = existing ? `/api/admin/promos/${encodeURIComponent(existing.id)}` : "/api/admin/promos";
        const data = await adminFetch(endpoint, {
            method: existing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!data?.success) {
            if (errorEl) errorEl.textContent = data?.message || adminT("promo_save_failed", "Promo code could not be saved");
            modal?.classList.add("show");
            return;
        }

        adminPromos = [];
        await loadAdminPromos(true);
        showAdminToast(adminT("promo_saved", "Promo code saved"), "success");
    } finally {
        promoSavePending = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}

function readPromoPayload(modal, existing = null) {
    const mode = modal.querySelector("#promoEligibilityMode")?.value || "ALL";
    return {
        name: modal.querySelector("#promoName")?.value || "",
        code: existing?.code || modal.querySelector("#promoCode")?.value || "",
        discountType: modal.querySelector("#promoDiscountType")?.value || "PERCENTAGE",
        percentageValue: numberValue("#promoPercentageValue"),
        fixedAmounts: { MM: numberValue("#promoFixedMM"), TH: numberValue("#promoFixedTH") },
        maximumDiscountAmounts: { MM: numberValue("#promoMaxMM"), TH: numberValue("#promoMaxTH") },
        minimumOrderAmounts: { MM: numberValue("#promoMinMM"), TH: numberValue("#promoMinTH") },
        regions: [
            modal.querySelector("#promoRegionMM")?.checked ? "MM" : "",
            modal.querySelector("#promoRegionTH")?.checked ? "TH" : ""
        ].filter(Boolean),
        eligibilityMode: mode,
        eligibleProductCodes: mode === "PRODUCTS"
            ? Array.from(modal.querySelectorAll("[data-promo-product]:checked")).map(input => input.dataset.promoProduct)
            : [],
        eligiblePackages: mode === "PACKAGES"
            ? Array.from(modal.querySelectorAll("[data-promo-package]:checked")).map(input => ({
                productCode: input.dataset.promoPackageProduct,
                packageCode: input.dataset.promoPackage
            }))
            : [],
        usageLimit: numberValue("#promoUsageLimit"),
        perUserLimit: numberValue("#promoPerUserLimit"),
        startsAt: fromPromoDatetimeValue(modal.querySelector("#promoStarts")?.value),
        endsAt: fromPromoDatetimeValue(modal.querySelector("#promoEnds")?.value),
        enabled: Boolean(modal.querySelector("#promoEnabled")?.checked)
    };
}

async function togglePromo(promo) {
    if (!promo) return;
    const payload = {
        ...promo,
        enabled: !promo.enabled
    };
    const data = await adminFetch(`/api/admin/promos/${encodeURIComponent(promo.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!data?.success) {
        showAdminToast(data?.message || adminT("promo_save_failed", "Promo code could not be saved"), "error");
        return;
    }

    const index = adminPromos.findIndex(item => item.id === promo.id);
    if (index >= 0) adminPromos[index] = data.promo;
    renderAdminPromos();
}

async function removePromo(id) {
    if (!id) return;
    const confirmed = window.confirm(adminT("remove_promo_confirm", "Remove this promo code? Existing orders keep their snapshots."));
    if (!confirmed) return;

    const data = await adminFetch(`/api/admin/promos/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!data?.success) {
        showAdminToast(data?.message || adminT("promo_remove_failed", "Promo code could not be removed"), "error");
        return;
    }

    adminPromos = adminPromos.filter(promo => promo.id !== id);
    renderAdminPromos();
    showAdminToast(adminT("promo_removed", "Promo code removed"), "success");
}

function findPromo(id) {
    return adminPromos.find(promo => promo.id === id) || null;
}

function numberValue(selector) {
    const value = Number(document.querySelector(selector)?.value || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatPromoRegions(regions = []) {
    return regions.join(", ") || "-";
}

function formatPromoDiscount(promo) {
    if (promo.discountType === "PERCENTAGE") return `${Number(promo.percentageValue || 0)}%`;
    return `MM ${Number(promo.fixedAmounts?.MM || 0).toLocaleString()} / TH ${Number(promo.fixedAmounts?.TH || 0).toLocaleString()}`;
}

function formatPromoMinimum(promo) {
    return `MM ${Number(promo.minimumOrderAmounts?.MM || 0).toLocaleString()} / TH ${Number(promo.minimumOrderAmounts?.TH || 0).toLocaleString()}`;
}

function promoStateClass(state = "") {
    const safe = String(state).toLowerCase();
    if (safe === "active") return "success";
    if (safe === "scheduled") return "pending";
    if (safe === "disabled" || safe === "expired") return "warn";
    return "";
}

function toPromoDatetimeValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
}

function fromPromoDatetimeValue(value) {
    return value ? new Date(value).toISOString() : null;
}

function escapePromoHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
